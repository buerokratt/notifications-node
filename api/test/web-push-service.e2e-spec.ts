import { createHash } from 'node:crypto';
import { join } from 'node:path';

import { HttpStatus } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import webPush, { type PushSubscription, WebPushError } from 'web-push';

import { NotificationRecipient } from '../src/rabbitmq/enums';
import { ValkeyService } from '../src/valkey/services';
import { WebPushService } from '../src/web-push/services';
import type { WebPushRecipientTarget, WebPushRegistrationHandle } from '../src/web-push/types';
import { WEB_PUSH_VALKEY_KEYS } from '../src/web-push/web-push.constants';
import { WebPushModule } from '../src/web-push/web-push.module';

type SortedSetState = {
  readonly expiresAt: number;
  readonly score?: number;
  readonly type: string;
};

describe('WebPushService (e2e)', () => {
  const CHAT_UUID = 'dee9c8da-2b40-4c6a-a31e-db278b6960b1';
  const USER_UUID = '7eba63ac-08aa-5fa3-b04d-b53f2be30e7c';
  const SECOND_USER_UUID = '2a848522-2806-5484-871f-f7a141caf5de';
  const EVENT_UUID = 'a34798cc-9ac4-4446-81ed-0d08f726aa52';
  const SECOND_EVENT_UUID = 'af83e20e-cfa6-4451-8eeb-6e52c78a4e57';
  const BASE_EXPIRATION_TIME_SECONDS = 4_938_821_608;
  const BASE_SUBSCRIPTION: PushSubscription = {
    endpoint: 'https://push.example.test/subscription',
    expirationTime: null,
    keys: {
      p256dh: 'test-p256dh',
      auth: 'test-auth',
    },
  };

  let moduleFixture: TestingModule;
  let valkeyService: ValkeyService;
  let webPushService: WebPushService;
  const subscriptionIds = new Set<string>();
  const chatUuids = new Set([CHAT_UUID]);
  const userUuids = new Set([USER_UUID, SECOND_USER_UUID]);
  const eventUuids = new Set([EVENT_UUID, SECOND_EVENT_UUID]);

  beforeAll(async () => {
    moduleFixture = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          envFilePath: join(process.cwd(), 'config', `${process.env.NODE_ENV || 'development'}.env`),
          expandVariables: true,
        }),
        WebPushModule,
      ],
    }).compile();
    await moduleFixture.init();

    valkeyService = moduleFixture.get(ValkeyService);
    webPushService = moduleFixture.get(WebPushService);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await cleanUpTestState();
  });

  afterAll(async () => {
    await cleanUpTestState();
    await moduleFixture.close();
  });

  it('should register GLOBAL, CHAT, and USER targets in expiring sorted set indexes', async () => {
    const expirationTimeSeconds = BASE_EXPIRATION_TIME_SECONDS;
    const subscription = createSubscription('all-targets');
    const registration = await registerSubscription(
      subscription,
      [
        { recipient: NotificationRecipient.Global },
        { recipient: NotificationRecipient.Global },
        { recipient: NotificationRecipient.Chat, recipientUuid: CHAT_UUID },
        { recipient: NotificationRecipient.Chat, recipientUuid: CHAT_UUID },
        { recipient: NotificationRecipient.User, recipientUuid: USER_UUID },
      ],
      expirationTimeSeconds,
    );

    expect(registration.connectionTargets).toEqual([
      { recipient: NotificationRecipient.Chat, recipientUuid: CHAT_UUID },
    ]);
    await expect(valkeyService.get(WEB_PUSH_VALKEY_KEYS.subscription.data(registration.subscriptionId))).resolves.toBe(
      JSON.stringify(subscription),
    );
    await expect(
      valkeyService.getSetMembers(WEB_PUSH_VALKEY_KEYS.subscription.chatUuids(registration.subscriptionId)),
    ).resolves.toEqual([CHAT_UUID]);
    await expect(
      valkeyService.get(WEB_PUSH_VALKEY_KEYS.subscription.userUuid(registration.subscriptionId)),
    ).resolves.toBe(USER_UUID);

    for (const key of [
      WEB_PUSH_VALKEY_KEYS.subscription.allIds,
      WEB_PUSH_VALKEY_KEYS.recipient.chatSubscriptionIds(CHAT_UUID),
      WEB_PUSH_VALKEY_KEYS.recipient.userSubscriptionIds(USER_UUID),
    ]) {
      await expect(getSortedSetState(key, registration.subscriptionId)).resolves.toEqual({
        type: 'zset',
        score: expirationTimeSeconds,
        expiresAt: expirationTimeSeconds,
      });
    }
  });

  it('should remove CHAT indexes after unregistering the last connection while retaining GLOBAL and USER indexes', async () => {
    const subscription = createSubscription('unregister-chat');
    const registration = await registerSubscription(subscription, [
      { recipient: NotificationRecipient.Global },
      { recipient: NotificationRecipient.Chat, recipientUuid: CHAT_UUID },
      { recipient: NotificationRecipient.User, recipientUuid: USER_UUID },
    ]);

    await webPushService.unregisterConnectionTargets(registration);

    await expect(
      valkeyService.getActiveSortedSetMembers(WEB_PUSH_VALKEY_KEYS.recipient.chatSubscriptionIds(CHAT_UUID)),
    ).resolves.not.toContain(registration.subscriptionId);
    await expect(
      valkeyService.getSetMembers(WEB_PUSH_VALKEY_KEYS.subscription.chatUuids(registration.subscriptionId)),
    ).resolves.not.toContain(CHAT_UUID);
    await expect(
      keyExists(WEB_PUSH_VALKEY_KEYS.connection.chatIds(registration.subscriptionId, CHAT_UUID)),
    ).resolves.toBe(false);
    await expect(valkeyService.getActiveSortedSetMembers(WEB_PUSH_VALKEY_KEYS.subscription.allIds)).resolves.toContain(
      registration.subscriptionId,
    );
    await expect(
      valkeyService.getActiveSortedSetMembers(WEB_PUSH_VALKEY_KEYS.recipient.userSubscriptionIds(USER_UUID)),
    ).resolves.toContain(registration.subscriptionId);
  });

  it('should only extend subscription index expiration', async () => {
    const subscription = createSubscription('extend-expiration');
    const firstExpiration = BASE_EXPIRATION_TIME_SECONDS - 120;
    const earlierExpiration = firstExpiration - 60;
    const laterExpiration = firstExpiration + 120;
    const firstRegistration = await registerSubscription(
      subscription,
      [{ recipient: NotificationRecipient.Global }],
      firstExpiration,
    );

    await registerSubscription(subscription, [{ recipient: NotificationRecipient.Global }], earlierExpiration);
    await expect(
      getSortedSetState(WEB_PUSH_VALKEY_KEYS.subscription.allIds, firstRegistration.subscriptionId),
    ).resolves.toEqual({
      type: 'zset',
      score: firstExpiration,
      expiresAt: firstExpiration,
    });

    await registerSubscription(subscription, [{ recipient: NotificationRecipient.Global }], laterExpiration);
    await expect(
      getSortedSetState(WEB_PUSH_VALKEY_KEYS.subscription.allIds, firstRegistration.subscriptionId),
    ).resolves.toEqual({
      type: 'zset',
      score: laterExpiration,
      expiresAt: laterExpiration,
    });
  });

  it('should prune an expired USER index member and delete the empty sorted set', async () => {
    const expirationTimeSeconds = BASE_EXPIRATION_TIME_SECONDS;
    const subscription = createSubscription('prune-user');
    const registration = await registerSubscription(
      subscription,
      [
        { recipient: NotificationRecipient.Global },
        { recipient: NotificationRecipient.User, recipientUuid: USER_UUID },
      ],
      expirationTimeSeconds,
    );
    const userIndexKey = WEB_PUSH_VALKEY_KEYS.recipient.userSubscriptionIds(USER_UUID);

    await expect(valkeyService.getActiveSortedSetMembers(userIndexKey, expirationTimeSeconds)).resolves.toEqual([]);
    await expect(keyExists(userIndexKey)).resolves.toBe(false);
    await expect(valkeyService.getActiveSortedSetMembers(WEB_PUSH_VALKEY_KEYS.subscription.allIds)).resolves.toContain(
      registration.subscriptionId,
    );
  });

  it('should deliver once only to the matching USER subscription', async () => {
    const userSubscription = createSubscription('deliver-user');
    const secondUserSubscription = createSubscription('deliver-second-user');
    await registerSubscription(userSubscription, [
      { recipient: NotificationRecipient.Global },
      { recipient: NotificationRecipient.User, recipientUuid: USER_UUID },
    ]);
    await registerSubscription(secondUserSubscription, [
      { recipient: NotificationRecipient.Global },
      { recipient: NotificationRecipient.User, recipientUuid: SECOND_USER_UUID },
    ]);
    const sendNotificationMock = vi.spyOn(webPush, 'sendNotification').mockResolvedValue({
      statusCode: HttpStatus.CREATED,
      body: '',
      headers: {},
    });
    const delivery = {
      eventUuid: EVENT_UUID,
      target: { recipient: NotificationRecipient.User as const, recipientUuid: USER_UUID },
      title: 'User notification',
      body: 'Only the matching user should receive this.',
      ttl: 300,
    };

    await webPushService.deliver(delivery);
    await webPushService.deliver(delivery);

    expect(sendNotificationMock).toHaveBeenCalledTimes(1);
    expect(sendNotificationMock).toHaveBeenCalledWith(
      userSubscription,
      JSON.stringify({
        notification: {
          title: delivery.title,
          body: delivery.body,
        },
      }),
      expect.objectContaining({ TTL: delivery.ttl }),
    );
    expect(sendNotificationMock.mock.calls[0][0]).not.toEqual(secondUserSubscription);
  });

  it('should remove all subscription state after the push provider returns GONE', async () => {
    const subscription = createSubscription('provider-gone');
    const registration = await registerSubscription(subscription, [
      { recipient: NotificationRecipient.Global },
      { recipient: NotificationRecipient.Chat, recipientUuid: CHAT_UUID },
      { recipient: NotificationRecipient.User, recipientUuid: USER_UUID },
    ]);
    vi.spyOn(webPush, 'sendNotification').mockRejectedValue(
      new WebPushError('Subscription expired', HttpStatus.GONE, {}, '', subscription.endpoint),
    );

    await webPushService.deliver({
      eventUuid: SECOND_EVENT_UUID,
      target: { recipient: NotificationRecipient.User, recipientUuid: USER_UUID },
      title: 'Expired subscription',
      body: 'This delivery removes stale state.',
    });

    for (const key of [
      WEB_PUSH_VALKEY_KEYS.subscription.allIds,
      WEB_PUSH_VALKEY_KEYS.recipient.chatSubscriptionIds(CHAT_UUID),
      WEB_PUSH_VALKEY_KEYS.recipient.userSubscriptionIds(USER_UUID),
    ]) {
      await expect(valkeyService.getActiveSortedSetMembers(key)).resolves.not.toContain(registration.subscriptionId);
    }
    await expect(
      valkeyService.get(WEB_PUSH_VALKEY_KEYS.subscription.data(registration.subscriptionId)),
    ).resolves.toBeUndefined();
    await expect(
      valkeyService.getSetMembers(WEB_PUSH_VALKEY_KEYS.subscription.chatUuids(registration.subscriptionId)),
    ).resolves.toEqual([]);
    await expect(
      valkeyService.get(WEB_PUSH_VALKEY_KEYS.subscription.userUuid(registration.subscriptionId)),
    ).resolves.toBeUndefined();
    await expect(
      keyExists(WEB_PUSH_VALKEY_KEYS.connection.chatIds(registration.subscriptionId, CHAT_UUID)),
    ).resolves.toBe(false);
  });

  const registerSubscription = async (
    subscription: PushSubscription,
    targets: readonly WebPushRecipientTarget[],
    expirationTimeSeconds = BASE_EXPIRATION_TIME_SECONDS,
  ): Promise<WebPushRegistrationHandle> => {
    const subscriptionId = createHash('sha256').update(subscription.endpoint).digest('base64url');
    subscriptionIds.add(subscriptionId);

    return webPushService.registerSubscription({
      targets,
      subscription,
      expirationTimeSeconds,
    });
  };

  const createSubscription = (suffix: string): PushSubscription => ({
    ...BASE_SUBSCRIPTION,
    endpoint: `${BASE_SUBSCRIPTION.endpoint}-${suffix}`,
  });

  const getSortedSetState = async (key: string, member: string): Promise<SortedSetState> => {
    const result = asArray(
      await valkeyService.executeScript(
        `
local keyType = redis.call('TYPE', KEYS[1]).ok
local score = redis.call('ZSCORE', KEYS[1], ARGV[1])
local expiresAt = redis.call('EXPIRETIME', KEYS[1])
return {keyType, score or '', expiresAt}
`,
        [key],
        [member],
      ),
    );

    return {
      type: asString(result[0]),
      ...(asString(result[1]) ? { score: Number(asString(result[1])) } : {}),
      expiresAt: Number(result[2]),
    };
  };

  const keyExists = async (key: string): Promise<boolean> => {
    const result = await valkeyService.executeScript(`return redis.call('EXISTS', KEYS[1])`, [key], []);
    return Number(result) === 1;
  };

  const cleanUpTestState = async (): Promise<void> => {
    const ids = [...subscriptionIds];
    if (ids.length === 0 || !valkeyService) return;

    await Promise.all([
      valkeyService.removeSortedSetMembers(WEB_PUSH_VALKEY_KEYS.subscription.allIds, ids),
      ...[...chatUuids].map((chatUuid) =>
        valkeyService.removeSortedSetMembers(WEB_PUSH_VALKEY_KEYS.recipient.chatSubscriptionIds(chatUuid), ids),
      ),
      ...[...userUuids].map((userUuid) =>
        valkeyService.removeSortedSetMembers(WEB_PUSH_VALKEY_KEYS.recipient.userSubscriptionIds(userUuid), ids),
      ),
    ]);
    await valkeyService.delete(
      ids.flatMap((subscriptionId) => [
        WEB_PUSH_VALKEY_KEYS.subscription.data(subscriptionId),
        WEB_PUSH_VALKEY_KEYS.subscription.chatUuids(subscriptionId),
        WEB_PUSH_VALKEY_KEYS.subscription.userUuid(subscriptionId),
        ...[...chatUuids].map((chatUuid) => WEB_PUSH_VALKEY_KEYS.connection.chatIds(subscriptionId, chatUuid)),
        ...[...eventUuids].map((eventUuid) => WEB_PUSH_VALKEY_KEYS.delivery.claim(eventUuid, subscriptionId)),
      ]),
    );
    subscriptionIds.clear();
  };

  const asArray = (value: unknown): unknown[] => {
    if (!Array.isArray(value)) throw new Error('Expected a Valkey array response');
    return value;
  };

  const asString = (value: unknown): string => {
    if (typeof value === 'string') return value;
    if (value instanceof Uint8Array) return Buffer.from(value).toString();
    return String(value ?? '');
  };
});
