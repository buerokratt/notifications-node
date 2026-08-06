import { HttpModule } from '@nestjs/axios';
import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { TimTokenGuard } from './guards';
import { TimService } from './services';
import { timConfigFactory } from './tim-config.factory';

@Global()
@Module({
  imports: [ConfigModule.forFeature(timConfigFactory), HttpModule],
  providers: [TimService, TimTokenGuard],
  exports: [TimService, TimTokenGuard],
})
export class TimModule {}
