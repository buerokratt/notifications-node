import { join } from 'path';

import { DynamicModule, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { appConfigFactory } from './app-config.factory';
import { AppType } from './enums';
import { EventBusType } from './event/enums';
import { EventModule } from './event/event.module';
import { HealthModule } from './health/health.module';
import { PrivateNotificationsModule } from './private-notifications/private-notifications.module';
import { PublicNotificationsModule } from './public-notifications/public-notifications.module';

@Module({})
export class AppModule {
  public static register(appType: AppType): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ConfigModule.forRoot({
          envFilePath: join(process.cwd(), 'config', `${process.env.NODE_ENV || 'development'}.env`),
          expandVariables: true,
        }),
        ConfigModule.forFeature(appConfigFactory),
        HealthModule,
        ...(appType === AppType.Public
          ? [EventModule.forRoot({ type: EventBusType.RabbitMQ }), PublicNotificationsModule]
          : []),
        ...(appType === AppType.Private ? [PrivateNotificationsModule] : []),
      ],
    };
  }
}
