import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { InteractionsService } from '../interactions/interactions.service';
import { InternalAuthGuard } from '@shared/guards/internal-auth.guard';
import { RecordInteractionEventDto } from '@shared/contracts/core.contracts';
import {
  InteractionEventType,
  TargetType,
} from '../interactions/schemas/interaction.schema';

@UseGuards(InternalAuthGuard)
@Controller('internal/interactions')
export class InternalInteractionsController {
  constructor(private readonly interactionsService: InteractionsService) {}

  @Post('event')
  async recordEvent(
    @Body() dto: RecordInteractionEventDto,
  ): Promise<{ success: boolean }> {
    const eventTypeMap: Record<string, InteractionEventType> = {
      view: InteractionEventType.VIEW,
      click: InteractionEventType.CLICK,
      favorite: InteractionEventType.FAVORITE,
      itinerary_add: InteractionEventType.ITINERARY_ADD,
      itinerary_complete: InteractionEventType.ITINERARY_COMPLETE,
    };

    await this.interactionsService.recordEvent(dto.userId, {
      eventType: eventTypeMap[dto.interactionType] || InteractionEventType.VIEW,
      targetType: TargetType.RESTAURANT,
      targetId: dto.restaurantId,
      durationMs: dto.dwellTime || 0,
      metadata: {
        source: dto.source || 'planning-service',
        ...dto.metadata,
      },
    });

    return { success: true };
  }
}
