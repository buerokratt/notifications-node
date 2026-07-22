import { createHash, randomUUID } from 'node:crypto';

import { HttpStatus, Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import webPush, { PushSubscription, WebPushError } from 'web-push';

import { ValkeyService } from '../../valkey/services';
import type { WebPushDelivery, WebPushRegistrationHandle } from '../types';
import { webPushConfigFactory } from '../web-push-config.factory';
import {
  CLEAN_UP_CHAT_CONNECTION_SCRIPT,
  REGISTER_CHAT_CONNECTION_SCRIPT,
  REGISTER_GLOBAL_SUBSCRIPTION_SCRIPT,
  WEB_PUSH_DELIVERY_CLAIM_TTL_SECONDS_MIN,
  WEB_PUSH_VALKEY_KEYS,
} from '../web-push.constants';

@Injectable()
export class WebPushService implements OnModuleInit {
  private readonly logger = new Logger(WebPushService.name);

  constructor(
    @Inject(webPushConfigFactory.KEY)
    private readonly config: ConfigType<typeof webPushConfigFactory>,
    private readonly valkeyService: ValkeyService,
  ) {}

  public onModuleInit(): void {
    webPush.setVapidDetails(this.config.vapidSubject, this.config.vapidPublicKey, this.config.vapidPrivateKey);
  }

  public async registerSubscription(
    chatUuids: string[],
    subscription: PushSubscription,
    expirationTimeSeconds: number,
  ): Promise<WebPushRegistrationHandle> {
    const subscriptionId = this.subscriptionId(subscription.endpoint);
    const uniqueChatUuids = [...new Set(chatUuids)];
    const connectionId = randomUUID();
    const nowSeconds = Math.floor(Date.now() / 1000);

    await this.valkeyService.executeScript(
      REGISTER_GLOBAL_SUBSCRIPTION_SCRIPT,
      [WEB_PUSH_VALKEY_KEYS.subscriptionData(subscriptionId), WEB_PUSH_VALKEY_KEYS.allSubscriptionIds],
      [JSON.stringify(subscription), subscriptionId, expirationTimeSeconds.toString()],
    );
    await Promise.all(
      uniqueChatUuids.map((chatUuid) =>
        this.valkeyService.executeScript(
          REGISTER_CHAT_CONNECTION_SCRIPT,
          [
            WEB_PUSH_VALKEY_KEYS.subscriptionChatConnectionIds(subscriptionId, chatUuid),
            WEB_PUSH_VALKEY_KEYS.subscriptionChatUuids(subscriptionId),
            WEB_PUSH_VALKEY_KEYS.chatSubscriptionIds(chatUuid),
          ],
          [connectionId, expirationTimeSeconds.toString(), nowSeconds.toString(), chatUuid, subscriptionId],
        ),
      ),
    );

    return {
      chatUuids: uniqueChatUuids,
      connectionId,
      subscriptionId,
    };
  }

  public async unregisterChatConnections(registration: WebPushRegistrationHandle): Promise<void> {
    await Promise.all(
      registration.chatUuids.map((chatUuid) =>
        this.cleanUpChatConnection(registration.subscriptionId, chatUuid, registration.connectionId),
      ),
    );
  }

  public async deliver(delivery: WebPushDelivery): Promise<void> {
    const subscriptionIds = await this.getApplicableSubscriptionIds(delivery.target);
    if (subscriptionIds.length === 0) return;

    const payload = JSON.stringify({
      notification: {
        title: delivery.title,
        body: delivery.body,
      },
    });
    const deliveryClaimTtlSeconds = delivery.ttl ?? WEB_PUSH_DELIVERY_CLAIM_TTL_SECONDS_MIN;

    await this.forEachConcurrently(subscriptionIds, async (subscriptionId) => {
      const claimed = await this.valkeyService.setIfAbsent(
        WEB_PUSH_VALKEY_KEYS.deliveryClaim(delivery.eventUuid, subscriptionId),
        '1',
        deliveryClaimTtlSeconds,
      );
      if (!claimed) return;

      const subscription = await this.getSubscription(subscriptionId);
      if (!subscription) {
        await this.removeSubscription(subscriptionId);
        return;
      }

      try {
        await webPush.sendNotification(subscription, payload, {
          TTL: delivery.ttl ?? this.config.defaultTtlSeconds,
          timeout: this.config.requestTimeoutMs,
        });
        this.logger.log(
          `Delivered Web Push notification. Event: ${delivery.eventUuid}, subscription: ${subscriptionId}`,
        );
      } catch (error) {
        if (error instanceof WebPushError && [HttpStatus.NOT_FOUND, HttpStatus.GONE].includes(error.statusCode)) {
          await this.removeSubscription(subscriptionId);
          this.logger.warn(`Removed an expired Web Push subscription after provider status ${error.statusCode}`);
          return;
        }

        const status = error instanceof WebPushError ? ` with provider status ${error.statusCode}` : '';
        this.logger.error(`Failed to deliver a Web Push notification${status}`, error);
      }
    });
  }

  private async getApplicableSubscriptionIds(target: WebPushDelivery['target']): Promise<string[]> {
    if (!('chatUuid' in target)) {
      return this.valkeyService.getSetMembers(WEB_PUSH_VALKEY_KEYS.allSubscriptionIds);
    }

    const subscriptionIds = await this.valkeyService.getSetMembers(
      WEB_PUSH_VALKEY_KEYS.chatSubscriptionIds(target.chatUuid),
    );
    const activeSubscriptionIds = await Promise.all(
      subscriptionIds.map(async (subscriptionId) => {
        const isActive = await this.cleanUpChatConnection(subscriptionId, target.chatUuid);
        return isActive ? subscriptionId : undefined;
      }),
    );

    return activeSubscriptionIds.filter((subscriptionId): subscriptionId is string => !!subscriptionId);
  }

  private async getSubscription(subscriptionId: string): Promise<PushSubscription | undefined> {
    const value = await this.valkeyService.get(WEB_PUSH_VALKEY_KEYS.subscriptionData(subscriptionId));
    if (!value) return;

    try {
      // Subscription data is written only by registerSubscription(), so its stored shape is trusted.
      return JSON.parse(value) as PushSubscription;
    } catch {
      this.logger.warn(`Ignoring malformed stored Web Push subscription: ${subscriptionId}`);
      return;
    }
  }

  private async removeSubscription(subscriptionId: string): Promise<void> {
    const chatUuids = await this.valkeyService.getSetMembers(
      WEB_PUSH_VALKEY_KEYS.subscriptionChatUuids(subscriptionId),
    );

    await Promise.all([
      this.valkeyService.removeSetMembers(WEB_PUSH_VALKEY_KEYS.allSubscriptionIds, [subscriptionId]),
      ...chatUuids.map((chatUuid) =>
        this.valkeyService.removeSetMembers(WEB_PUSH_VALKEY_KEYS.chatSubscriptionIds(chatUuid), [subscriptionId]),
      ),
    ]);
    await this.valkeyService.delete([
      WEB_PUSH_VALKEY_KEYS.subscriptionData(subscriptionId),
      WEB_PUSH_VALKEY_KEYS.subscriptionChatUuids(subscriptionId),
      ...chatUuids.map((chatUuid) => WEB_PUSH_VALKEY_KEYS.subscriptionChatConnectionIds(subscriptionId, chatUuid)),
    ]);
  }

  private async cleanUpChatConnection(
    subscriptionId: string,
    chatUuid: string,
    connectionId?: string,
  ): Promise<boolean> {
    const result = await this.valkeyService.executeScript(
      CLEAN_UP_CHAT_CONNECTION_SCRIPT,
      [
        WEB_PUSH_VALKEY_KEYS.subscriptionChatConnectionIds(subscriptionId, chatUuid),
        WEB_PUSH_VALKEY_KEYS.subscriptionChatUuids(subscriptionId),
        WEB_PUSH_VALKEY_KEYS.chatSubscriptionIds(chatUuid),
      ],
      [connectionId ?? '', Math.floor(Date.now() / 1000).toString(), chatUuid, subscriptionId],
    );

    return result === 1;
  }

  private async forEachConcurrently<T>(items: T[], callback: (item: T) => Promise<void>): Promise<void> {
    let nextIndex = 0;
    const workerCount = Math.min(items.length, this.config.concurrency);

    await Promise.all(
      Array.from({ length: workerCount }, async () => {
        while (nextIndex < items.length) {
          const item = items[nextIndex];
          nextIndex += 1;
          await callback(item);
        }
      }),
    );
  }

  private subscriptionId(endpoint: string): string {
    return createHash('sha256').update(endpoint).digest('base64url');
  }
}
