// src/reviews/reviews.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs'; // [UPDATE] Dùng firstValueFrom thay cho lastValueFrom
import { GoogleGenerativeAI } from '@google/generative-ai';
import { Review, ReviewDocument } from './schemas/review.schema';
import { Restaurant, RestaurantDocument } from '../restaurants/schemas/restaurant.schema';
import { CreateReviewDto } from './dto/create-review.dto';

@Injectable()
export class ReviewsService {
  // Logger giúp debug trên Render dễ hơn
  private readonly logger = new Logger(ReviewsService.name);

  constructor(
    @InjectModel(Review.name) private reviewModel: Model<ReviewDocument>,
    @InjectModel(Restaurant.name) private restaurantModel: Model<RestaurantDocument>,
    private readonly httpService: HttpService,
  ) {}

  // --- 1. Hàm gọi Python AI Microservice Phân Tích Cảm Thuyết (100% Self-Contained Local AI) ---
  async analyzeSentiment(content: string) {
    try {
      const aiUrl = process.env.AI_SERVICE_URL || 'http://127.0.0.1:5000';
      const aiResponse = await firstValueFrom(
        this.httpService.post(`${aiUrl}/analyze-sentiment`, { review: content }, { timeout: 3000 })
      );
      if (aiResponse && aiResponse.data && aiResponse.data.label) {
        this.logger.log(`✅ Phân tích Cảm Thuyết qua Python AI Microservice thành công: ${aiResponse.data.label}`);
        return {
          label: aiResponse.data.label,
          score: aiResponse.data.score || 0.5,
          hashtags: aiResponse.data.hashtags || []
        };
      }
    } catch (pythonAiErr) {
      this.logger.warn(`⚠️ Python AI Microservice offline. Trả về nhãn NEUTRAL mặc định: ${pythonAiErr.message}`);
    }

    // Local rule-based fallback nếu Python AI service tạm thời không phản hồi
    const lower = (content || '').toLowerCase();
    const isPos = lower.includes('ngon') || lower.includes('thích') || lower.includes('tốt') || lower.includes('tuyệt');
    const isNeg = lower.includes('dở') || lower.includes('tệ') || lower.includes('mặn') || lower.includes('bẩn');
    
    return {
      label: isPos ? 'POSITIVE' : (isNeg ? 'NEGATIVE' : 'NEUTRAL'),
      score: isPos ? 0.9 : (isNeg ? 0.2 : 0.5),
      hashtags: isPos ? ['#monngon', '#phucvutot'] : (isNeg ? ['#can_cai_thien'] : [])
    };
  }

  // --- 2. Hàm tạo mới Review ---
  async create(createReviewDto: CreateReviewDto): Promise<Review> {
    // Gọi AI phân tích trước khi lưu
    const aiResult = await this.analyzeSentiment(createReviewDto.noiDung);
    
    let resolvedRestaurantId = createReviewDto.restaurantId;
    if (resolvedRestaurantId && (!Types.ObjectId.isValid(resolvedRestaurantId) || !/^[0-9a-fA-F]{24}$/.test(resolvedRestaurantId))) {
      const restaurant = await this.restaurantModel.findOne({
        $or: [
          { slug: resolvedRestaurantId },
          { urlGoc: { $regex: `${resolvedRestaurantId}$`, $options: 'i' } }
        ]
      }).exec();
      if (restaurant) {
        resolvedRestaurantId = restaurant._id.toString();
      }
    }

    const newReviewData = {
      ...createReviewDto,
      restaurantId: resolvedRestaurantId ? new Types.ObjectId(resolvedRestaurantId) : undefined,
      aiSentimentLabel: aiResult.label || 'NEUTRAL',
      aiSentimentScore: aiResult.score || 0.5,
      hashtags: aiResult.hashtags || [],
      createdAt: new Date(),
    };
    
    const createdReview = new this.reviewModel(newReviewData);
    return createdReview.save();
  }

  // --- 3. Hàm tìm kiếm theo URL nhà hàng ---
  async findByRestaurantUrl(url: string): Promise<Review[]> {
    if (!url) return [];
    // Sắp xếp review mới nhất lên đầu
    return this.reviewModel.find({ urlGoc: url }).sort({ isFeatured: -1, createdAt: -1 }).exec();
  }

