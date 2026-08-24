import { createHash, randomUUID } from 'node:crypto';

import { HttpStatus, Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import webPush, { type PushSubscription, WebPushError } from 'web-push';

import { NotificationRecipient } from '../../rabbitmq/enums';
import { ValkeyService } from '../../valkey/services';
import type {
  WebPushChatTarget,
  WebPushDelivery,
  WebPushRecipientTarget,
  WebPushRegistration,
  WebPushRegistrationHandle,
  WebPushUserTarget,
} from '../types';
import { webPushConfigFactory } from '../web-push-config.factory';
import {
  CLEAN_UP_CONNECTION_TARGET_SCRIPT,
  REGISTER_CONNECTION_TARGET_SCRIPT,
  REGISTER_GLOBAL_SUBSCRIPTION_SCRIPT,
  REGISTER_USER_TARGET_SCRIPT,
  WEB_PUSH_DELIVERY_CLAIM_TTL_SECONDS_MIN,
  WEB_PUSH_USER_INDEX_PREFIX,
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

  public async registerSubscription({
    targets,
    subscription,
    expirationTimeSeconds,
  }: WebPushRegistration): Promise<WebPushRegistrationHandle> {
    const subscriptionId = this.subscriptionId(subscription.endpoint);
    const uniqueTargets = this.uniqueTargets(targets);
    const connectionTargets = uniqueTargets.filter(
      (target): target is WebPushChatTarget => target.recipient === NotificationRecipient.Chat,
    );
    const userTarget = uniqueTargets.find(
      (target): target is WebPushUserTarget => target.recipient === NotificationRecipient.User,
    );
    const connectionId = randomUUID();

    await this.registerGlobalSubscription(subscriptionId, subscription, expirationTimeSeconds);
    await Promise.all(
      connectionTargets.map((target) =>
        this.registerConnectionTarget(subscriptionId, connectionId, target, expirationTimeSeconds),
      ),
    );
    if (userTarget) await this.registerUserTarget(subscriptionId, userTarget, expirationTimeSeconds);

    return {
      connectionTargets,
      connectionId,
      subscriptionId,
    };
  }

  public async unregisterConnectionTargets(registration: WebPushRegistrationHandle): Promise<void> {
    await Promise.all(
      registration.connectionTargets.map((target) =>
        this.cleanUpConnectionTarget(registration.subscriptionId, target, registration.connectionId),
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
        WEB_PUSH_VALKEY_KEYS.delivery.claim(delivery.eventUuid, subscriptionId),
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

  private uniqueTargets(targets: readonly WebPushRecipientTarget[]): WebPushRecipientTarget[] {
    return [
      ...new Map(
        targets.map(
          (target) => [`${target.recipient}:${'recipientUuid' in target ? target.recipientUuid : ''}`, target] as const,
        ),
      ).values(),
    ];
  }

  private async registerGlobalSubscription(
    subscriptionId: string,
    subscription: PushSubscription,
    expirationTimeSeconds: number,
  ): Promise<void> {
    await this.valkeyService.executeScript(
      REGISTER_GLOBAL_SUBSCRIPTION_SCRIPT,
      [WEB_PUSH_VALKEY_KEYS.subscription.data(subscriptionId), WEB_PUSH_VALKEY_KEYS.subscription.allIds],
      [JSON.stringify(subscription), subscriptionId, expirationTimeSeconds.toString()],
    );
  }

  private async registerConnectionTarget(
    subscriptionId: string,
    connectionId: string,
    target: WebPushChatTarget,
    expirationTimeSeconds: number,
  ): Promise<void> {
    await this.valkeyService.executeScript(
      REGISTER_CONNECTION_TARGET_SCRIPT,
      [
        WEB_PUSH_VALKEY_KEYS.connection.chatIds(subscriptionId, target.recipientUuid),
        WEB_PUSH_VALKEY_KEYS.subscription.chatUuids(subscriptionId),
        WEB_PUSH_VALKEY_KEYS.recipient.chatSubscriptionIds(target.recipientUuid),
      ],
      [
        connectionId,
        expirationTimeSeconds.toString(),
        Math.floor(Date.now() / 1000).toString(),
        target.recipientUuid,
        subscriptionId,
      ],
    );
  }

  private async registerUserTarget(
    subscriptionId: string,
    target: WebPushUserTarget,
    expirationTimeSeconds: number,
  ): Promise<void> {
    await this.valkeyService.executeScript(
      REGISTER_USER_TARGET_SCRIPT,
      [
        WEB_PUSH_VALKEY_KEYS.subscription.userUuid(subscriptionId),
        WEB_PUSH_VALKEY_KEYS.recipient.userSubscriptionIds(target.recipientUuid),
      ],
      [subscriptionId, target.recipientUuid, expirationTimeSeconds.toString(), WEB_PUSH_USER_INDEX_PREFIX],
    );
  }

  private async getApplicableSubscriptionIds(target: WebPushDelivery['target']): Promise<string[]> {
    const subscriptionIds = await this.valkeyService.getActiveSortedSetMembers(this.targetSubscriptionIdsKey(target));
    if (target.recipient === NotificationRecipient.Global) return subscriptionIds;

    const activeSubscriptionIds = await Promise.all(
      subscriptionIds.map(async (subscriptionId) => {
        const isActive =
          target.recipient === NotificationRecipient.Chat
            ? await this.cleanUpConnectionTarget(subscriptionId, target)
            : await this.hasActiveUserTarget(subscriptionId, target);
        return isActive ? subscriptionId : undefined;
      }),
    );

    return activeSubscriptionIds.filter((subscriptionId): subscriptionId is string => !!subscriptionId);
  }

  private async getSubscription(subscriptionId: string): Promise<PushSubscription | undefined> {
    const value = await this.valkeyService.get(WEB_PUSH_VALKEY_KEYS.subscription.data(subscriptionId));
    if (!value) return;

    try {
      return JSON.parse(value) as PushSubscription;
    } catch {
      this.logger.warn(`Ignoring malformed stored Web Push subscription: ${subscriptionId}`);
      return;
    }
  }

  private async removeSubscription(subscriptionId: string): Promise<void> {
    const [chatUuids, userUuid] = await Promise.all([
      this.valkeyService.getSetMembers(WEB_PUSH_VALKEY_KEYS.subscription.chatUuids(subscriptionId)),
      this.valkeyService.get(WEB_PUSH_VALKEY_KEYS.subscription.userUuid(subscriptionId)),
    ]);
    const chatTargets: WebPushChatTarget[] = chatUuids.map((recipientUuid) => ({
      recipient: NotificationRecipient.Chat,
      recipientUuid,
    }));
    const targets: WebPushRecipientTarget[] = [
      { recipient: NotificationRecipient.Global },
      ...chatTargets,
      ...(userUuid ? [{ recipient: NotificationRecipient.User as const, recipientUuid: userUuid }] : []),
    ];

    await Promise.all(
      targets.map((target) =>
        this.valkeyService.removeSortedSetMembers(this.targetSubscriptionIdsKey(target), [subscriptionId]),
      ),
    );
    await this.valkeyService.delete([
      WEB_PUSH_VALKEY_KEYS.subscription.data(subscriptionId),
      WEB_PUSH_VALKEY_KEYS.subscription.chatUuids(subscriptionId),
      WEB_PUSH_VALKEY_KEYS.subscription.userUuid(subscriptionId),
      ...chatTargets.map((target) => WEB_PUSH_VALKEY_KEYS.connection.chatIds(subscriptionId, target.recipientUuid)),
    ]);
  }

  private async cleanUpConnectionTarget(
    subscriptionId: string,
    target: WebPushChatTarget,
    connectionId?: string,
  ): Promise<boolean> {
    const result = await this.valkeyService.executeScript(
      CLEAN_UP_CONNECTION_TARGET_SCRIPT,
      [
        WEB_PUSH_VALKEY_KEYS.connection.chatIds(subscriptionId, target.recipientUuid),
        WEB_PUSH_VALKEY_KEYS.subscription.chatUuids(subscriptionId),
        WEB_PUSH_VALKEY_KEYS.recipient.chatSubscriptionIds(target.recipientUuid),
      ],
      [connectionId ?? '', Math.floor(Date.now() / 1000).toString(), target.recipientUuid, subscriptionId],
    );

    return result === 1;
  }

  private async hasActiveUserTarget(subscriptionId: string, target: WebPushUserTarget): Promise<boolean> {
    const registeredUserUuid = await this.valkeyService.get(WEB_PUSH_VALKEY_KEYS.subscription.userUuid(subscriptionId));
    if (registeredUserUuid === target.recipientUuid) return true;

    await this.valkeyService.removeSortedSetMembers(
      WEB_PUSH_VALKEY_KEYS.recipient.userSubscriptionIds(target.recipientUuid),
      [subscriptionId],
    );
    return false;
  }

  private targetSubscriptionIdsKey(target: WebPushRecipientTarget): string {
    switch (target.recipient) {
      case NotificationRecipient.Global:
        return WEB_PUSH_VALKEY_KEYS.subscription.allIds;
      case NotificationRecipient.Chat:
        return WEB_PUSH_VALKEY_KEYS.recipient.chatSubscriptionIds(target.recipientUuid);
      case NotificationRecipient.User:
        return WEB_PUSH_VALKEY_KEYS.recipient.userSubscriptionIds(target.recipientUuid);
    }
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
