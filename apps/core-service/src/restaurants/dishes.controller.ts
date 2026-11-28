import { Controller, Get, Param, Query } from '@nestjs/common';
import { RestaurantsService } from './restaurants.service';
import { QueryDishesDto } from './dto/query-dishes.dto';

@Controller('dishes')
export class DishesController {
  constructor(private readonly restaurantsService: RestaurantsService) {}

  /**
   * [M10.5] List and search dishes with pagination, price range, and tag/category filters
   * GET /api/v1/dishes
   */
  @Get()
  findAll(@Query() query: QueryDishesDto) {
    return this.restaurantsService.findDishes(query);
  }

  /**
   * [M10.5] Get dish detail by MongoDB ObjectId
   * GET /api/v1/dishes/:id
   */
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.restaurantsService.findDishById(id);
  }
}
