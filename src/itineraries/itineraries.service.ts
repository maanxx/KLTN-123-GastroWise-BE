import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Itinerary } from './schemas/itinerary.schema';
import { Restaurant } from '../restaurants/schemas/restaurant.schema';
import { GenerateItineraryDto } from './dto/generate-itinerary.dto';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class ItinerariesService {
  constructor(
    @InjectModel(Itinerary.name) private itineraryModel: Model<Itinerary>,
    @InjectModel(Restaurant.name) private restaurantModel: Model<Restaurant>,
  ) {}

  async generateItinerary(userId: string, dto: GenerateItineraryDto): Promise<Itinerary> {
    // 1. Keyword Extraction (Lightweight Approach)
    const prompt = dto.prompt.toLowerCase();
    
    // Map of common keywords to tags/categories
    const keywordMap = {
      'chay': 'ĐỒ CHAY',
      'uống': 'ĐỒ UỐNG',
      'tráng miệng': 'TRÁNG MIỆNG',
      'lẩu': 'MÓN LẨU',
      'ăn vặt': 'ĐỒ ĂN',
      'nướng': 'MÓN NƯỚNG',
      'hải sản': 'HẢI SẢN',
      'pizza': 'PIZZA',
      'sushi': 'SUSHI',
      'cafe': 'CAFE',
      'cà phê': 'CAFE',
      'trà sữa': 'TRÀ SỮA',
    };

    let selectedTag = '';
    for (const [key, tag] of Object.entries(keywordMap)) {
      if (prompt.includes(key)) {
        selectedTag = tag;
        break;
      }
    }

    // Determine district if mentioned (e.g., "quận 1", "q1", "thủ đức")
    let districtFilter: string | null = null;
    const districtMatch = prompt.match(/quận (\d+)|q(\d+)|thủ đức|tân bình|phú nhuận/i);
    if (districtMatch) {
      districtFilter = districtMatch[0];
    }

    // 2. Query Database
    const query: any = {};
    if (selectedTag) {
      query.tags = { $regex: new RegExp(selectedTag, 'i') };
    }
    if (districtFilter) {
      query.quan = { $regex: new RegExp(districtFilter, 'i') };
    }

    // If no tags or district found, just search by the prompt text directly in tenQuan
    if (!selectedTag && !districtFilter) {
      query.tenQuan = { $regex: new RegExp(prompt.split(' ')[0], 'i') };
    }

    // Find top 3 restaurants matching criteria (sort by rating)
    const restaurants = await this.restaurantModel
      .find(query)
      .sort({ diemTrungBinh: -1 })
      .limit(3)
      .exec();

    if (!restaurants || restaurants.length === 0) {
      // Fallback: Just return top rated if nothing matches
      const fallback = await this.restaurantModel.find().sort({ diemTrungBinh: -1 }).limit(3).exec();
      restaurants.push(...fallback);
    }

    // 3. Create Itinerary Stops
    const stops = restaurants.map((r, index) => ({
      stop_id: uuidv4(),
      restaurant_id: r._id,
      order_index: index,
      restaurant_name: r.tenQuan,
      restaurant_lat: r.lat,
      restaurant_lng: r.lon,
    }));

    // Generate Title
    const title = `Lộ trình ${selectedTag ? selectedTag.toLowerCase() : 'khám phá'} ${districtFilter ? `tại ${districtFilter.toUpperCase()}` : ''}`;

    // 4. Save to DB
    const newItinerary = new this.itineraryModel({
      user_id: new Types.ObjectId(userId),
      prompt: dto.prompt,
      title: title,
      start_time: dto.start_time,
      end_time: dto.end_time,
      budget: dto.budget || 0,
      start_location: { type: 'Point', coordinates: [dto.lng || 106.7009, dto.lat || 10.7769] },
      status: 'generated',
      stops: stops,
      created_at: new Date(),
    });

    return await newItinerary.save();
  }

  async getItinerariesByUser(userId: string): Promise<Itinerary[]> {
    return this.itineraryModel.find({ user_id: new Types.ObjectId(userId) }).sort({ created_at: -1 }).exec();
  }

  async getItineraryById(id: string, userId: string): Promise<Itinerary> {
    const itinerary = await this.itineraryModel.findById(id).populate('stops.restaurant_id').exec();
    if (!itinerary) {
      throw new NotFoundException('Itinerary not found');
    }
    // TODO: Authorize user if needed (itinerary.user_id === userId)
    return itinerary;
  }
}
