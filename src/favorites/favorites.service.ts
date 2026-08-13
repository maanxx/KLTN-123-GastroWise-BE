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

    // Convert to a format expected by frontend.
    // Assuming populated savedRestaurants have a toJSON or id field.
    // We map `_id` to `id` for frontend consistency if needed.
    const favorites = user.savedRestaurants || [];
    return favorites.map((restaurant: any) => {
      // Map properties here if needed to match frontend
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
}
