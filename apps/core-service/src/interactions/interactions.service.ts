// src/interactions/interactions.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Interaction, InteractionDocument } from './schemas/interaction.schema';
import { CreateInteractionDto } from './dto/create-interaction.dto';
import { BatchInteractionDto } from './dto/batch-interaction.dto';

@Injectable()
export class InteractionsService {
  private readonly logger = new Logger(InteractionsService.name);

  constructor(
    @InjectModel(Interaction.name)
    private readonly interactionModel: Model<InteractionDocument>,
  ) {}

  /**
   * Ghi nhận một tương tác đơn lẻ
   */
  async recordEvent(userId: string | undefined, dto: CreateInteractionDto) {
    const docData: any = {
      eventType: dto.eventType,
      targetType: dto.targetType,
      targetId: dto.targetId,
      durationMs: dto.durationMs || 0,
      metadata: dto.metadata || {},
    };

    if (userId && Types.ObjectId.isValid(userId)) {
      docData.userId = new Types.ObjectId(userId);
    }
    if (dto.sessionId) {
      docData.sessionId = dto.sessionId;
    }

    const created = new this.interactionModel(docData);
    return created.save();
  }

  /**
   * Ghi nhận batch tối đa 100 sự kiện (cho mobile offline queue hoặc analytics flush)
   */
  async recordBatch(userId: string | undefined, dto: BatchInteractionDto) {
    if (!dto.events || dto.events.length === 0) {
      return { success: true, count: 0 };
    }

    const validUserObjId =
      userId && Types.ObjectId.isValid(userId)
        ? new Types.ObjectId(userId)
        : undefined;

    const docs = dto.events.map((evt) => {
      const doc: any = {
        eventType: evt.eventType,
        targetType: evt.targetType,
        targetId: evt.targetId,
        durationMs: evt.durationMs || 0,
        metadata: evt.metadata || {},
      };
      if (validUserObjId) {
        doc.userId = validUserObjId;
      }
      if (evt.sessionId) {
        doc.sessionId = evt.sessionId;
      }
      return doc;
    });

    const result = await this.interactionModel.insertMany(docs, {
      ordered: false,
    });
    return {
      success: true,
      count: result.length,
    };
  }

  /**
   * Lấy lịch sử tương tác gần nhất của người dùng
   */
  async getUserInteractions(userId: string, limit: number = 50) {
    if (!Types.ObjectId.isValid(userId)) return [];
    return this.interactionModel
      .find({ userId: new Types.ObjectId(userId) })
      .sort({ createdAt: -1 })
      .limit(Math.min(limit, 200))
      .lean()
      .exec();
  }

  /**
   * Lấy danh sách địa điểm / món ăn phổ biến nhất dựa trên tương tác thực tế
   */
  async getPopularTargets(
    targetType: string = 'restaurant',
    limit: number = 10,
  ) {
    return this.interactionModel.aggregate([
      { $match: { targetType } },
      {
        $group: {
          _id: '$targetId',
          totalInteractions: { $sum: 1 },
          lastInteractionAt: { $max: '$createdAt' },
        },
      },
      { $sort: { totalInteractions: -1 } },
      { $limit: Number(limit) || 10 },
    ]);
  }

  /**
   * Export dữ liệu ma trận (User, Target, InteractionWeight) cho AI Collaborative Filtering
   */
  async getMatrixExport(limit: number = 5000) {
    return this.interactionModel
      .find({ userId: { $exists: true, $ne: null } })
      .select('userId targetId eventType durationMs createdAt')
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean()
      .exec();
  }
}
