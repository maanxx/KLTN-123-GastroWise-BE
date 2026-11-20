import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Param,
  Delete,
  Patch,
  UseGuards,
  Req,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ReviewsService } from './reviews.service';
import { CreateReviewDto } from './dto/create-review.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

@Controller('reviews')
export class ReviewsController {
  constructor(private readonly reviewsService: ReviewsService) {}

  /**
   * [P0-002 FIX] Tạo review mới - Yêu cầu xác thực JWT, tự động gán userId từ token
   */
  @UseGuards(JwtAuthGuard)
  @Post()
  async create(@Req() req: any, @Body() createReviewDto: CreateReviewDto) {
    const userId = req.user?._id || req.user?.sub || req.user?.id;
    if (userId) {
      createReviewDto.userId = userId.toString();
    }
    if (req.user?.name && !createReviewDto.userName) {
      createReviewDto.userName = req.user.name;
    }
    return this.reviewsService.create(createReviewDto);
  }

  @Get()
  async findAll(
    @Query('url') url?: string,
    @Query('search') search?: string,
    @Query('sentiment') sentiment?: string,
  ) {
    if (!url) {
      return this.reviewsService.getAllReviews({ search, sentiment });
    }
    return this.reviewsService.findByRestaurantUrl(url);
  }

  @Get('stats')
  async getStats() {
    return this.reviewsService.getReviewStats();
  }

  @Get('all')
  async getAll(@Query() query: any) {
    return this.reviewsService.getAllReviews(query);
  }

  @Get('restaurant/:id')
  async getByRestaurantId(@Param('id') id: string) {
    return this.reviewsService.findByRestaurantId(id);
  }

  /**
   * [P0-002 FIX] Xóa review - Yêu cầu xác thực JWT + kiểm tra quyền sở hữu hoặc Admin
   */
  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  async delete(@Req() req: any, @Param('id') id: string) {
    const user = req.user;
    const review = await (this.reviewsService as any).reviewModel
      .findById(id)
      .exec();
    if (!review) {
      throw new NotFoundException(`Review với ID "${id}" không tồn tại.`);
    }

    const isAdmin = user?.role === 'admin' || user?.roles?.includes('admin');
    const isOwner =
      review.userId &&
      review.userId.toString() === (user?._id || user?.sub)?.toString();

    if (!isAdmin && !isOwner) {
      throw new ForbiddenException(
        'Bạn không có quyền xóa đánh giá của người khác.',
      );
    }

    return this.reviewsService.deleteReview(id);
  }

  /**
   * [P0-002 FIX] Cập nhật review - Yêu cầu xác thực JWT + kiểm tra quyền sở hữu hoặc Admin
   */
  @UseGuards(JwtAuthGuard)
  @Patch(':id')
  async update(@Req() req: any, @Param('id') id: string, @Body() dto: any) {
    const user = req.user;
    const review = await (this.reviewsService as any).reviewModel
      .findById(id)
      .exec();
    if (!review) {
      throw new NotFoundException(`Review với ID "${id}" không tồn tại.`);
    }

    const isAdmin = user?.role === 'admin' || user?.roles?.includes('admin');
    const isOwner =
      review.userId &&
      review.userId.toString() === (user?._id || user?.sub)?.toString();

    if (!isAdmin && !isOwner) {
      throw new ForbiddenException(
        'Bạn không có quyền chỉnh sửa đánh giá này.',
      );
    }

    return this.reviewsService.updateReview(id, dto);
  }

  /**
   * [P0-002 FIX] Quét và cập nhật dữ liệu sentiment - Chỉ dành cho Quản trị viên
   */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @Post('migrate-sentiment')
  async migrateOldData() {
    return this.reviewsService.updateAllReviewsSentiment();
  }
}
