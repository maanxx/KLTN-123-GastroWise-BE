import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { UsersModule } from './users/users.module';
import { AuthModule } from './auth/auth.module';
import { RestaurantsModule } from './restaurants/restaurants.module';
import { ReviewsModule } from './reviews/reviews.module';
import { FavoritesModule } from './favorites/favorites.module';
import { ContactsModule } from './contacts/contacts.module';
import { InteractionsModule } from './interactions/interactions.module';
import { TasteDnaModule } from './taste-dna/taste-dna.module';
import { HealthModule } from './health/health.module';
import { InternalModule } from './internal/internal.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => {
        const uri =
          configService.get<string>('MONGODB_URI_CORE') ||
          configService.get<string>('MONGODB_URI');
        if (!uri) {
          throw new Error(
            'MONGODB_URI_CORE or MONGODB_URI environment variable is required',
          );
        }
        return {
          uri,
          dbName: configService.get<string>('CORE_DB_NAME') || 'gastro_core',
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
    ContactsModule,
    InteractionsModule,
    TasteDnaModule,
    HealthModule,
    InternalModule,
  ],
})
export class AppModule {}
