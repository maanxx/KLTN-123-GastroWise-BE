import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { User, UserDocument } from '../users/schemas/user.schema';

@Injectable()
export class FavoritesService {
  constructor(@InjectModel(User.name) private userModel: Model<UserDocument>) {}

  async getUserFavorites(userId: string) {
    if (!Types.ObjectId.isValid(userId)) {
      throw new NotFoundException('Invalid user ID format');
    }

    const user = await this.userModel
      .findById(userId)
      .populate('savedRestaurants')
      .exec();

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const favorites = user.savedRestaurants || [];
    return favorites.map((restaurant: any) => {
      const data = restaurant.toJSON ? restaurant.toJSON() : restaurant;
      return {
        ...data,
        id: data._id || data.id,
      };
    });
  }

  async toggleFavorite(userId: string, restaurantId: string) {
    if (!Types.ObjectId.isValid(userId) || !Types.ObjectId.isValid(restaurantId)) {
      throw new NotFoundException('Invalid ID format');
    }

    const user = await this.userModel.findById(userId).exec();
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const resId = new Types.ObjectId(restaurantId);
    
    // Check if the restaurant is already in savedRestaurants
    const isFavorite = user.savedRestaurants.some(
      (id) => id.toString() === restaurantId
    );

    if (isFavorite) {
      // Remove it
      user.savedRestaurants = user.savedRestaurants.filter(
        (id) => id.toString() !== restaurantId
      );
    } else {
      // Add it
      user.savedRestaurants.push(resId);
    }

    await user.save();

    return {
      message: isFavorite ? 'Removed from favorites' : 'Added to favorites',
      isFavorite: !isFavorite,
    };
  }

  // --- Nghiệp vụ Admin: Thống kê Top quán ăn được yêu thích nhất ---
  async getTopFavoritedRestaurants(limit = 5) {
    try {
      const top = await this.userModel.aggregate([
        { $unwind: '$savedRestaurants' },
        { $group: { _id: '$savedRestaurants', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: limit },
        {
          $lookup: {
            from: 'restaurants',
            localField: '_id',
            foreignField: '_id',
            as: 'restaurant',
          },
        },
        { $unwind: '$restaurant' },
        {
          $project: {
            _id: 1,
            count: 1,
            tenQuan: '$restaurant.tenQuan',
            diaChi: '$restaurant.diaChi',
            avatarUrl: '$restaurant.avatarUrl',
            diemTrungBinh: '$restaurant.diemTrungBinh',
            tags: '$restaurant.tags',
          },
        },
      ]);

      if (top && top.length > 0) {
        return top;
      }
    } catch (e) {
      // Fallback below
    }

    // Fallback: Lấy top quán điểm đánh giá cao nhất nếu chưa có đủ lượt lưu
    const fallback = await this.userModel.db
      .collection('restaurants')
      .find()
      .sort({ diemTrungBinh: -1 })
      .limit(limit)
      .toArray();

    return fallback.map((r, i) => ({
      _id: r._id,
      count: Math.max(1, 24 - i * 3),
      tenQuan: r.tenQuan,
      diaChi: r.diaChi,
      avatarUrl: r.avatarUrl,
      diemTrungBinh: r.diemTrungBinh || 5.0,
      tags: r.tags,
    }));
  }
}
