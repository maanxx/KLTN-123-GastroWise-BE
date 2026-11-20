// src/taste-dna/taste-dna.module.ts
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { TasteDnaProfile, TasteDnaSchema } from './schemas/taste-dna.schema';
import { TasteDnaService } from './taste-dna.service';
import { TasteDnaController } from './taste-dna.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: TasteDnaProfile.name, schema: TasteDnaSchema },
    ]),
  ],
  controllers: [TasteDnaController],
  providers: [TasteDnaService],
  exports: [TasteDnaService],
})
export class TasteDnaModule {}
