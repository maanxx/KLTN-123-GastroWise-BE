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

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }), // 2. Initialize ConfigModule
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        uri: configService.get<string>('MONGODB_URI'),
      }),
      inject: [ConfigService],
    }),
    UsersModule,
    AuthModule,
    RestaurantsModule,
    ReviewsModule,
    FavoritesModule,
    ItinerariesModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
