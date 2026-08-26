import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';

import { HealthController } from './controllers';
import { RabbitmqModule } from '../rabbitmq/rabbitmq.module';
import { ValkeyModule } from '../valkey/valkey.module';

@Module({
  imports: [RabbitmqModule, TerminusModule, ValkeyModule],
  controllers: [HealthController],
})
export class HealthModule {}
