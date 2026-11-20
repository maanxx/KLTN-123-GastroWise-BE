import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  UseGuards,
  NotFoundException,
} from '@nestjs/common';
import { TasteDnaService } from '../taste-dna/taste-dna.service';
import { InternalAuthGuard } from '@shared/guards/internal-auth.guard';
import {
  TasteDnaProfileDto,
  TasteDnaFeedbackDto,
} from '@shared/contracts/core.contracts';

@UseGuards(InternalAuthGuard)
@Controller('internal/taste-dna')
export class InternalTasteDnaController {
  constructor(private readonly tasteDnaService: TasteDnaService) {}

  @Get(':userId')
  async getProfile(
    @Param('userId') userId: string,
  ): Promise<TasteDnaProfileDto> {
    const profile = await this.tasteDnaService.getProfile(userId);
    if (!profile) {
      throw new NotFoundException(
        `Taste DNA profile for user "${userId}" not found`,
      );
    }

    return {
      userId,
      flavorProfile: {
        sweet: profile.sweet ?? 0.5,
        sour: profile.sour ?? 0.5,
        salty: profile.salty ?? 0.5,
        spicy: profile.spicy ?? 0.5,
        bitter: profile.bitter ?? 0.5,
        umami: profile.umami ?? 0.5,
      },
      preferredCuisines: profile.favoriteCuisines,
      dietaryRestrictions: profile.dietaryRestrictions,
      pricePreference: profile.budgetPreference,
      lastUpdated: (profile as any).updatedAt,
    };
  }

  @Post(':userId/feedback')
  async applyFeedback(
    @Param('userId') userId: string,
    @Body() dto: TasteDnaFeedbackDto,
  ): Promise<{ success: boolean }> {
    await this.tasteDnaService.applyFeedbackEma(
      userId,
      {
        sweet: 0.5,
        spicy: 0.5,
        sour: 0.5,
        salty: 0.5,
        umami: 0.5,
        bitter: 0.5,
      },
      0.15,
    );
    return { success: true };
  }
}
