import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  Restaurant,
  RestaurantSchema,
} from '../restaurants/schemas/restaurant.schema';
import { TasteDnaModule } from '../taste-dna/taste-dna.module';
import { InteractionsModule } from '../interactions/interactions.module';
import { InternalRestaurantsController } from './internal-restaurants.controller';
import { InternalTasteDnaController } from './internal-taste-dna.controller';
import { InternalInteractionsController } from './internal-interactions.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Restaurant.name, schema: RestaurantSchema },
    ]),
    TasteDnaModule,
    InteractionsModule,
  ],
  controllers: [
    InternalRestaurantsController,
    InternalTasteDnaController,
    InternalInteractionsController,
  ],
})
export class InternalModule {}
