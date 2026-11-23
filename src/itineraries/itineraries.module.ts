import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { HttpModule } from '@nestjs/axios';
import { ItinerariesService } from './itineraries.service';
import { ItinerariesController } from './itineraries.controller';
import { Itinerary, ItinerarySchema } from './schemas/itinerary.schema';
import {
  Restaurant,
  RestaurantSchema,
} from '../restaurants/schemas/restaurant.schema';
import { TasteDnaModule } from '../taste-dna/taste-dna.module';
import { InteractionsModule } from '../interactions/interactions.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Itinerary.name, schema: ItinerarySchema },
      { name: Restaurant.name, schema: RestaurantSchema },
    ]),
    HttpModule,
    TasteDnaModule,
    InteractionsModule,
  ],
  controllers: [ItinerariesController],
  providers: [ItinerariesService],
  exports: [ItinerariesService],
})
export class ItinerariesModule {}
