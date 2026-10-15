import { vi } from 'vitest';

export const APPLICATION_SERVER_KEY = new Uint8Array(65);
APPLICATION_SERVER_KEY[0] = 0x04;
for (let index = 1; index < APPLICATION_SERVER_KEY.length; index += 1) APPLICATION_SERVER_KEY[index] = index;

export const SUBSCRIPTION_JSON: PushSubscriptionJSON = {
  endpoint: 'https://push.example.test/subscriptions/test',
  expirationTime: null,
  keys: {
    auth: 'auth-secret',
    p256dh: 'public-key',
  },
};

export interface PushSubscriptionOptions {
  readonly applicationServerKey?: ArrayBuffer | null;
  readonly unsubscribeResult?: boolean;
}

export const createPushSubscription = ({
  applicationServerKey = APPLICATION_SERVER_KEY.buffer,
  unsubscribeResult = true,
}: PushSubscriptionOptions = {}): PushSubscription =>
  ({
    options: { applicationServerKey, userVisibleOnly: true },
    toJSON: () => SUBSCRIPTION_JSON,
    unsubscribe: vi.fn().mockResolvedValue(unsubscribeResult),
  }) as unknown as PushSubscription;

export interface InstallWebPushBrowserOptions {
  readonly existingSubscription?: PushSubscription | null;
  readonly permission?: NotificationPermission;
  readonly ready?: Promise<ServiceWorkerRegistration>;
  readonly requestPermissionResult?: NotificationPermission;
  readonly subscription?: PushSubscription;
  readonly unsupportedCapability?: 'notification' | 'push-manager' | 'service-worker';
}

export interface WebPushBrowserHarness {
  readonly existingSubscription?: PushSubscription | null;
  readonly getSubscription: ReturnType<typeof vi.fn>;
  readonly register: ReturnType<typeof vi.fn>;
  readonly registration: ServiceWorkerRegistration;
  readonly requestPermission: ReturnType<typeof vi.fn>;
  readonly restore: () => void;
  readonly setPermission: (permission: NotificationPermission) => void;
  readonly setRequestPermissionResult: (permission: NotificationPermission) => void;
  readonly subscribe: ReturnType<typeof vi.fn>;
  readonly subscription: PushSubscription;
}

export const installWebPushBrowser = ({
  existingSubscription = null,
  permission: initialPermission = 'granted',
  ready,
  requestPermissionResult: initialRequestPermissionResult = 'granted',
  subscription = createPushSubscription(),
  unsupportedCapability,
}: InstallWebPushBrowserOptions = {}): WebPushBrowserHarness => {
  let permission = initialPermission;
  let requestPermissionResult = initialRequestPermissionResult;
  const notificationDescriptor = Object.getOwnPropertyDescriptor(window, 'Notification');
  const pushManagerDescriptor = Object.getOwnPropertyDescriptor(window, 'PushManager');
  const serviceWorkerDescriptor = Object.getOwnPropertyDescriptor(navigator, 'serviceWorker');

  const requestPermission = vi.fn(() => Promise.resolve(requestPermissionResult));
  const notificationApi = {
    get permission(): NotificationPermission {
      return permission;
    },
    requestPermission,
  } as unknown as typeof Notification;
  const getSubscription = vi.fn(() => Promise.resolve(existingSubscription));
  const subscribe = vi.fn(() => Promise.resolve(subscription));
  const registration = {
    pushManager: { getSubscription, subscribe },
  } as unknown as ServiceWorkerRegistration;
  const register = vi.fn(() => Promise.resolve(registration));
  const serviceWorker = {
    ready: ready ?? Promise.resolve(registration),
    register,
  } as unknown as ServiceWorkerContainer;

  if (unsupportedCapability === 'notification') Reflect.deleteProperty(window, 'Notification');
  else Object.defineProperty(window, 'Notification', { configurable: true, value: notificationApi });

  if (unsupportedCapability === 'push-manager') Reflect.deleteProperty(window, 'PushManager');
  else Object.defineProperty(window, 'PushManager', { configurable: true, value: class PushManager {} });

  if (unsupportedCapability === 'service-worker') Reflect.deleteProperty(navigator, 'serviceWorker');
  else Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: serviceWorker });

  const restoreProperty = (target: object, name: PropertyKey, descriptor?: PropertyDescriptor): void => {
    if (descriptor) Object.defineProperty(target, name, descriptor);
    else Reflect.deleteProperty(target, name);
  };

  return {
    existingSubscription,
    getSubscription,
    register,
    registration,
    requestPermission,
    restore: () => {
      restoreProperty(window, 'Notification', notificationDescriptor);
      restoreProperty(window, 'PushManager', pushManagerDescriptor);
      restoreProperty(navigator, 'serviceWorker', serviceWorkerDescriptor);
    },
    setPermission: (nextPermission) => {
      permission = nextPermission;
    },
    setRequestPermissionResult: (nextPermission) => {
      requestPermissionResult = nextPermission;
    },
    subscribe,
    subscription,
  };
};

export const decodeBase64UrlJson = (value: string): unknown => {
  const base64 = value
    .replace(/-/gu, '+')
    .replace(/_/gu, '/')
    .padEnd(Math.ceil(value.length / 4) * 4, '=');
  const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
};
