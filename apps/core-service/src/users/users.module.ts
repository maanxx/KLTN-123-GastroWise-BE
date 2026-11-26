import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { MongooseModule } from '@nestjs/mongoose';
import { User, UserSchema } from './schemas/user.schema';
import {
  TasteDnaProfile,
  TasteDnaSchema,
} from '../taste-dna/schemas/taste-dna.schema';
import {
  FavoriteCollection,
  FavoriteCollectionSchema,
} from '../favorites/schemas/favorite-collection.schema';
import { Notification, NotificationSchema } from './schemas/notification.schema';
import {
  ChatSession,
  ChatSessionSchema,
} from '../restaurants/schemas/chat-session.schema';
import { Review, ReviewSchema } from '../reviews/schemas/review.schema';
import {
  Restaurant,
  RestaurantSchema,
} from '../restaurants/schemas/restaurant.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: TasteDnaProfile.name, schema: TasteDnaSchema },
      { name: FavoriteCollection.name, schema: FavoriteCollectionSchema },
      { name: Notification.name, schema: NotificationSchema },
      { name: ChatSession.name, schema: ChatSessionSchema },
      { name: Review.name, schema: ReviewSchema },
      { name: Restaurant.name, schema: RestaurantSchema },
    ]),
  ],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
