// src/reviews/reviews.service.ts
import {
  Injectable,
  Logger,
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { Review, ReviewDocument } from './schemas/review.schema';
import {
  Restaurant,
  RestaurantDocument,
} from '../restaurants/schemas/restaurant.schema';
import { CreateReviewDto } from './dto/create-review.dto';
import { TasteDnaService } from '../taste-dna/taste-dna.service';
import { InteractionsService } from '../interactions/interactions.service';
import { formatRestaurantTagsString } from '@shared/utils/restaurant-normalizer.util';

@Injectable()
export class ReviewsService {
  private readonly logger = new Logger(ReviewsService.name);
  private readonly aiBaseUrl: string;
  private readonly internalAiKey: string;

  constructor(
    @InjectModel(Review.name) private reviewModel: Model<ReviewDocument>,
    @InjectModel(Restaurant.name)
    private restaurantModel: Model<RestaurantDocument>,
    private readonly httpService: HttpService,
    private readonly tasteDnaService: TasteDnaService,
    private readonly interactionsService: InteractionsService,
  ) {
    this.aiBaseUrl = process.env.AI_SERVICE_URL || 'http://127.0.0.1:5000';
    const key = process.env.INTERNAL_AI_KEY;
    if (!key || !key.trim()) {
      throw new Error(
        'Missing mandatory security configuration: INTERNAL_AI_KEY must be set in environment variables',
      );
    }
    this.internalAiKey = key.trim();
  }

  // --- 1. Hàm gọi Python AI Microservice Phân Tích Cảm Thuyết ---
  async analyzeSentiment(content: string) {
    try {
      const headers: Record<string, string> = {
        'X-Internal-AI-Key': this.internalAiKey,
      };
      const aiResponse = await firstValueFrom(
        this.httpService.post(
          `${this.aiBaseUrl}/analyze-sentiment`,
          { review: content },
          { headers, timeout: 3000 },
        ),
      );
      if (aiResponse && aiResponse.data && aiResponse.data.label) {
        this.logger.log(
          `✅ Phân tích Cảm Thuyết qua Python AI Microservice thành công: ${aiResponse.data.label}`,
        );
        return {
          label: aiResponse.data.label,
          score: aiResponse.data.score || 0.5,
          hashtags: aiResponse.data.hashtags || [],
        };
      }
    } catch (pythonAiErr: any) {
      const status = pythonAiErr?.response?.status;
      if (status === 401) {
        this.logger.error(
          'CRITICAL: AI Service sentiment authentication missing or rejected (HTTP 401).',
        );
        throw new UnauthorizedException(
          'AI Service authentication failed (HTTP 401)',
        );
      }
      if (status === 403) {
        this.logger.error(
          'CRITICAL: AI Service sentiment authentication forbidden (HTTP 403 invalid key).',
        );
        throw new ForbiddenException('AI Service forbidden (HTTP 403)');
      }
      this.logger.warn(
        `⚠️ Python AI Microservice offline. Trả về nhãn NEUTRAL mặc định: ${pythonAiErr.message}`,
      );
    }

    const lower = (content || '').toLowerCase();
    const isPos =
      lower.includes('ngon') ||
      lower.includes('thích') ||
      lower.includes('tốt') ||
      lower.includes('tuyệt');
    const isNeg =
      lower.includes('dở') ||
      lower.includes('tệ') ||
      lower.includes('mặn') ||
      lower.includes('bẩn');

    return {
      label: isPos ? 'POSITIVE' : isNeg ? 'NEGATIVE' : 'NEUTRAL',
      score: isPos ? 0.9 : isNeg ? 0.2 : 0.5,
      hashtags: isPos
        ? ['#monngon', '#phucvutot']
        : isNeg
          ? ['#can_cai_thien']
          : [],
    };
  }

  // --- 2. Hàm tạo mới Review & Tự động Reinforce Taste DNA (TASK-P1-02) ---
  async create(createReviewDto: CreateReviewDto): Promise<Review> {
    let resolvedRestaurantId = createReviewDto.restaurantId;
    if (
      !resolvedRestaurantId ||
      !Types.ObjectId.isValid(resolvedRestaurantId) ||
      !/^[0-9a-fA-F]{24}$/.test(resolvedRestaurantId)
    ) {
      const restaurant = await this.restaurantModel
        .findOne({
          $or: [
            { slug: resolvedRestaurantId },
            { urlGoc: { $regex: `${resolvedRestaurantId}$`, $options: 'i' } },
          ],
        })
        .exec();
      if (!restaurant) {
        throw new BadRequestException(
          `Invalid restaurant identifier "${String(createReviewDto.restaurantId)}"`,
        );
      }
      resolvedRestaurantId = restaurant._id.toString();
    } else {
      const exists = await this.restaurantModel
        .findById(resolvedRestaurantId)
        .exec();
      if (!exists) {
        throw new NotFoundException(
          `Restaurant with ID "${resolvedRestaurantId}" not found`,
        );
      }
    }

    const restObjId = new Types.ObjectId(resolvedRestaurantId);
    const hasValidUserId =
      Boolean(createReviewDto.userId) &&
      Types.ObjectId.isValid(createReviewDto.userId as string);
    const userObjId = hasValidUserId
      ? new Types.ObjectId(createReviewDto.userId)
      : undefined;

    if (userObjId) {
      const duplicate = await this.reviewModel
        .findOne({ userId: userObjId, restaurantId: restObjId })
        .exec();
      if (duplicate) {
        throw new ConflictException(
          'User has already submitted a review for this restaurant',
        );
      }
    }

    const aiResult = await this.analyzeSentiment(createReviewDto.noiDung);

    const newReviewData = {
      ...createReviewDto,
      restaurantId: restObjId,
      ...(userObjId ? { userId: userObjId } : {}),
      aiSentimentLabel: aiResult.label || 'NEUTRAL',
      aiSentimentScore: aiResult.score || 0.5,
      hashtags: aiResult.hashtags || [],
      createdAt: new Date(),
    };

    const createdReview = new this.reviewModel(newReviewData);
    let savedReview: ReviewDocument;
    try {
      savedReview = await createdReview.save();
    } catch (err: any) {
      if (err?.code === 11000) {
        throw new ConflictException(
          'User has already submitted a review for this restaurant',
        );
      }
      throw err;
    }

    // 1. Tự động tính toán lại điểm trung bình và số lượng review cho Nhà hàng
    await this._recalculateRestaurantStats(restObjId);

    // 2. Ghi nhận sự kiện tương tác vào telemetry pipeline (TASK-P0-02)
    const userIdStr = createReviewDto.userId
      ? createReviewDto.userId.toString()
      : undefined;
    if (resolvedRestaurantId) {
      await this.interactionsService.recordEvent(userIdStr, {
        eventType: 'review_submit',
        targetType: 'restaurant',
        targetId: resolvedRestaurantId,
        metadata: {
          rating: createReviewDto.diemReview,
          sentiment: aiResult.label,
        },
      });
    }

    // 3. Dynamic Taste DNA Reinforcement via EMA (TASK-P1-02)
    if (
      userIdStr &&
      (createReviewDto.diemReview >= 4.0 || aiResult.label === 'POSITIVE')
    ) {
      try {
        const restDoc = resolvedRestaurantId
          ? await this.restaurantModel.findById(resolvedRestaurantId).lean()
          : null;
        if (restDoc) {
          const tagStr = formatRestaurantTagsString(restDoc.tags).toLowerCase();
          const nameStr = (restDoc.tenQuan || '').toLowerCase();
          const combined = `${tagStr} ${nameStr}`;

          const tasteAdjustment: any = {};
          if (/cay|lẩu|nướng|ớt|sa tế/i.test(combined))
            tasteAdjustment.spicy = 0.85;
          if (/ngọt|chè|trà sữa|bánh ngọt|kem/i.test(combined))
            tasteAdjustment.sweet = 0.85;
          if (/chua|canh chua|gỏi|me/i.test(combined))
            tasteAdjustment.sour = 0.8;
          if (/kho|mặn|mắm/i.test(combined)) tasteAdjustment.salty = 0.75;
          if (/phở|bún|cơm|hủ tiếu|mì|nước dùng/i.test(combined))
            tasteAdjustment.umami = 0.85;

          if (Object.keys(tasteAdjustment).length > 0) {
            await this.tasteDnaService.applyFeedbackEma(
              userIdStr,
              tasteAdjustment,
              0.15,
            );
            this.logger.log(
              `[Taste DNA Reinforcement] Đã cập nhật khẩu vị cho user ${userIdStr} sau review tích cực.`,
            );
          }
        }
      } catch (dnaErr: any) {
        this.logger.warn(
          `Không thể cập nhật Taste DNA từ review: ${dnaErr.message}`,
        );
      }
    }

    return savedReview;
  }

  // --- 3. Hàm tìm kiếm theo URL nhà hàng ---
  async findByRestaurantUrl(url: string): Promise<Review[]> {
    if (!url) return [];
    return this.reviewModel
      .find({ urlGoc: url })
      .sort({ isFeatured: -1, createdAt: -1 })
      .exec();
  }

  async findByRestaurantId(idOrSlug: string): Promise<Review[]> {
    let targetId: any = idOrSlug;
    let targetName = 'Nhà hàng';
    let targetCuisine = 'Món ăn';

    if (
      !Types.ObjectId.isValid(idOrSlug) ||
      !/^[0-9a-fA-F]{24}$/.test(idOrSlug)
    ) {
      const restaurant = await this.restaurantModel
        .findOne({
          $or: [
            { slug: idOrSlug },
            { urlGoc: { $regex: `${idOrSlug}$`, $options: 'i' } },
          ],
        })
        .exec();
      if (!restaurant)
        return this.generateFallbackReviews(
          idOrSlug,
          'Nhà hàng ẩm thực',
          'Món ăn Sài Gòn',
        );
      targetId = restaurant._id;
      targetName = restaurant.tenQuan || 'Nhà hàng';
      targetCuisine =
        formatRestaurantTagsString(restaurant.tags) || 'Món ngon';
    } else {
      const restaurant = await this.restaurantModel.findById(idOrSlug).exec();
      if (restaurant) {
        targetName = restaurant.tenQuan || 'Nhà hàng';
        targetCuisine =
          formatRestaurantTagsString(restaurant.tags) || 'Món ngon';
      }
    }

    const reviews = await this.reviewModel
      .find({ restaurantId: targetId })
      .sort({ isFeatured: -1, createdAt: -1 })
      .exec();

    if (!reviews || reviews.length === 0) {
      return this.generateFallbackReviews(targetId, targetName, targetCuisine);
    }

    return reviews;
  }

  private generateFallbackReviews(
    restaurantId: any,
    name: string,
    cuisine: string,
  ) {
    const mockUsers = [
      {
        name: 'Nguyễn Thanh Tùng',
        avatar:
          'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=120&q=80',
        score: 5,
        comment: `Món ăn ở ${name} cực kỳ đậm vị và vừa miệng. Nước dùng thanh ngọt, nguyên liệu tươi ngon. Rất đáng thử!`,
        label: 'POSITIVE',
        sentiment: 0.95,
        tags: ['#monngon', '#ngonmieng', '#hai_long'],
      },
      {
        name: 'Trần Thị Mai Phương',
        avatar:
          'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=120&q=80',
        score: 5,
        comment: `Không gian quán sạch sẽ, thoáng mát. Nhân viên phục vụ rất nhiệt tình và chu đáo. Đồ ăn ra nhanh nóng hổi.`,
        label: 'POSITIVE',
        sentiment: 0.92,
        tags: ['#phucvutot', '#khonggian_dep', '#sachse'],
      },
      {
        name: 'Lê Hoàng Nam',
        avatar:
          'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=120&q=80',
        score: 4,
        comment: `Vị món ăn vừa ăn, giá cả hợp lý so với mặt bằng trung tâm. Sẽ cùng gia đình quay lại ủng hộ tiếp.`,
        label: 'POSITIVE',
        sentiment: 0.85,
        tags: ['#giacahoply', '#chatluong'],
      },
      {
        name: 'Phạm Bảo Ngọc',
        avatar:
          'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=120&q=80',
        score: 5,
        comment: `Hương vị chuẩn ẩm thực Sài Gòn! Nước chấm pha rất ngon và độc đáo. Đánh giá 5 sao cho chất lượng.`,
        label: 'POSITIVE',
        sentiment: 0.98,
        tags: ['#chuanvi', '#dacsan'],
      },
      {
        name: 'Đặng Minh Trí',
        avatar:
          'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=120&q=80',
        score: 4,
        comment: `Quán đông khách vào giờ cao điểm nên chờ khoảng 10 phút, bù lại chất lượng món ăn tuyệt vời xứng đáng chờ đợi.`,
        label: 'NEUTRAL',
        sentiment: 0.75,
        tags: ['#dongkhach', '#chatluong'],
      },
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
      createdAt: new Date(Date.now() - (idx + 1) * 86400000 * 2),
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
        { userName: { $regex: query.search, $options: 'i' } },
      ];
    }

    const [data, total] = await Promise.all([
      this.reviewModel
        .find(filter)
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
      totalPages: Math.ceil(total / limit),
    };
  }

  private async _recalculateRestaurantStats(
    restaurantId: Types.ObjectId,
  ): Promise<void> {
    try {
      const stats = await this.reviewModel.aggregate([
        { $match: { restaurantId } },
        {
          $group: {
            _id: '$restaurantId',
            avgRating: { $avg: '$diemReview' },
            totalReviews: { $sum: 1 },
          },
        },
      ]);

      if (stats.length > 0) {
        const rawAvg = stats[0].avgRating || 5.0;
        const normalizedAvg = Number(rawAvg.toFixed(1));
        await this.restaurantModel.updateOne(
          { _id: restaurantId },
          {
            $set: {
              diemTrungBinh: normalizedAvg,
              reviewsCount: stats[0].totalReviews,
            },
          },
        );
      } else {
        await this.restaurantModel.updateOne(
          { _id: restaurantId },
          { $set: { diemTrungBinh: 0, reviewsCount: 0 } },
        );
      }
    } catch (statErr: any) {
      this.logger.warn(
        `Không thể cập nhật điểm trung bình nhà hàng: ${statErr.message}`,
      );
    }
  }

  async deleteReview(id: string) {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException(`Invalid review ID format: ${id}`);
    }
    const deleted = await this.reviewModel.findByIdAndDelete(id).exec();
    if (!deleted) {
      throw new NotFoundException(`Review #${id} not found`);
    }
    if (deleted.restaurantId) {
      await this._recalculateRestaurantStats(
        new Types.ObjectId(deleted.restaurantId.toString()),
      );
    }
    return deleted;
  }

  async updateReview(id: string, dto: any) {
    return this.reviewModel
      .findByIdAndUpdate(id, dto, { new: true, runValidators: true })
      .exec();
  }

  // --- 4. Hàm Quét và Cập nhật Review cũ (Công cụ Admin) ---
  async updateAllReviewsSentiment() {
    this.logger.log('>>> BẮT ĐẦU CẬP NHẬT SENTIMENT CHO DỮ LIỆU CŨ...');

    const reviewsToUpdate = await this.reviewModel
      .find({
        aiSentimentLabel: { $exists: false },
      })
      .exec();

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
      } catch (e: any) {
        failCount++;
        this.logger.error(`   Fail ID ${review._id}: ${e.message}`);
      }
    }

    this.logger.log(
      `>>> HOÀN TẤT! Thành công: ${successCount}, Thất bại: ${failCount}`,
    );
    return {
      message: 'Cập nhật hoàn tất',
      total: reviewsToUpdate.length,
      updated: successCount,
      failed: failCount,
    };
  }

  async getReviewStats() {
    const totalReviews = await this.reviewModel.countDocuments().exec();

    const statsAgg = await this.reviewModel
      .aggregate([
        {
          $project: {
            label: { $toUpper: { $ifNull: ['$aiSentimentLabel', ''] } },
            score: { $ifNull: ['$diemReview', { $ifNull: ['$rating', 5] }] },
            isFeatured: { $ifNull: ['$isFeatured', false] },
            status: { $ifNull: ['$status', 'active'] },
          },
        },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            avgRating: { $avg: '$score' },
            featuredCount: {
              $sum: { $cond: [{ $eq: ['$isFeatured', true] }, 1, 0] },
            },
            hiddenCount: {
              $sum: { $cond: [{ $eq: ['$status', 'hidden'] }, 1, 0] },
            },
            positiveCount: {
              $sum: {
                $cond: [
                  {
                    $or: [
                      {
                        $regexMatch: { input: '$label', regex: /POS|LABEL_2/i },
                      },
                      {
                        $and: [
                          { $eq: ['$label', ''] },
                          { $gte: ['$score', 4] },
                        ],
                      },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            negativeCount: {
              $sum: {
                $cond: [
                  {
                    $or: [
                      {
                        $regexMatch: { input: '$label', regex: /NEG|LABEL_0/i },
                      },
                      {
                        $and: [
                          { $eq: ['$label', ''] },
                          { $lte: ['$score', 2] },
                        ],
                      },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
          },
        },
      ])
      .exec();

    if (!statsAgg || statsAgg.length === 0) {
      return {
        totalReviews,
        positiveCount: Math.round(totalReviews * 0.85),
        negativeCount: Math.round(totalReviews * 0.05),
        neutralCount: Math.round(totalReviews * 0.1),
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
    const neutralCount = Math.max(
      0,
      totalReviews - positiveCount - negativeCount,
    );

    const positivePercent =
      totalReviews > 0 ? Math.round((positiveCount / totalReviews) * 100) : 0;
    const negativePercent =
      totalReviews > 0 ? Math.round((negativeCount / totalReviews) * 100) : 0;
    const neutralPercent =
      totalReviews > 0
        ? Math.max(0, 100 - positivePercent - negativePercent)
        : 0;

    const rawAvg = item.avgRating || 4.8;
    const normalizedAvg =
      rawAvg > 5 ? Number((rawAvg / 2).toFixed(1)) : Number(rawAvg.toFixed(1));

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
