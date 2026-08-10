const axios = require('axios');

class GooglePlacesService {
  constructor() {
    this.apiKey = process.env.GOOGLE_PLACES_API_KEY;
    this.baseUrl = 'https://maps.googleapis.com/maps/api/place';
  }

  async findPlaceId(name, address) {
    if (!this.apiKey) {
      console.warn('Google Places API Key is not set.');
      return null;
    }

    try {
      const query = `${name} ${address || ''}`.trim();
      const response = await axios.get(`${this.baseUrl}/findplacefromtext/json`, {
        params: {
          input: query,
          inputtype: 'textquery',
          fields: 'place_id',
          key: this.apiKey,
        },
      });

      if (response.data.status === 'OK' && response.data.candidates.length > 0) {
        return response.data.candidates[0].place_id;
      }
      return null;
    } catch (error) {
      console.error('Error finding Google Place ID:', error.message);
      return null;
    }
  }

  async getPlaceReviews(placeId) {
    if (!this.apiKey || !placeId) return [];

    try {
      const response = await axios.get(`${this.baseUrl}/details/json`, {
        params: {
          place_id: placeId,
          fields: 'reviews',
          language: 'vi',
          key: this.apiKey,
        },
      });

      if (response.data.status === 'OK' && response.data.result.reviews) {
        return response.data.result.reviews.map(review => ({
          author_name: review.author_name,
          author_url: review.author_url,
          profile_photo_url: review.profile_photo_url,
          rating: review.rating,
          text: review.text,
          time: review.time, // Unix timestamp
        }));
      }
      return [];
    } catch (error) {
      console.error('Error fetching Google Place Reviews:', error.message);
      return [];
    }
  }
}

module.exports = new GooglePlacesService();
