export class RestaurantCandidateDto {
  restaurant_id: string;
  name: string;
  address: string;
  location?: {
    type: string;
    coordinates: [number, number]; // [lng, lat]
  };
  lat?: number;
  lng?: number;
  rating: number;
  price_level?: number | string;
  tags?: string[];
  cuisine_type?: string[];
  open_time?: string;
  close_time?: string;
  opening_hours?: Record<string, any>;
  average_cost?: number;
  featured_image?: string;
}

export class TasteDnaProfileDto {
  userId: string;
  flavorProfile: {
    sweet: number;
    sour: number;
    salty: number;
    spicy: number;
    bitter: number;
    umami: number;
  };
  preferredCuisines?: string[];
  dietaryRestrictions?: string[];
  pricePreference?: string;
  lastUpdated?: Date;
}

export class TasteDnaFeedbackDto {
  completedItineraryId: string;
  restaurantIds: string[];
  rating: number;
  feedbackText?: string;
}

export class RecordInteractionEventDto {
  userId: string;
  restaurantId: string;
  interactionType:
    | 'view'
    | 'click'
    | 'favorite'
    | 'itinerary_add'
    | 'itinerary_complete';
  dwellTime?: number;
  source?: string;
  metadata?: Record<string, any>;
}
