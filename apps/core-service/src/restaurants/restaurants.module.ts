// src/restaurants/restaurants.module.ts
import { Module } from '@nestjs/common';
import { RestaurantsService } from './restaurants.service';
import { RestaurantsController } from './restaurants.controller';
import { DishesController } from './dishes.controller';
import { MongooseModule } from '@nestjs/mongoose';
import { Restaurant, RestaurantSchema } from './schemas/restaurant.schema';
import { MenuItem, MenuItemSchema } from './schemas/menu-item.schema';
import { Review, ReviewSchema } from '../reviews/schemas/review.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import {
  FavoriteCollection,
  FavoriteCollectionSchema,
} from '../favorites/schemas/favorite-collection.schema';
import { HttpModule } from '@nestjs/axios';
import { TasteDnaModule } from '../taste-dna/taste-dna.module';
import { InteractionsModule } from '../interactions/interactions.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Restaurant.name, schema: RestaurantSchema },
      { name: MenuItem.name, schema: MenuItemSchema },
      { name: Review.name, schema: ReviewSchema },
      { name: User.name, schema: UserSchema },
      { name: FavoriteCollection.name, schema: FavoriteCollectionSchema },
    ]),
    HttpModule,
    TasteDnaModule,
    InteractionsModule,
  ],
  controllers: [RestaurantsController, DishesController],
  providers: [RestaurantsService],
  exports: [RestaurantsService],
})
export class RestaurantsModule {}
