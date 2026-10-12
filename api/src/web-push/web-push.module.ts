import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { WebPushService } from './services';
import { webPushConfigFactory } from './web-push-config.factory';
import { ValkeyModule } from '../valkey/valkey.module';

@Module({
  imports: [ConfigModule.forFeature(webPushConfigFactory), ValkeyModule],
  providers: [WebPushService],
  exports: [WebPushService],
})
export class WebPushModule {}
