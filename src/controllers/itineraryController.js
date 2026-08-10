const Itinerary = require('../models/Itinerary');
const ItineraryStop = require('../models/ItineraryStop');
const Restaurant = require('../models/Restaurant');

exports.generateItinerary = async (req, res) => {
  try {
    const { title, start_time, end_time, budget, lat, lng } = req.body;
    const userId = req.user.id;

    const newItinerary = await Itinerary.create({
      user_id: userId,
      title: title || 'Lộ trình khám phá ẩm thực',
      start_time,
      end_time,
      budget,
      start_lat: lat,
      start_lng: lng
    });

    const radius = 5000; 
    let availableRestaurants = await Restaurant.findNearby(lat, lng, radius);

    const estimatedStops = 3;
    const budgetPerStop = budget / estimatedStops;

    let candidates = availableRestaurants.filter(r => {
      if (r.avg_price && r.avg_price > budgetPerStop) return false;
      return true;
    });

    candidates.sort((a, b) => {
      const scoreA = (a.rating_avg * 20) - (a.distance_m / 100); 
      const scoreB = (b.rating_avg * 20) - (b.distance_m / 100);
      return scoreB - scoreA;
    });

    const selectedRestaurants = candidates.slice(0, estimatedStops);

    if (selectedRestaurants.length === 0) {
      return res.status(400).json({ message: 'Không tìm thấy nhà hàng nào phù hợp với tiêu chí của bạn.' });
    }

    const start = new Date(start_time);
    let current_time = new Date(start.getTime());

    const stops = [];
    for (let i = 0; i < selectedRestaurants.length; i++) {
      const restaurant = selectedRestaurants[i];
      
      const arrival = new Date(current_time.getTime() + 15 * 60000); 
      const departure = new Date(arrival.getTime() + 60 * 60000); 
      
      stops.push({
        itinerary_id: newItinerary.id,
        restaurant_id: restaurant.id,
        order_index: i + 1,
        arrival_time: arrival.toISOString(),
        departure_time: departure.toISOString(),
        distance_from_prev: i === 0 ? restaurant.distance_m : 2000
      });

      current_time = new Date(departure.getTime());
    }

    await ItineraryStop.bulkCreate(stops);

    const finalItinerary = await Itinerary.findById(newItinerary.id);
    
    res.status(201).json(finalItinerary);
  } catch (error) {
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
