// src/restaurants/restaurants.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { CreateRestaurantDto } from './dto/create-restaurant.dto';
import { UpdateRestaurantDto } from './dto/update-restaurant.dto';
import { InjectModel } from '@nestjs/mongoose';
import { Restaurant, RestaurantDocument } from './schemas/restaurant.schema';
import { MenuItem, MenuItemDocument } from './schemas/menu-item.schema';
import { Model, Types } from 'mongoose';
import { HttpService } from '@nestjs/axios'; 
import { firstValueFrom } from 'rxjs';
import FormData from 'form-data'; 

const aiUrl = process.env.AI_SERVICE_URL || 'http://127.0.0.1:8000';

@Injectable()
export class RestaurantsService {
  constructor(
    @InjectModel(Restaurant.name)
    private restaurantModel: Model<RestaurantDocument>,
    @InjectModel(MenuItem.name)
    private menuItemModel: Model<MenuItemDocument>,
    private readonly httpService: HttpService,
  ) {}

  async getMenu(idOrSlug: string) {
    const restaurant = await this.findOne(idOrSlug);
    return this.menuItemModel.find({ restaurantId: restaurant._id }).exec();
  }

  async getAllMenuItems(search?: string, restaurantId?: string) {
    const filter: any = {};
    if (restaurantId && restaurantId !== 'all') {
      if (Types.ObjectId.isValid(restaurantId)) {
        filter.restaurantId = new Types.ObjectId(restaurantId);
      }
    }
    if (search) {
      filter.name = { $regex: search, $options: 'i' };
    }
    return this.menuItemModel.find(filter).populate('restaurantId', 'tenQuan diaChi').exec();
  }

  async createMenuItem(restaurantId: string, dto: any) {
    let targetRestId = restaurantId;
    if (restaurantId && Types.ObjectId.isValid(restaurantId)) {
      targetRestId = restaurantId;
    } else if (restaurantId) {
      const rest = await this.restaurantModel.findOne({ slug: restaurantId }).exec();
      if (rest) targetRestId = rest._id.toString();
    }
    const item = new this.menuItemModel({
      restaurantId: new Types.ObjectId(targetRestId),
      name: dto.name,
      description: dto.description || '',
      price: Number(dto.price) || 0,
      image: dto.image || 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?auto=format&fit=crop&w=600&q=80',
      isVegetarian: Boolean(dto.isVegetarian),
      tags: dto.tags || [],
    });
    return item.save();
  }

  async updateMenuItem(menuId: string, dto: any) {
    return this.menuItemModel.findByIdAndUpdate(menuId, dto, { new: true }).exec();
  }

  async deleteMenuItem(menuId: string) {
    return this.menuItemModel.findByIdAndDelete(menuId).exec();
  }

  create(createRestaurantDto: CreateRestaurantDto) {
    return 'This action adds a new restaurant';
  }

  // [MỚI] HÀM XỬ LÝ SEARCH ẢNH
  async searchByImage(file: Express.Multer.File) {
    try {
      if (!file) throw new Error("Không có file được tải lên");

      const aiUrl = process.env.AI_SERVICE_URL || 'http://127.0.0.1:8000';
      
      // [QUAN TRỌNG] Log ra console để xem Backend đang kết nối đi đâu
      console.log("------------------------------------------------");
      console.log("📸 ĐANG GỌI AI SERVICE...");
      console.log("🔗 URL được dùng:", aiUrl);
      console.log("❓ Có phải localhost không?:", aiUrl.includes('127.0.0.1') ? "CÓ (LỖI)" : "KHÔNG (OK)");
      console.log("------------------------------------------------");
      
      const formData = new FormData();
      formData.append('file', Buffer.from(file.buffer), file.originalname);

      const aiResponse = await firstValueFrom(
        this.httpService.post(`${aiUrl}/predict-food`, formData, {
          headers: {
            ...formData.getHeaders(),
          },
        })
      );

      const foodName = aiResponse.data.food_name;
      console.log('AI Detected:', foodName);

      if (!foodName) {
        return { data: [], message: 'Không nhận diện được món ăn' };
      }

      // 2. [QUAN TRỌNG] Gọi hàm findAll lấy số lượng lớn (50 quán)
      // Lý do: Để đảm bảo không bỏ sót quán ngon nào chỉ vì AI xếp hạng độ liên quan khác
      const result = await this.findAll(
        1,               // page
        50,              // limit: Lấy 50 để lọc
        'diemTrungBinh', // sortBy
        'desc',          // order
        'all',           // rating
        'false',         // openNow
        '', '',          // lat, lon (Tạm để trống, có thể update nếu cần GPS)
        foodName         // search query (Tên món AI đoán)
      );

      // 3. [QUAN TRỌNG] Tự sắp xếp lại theo điểm trung bình (Cao -> Thấp)
      let topRestaurants = result.data || [];
      topRestaurants.sort((a: any, b: any) => (b.diemTrungBinh || 0) - (a.diemTrungBinh || 0));

      // 4. [QUAN TRỌNG] Cắt lấy đúng Top 5 quán ngon nhất
      topRestaurants = topRestaurants.slice(0, 5);

      return {
        data: topRestaurants, // Trả về danh sách 5 quán xịn nhất
        detectedFood: foodName,
        total: topRestaurants.length
      };

    } catch (error) {
      console.error('Lỗi search by image:', error.message);
      return { data: [], message: 'Lỗi xử lý hình ảnh' };
    }
  }

