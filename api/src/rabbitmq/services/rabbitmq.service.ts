import { BeforeApplicationShutdown, Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { HealthIndicatorResult, HealthIndicatorService } from '@nestjs/terminus';
import { Channel, connect, ConsumeMessage } from 'amqplib';

import { NotificationTarget } from '../enums';
import { rabbitmqConfigFactory } from '../rabbitmq-config.factory';
import {
  RABBITMQ_CHANNEL_ROUTING_KEY_PREFIX,
  RABBITMQ_EVENTS_EXCHANGE,
  RABBITMQ_HEALTH_KEY,
  RABBITMQ_NAME_SEPARATOR,
} from '../rabbitmq.constants';
import { RabbitmqEventCallback, RabbitmqNotificationEvent } from '../types';

@Injectable()
export class RabbitmqService implements OnModuleInit, BeforeApplicationShutdown {
  private readonly logger = new Logger(RabbitmqService.name);
  private readonly instanceId = crypto.randomUUID();

  private client?: Awaited<ReturnType<typeof connect>>;

  // Consumes messages from this app instance's exclusive queue.
  private consumerChannel?: Channel;
  private consumerTag?: string;

  constructor(
    @Inject(rabbitmqConfigFactory.KEY)
    private readonly config: ConfigType<typeof rabbitmqConfigFactory>,
    private readonly healthIndicatorService: HealthIndicatorService,
  ) {}

  public async onModuleInit(): Promise<void> {
    this.logger.log('RabbitmqConsumerService initialized');
    await this.connect();
    await this.bindGlobal();
  }

  public async beforeApplicationShutdown(signal?: string): Promise<void> {
    this.logger.log(`Closing RabbitMQ connection. Signal: ${signal ?? 'unknown'}`);

    await this.consumerChannel?.close().catch((error) => {
      this.logger.error('Failed to close RabbitMQ consumer channel', error);
    });

    await this.client?.close().catch((error) => {
      this.logger.error('Failed to close RabbitMQ client', error);
    });
  }

  public async subscribe(callback: RabbitmqEventCallback): Promise<void> {
    if (!this.consumerChannel) {
      throw new Error('RabbitMQ consumer channel has not been initialized');
    }

    if (this.consumerTag) {
      this.logger.warn('Unable to subscribe: RabbitMQ consumer has already been started');
      throw new Error('RabbitMQ consumer has already been started');
    }

    const { consumerTag } = await this.consumerChannel.consume(
      this.queueName,
      async (message) => {
        if (!message) return;

        try {
          const event = this.parseMessage(message);
          await callback(event, message);
          this.consumerChannel?.ack(message);
        } catch (error) {
          this.logger.error('Failed to process RabbitMQ message', error);
          this.consumerChannel?.nack(message, false, false);
        }
      },
      { noAck: false },
    );

    this.consumerTag = consumerTag;
    this.logger.log(`Started RabbitMQ consumer for queue: ${this.queueName}`);
  }

  public async bindGlobal(): Promise<void> {
    await this.bindRoutingKey(this.globalRoutingKey);
  }

  public async unbindGlobal(): Promise<void> {
    await this.unbindRoutingKey(this.globalRoutingKey);
  }

  public async bindChannel(args: Parameters<typeof this.channelRoutingKey>[0]): Promise<void> {
    await this.bindRoutingKey(this.channelRoutingKey(args));
  }

  public async unbindChannel(args: Parameters<typeof this.channelRoutingKey>[0]): Promise<void> {
    await this.unbindRoutingKey(this.channelRoutingKey(args));
  }

  public isHealthy(): HealthIndicatorResult {
    const indicator = this.healthIndicatorService.check(RABBITMQ_HEALTH_KEY);
    const isConnected = Boolean(this.client && this.consumerChannel);

    return isConnected ? indicator.up() : indicator.down();
  }

  private async connect(): Promise<void> {
    this.client = await connect(this.config.url);

    this.client.on('error', (error) => {
      this.logger.error('RabbitMQ connection error:', error);
    });

    this.client.on('close', () => {
      this.logger.warn('RabbitMQ connection closed');
      this.resetConsumerTag();
    });

    this.consumerChannel = await this.client.createChannel();
    await this.consumerChannel.assertExchange(this.exchangeName, 'topic', {
      durable: true,
    });
    await this.consumerChannel.assertQueue(this.queueName, {
      durable: false,
      exclusive: true,
      autoDelete: true,
    });
    this.consumerChannel.on('error', (error) => {
      this.logger.error('RabbitMQ consumer channel error:', error);
    });
    this.consumerChannel.on('close', () => {
      this.logger.warn('RabbitMQ consumer channel closed');
      this.resetConsumerTag();
    });

    this.logger.log(`Connected to RabbitMQ | Exchange: ${this.exchangeName} | Queue: ${this.queueName}`);
  }

  private async bindRoutingKey(routingKey: string): Promise<void> {
    if (!this.consumerChannel) {
      throw new Error('RabbitMQ consumer channel has not been initialized');
    }

    await this.consumerChannel.bindQueue(this.queueName, this.exchangeName, routingKey);

    this.logger.log(`Bound queue "${this.queueName}" to routing key "${routingKey}"`);
  }

  private async unbindRoutingKey(routingKey: string): Promise<void> {
    if (!this.consumerChannel) {
      throw new Error('RabbitMQ consumer channel has not been initialized');
    }

    await this.consumerChannel.unbindQueue(this.queueName, this.exchangeName, routingKey);

    this.logger.log(`Unbound queue "${this.queueName}" from routing key "${routingKey}"`);
  }

  private parseMessage(message: ConsumeMessage): RabbitmqNotificationEvent {
    const content = message.content.toString();

    try {
      return JSON.parse(content) as RabbitmqNotificationEvent;
    } catch {
      throw new Error(`Invalid RabbitMQ JSON message: ${content}`);
    }
  }

  private resetConsumerTag(): void {
    this.consumerTag = undefined;
  }

  private get queueName(): string {
    // Queue is scoped to this notification-node instance so each app instance can
    // receive notification events and fan them out locally to SSE/WebSocket subscribers.
    return [this.exchangeName, this.instanceId].join(RABBITMQ_NAME_SEPARATOR);
  }

  private get exchangeName(): string {
    return `${this.prefix}${RABBITMQ_EVENTS_EXCHANGE}`;
  }

  private get prefix(): string {
    return this.config.prefix ? `${this.config.prefix}${RABBITMQ_NAME_SEPARATOR}` : '';
  }

  private get globalRoutingKey(): string {
    return this.routingKey({ target: NotificationTarget.Global });
  }

  private channelRoutingKey(
    args: Extract<Parameters<typeof this.routingKey>[0], { readonly channelId: string }>,
  ): string {
    return [RABBITMQ_CHANNEL_ROUTING_KEY_PREFIX, this.routingKey(args)].join(RABBITMQ_NAME_SEPARATOR);
  }

  private routingKey(
    args:
      | {
          readonly target: `${NotificationTarget.Global}`;
        }
      | {
          readonly target: Exclude<`${NotificationTarget}`, `${NotificationTarget.Global}`>;
          readonly channelId: string;
        },
  ): string {
    return [args.target.toLowerCase(), ...(args.target === NotificationTarget.Global ? [] : [args.channelId])].join(
      RABBITMQ_NAME_SEPARATOR,
    );
  }
}
