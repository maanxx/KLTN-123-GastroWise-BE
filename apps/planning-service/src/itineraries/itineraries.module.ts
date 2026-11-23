import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { HttpModule } from '@nestjs/axios';
import { ItinerariesController } from './itineraries.controller';
import { ItinerariesService } from './itineraries.service';
import { Itinerary, ItinerarySchema } from './schemas/itinerary.schema';
import { AclModule } from '../acl/acl.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Itinerary.name, schema: ItinerarySchema },
    ]),
    HttpModule,
    AclModule,
    AuthModule,
  ],
  controllers: [ItinerariesController],
  providers: [ItinerariesService],
  exports: [ItinerariesService],
})
export class ItinerariesModule {}
