import { Module } from '@nestjs/common';

import { PublicNotificationsController } from './controllers';
import { NotificationModule } from '../notification/notification.module';

@Module({
  imports: [NotificationModule],
  controllers: [PublicNotificationsController],
})
export class PublicNotificationsModule {}
