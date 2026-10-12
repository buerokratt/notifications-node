import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TerminusModule } from '@nestjs/terminus';

import { ValkeyService } from './services';
import { valkeyConfigFactory } from './valkey-config.factory';

@Module({
  imports: [ConfigModule.forFeature(valkeyConfigFactory), TerminusModule],
  providers: [ValkeyService],
  exports: [ValkeyService],
})
export class ValkeyModule {}
