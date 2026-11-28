import { Controller, Get, Query } from '@nestjs/common';
import { RestaurantsService } from './restaurants.service';
import { QueryFoodRecommendationsDto } from './dto/query-food-recommendations.dto';

@Controller('recommendations')
export class RecommendationsController {
  constructor(private readonly restaurantsService: RestaurantsService) {}

  /**
   * [M10.9] Personalized food discovery & restaurant/dish recommendations
   * GET /api/v1/recommendations/food
   */
  @Get('food')
  getFoodRecommendations(@Query() query: QueryFoodRecommendationsDto) {
    return this.restaurantsService.getFoodRecommendations(query);
  }
}
