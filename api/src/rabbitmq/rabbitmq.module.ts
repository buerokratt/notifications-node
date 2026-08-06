import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TerminusModule } from '@nestjs/terminus';

import { rabbitmqConfigFactory } from './rabbitmq-config.factory';
import { RabbitmqService } from './services';

@Module({
  imports: [ConfigModule.forFeature(rabbitmqConfigFactory), TerminusModule],
  providers: [RabbitmqService],
  exports: [RabbitmqService],
})
export class RabbitmqModule {}
