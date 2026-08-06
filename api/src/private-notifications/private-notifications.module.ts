import { Module } from '@nestjs/common';

import { PrivateNotificationsController } from './controllers';
import { NotificationModule } from '../notification/notification.module';

@Module({
  imports: [NotificationModule],
  controllers: [PrivateNotificationsController],
})
export class PrivateNotificationsModule {}
