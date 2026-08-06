import { Inject, Injectable, Logger, OnApplicationBootstrap, Optional } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';

import { RabbitmqService } from '../../rabbitmq/services';
import { NOTIFICATION_RECEIVED_EVENT } from '../../shared/shared.constants';
import { EventBusType } from '../enums';
import { EVENT_MODULE_CONFIGURATION } from '../event.constants';
import type { EventModuleConfiguration } from '../interfaces';

@Injectable()
export class EventService implements OnApplicationBootstrap {
  private readonly logger = new Logger(EventService.name);

  constructor(
    private readonly eventEmitter: EventEmitter2,
    @Optional() private readonly rabbitmqService: RabbitmqService,
    @Inject(EVENT_MODULE_CONFIGURATION)
    private readonly configuration: EventModuleConfiguration,
  ) {}

  public async onApplicationBootstrap(): Promise<void> {
    await this.bootstrap();
  }

  private async bootstrap(): Promise<void> {
    switch (this.eventBusType) {
      case EventBusType.RabbitMQ:
        await this.rabbitmqService.subscribe((data) => {
          this.eventEmitter.emit(NOTIFICATION_RECEIVED_EVENT, data);
        });
        break;
      default:
        this.logger.warn('No event bus configured, skipping event service bootstrap');
        throw new Error(`Unsupported event bus type: ${this.eventBusType}`);
    }
  }

  get eventBusType(): EventBusType | undefined {
    return this.configuration.type;
  }
}
