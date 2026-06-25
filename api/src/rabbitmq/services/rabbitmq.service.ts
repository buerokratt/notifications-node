import { once } from 'node:events';

import { BeforeApplicationShutdown, Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { HealthIndicatorResult, HealthIndicatorService } from '@nestjs/terminus';
import { connect } from 'amqplib';
import type { Channel, ConfirmChannel, ConsumeMessage } from 'amqplib';

import { NotificationRecipient } from '../enums';
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

  // Publishes notification messages to the topic exchange.
  private publisherChannel?: ConfirmChannel;

  constructor(
    @Inject(rabbitmqConfigFactory.KEY)
    private readonly config: ConfigType<typeof rabbitmqConfigFactory>,
    private readonly healthIndicatorService: HealthIndicatorService,
  ) {}

  public async onModuleInit(): Promise<void> {
    this.logger.log('RabbitmqService initialized');
    await this.connect();
    await this.bindGlobal();
  }

  public async beforeApplicationShutdown(signal?: string): Promise<void> {
    this.logger.log(`Closing RabbitMQ connection. Signal: ${signal ?? 'unknown'}`);

    await this.consumerChannel?.close().catch((error) => {
      this.logger.error('Failed to close RabbitMQ consumer channel', error);
    });

    await this.publisherChannel?.close().catch((error) => {
      this.logger.error('Failed to close RabbitMQ publisher channel', error);
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

  public async publishEvent(event: RabbitmqNotificationEvent): Promise<void> {
    const routingKey =
      event.recipient === NotificationRecipient.Global
        ? this.globalRoutingKey
        : this.channelRoutingKey({
            recipient: event.recipient,
            channelId: event.recipientUuid!,
          });

    await this.publish(routingKey, event);
  }

  public isHealthy(): HealthIndicatorResult {
    const indicator = this.healthIndicatorService.check(RABBITMQ_HEALTH_KEY);
    const isConnected = Boolean(this.client && this.consumerChannel && this.publisherChannel);

    return isConnected ? indicator.up() : indicator.down();
  }

  private async connect(): Promise<void> {
    this.client = await connect(this.config.url);

    this.client.on('error', (error) => {
      this.logger.error('RabbitMQ connection error:', error);
    });

    this.client.on('close', () => {
      this.logger.warn('RabbitMQ connection closed');
      this.resetConnection();
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
      this.consumerChannel = undefined;
      this.resetConsumerTag();
    });

    this.publisherChannel = await this.client.createConfirmChannel();
    await this.publisherChannel.assertExchange(this.exchangeName, 'topic', {
      durable: true,
    });
    this.publisherChannel.on('error', (error) => {
      this.logger.error('RabbitMQ publisher channel error:', error);
    });
    this.publisherChannel.on('close', () => {
      this.logger.warn('RabbitMQ publisher channel closed');
      this.publisherChannel = undefined;
    });

    this.logger.log(`Connected to RabbitMQ | Exchange: ${this.exchangeName} | Queue: ${this.queueName}`);
  }

  private async publish(routingKey: string, event: RabbitmqNotificationEvent): Promise<void> {
    if (!this.client || !this.publisherChannel) {
      throw new Error('RabbitMQ publisher channel has not been initialized');
    }

    const publisherChannel = this.publisherChannel;
    const published = publisherChannel.publish(this.exchangeName, routingKey, Buffer.from(JSON.stringify(event)), {
      contentType: 'application/json',
      messageId: event.eventUuid,
      persistent: false,
      timestamp: Date.now(),
    });

    if (!published) {
      this.logger.warn(`RabbitMQ publish buffer is full. Routing key: ${routingKey}`);
      await once(publisherChannel, 'drain');
    }

    await publisherChannel.waitForConfirms();
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

  private resetConnection(): void {
    this.client = undefined;
    this.consumerChannel = undefined;
    this.publisherChannel = undefined;
    this.resetConsumerTag();
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
    return this.routingKey({ recipient: NotificationRecipient.Global });
  }

  private channelRoutingKey(
    args: Extract<Parameters<typeof this.routingKey>[0], { readonly channelId: string }>,
  ): string {
    return [RABBITMQ_CHANNEL_ROUTING_KEY_PREFIX, this.routingKey(args)].join(RABBITMQ_NAME_SEPARATOR);
  }

  private routingKey(
    args:
      | {
          readonly recipient: `${NotificationRecipient.Global}`;
        }
      | {
          readonly recipient: Exclude<`${NotificationRecipient}`, `${NotificationRecipient.Global}`>;
          readonly channelId: string;
        },
  ): string {
    return [
      args.recipient.toLowerCase(),
      ...(args.recipient === NotificationRecipient.Global ? [] : [args.channelId]),
    ].join(RABBITMQ_NAME_SEPARATOR);
  }
}
