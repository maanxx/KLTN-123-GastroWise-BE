import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { MongooseModule } from '@nestjs/mongoose';
import { UsersModule } from './users/users.module';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthModule } from './auth/auth.module';
import { RestaurantsModule } from './restaurants/restaurants.module';
import { ReviewsModule } from './reviews/reviews.module';
import { FavoritesModule } from './favorites/favorites.module';
import { ItinerariesModule } from './itineraries/itineraries.module';
import { ContactsModule } from './contacts/contacts.module';
import { InteractionsModule } from './interactions/interactions.module';
import { TasteDnaModule } from './taste-dna/taste-dna.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }), 
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => {
        const uri = configService.get<string>('MONGODB_URI');
        if (!uri) {
          throw new Error('MONGODB_URI environment variable is required');
        }
        return {
          uri,
          serverSelectionTimeoutMS: 5000,
        };
      },
      inject: [ConfigService],
    }),
    UsersModule,
    AuthModule,
    RestaurantsModule,
    ReviewsModule,
    FavoritesModule,
    ItinerariesModule,
    ContactsModule,
    InteractionsModule,
    TasteDnaModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
