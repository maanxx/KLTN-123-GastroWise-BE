import {
  BadRequestException,
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
import {
  extractValidGeoPoint,
  parseValidCoordinatePair,
} from '@shared/utils/geo.utils';
import {
  normalizeRestaurantRating,
  normalizeRestaurantTags,
  parseRestaurantPriceVnd,
} from '@shared/utils/restaurant-normalizer.util';

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

    // Geospatial query if coordinates provided (exclude un-geocoded & [0,0] docs)
    if (lat !== undefined || lng !== undefined) {
      const center = parseValidCoordinatePair(lat, lng);
      if (!center) {
        throw new BadRequestException(
          'Valid non-zero lat and lng parameters are required when filtering candidates spatially',
        );
      }
      const maxDistanceMeters = (Number(radiusKm) || 10) * 1000;
      query = this.restaurantModel.find({
        ...filter,
        'location.type': 'Point',
        'location.coordinates': { $ne: [0, 0] },
        location: {
          $near: {
            $geometry: {
              type: 'Point',
              coordinates: [center.lon, center.lat],
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

    const candidates: RestaurantCandidateDto[] = docs.map((doc: any) =>
      this.toCandidateDto(doc),
    );

    return { candidates, total: candidates.length };
  }

  @Get(':id')
  async getById(@Param('id') id: string): Promise<RestaurantCandidateDto> {
    const doc: any = await this.restaurantModel.findById(id).lean().exec();
    if (!doc) {
      throw new NotFoundException(`Restaurant with ID "${id}" not found`);
    }

    return this.toCandidateDto(doc);
  }

  private toCandidateDto(doc: Record<string, any>): RestaurantCandidateDto {
    const point = extractValidGeoPoint(doc);
    const { rating, rawRating, ratingScale, isAmbiguous } =
      normalizeRestaurantRating(doc);

    return {
      restaurant_id: doc._id ? String(doc._id) : String(doc.id ?? ''),
      name: doc.tenQuan || doc.name || 'Unknown',
      address: doc.diaChi || doc.address || '',
      location: point
        ? { type: 'Point', coordinates: [point.lon, point.lat] }
        : undefined,
      lat: point?.lat,
      lng: point?.lon,
      rating,
      raw_rating: rawRating,
      rating_scale: ratingScale,
      is_ambiguous_rating: isAmbiguous,
      price_level: doc.giaCa ?? doc.priceRange ?? doc.price,
      average_cost: parseRestaurantPriceVnd(
        doc.giaCa ?? doc.price ?? doc.averageCost ?? doc.priceRange,
        50000,
      ),
      tags: normalizeRestaurantTags(doc.tags),
      open_time: doc.gioMoCua ?? doc.open_time,
      featured_image: doc.avatarUrl ?? doc.featured_image,
    };
  }
}
