import { Module } from '@nestjs/common';

import { NotificationService } from './services';
import { RabbitmqModule } from '../rabbitmq/rabbitmq.module';
import { WebPushModule } from '../web-push/web-push.module';

@Module({
  imports: [RabbitmqModule, WebPushModule],
  providers: [NotificationService],
  exports: [NotificationService],
})
export class NotificationModule {}
