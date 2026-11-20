import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  Restaurant,
  RestaurantDocument,
} from '../restaurants/schemas/restaurant.schema';
import { InternalAuthGuard } from '@shared/guards/internal-auth.guard';
import { RestaurantCandidateDto } from '@shared/contracts/core.contracts';

@UseGuards(InternalAuthGuard)
@Controller('internal/restaurants')
export class InternalRestaurantsController {
  constructor(
    @InjectModel(Restaurant.name)
    private readonly restaurantModel: Model<RestaurantDocument>,
  ) {}

  @Get('candidates')
  async getCandidates(
    @Query('tags') tags?: string | string[],
    @Query('lat') lat?: number,
    @Query('lng') lng?: number,
    @Query('radius_km') radiusKm: number = 10,
    @Query('limit') limit: number = 50,
  ): Promise<{ candidates: RestaurantCandidateDto[]; total: number }> {
    const filter: any = {};

    if (tags) {
      const tagList = Array.isArray(tags) ? tags : [tags];
      filter.tags = { $regex: tagList.join('|'), $options: 'i' };
    }

    let query = this.restaurantModel.find(filter);

    // Geospatial query if coordinates provided
    if (lat !== undefined && lng !== undefined) {
      const maxDistanceMeters = (Number(radiusKm) || 10) * 1000;
      query = this.restaurantModel.find({
        ...filter,
        location: {
          $near: {
            $geometry: {
              type: 'Point',
              coordinates: [Number(lng), Number(lat)],
            },
            $maxDistance: maxDistanceMeters,
          },
        },
      });
    }

    const docs = await query
      .limit(Math.min(Number(limit) || 50, 100))
      .lean()
      .exec();

    const candidates: RestaurantCandidateDto[] = docs.map((doc: any) => ({
      restaurant_id: doc._id.toString(),
      name: doc.tenQuan || 'Unknown',
      address: doc.diaChi || '',
      location: doc.location,
      lat: doc.lat ?? (doc.location?.coordinates?.[1] || 10.7769),
      lng: doc.lon ?? (doc.location?.coordinates?.[0] || 106.7009),
      rating: doc.diemTrungBinh || 0,
      price_level: doc.giaCa,
      tags: doc.tags ? doc.tags.split(',').map((t: string) => t.trim()) : [],
      open_time: doc.gioMoCua,
      featured_image: doc.avatarUrl,
    }));

    return { candidates, total: candidates.length };
  }

  @Get(':id')
  async getById(@Param('id') id: string): Promise<RestaurantCandidateDto> {
    const doc: any = await this.restaurantModel.findById(id).lean().exec();
    if (!doc) {
      throw new NotFoundException(`Restaurant with ID "${id}" not found`);
    }

    return {
      restaurant_id: doc._id.toString(),
      name: doc.tenQuan || 'Unknown',
      address: doc.diaChi || '',
      location: doc.location,
      lat: doc.lat ?? (doc.location?.coordinates?.[1] || 10.7769),
      lng: doc.lon ?? (doc.location?.coordinates?.[0] || 106.7009),
      rating: doc.diemTrungBinh || 0,
      price_level: doc.giaCa,
      tags: doc.tags ? doc.tags.split(',').map((t: string) => t.trim()) : [],
      open_time: doc.gioMoCua,
      featured_image: doc.avatarUrl,
    };
  }
}