  // --- CÁC HÀM CŨ GIỮ NGUYÊN BÊN DƯỚI ---

  private checkIsOpen(gioMoCua: string): boolean {
    if (!gioMoCua) return false;
    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const ranges = gioMoCua.split(/[|,]/).map(r => r.trim());

    for (const range of ranges) {
      const parts = range.split('-').map(p => p.trim());
      if (parts.length !== 2) continue;
      const [startStr, endStr] = parts;
      const toMinutes = (timeStr: string) => {
        const [h, m] = timeStr.split(':').map(Number);
        return h * 60 + m;
      };
      const start = toMinutes(startStr);
      const end = toMinutes(endStr);

      if (start <= end) {
        if (currentMinutes >= start && currentMinutes <= end) return true;
      } else {
        if (currentMinutes >= start || currentMinutes <= end) return true;
      }
    }
    return false;
  }

  private getDistanceFromLatLonInKm(lat1: number, lon1: number, lat2: number, lon2: number) {
    const R = 6371; 
    const dLat = this.deg2rad(lat2 - lat1);
    const dLon = this.deg2rad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.deg2rad(lat1)) * Math.cos(this.deg2rad(lat2)) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c; 
  }

  private deg2rad(deg: number) {
    return deg * (Math.PI / 180);
  }

  private mapRestaurantToDTO(res: any) {
    const r = res.toObject ? res.toObject() : res;
    const rawRating = r.diemTrungBinh ? Number(r.diemTrungBinh) : (r.rating ? Number(r.rating) : 5.0);
    const normalizedRating = rawRating > 5 ? Number((rawRating / 2).toFixed(1)) : Number(rawRating.toFixed(1));

    return {
      id: r._id ? r._id.toString() : r.id,
      _id: r._id ? r._id.toString() : r.id,
      name: r.tenQuan || r.name || 'Nhà hàng GastroWise',
      tenQuan: r.tenQuan || r.name || 'Nhà hàng GastroWise',
      address: r.diaChi || r.address || 'TP. Hồ Chí Minh',
      diaChi: r.diaChi || r.address || 'TP. Hồ Chí Minh',
      coverImage: r.avatarUrl || r.coverImage || r.cover_image || `https://picsum.photos/seed/${r._id || r.id}/1200/500`,
      avatarUrl: r.avatarUrl || r.coverImage || r.cover_image || `https://picsum.photos/seed/${r._id || r.id}/1200/500`,
      rating: normalizedRating,
      diemTrungBinh: normalizedRating,
      priceRange: r.giaCa || r.priceRange || '30.000đ - 150.000đ',
      giaCa: r.giaCa || r.priceRange || '30.000đ - 150.000đ',
      openingHours: r.gioMoCua || r.openingHours || r.openTime || '08:00 - 22:00',
      gioMoCua: r.gioMoCua || r.openingHours || r.openTime || '08:00 - 22:00',
      openTime: r.gioMoCua || r.openingHours || r.openTime || '08:00 - 22:00',
      cuisineTypes: r.tags ? r.tags.split(',').map((t: string) => t.trim()) : ['Nhà hàng'],
      tags: r.tags || '',
      phone: r.contactPhone || r.phone || '0901 234 567',
      contactPhone: r.contactPhone || r.phone || '0901 234 567',
      description: r.description || '',
      lat: r.lat,
      lng: r.lon || r.lng,
      shopeeUrl: r.urlGoc || null,
      distance: r.distance,
    };
  }

  async findAll(
    page: number = 1, 
    limit: number = 32,
    sortBy: string = 'diemTrungBinh',
    order: string = 'desc',
    rating: string = 'all',
    openNow: string = 'false',
    userLat: string = '', 
    userLon: string = '',
    search: string = '',
    city: string = '',
    tags: string = '',
  ): Promise<any> {
    const pageNum = Number(page) || 1;
    const limitNum = Number(limit) || 32;
    const skip = (pageNum - 1) * limitNum;

    // 1. Setup Sort
    const sortOptions: any = {};
    const allowedSortFields = [
      'diemTrungBinh', 'diemKhongGian', 'diemViTri', 
      'diemChatLuong', 'diemPhucVu', 'diemGiaCa'
    ];
    const sortField = (allowedSortFields.includes(sortBy) && sortBy !== 'default') ? sortBy : 'diemTrungBinh';
    const sortDirection = order === 'asc' ? 1 : -1;
    sortOptions[sortField] = sortDirection;

    // 2. Setup Filter
    const filterQuery: any = {};
    if (city) {
      if (city === 'hanoi') {
        filterQuery['diaChi'] = { 
          $regex: /Hà Nội|Ha Noi|HN|Hanoi|Ba Đình|Ba Dinh|Hoàn Kiếm|Hoan Kiem|Tây Hồ|Tay Ho|Long Biên|Long Bien|Cầu Giấy|Cau Giay|Đống Đa|Dong Da|Hai Bà Trưng|Hai Ba Trung|Hoàng Mai|Hoang Mai|Thanh Xuân|Thanh Xuan|Sóc Sơn|Soc Son|Đông Anh|Dong Anh|Gia Lâm|Gia Lam|Nam Từ Liêm|Nam Tu Liem|Bắc Từ Liêm|Bac Tu Liem|Thanh Trì|Thanh Tri|Hà Đông|Ha Dong|Sơn Tây|Son Tay/i 
        }; 
      } else if (city === 'hcmc') {
        filterQuery['diaChi'] = { 
          $regex: /Hồ Chí Minh|Ho Chi Minh|TP\.?\s?HCM|TPHCM|Sài Gòn|Sai Gon|HCM|Thủ Đức|Thu Duc|Gò Vấp|Go Vap|Bình Thạnh|Binh Thanh|Tân Bình|Tan Binh|Tân Phú|Tan Phu|Phú Nhuận|Phu Nhuan|Bình Tân|Binh Tan|Củ Chi|Cu Chi|Hóc Môn|Hoc Mon|Bình Chánh|Binh Chanh|Nhà Bè|Nha Be|Cần Giờ|Can Gio|Quận\s?1|District\s?1|Q\.?1|Quận\s?3|District\s?3|Q\.?3|Quận\s?4|District\s?4|Q\.?4|Quận\s?5|District\s?5|Q\.?5|Quận\s?6|District\s?6|Q\.?6|Quận\s?7|District\s?7|Q\.?7|Quận\s?8|District\s?8|Q\.?8|Quận\s?10|District\s?10|Q\.?10|Quận\s?11|District\s?11|Q\.?11|Quận\s?12|District\s?12|Q\.?12/i 
        };
      }
    }
    const scoreFieldToCheck = sortField; 
    if (rating && rating !== 'all') {
      switch (rating) {
        case 'gte4_5':
        case 'gte9':
          filterQuery['$or'] = [
            { [scoreFieldToCheck]: { $gte: 9.0 } },
            { [scoreFieldToCheck]: { $gte: 4.5, $lte: 5.0 } }
          ];
          break;
        case 'gte4':
        case '8to9':
          filterQuery['$or'] = [
            { [scoreFieldToCheck]: { $gte: 8.0 } },
            { [scoreFieldToCheck]: { $gte: 4.0, $lte: 5.0 } }
          ];
          break;
        case 'gte3_5':
        case '7to8':
          filterQuery['$or'] = [
            { [scoreFieldToCheck]: { $gte: 7.0 } },
            { [scoreFieldToCheck]: { $gte: 3.5, $lte: 5.0 } }
          ];
          break;
        case 'gte3':
        case '6to7':
          filterQuery['$or'] = [
            { [scoreFieldToCheck]: { $gte: 6.0 } },
            { [scoreFieldToCheck]: { $gte: 3.0, $lte: 5.0 } }
          ];
          break;
        case 'lt6':
          filterQuery[scoreFieldToCheck] = { $lt: 6.0 };
          break;
      }
    }

    if (tags && tags !== 'Tất cả') {
      const tagList = tags.split(',').map(t => t.trim()).filter(Boolean);
      if (tagList.length > 0) {
        // Match ANY of the tags (OR logic)
        filterQuery['tags'] = { $regex: new RegExp(tagList.join('|'), 'i') };
      }
    }

    // Logic gọi AI (Text Search)
    let aiIndexMap: Record<string, number> = {};
    let isAiSearch = false;
    if (search && search.trim() !== '') {
      isAiSearch = true;
      try {
        const payload = {
            query: search,
            user_gps: (userLat && userLon) ? [parseFloat(userLat), parseFloat(userLon)] : null
        };
        const aiUrl = process.env.AI_SERVICE_URL || 'http://127.0.0.1:5000';
        const aiResponse = await firstValueFrom(
          this.httpService.post(`${aiUrl}/recommend`, payload)
        );
        
        const recommendedItems = aiResponse.data.scores || [];
        const recommendedIds = recommendedItems.map((item: any) => item.id);

        if (recommendedIds.length > 0) {
           filterQuery['_id'] = { $in: recommendedIds }; 
           recommendedItems.forEach((item: any, index: number) => {
               aiIndexMap[item.id] = index;
           });
        } else {
           return { data: [], total: 0, currentPage: pageNum, totalPages: 0 }; 
        }
      } catch (error) {
        console.error("Lỗi kết nối AI:", error.message);
        filterQuery['$or'] = [
          { tenQuan: { $regex: search, $options: 'i' } },
          { tags: { $regex: search, $options: 'i' } }
        ];
      }
    }

    // 3. Xác định chế độ xử lý
    const isOpenNowBool = openNow === 'true';
    const isSortDistance = sortBy === 'distance' && userLat && userLon;
    const isManualProcessing = isOpenNowBool || isSortDistance || isAiSearch;

    let data: any[] = [];
    let total = 0;

    if (isManualProcessing) {
      let allCandidates = await this.restaurantModel
        .find(filterQuery)
        .lean()
        .exec();

      if (userLat && userLon) {
        const uLat = parseFloat(userLat);
        const uLon = parseFloat(userLon);
        
        allCandidates = allCandidates.map((res: any) => {
          const parseCoord = (val: any) => {
            if (typeof val === 'number') return val;
            if (typeof val === 'string') return parseFloat(val.replace(',', '.'));
            return 0;
          };
          const resLat = parseCoord(res.lat);
          const resLon = parseCoord(res.lon);
          const dist = (resLat && resLon) ? this.getDistanceFromLatLonInKm(uLat, uLon, resLat, resLon) : 99999;
          return { ...res, distance: dist };
        });
      }

      if (isOpenNowBool) {
        allCandidates = allCandidates.filter((res: any) => this.checkIsOpen(res.openingTime || res.gioMoCua));
      }

     if (isAiSearch && sortBy === 'diemTrungBinh') {
         allCandidates.sort((a: any, b: any) => {
            // [FIX] Nếu user chọn Tăng dần (ASC), sort theo điểm số thực tế
            if (order === 'asc') {
                return (a.diemTrungBinh || 0) - (b.diemTrungBinh || 0);
            }

            // [FIX] Mặc định (DESC) hoặc không chọn: Ưu tiên độ phù hợp AI (Index thấp đứng trước)
            const idxA = aiIndexMap[a._id.toString()] ?? 9999;
            const idxB = aiIndexMap[b._id.toString()] ?? 9999;
            return idxA - idxB;
         });

      } else if (isSortDistance) {
         allCandidates.sort((a: any, b: any) => {
            return order === 'asc' ? (a.distance - b.distance) : (b.distance - a.distance);
         });
      } else {
         allCandidates.sort((a: any, b: any) => {
            const valA = a[sortField] || 0;
            const valB = b[sortField] || 0;
            return sortDirection === 1 ? valA - valB : valB - valA;
         });
      }

      total = allCandidates.length;
      data = allCandidates.slice(skip, skip + limitNum).map(res => this.mapRestaurantToDTO(res));
    } else {
      total = await this.restaurantModel.countDocuments(filterQuery).exec();
      const rawData = await this.restaurantModel
        .find(filterQuery)
        .sort(sortOptions)
        .skip(skip)
        .limit(limitNum)
        .exec();
    }

    return {
      data,
      total,
      currentPage: pageNum,
      totalPages: Math.ceil(total / limitNum),
      sortBy: sortBy,
      order: order
    };
  }

  async findOne(idOrSlug: string): Promise<RestaurantDocument> {
    let restaurant: RestaurantDocument | null = null;
    if (Types.ObjectId.isValid(idOrSlug) && /^[0-9a-fA-F]{24}$/.test(idOrSlug)) {
      restaurant = await this.restaurantModel.findById(idOrSlug).exec();
    }
    if (!restaurant) {
      restaurant = await this.restaurantModel.findOne({ slug: idOrSlug }).exec();
    }
    if (!restaurant) {
      restaurant = await this.restaurantModel.findOne({
        urlGoc: { $regex: `${idOrSlug}$`, $options: 'i' }
      }).exec();
    }
    if (!restaurant) throw new NotFoundException(`Restaurant with ID or slug "${idOrSlug}" not found`);
    return this.mapRestaurantToDTO(restaurant) as any;
  }
  async update(id: string, updateRestaurantDto: any): Promise<RestaurantDocument> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException(`ID nhà hàng "${id}" không hợp lệ.`);
    }
    const updated = await this.restaurantModel
      .findByIdAndUpdate(id, updateRestaurantDto, { new: true })
      .exec();
    if (!updated) {
      throw new NotFoundException(`Không tìm thấy nhà hàng với ID "${id}"`);
    }
    return updated;
  }

  async remove(id: string): Promise<any> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException(`ID nhà hàng "${id}" không hợp lệ.`);
    }
    return this.restaurantModel.findByIdAndDelete(id).exec();
  }

  private getRandomReply(type: 'success' | 'notFound' | 'error', params?: { count?: number; keyword?: string }): string {
    const { count, keyword } = params || {};

    const templates = {
      success: [
        `Tuyệt vời! Mình tìm được ${count} quán "${keyword}" được đánh giá cao nhất cho bạn đây 👇`,
        `Có ngay! Dưới đây là ${count} địa điểm bán "${keyword}" xịn xò nhất mà mình lọc được. Mời bạn thẩm! 😋`,
        `Bingo! 🎯 Tìm thấy ${count} quán "${keyword}" cực phẩm. Bạn xem thử nhé!`,
        `Dựa trên yêu cầu "${keyword}", đây là top ${count} quán "đỉnh của chóp" mình gợi ý cho bạn.`,
        `Đã tìm ra! ${count} địa điểm này chắc chắn sẽ làm bạn hài lòng với món "${keyword}".`,
        `Món "${keyword}" hả? Dễ ợt! Mình có ${count} gợi ý siêu chất lượng bên dưới này.`
      ],
      notFound: [
        `Hic, tiếc quá! Mình lục tung dữ liệu mà không thấy quán nào bán "${keyword}". Hay bạn thử món khác xem? 🍜`,
        `Rất tiếc, hiện tại mình chưa có dữ liệu về món "${keyword}". Bạn thử tìm "Phở", "Cơm tấm" xem sao nhé!`,
        `Ca này khó! 😅 Mình không tìm thấy kết quả nào cho "${keyword}". Bạn kiểm tra lại chính tả hoặc thử từ khóa ngắn gọn hơn nhé.`,
        `Hmm... Món này nghe lạ quá, mình chưa tìm thấy quán phù hợp. Bạn thử đổi món khác nhé?`
      ],
      error: [
        `Ouch! Hệ thống đang bị "đau bụng" chút xíu. Bạn thử lại sau nhé! 🤒`,
        `Xin lỗi, mình đang mất kết nối tạm thời. Bạn chờ chút rồi hỏi lại nha!`,
        `Máy chủ đang bận, bạn vui lòng thử lại sau vài phút nhé!`
      ]
    };

    const list = templates[type];
    const randomIndex = Math.floor(Math.random() * list.length);
    return list[randomIndex];
  }

  async chatWithAI(message: string, userLat?: string, userLon?: string) {
    try {
      // 1. Gọi logic findAll lấy 50 quán để sort
      const result = await this.findAll(
        1, 50, 'diemTrungBinh', 'desc', 'all', 'false', userLat, userLon, message
      );

      // 2. Sort thủ công theo rating
      let topRestaurants = result.data || [];
      topRestaurants.sort((a: any, b: any) => (b.diemTrungBinh || 0) - (a.diemTrungBinh || 0));

      // 3. Lấy Top 5
      topRestaurants = topRestaurants.slice(0, 5);
      const count = topRestaurants.length;

      // 4. [MỚI] Chọn câu trả lời ngẫu nhiên
      let replyText = "";
      if (count > 0) {
        replyText = this.getRandomReply('success', { count, keyword: message });
      } else {
        replyText = this.getRandomReply('notFound', { keyword: message });
      }

      return {
        reply: replyText,
        results: topRestaurants
      };

    } catch (error) {
      console.error("Chatbot Error:", error);
      return {
        reply: this.getRandomReply('error'),
        results: []
      };
    }
  }
}