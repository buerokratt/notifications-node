import { Module } from '@nestjs/common';

import { NotificationService } from './services';
import { RabbitmqModule } from '../rabbitmq/rabbitmq.module';

@Module({
  imports: [RabbitmqModule],
  providers: [NotificationService],
  exports: [NotificationService],
})
export class NotificationModule {}
