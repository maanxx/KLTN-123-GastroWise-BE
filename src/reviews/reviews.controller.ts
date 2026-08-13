import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  HttpException,
  HttpStatus,
  Param,
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
  async findAll(@Query('url') url: string) {
    if (!url) {
      throw new HttpException('Missing url parameter', HttpStatus.BAD_REQUEST);
    }
    return this.reviewsService.findByRestaurantUrl(url);
  }

  @Get('restaurant/:id')
  async getByRestaurantId(@Param('id') id: string) {
    return this.reviewsService.findByRestaurantId(id);
  }

  @Post('migrate-sentiment')
  async migrateOldData() {
    return this.reviewsService.updateAllReviewsSentiment();
  }
}