import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Itinerary } from './schemas/itinerary.schema';
import { Restaurant } from '../restaurants/schemas/restaurant.schema';
import { GenerateItineraryDto } from './dto/generate-itinerary.dto';
import { v4 as uuidv4 } from 'uuid';

function calculateHaversineDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  if (!lat1 || !lon1 || !lat2 || !lon2) return 1.5;
  const R = 6371; // km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

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
    const keywordMap: Record<string, string> = {
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
      'phở': 'PHỞ',
      'bún': 'BÚN',
      'cơm': 'CƠM',
      'bánh mì': 'BÁNH MÌ',
      'mì': 'MÌ',
    };

    let selectedTag = '';
    for (const [key, tag] of Object.entries(keywordMap)) {
      if (prompt.includes(key)) {
        selectedTag = tag;
        break;
      }
    }

    // Determine district if mentioned (e.g., "quận 1", "q1", "thủ đức")
    let districtRegex: string | null = null;
    let districtDisplay: string | null = null;
    const qNumMatch = prompt.match(/(?:quận|q\.?)\s*(\d+)/i);
    if (qNumMatch) {
      districtRegex = `(quận|q\\.?)\\s*0?${qNumMatch[1]}\\b`;
      districtDisplay = `Quận ${qNumMatch[1]}`;
    } else {
      const nameDistricts = [
        'thủ đức', 'bình thạnh', 'gò vấp', 'phú nhuận', 'tân bình', 
        'tân phú', 'bình tân', 'nhà bè', 'hóc môn', 'củ chi', 'cần giờ', 'bình chánh'
      ];
      for (const name of nameDistricts) {
        if (prompt.includes(name)) {
          districtRegex = name;
          districtDisplay = name.charAt(0).toUpperCase() + name.slice(1);
          break;
        }
      }
    }

    // 2. Query Database (exclude closed restaurants)
    const query: any = { status: { $ne: 'closed' } };
    if (districtRegex) {
      query.diaChi = { $regex: new RegExp(districtRegex, 'i') };
    }
    if (selectedTag) {
      query.tags = { $regex: new RegExp(selectedTag, 'i') };
    } else {
      // Clean prompt by removing common conversational filler words
      const cleanPrompt = prompt
        .replace(/(?:tôi|muốn|tìm|gợi ý|quán|nhà hàng|cho|mình|ở|tại|khu vực|ăn|uống|đi|giúp|với|nhé|nào|được)/gi, ' ')
        .trim();
      const keywords = cleanPrompt.split(/\s+/).filter((w) => w.length > 1);
      if (keywords.length > 0) {
        const searchPattern = keywords.slice(0, 3).join('|');
        query.$or = [
          { tenQuan: { $regex: new RegExp(searchPattern, 'i') } },
          { tags: { $regex: new RegExp(searchPattern, 'i') } },
          { description: { $regex: new RegExp(searchPattern, 'i') } },
        ];
      }
    }

    // Find top 3 restaurants matching criteria (prioritize isFeatured and high rating)
    let restaurants = await this.restaurantModel
      .find(query)
      .sort({ isFeatured: -1, diemTrungBinh: -1 })
      .limit(3)
      .exec();

    if (!restaurants || restaurants.length === 0) {
      // Try relaxing: keeping district filter if present
      const fallbackQuery: any = { status: { $ne: 'closed' } };
      if (districtRegex) {
        fallbackQuery.diaChi = { $regex: new RegExp(districtRegex, 'i') };
      }
      restaurants = await this.restaurantModel
        .find(fallbackQuery)
        .sort({ isFeatured: -1, diemTrungBinh: -1 })
        .limit(3)
        .exec();
    }

    if (!restaurants || restaurants.length === 0) {
      // Final fallback: Just return top rated available restaurants
      restaurants = await this.restaurantModel
        .find({ status: { $ne: 'closed' } })
        .sort({ isFeatured: -1, diemTrungBinh: -1 })
        .limit(3)
        .exec();
    }

    // 3. Create Itinerary Stops & Calculate Route Distance / CO2
    const userLat = dto.lat || 10.7769;
    const userLng = dto.lng || 106.7009;
    let totalDistKm = 0;
    let prevLat = userLat;
    let prevLng = userLng;

    const stops = restaurants.map((r, index) => {
      if (r.lat && r.lon) {
        totalDistKm += calculateHaversineDistanceKm(prevLat, prevLng, r.lat, r.lon);
        prevLat = r.lat;
        prevLng = r.lon;
      }
      return {
        stop_id: uuidv4(),
        restaurant_id: r._id,
        order_index: index,
        restaurant_name: r.tenQuan,
        restaurant_lat: r.lat,
        restaurant_lng: r.lon,
      };
    });

    const co2Saved = Math.max(0.5, Math.round((totalDistKm * 0.18 + 0.4) * 10) / 10);

    // Generate Title
    const title = `Lộ trình ${selectedTag ? selectedTag.toLowerCase() : 'ẩm thực'} ${districtDisplay ? `tại ${districtDisplay}` : 'Sài Gòn'}`;

    // 4. Save to DB
    const newItinerary = new this.itineraryModel({
      user_id: new Types.ObjectId(userId),
      prompt: dto.prompt,
      title: title,
      start_time: dto.start_time,
      end_time: dto.end_time,
      budget: dto.budget || 0,
      start_location: { type: 'Point', coordinates: [userLng, userLat] },
      status: 'generated',
      stops: stops,
      co2SavedKg: co2Saved,
      created_at: new Date(),
    });

    return await newItinerary.save();
  }

  async getItinerariesByUser(userId: string): Promise<Itinerary[]> {
    return this.itineraryModel.find({ user_id: new Types.ObjectId(userId) }).sort({ created_at: -1 }).exec();
  }

  async getAllItineraries(): Promise<Itinerary[]> {
    return this.itineraryModel
      .find()
      .populate('user_id', 'username firstName lastName email')
      .sort({ created_at: -1 })
      .exec();
  }

  async getItineraryById(id: string, userId: string): Promise<Itinerary> {
    if (!Types.ObjectId.isValid(id) || !/^[0-9a-fA-F]{24}$/.test(id)) {
      throw new NotFoundException(`Lộ trình với ID "${id}" không hợp lệ hoặc không tồn tại.`);
    }
    const itinerary = await this.itineraryModel.findById(id).populate('stops.restaurant_id').exec();
    if (!itinerary) {
      throw new NotFoundException('Không tìm thấy lộ trình');
    }
    // TODO: Authorize user if needed (itinerary.user_id === userId)
    return itinerary;
  }

  /**
   * Admin: Cập nhật trạng thái + tự động ghi audit trail
   */
  async updateStatus(id: string, newStatus: string, actorId?: string): Promise<Itinerary> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException(`ID lộ trình "${id}" không hợp lệ.`);
    }

    const now = new Date();
    const actorObjectId = actorId && Types.ObjectId.isValid(actorId)
      ? new Types.ObjectId(actorId)
      : null;

    const auditUpdate: Record<string, any> = { status: newStatus };

    if (newStatus === 'confirmed') {
      auditUpdate.confirmedBy = actorObjectId;
      auditUpdate.confirmedAt = now;
    } else if (newStatus === 'cancelled') {
      auditUpdate.cancelledBy = actorObjectId;
      auditUpdate.cancelledAt = now;
    } else if (newStatus === 'completed') {
      auditUpdate.completedBy = actorObjectId;
      auditUpdate.completedAt = now;
    }

    const updated = await this.itineraryModel
      .findByIdAndUpdate(id, { $set: auditUpdate }, { new: true })
      .populate('user_id', 'username firstName lastName email')
      .exec();

    if (!updated) {
      throw new NotFoundException('Không tìm thấy lộ trình để cập nhật.');
    }
    return updated;
  }

  /**
   * Admin: Xóa lộ trình
   */
  async remove(id: string): Promise<{ message: string }> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException(`ID lộ trình "${id}" không hợp lệ.`);
    }
    const res = await this.itineraryModel.findByIdAndDelete(id).exec();
    if (!res) {
      throw new NotFoundException('Không tìm thấy lộ trình để xóa.');
    }
    return { message: 'Đã xóa lộ trình thành công.' };
  }
}
