import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  HttpException,
    HttpStatus,
    Param,
    Delete,
  Patch,
} from '@nestjs/common';
import { ReviewsService } from './reviews.service';
import { CreateReviewDto } from './dto/create-review.dto';

@Controller('reviews')
export class ReviewsController {
  constructor(private readonly reviewsService: ReviewsService) {}

  @Post()
  async create(@Body() createReviewDto: CreateReviewDto) {
    return this.reviewsService.create(createReviewDto);
  }

  @Get()
  async findAll(@Query('url') url?: string, @Query('search') search?: string, @Query('sentiment') sentiment?: string) {
    if (!url) {
      return this.reviewsService.getAllReviews({ search, sentiment });
    }
    return this.reviewsService.findByRestaurantUrl(url);
  }

  @Get('all')
  async getAll(@Query() query: any) {
    return this.reviewsService.getAllReviews(query);
  }

  @Get('restaurant/:id')
  async getByRestaurantId(@Param('id') id: string) {
    return this.reviewsService.findByRestaurantId(id);
  }

  @Delete(':id')
  async delete(@Param('id') id: string) {
    return this.reviewsService.deleteReview(id);
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: any) {
    return this.reviewsService.updateReview(id, dto);
  }

  @Post('migrate-sentiment')
  async migrateOldData() {
    return this.reviewsService.updateAllReviewsSentiment();
  }
}