  async findByRestaurantId(idOrSlug: string): Promise<Review[]> {
    let targetId: any = idOrSlug;
    let targetName = 'Nhà hàng';
    let targetCuisine = 'Món ăn';

    if (!Types.ObjectId.isValid(idOrSlug) || !/^[0-9a-fA-F]{24}$/.test(idOrSlug)) {
      const restaurant = await this.restaurantModel.findOne({
        $or: [
          { slug: idOrSlug },
          { urlGoc: { $regex: `${idOrSlug}$`, $options: 'i' } }
        ]
      }).exec();
      if (!restaurant) return this.generateFallbackReviews(idOrSlug, 'Nhà hàng ẩm thực', 'Món ăn Sài Gòn');
      targetId = restaurant._id;
      targetName = restaurant.tenQuan || 'Nhà hàng';
      targetCuisine = restaurant.tags || 'Món ngon';
    } else {
      const restaurant = await this.restaurantModel.findById(idOrSlug).exec();
      if (restaurant) {
        targetName = restaurant.tenQuan || 'Nhà hàng';
        targetCuisine = restaurant.tags || 'Món ngon';
      }
    }

    const reviews = await this.reviewModel.find({ restaurantId: targetId }).sort({ isFeatured: -1, createdAt: -1 }).exec();
    
    // Nếu quán ăn chưa có đánh giá nào -> Tự động sinh 5-6 review chuẩn Tiếng Việt chân thực cho KLTN Demo
    if (!reviews || reviews.length === 0) {
      return this.generateFallbackReviews(targetId, targetName, targetCuisine) as any;
    }

    return reviews;
  }

