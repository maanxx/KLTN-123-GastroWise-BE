const Itinerary = require('../models/Itinerary');
const ItineraryStop = require('../models/ItineraryStop');
const Restaurant = require('../models/Restaurant');

exports.generateItinerary = async (req, res) => {
  try {
    const { title, start_time, end_time, budget, lat, lng } = req.body;
    const userId = req.user.id;

    // 1. Tạo bản ghi Itinerary (Header)
    const newItinerary = await Itinerary.create({
      user_id: userId,
      title: title || 'Lộ trình khám phá ẩm thực',
      start_time,
      end_time,
      budget,
      start_lat: lat,
      start_lng: lng
    });

    // 2. Thuật toán Tham lam (Greedy) kết hợp Spatial
    // Bán kính tìm kiếm ban đầu: 5km
    const radius = 5000; 
    let availableRestaurants = await Restaurant.findNearby(lat, lng, radius);

    // Filter cơ bản (Ở đây demo lọc các nhà hàng có giá trung bình nhỏ hơn ngân sách / số bữa ăn dự kiến)
    // Giả sử lộ trình trung bình có 2-3 bữa ăn
    const estimatedStops = 3;
    const budgetPerStop = budget / estimatedStops;

    // Giả lập filter giá (vì hiện tại DB có thể avg_price đang null, nên ta ưu tiên rating)
    let candidates = availableRestaurants.filter(r => {
      // Nếu có giá, phải nhỏ hơn budget
      if (r.avg_price && r.avg_price > budgetPerStop) return false;
      return true;
    });

    // Sắp xếp theo chất lượng (rating) và khoảng cách (distance)
    // Tỷ trọng: Ưu tiên rating cao, sau đó mới tính đến distance gần
    candidates.sort((a, b) => {
      const scoreA = (a.rating_avg * 20) - (a.distance_m / 100); 
      const scoreB = (b.rating_avg * 20) - (b.distance_m / 100);
      return scoreB - scoreA;
    });

    // Lấy top 3 điểm đến (hoặc ít hơn nếu ko đủ)
    const selectedRestaurants = candidates.slice(0, estimatedStops);

    if (selectedRestaurants.length === 0) {
      return res.status(400).json({ message: 'Không tìm thấy nhà hàng nào phù hợp với tiêu chí của bạn.' });
    }

    // 3. Tính toán thời gian cho từng điểm đến (Giả lập)
    const start = new Date(start_time);
    let current_time = new Date(start.getTime());

    const stops = [];
    for (let i = 0; i < selectedRestaurants.length; i++) {
      const restaurant = selectedRestaurants[i];
      
      // Giả sử thời gian di chuyển giữa các điểm là 15 phút, thời gian ăn là 60 phút
      const arrival = new Date(current_time.getTime() + 15 * 60000); 
      const departure = new Date(arrival.getTime() + 60 * 60000); 
      
      stops.push({
        itinerary_id: newItinerary.id,
        restaurant_id: restaurant.id,
        order_index: i + 1,
        arrival_time: arrival.toISOString(),
        departure_time: departure.toISOString(),
        distance_from_prev: i === 0 ? restaurant.distance_m : 2000 // Giả lập khoảng cách từ điểm trước
      });

      current_time = new Date(departure.getTime());
    }

    // 4. Lưu các điểm dừng vào database (Bulk Insert)
    await ItineraryStop.bulkCreate(stops);

    // 5. Lấy kết quả hoàn chỉnh trả về cho FE
    const finalItinerary = await Itinerary.findById(newItinerary.id);
    
    res.status(201).json(finalItinerary);
  } catch (error) {
    console.error('Lỗi sinh lộ trình:', error);
    res.status(500).json({ message: 'Lỗi server khi tính toán lộ trình' });
  }
};

exports.getUserItineraries = async (req, res) => {
  try {
    const userId = req.user.id;
    const itineraries = await Itinerary.findByUserId(userId);
    res.status(200).json(itineraries);
  } catch (error) {
    console.error('Lỗi lấy danh sách lộ trình:', error);
    res.status(500).json({ message: 'Lỗi server' });
  }
};

exports.getItineraryById = async (req, res) => {
  try {
    const { id } = req.params;
    const itinerary = await Itinerary.findById(id);
    
    if (!itinerary || itinerary.user_id !== req.user.id) {
      return res.status(404).json({ message: 'Không tìm thấy lộ trình' });
    }
    
    res.status(200).json(itinerary);
  } catch (error) {
    console.error('Lỗi lấy chi tiết lộ trình:', error);
    res.status(500).json({ message: 'Lỗi server' });
  }
};
