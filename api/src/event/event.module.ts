import { DynamicModule, Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';

import { EventBusType } from './enums';
import { EVENT_MODULE_CONFIGURATION } from './event.constants';
import { EventModuleConfiguration } from './interfaces';
import { EventService, WebPushEventConsumerService } from './services';
import { RabbitmqModule } from '../rabbitmq/rabbitmq.module';
import { WebPushModule } from '../web-push/web-push.module';

@Module({
  imports: [WebPushModule],
  providers: [EventService, WebPushEventConsumerService],
  exports: [EventService],
})
export class EventModule {
  public static forRoot(options: EventModuleConfiguration): DynamicModule {
    switch (options.type) {
      case EventBusType.RabbitMQ:
        return {
          module: EventModule,
          imports: [EventEmitterModule.forRoot(), RabbitmqModule],
          providers: [{ provide: EVENT_MODULE_CONFIGURATION, useValue: options }],
        };

      default:
        throw new Error(`Unsupported event bus type: ${String(options.type)}`);
    }
  }
}
