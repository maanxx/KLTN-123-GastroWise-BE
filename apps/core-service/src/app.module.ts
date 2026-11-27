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
import { resolveServiceMongoUri } from '@shared/database/mongo-uri.util';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => {
        const { uri, dbName } = resolveServiceMongoUri(configService, {
          uriEnvKeys: ['CORE_MONGODB_URI', 'MONGODB_URI_CORE'],
          userEnvKey: 'CORE_DB_USER',
          passwordEnvKey: 'CORE_DB_PASSWORD',
          dbNameEnvKey: 'CORE_DB_NAME',
          defaultDbName: 'gastro_core',
        });
        return {
          uri,
          dbName,
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
