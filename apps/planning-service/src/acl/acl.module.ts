import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { CoreApiClient } from './core-api.client';
import { AiApiClient } from './ai-api.client';

@Module({
  imports: [HttpModule],
  providers: [CoreApiClient, AiApiClient],
  exports: [CoreApiClient, AiApiClient],
})
export class AclModule {}
