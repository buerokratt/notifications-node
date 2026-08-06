import { Module } from '@nestjs/common';

import { NotificationController } from './controllers';
import { NotificationService } from './services';
import { RabbitmqModule } from '../rabbitmq/rabbitmq.module';

@Module({
  imports: [RabbitmqModule],
  providers: [NotificationService],
  controllers: [NotificationController],
})
export class NotificationModule {}
