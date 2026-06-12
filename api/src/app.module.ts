import { join } from 'path';

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { appConfigFactory } from './app-config.factory';
import { EventBusType } from './event/enums';
import { EventModule } from './event/event.module';
import { HealthModule } from './health/health.module';
import { NotificationModule } from './notification/notification.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      envFilePath: join(process.cwd(), 'config', `${process.env.NODE_ENV || 'development'}.env`),
      expandVariables: true,
    }),
    ConfigModule.forFeature(appConfigFactory),
    EventModule.forRoot({ type: EventBusType.RabbitMQ }),
    HealthModule,
    NotificationModule,
  ],
})
export class AppModule {}