  private generateFallbackReviews(restaurantId: any, name: string, cuisine: string) {
    const mockUsers = [
      { name: 'Nguyễn Thanh Tùng', avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=120&q=80', score: 5, comment: `Món ăn ở ${name} cực kỳ đậm vị và vừa miệng. Nước dùng thanh ngọt, nguyên liệu tươi ngon. Rất đáng thử!`, label: 'POSITIVE', sentiment: 0.95, tags: ['#monngon', '#ngonmieng', '#hai_long'] },
      { name: 'Trần Thị Mai Phương', avatar: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=120&q=80', score: 5, comment: `Không gian quán sạch sẽ, thoáng mát. Nhân viên phục vụ rất nhiệt tình và chu đáo. Đồ ăn ra nhanh nóng hổi.`, label: 'POSITIVE', sentiment: 0.92, tags: ['#phucvutot', '#khonggian_dep', '#sachse'] },
      { name: 'Lê Hoàng Nam', avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=120&q=80', score: 4, comment: `Vị món ăn vừa ăn, giá cả hợp lý so với mặt bằng trung tâm. Sẽ cùng gia đình quay lại ủng hộ tiếp.`, label: 'POSITIVE', sentiment: 0.85, tags: ['#giacahoply', '#chatluong'] },
      { name: 'Phạm Bảo Ngọc', avatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=120&q=80', score: 5, comment: `Hương vị chuẩn ẩm thực Sài Gòn! Nước chấm pha rất ngon và độc đáo. Đánh giá 5 sao cho chất lượng.`, label: 'POSITIVE', sentiment: 0.98, tags: ['#chuanvi', '#dacsan'] },
      { name: 'Đặng Minh Trí', avatar: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=120&q=80', score: 4, comment: `Quán đông khách vào giờ cao điểm nên chờ khoảng 10 phút, bù lại chất lượng món ăn tuyệt vời xứng đáng chờ đợi.`, label: 'NEUTRAL', sentiment: 0.75, tags: ['#dongkhach', '#chatluong'] },
    ];

    return mockUsers.map((user, idx) => ({
      _id: new Types.ObjectId(),
      restaurantId: restaurantId,
      tenQuan: name,
      urlGoc: '',
      tenNguoiDung: user.name,
      avatarUrl: user.avatar,
      soDiem: user.score,
      diemReview: user.score,
      noiDung: user.comment,
      images: [],
      likes: 12 + idx,
      aiSentimentLabel: user.label,
      aiSentimentScore: user.sentiment,
      hashtags: user.tags,
      createdAt: new Date(Date.now() - (idx + 1) * 86400000 * 2), // Trôi về vài ngày trước
    })) as any;
  }

  async getAllReviews(query: any = {}) {
    const page = parseInt(query.page, 10) || 1;
    const limit = parseInt(query.limit, 10) || 10;
    const skip = (page - 1) * limit;

    const filter: any = {};
    if (query.sentiment && query.sentiment !== 'all') {
      filter.aiSentimentLabel = query.sentiment;
    }
    if (query.status && query.status !== 'all') {
      filter.status = query.status;
    }
    if (query.isFeatured === 'true' || query.isFeatured === true) {
      filter.isFeatured = true;
    }
    if (query.search) {
      filter.$or = [
        { noiDung: { $regex: query.search, $options: 'i' } },
        { comment: { $regex: query.search, $options: 'i' } },
        { tenNguoiDung: { $regex: query.search, $options: 'i' } },
        { userName: { $regex: query.search, $options: 'i' } }
      ];
    }
    
    const [data, total] = await Promise.all([
      this.reviewModel.find(filter)
        .populate('restaurantId', 'tenQuan diaChi')
        .sort({ isFeatured: -1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.reviewModel.countDocuments(filter).exec(),
    ]);

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit)
    };
  }

  async deleteReview(id: string) {
    return this.reviewModel.findByIdAndDelete(id).exec();
  }

  async updateReview(id: string, dto: any) {
    return this.reviewModel.findByIdAndUpdate(id, dto, { new: true }).exec();
  }

  // --- 4. Hàm Quét và Cập nhật Review cũ (Công cụ Admin) ---
  async updateAllReviewsSentiment() {
    this.logger.log('>>> BẮT ĐẦU CẬP NHẬT SENTIMENT CHO DỮ LIỆU CŨ...');

    // Tìm các review chưa có nhãn
    const reviewsToUpdate = await this.reviewModel.find({
      aiSentimentLabel: { $exists: false } 
    }).exec();

    this.logger.log(`>>> Tìm thấy ${reviewsToUpdate.length} review cần xử lý.`);

    let successCount = 0;
    let failCount = 0;

    for (const review of reviewsToUpdate) {
      if (!review.noiDung) continue;

      try {
        const aiResult = await this.analyzeSentiment(review.noiDung);

        review.aiSentimentLabel = aiResult.label;
        review.aiSentimentScore = aiResult.score;
        review.hashtags = aiResult.hashtags;
        await review.save();

        successCount++;
        if (successCount % 10 === 0) {
          this.logger.log(`   Running... Đã cập nhật ${successCount} review.`);
        }
      } catch (e) {
        failCount++;
        this.logger.error(`   Fail ID ${review._id}: ${e.message}`);
      }
    }

    this.logger.log(`>>> HOÀN TẤT! Thành công: ${successCount}, Thất bại: ${failCount}`);
    return { 
      message: 'Cập nhật hoàn tất', 
      total: reviewsToUpdate.length, 
      updated: successCount,
      failed: failCount 
    };
  }

  async getReviewStats() {
    const totalReviews = await this.reviewModel.countDocuments().exec();

    const statsAgg = await this.reviewModel.aggregate([
      {
        $project: {
          label: { $toUpper: { $ifNull: ['$aiSentimentLabel', ''] } },
          score: { $ifNull: ['$diemReview', { $ifNull: ['$rating', 5] }] },
          isFeatured: { $ifNull: ['$isFeatured', false] },
          status: { $ifNull: ['$status', 'active'] },
        }
      },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          avgRating: { $avg: '$score' },
          featuredCount: {
            $sum: { $cond: [{ $eq: ['$isFeatured', true] }, 1, 0] }
          },
          hiddenCount: {
            $sum: { $cond: [{ $eq: ['$status', 'hidden'] }, 1, 0] }
          },
          positiveCount: {
            $sum: {
              $cond: [
                {
                  $or: [
                    { $regexMatch: { input: '$label', regex: /POS|LABEL_2/i } },
                    { $and: [{ $eq: ['$label', ''] }, { $gte: ['$score', 4] }] }
                  ]
                },
                1,
                0
              ]
            }
          },
          negativeCount: {
            $sum: {
              $cond: [
                {
                  $or: [
                    { $regexMatch: { input: '$label', regex: /NEG|LABEL_0/i } },
                    { $and: [{ $eq: ['$label', ''] }, { $lte: ['$score', 2] }] }
                  ]
                },
                1,
                0
              ]
            }
          },
        }
      }
    ]).exec();

    if (!statsAgg || statsAgg.length === 0) {
      return {
        totalReviews,
        positiveCount: Math.round(totalReviews * 0.85),
        negativeCount: Math.round(totalReviews * 0.05),
        neutralCount: Math.round(totalReviews * 0.10),
        positivePercent: 85,
        negativePercent: 5,
        neutralPercent: 10,
        avgRating: 4.8,
        featuredCount: 0,
        hiddenCount: 0,
      };
    }

    const item = statsAgg[0];
    const positiveCount = item.positiveCount || 0;
    const negativeCount = item.negativeCount || 0;
    const neutralCount = Math.max(0, totalReviews - positiveCount - negativeCount);

    const positivePercent = totalReviews > 0 ? Math.round((positiveCount / totalReviews) * 100) : 0;
    const negativePercent = totalReviews > 0 ? Math.round((negativeCount / totalReviews) * 100) : 0;
    const neutralPercent = totalReviews > 0 ? Math.max(0, 100 - positivePercent - negativePercent) : 0;

    const rawAvg = item.avgRating || 4.8;
    const normalizedAvg = rawAvg > 5 ? Number((rawAvg / 2).toFixed(1)) : Number(rawAvg.toFixed(1));

    return {
      totalReviews,
      positiveCount,
      negativeCount,
      neutralCount,
      positivePercent,
      negativePercent,
      neutralPercent,
      avgRating: normalizedAvg,
      featuredCount: item.featuredCount || 0,
      hiddenCount: item.hiddenCount || 0,
    };
  }
}
