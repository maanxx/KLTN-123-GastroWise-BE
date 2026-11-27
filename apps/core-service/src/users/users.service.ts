import {
  ConflictException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { InjectModel } from '@nestjs/mongoose';
import { User, UserDocument } from './schemas/user.schema';
import {
  TasteDnaProfile,
  TasteDnaDocument,
} from '../taste-dna/schemas/taste-dna.schema';
import { FavoriteCollection } from '../favorites/schemas/favorite-collection.schema';
import { Notification } from './schemas/notification.schema';
import {
  ChatSession,
  ChatSessionDocument,
} from '../restaurants/schemas/chat-session.schema';
import { Review, ReviewDocument } from '../reviews/schemas/review.schema';
import {
  Restaurant,
  RestaurantDocument,
} from '../restaurants/schemas/restaurant.schema';
import mongoose, { Model } from 'mongoose';
import { escapeRegexLiteral, normalizeEmail } from '@shared/utils/email.util';

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @Optional()
    @InjectModel(TasteDnaProfile.name)
    private tasteDnaModel?: Model<TasteDnaDocument>,
    @Optional()
    @InjectModel(FavoriteCollection.name)
    private favoriteCollectionModel?: Model<FavoriteCollection>,
    @Optional()
    @InjectModel(Notification.name)
    private notificationModel?: Model<Notification>,
    @Optional()
    @InjectModel(ChatSession.name)
    private chatSessionModel?: Model<ChatSessionDocument>,
    @Optional()
    @InjectModel(Review.name)
    private reviewModel?: Model<ReviewDocument>,
    @Optional()
    @InjectModel(Restaurant.name)
    private restaurantModel?: Model<RestaurantDocument>,
  ) {}

  async create(createUserDto: CreateUserDto): Promise<UserDocument> {
    const normalizedPayload: CreateUserDto = {
      ...createUserDto,
      email: normalizeEmail(createUserDto.email),
      ...(typeof createUserDto.username === 'string'
        ? { username: createUserDto.username.trim() }
        : {}),
    };

    const createdUser = new this.userModel(normalizedPayload);
    try {
      return await createdUser.save();
    } catch (err: any) {
      if (err?.code === 11000) {
        const keyPattern = err?.keyPattern || {};
        if (keyPattern.username) {
          throw new ConflictException('Username already exists');
        }
        throw new ConflictException('Email already exists');
      }
      throw err;
    }
  }

  async findAll(query: any = {}): Promise<any> {
    const page = parseInt(query.page, 10) || 1;
    const limit = parseInt(query.limit, 10) || 10;
    const skip = (page - 1) * limit;

    const filter: any = {};
    if (query.search) {
      filter.$or = [
        { username: { $regex: query.search, $options: 'i' } },
        { email: { $regex: query.search, $options: 'i' } },
        { firstName: { $regex: query.search, $options: 'i' } },
        { lastName: { $regex: query.search, $options: 'i' } },
      ];
    }
    if (query.role && query.role !== 'all') {
      if (query.role === 'owner') {
        filter.role = 'merchant';
      } else {
        filter.role = query.role;
      }
    }

    const [data, total] = await Promise.all([
      this.userModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.userModel.countDocuments(filter).exec(),
    ]);

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  // 3. THÊM HÀM NÀY
  async findOne(id: string): Promise<UserDocument> {
    // Kiểm tra xem ID có đúng định dạng ObjectId của Mongo không
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new NotFoundException(`Invalid ID format: ${id}`);
    }
    const user = await this.userModel.findById(id).exec();
    if (!user) {
      throw new NotFoundException(`User #${id} not found`);
    }
    return user;
  }

  // 4. THÊM HÀM NÀY
  async update(
    id: string,
    updateUserDto: UpdateUserDto,
  ): Promise<UserDocument> {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new NotFoundException(`Invalid ID format: ${id}`);
    }
    // findByIdAndUpdate sẽ tìm, cập nhật và trả về bản ghi MỚI (vì có { new: true })
    const updatedUser = await this.userModel
      .findByIdAndUpdate(id, updateUserDto, { new: true, runValidators: true })
      .exec();

    if (!updatedUser) {
      throw new NotFoundException(`User #${id} not found`);
    }
    return updatedUser;
  }

  async remove(id: string): Promise<UserDocument> {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new NotFoundException(`Invalid ID format: ${id}`);
    }
    const deletedUser = await this.userModel.findByIdAndDelete(id).exec();
    if (!deletedUser) {
      throw new NotFoundException(`User #${id} not found`);
    }

    const userObjId = new mongoose.Types.ObjectId(id);

    // Cascade delete user-owned dependent documents & anonymize/unlink shared records
    await Promise.all([
      this.tasteDnaModel?.deleteMany({ userId: userObjId }),
      this.favoriteCollectionModel?.deleteMany({ userId: userObjId }),
      this.notificationModel?.deleteMany({ userId: userObjId }),
      this.chatSessionModel?.deleteMany({ userId: userObjId }),
      this.reviewModel?.updateMany(
        { userId: userObjId },
        { $set: { userId: null, userName: 'Deleted User' } },
      ),
      this.restaurantModel?.updateMany(
        { ownerId: userObjId },
        { $set: { ownerId: null } },
      ),
    ]);

    return deletedUser;
  }

  async findOneByEmail(email: string): Promise<UserDocument> {
    const normalizedEmail = normalizeEmail(email);
    // Exact lowercase lookup first (uses unique email index IXSCAN)
    let user: UserDocument | null = (await this.userModel
      .findOne({ email: normalizedEmail })
      .select('+password')) as unknown as UserDocument | null;

    // Backward-compatible anchored case-insensitive fallback for pre-V004 legacy mixed-case emails
    if (!user && email && email.trim() !== normalizedEmail) {
      const legacyPattern = new RegExp(
        `^${escapeRegexLiteral(email.trim())}$`,
        'i',
      );
      user = (await this.userModel
        .findOne({ email: { $regex: legacyPattern } })
        .select('+password')) as unknown as UserDocument | null;
    }

    if (!user) {
      throw new NotFoundException(`User with email ${normalizedEmail} not found`);
    }
    return user;
  }

  async updateRefreshToken(
    userId: string,
    hashedRefreshToken: string | null,
  ): Promise<UserDocument | null> {
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      throw new NotFoundException(`Invalid ID format: ${userId}`);
    }
    // Lưu ý: refreshToken đã được băm ở auth.service trước khi gọi hàm này
    return this.userModel
      .findByIdAndUpdate(
        userId,
        { hashedRefreshToken: hashedRefreshToken ?? null },
        { new: true, runValidators: true },
      )
      .exec();
  }

  async updateProfile(
    userId: string,
    updateUserDto: UpdateUserDto,
  ): Promise<User> {
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      throw new NotFoundException(`Invalid ID format`);
    }

    const updatedUser = await this.userModel
      .findByIdAndUpdate(userId, updateUserDto, {
        new: true,
        runValidators: true,
      }) // { new: true } để trả về data MỚI
      .exec();

    if (!updatedUser) {
      throw new NotFoundException(`User #${userId} not found`);
    }
    return updatedUser;
  }
}
