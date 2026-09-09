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

  // --- 1. Hàm gọi AI (Sử dụng Google Gemini) ---
  async analyzeSentiment(content: string) {
    try {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        this.logger.warn('⚠️ GEMINI_API_KEY is missing. Returning neutral sentiment.');
        return { label: 'NEUTRAL', score: 0.5, hashtags: [] };
      }

      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

      const prompt = `Phân tích đoạn đánh giá nhà hàng/món ăn sau đây: "${content}"

Yêu cầu trả về kết quả dưới định dạng JSON chính xác với 3 trường:
1. "label": Một trong các giá trị "POSITIVE", "NEGATIVE", "NEUTRAL".
2. "score": Độ tự tin/mức độ tích cực từ 0.0 đến 1.0.
3. "hashtags": Mảng các từ khóa nổi bật (tối đa 3 từ khóa, bắt đầu bằng #, ví dụ: ["#monngon", "#phucvutot"]).

Quy tắc đặc biệt:
- Nếu nhận xét mơ hồ, chứa ký tự vô nghĩa (spam), hoặc HOÀN TOÀN KHÔNG LIÊN QUAN đến ẩm thực/nhà hàng, hãy trả về label: "NEUTRAL", score: 0.5, hashtags: [].

Không giải thích gì thêm, chỉ trả về JSON hợp lệ.`;

      const result = await model.generateContent(prompt);
      const responseText = result.response.text();
      
      const cleanJson = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
      const parsedData = JSON.parse(cleanJson);

      return {
        label: parsedData.label?.toUpperCase() || 'NEUTRAL',
        score: parsedData.score || 0.5,
        hashtags: parsedData.hashtags || []
      };
    } catch (error) {
      this.logger.error(`⚠️ Lỗi Gemini AI Service: ${error.message}`);
      return { label: 'NEUTRAL', score: 0.5, hashtags: [] };
    }
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
    return this.reviewModel.find({ urlGoc: url }).sort({ createdAt: -1 }).exec();
  }

  async findByRestaurantId(idOrSlug: string): Promise<Review[]> {
    let targetId: any = idOrSlug;
    if (!Types.ObjectId.isValid(idOrSlug) || !/^[0-9a-fA-F]{24}$/.test(idOrSlug)) {
      const restaurant = await this.restaurantModel.findOne({
        $or: [
          { slug: idOrSlug },
          { urlGoc: { $regex: `${idOrSlug}$`, $options: 'i' } }
        ]
      }).exec();
      if (!restaurant) return [];
      targetId = restaurant._id;
    }
    return this.reviewModel.find({ restaurantId: targetId }).sort({ createdAt: -1 }).exec();
  }

  async getAllReviews(query: any = {}) {
    const page = parseInt(query.page, 10) || 1;
    const limit = parseInt(query.limit, 10) || 10;
    const skip = (page - 1) * limit;

    const filter: any = {};
    if (query.sentiment && query.sentiment !== 'all') {
      filter.aiSentimentLabel = query.sentiment;
    }
    if (query.search) {
      filter.$or = [
        { noiDung: { $regex: query.search, $options: 'i' } },
        { tenNguoiDung: { $regex: query.search, $options: 'i' } }
      ];
    }
    
    const [data, total] = await Promise.all([
      this.reviewModel.find(filter)
        .populate('restaurantId', 'tenQuan diaChi')
        .sort({ createdAt: -1 })
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
}