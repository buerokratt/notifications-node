import type { WebPushEnableResult } from '../types/index.js';
import { applicationServerKeysEqual } from './vapid-public-key.js';

export interface EnableWebPushArgs {
  readonly applicationServerKey: Uint8Array<ArrayBuffer>;
}

const NOTIFICATIONS_SERVICE_WORKER_URL = '/notifications-service-worker.js';

const isWebPushSupported = (): boolean =>
  typeof window !== 'undefined' && 'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window;

const getOrCreateSubscription = async (
  registration: ServiceWorkerRegistration,
  applicationServerKey: Uint8Array<ArrayBuffer>,
): Promise<PushSubscription> => {
  const subscription = await registration.pushManager.getSubscription();

  if (subscription && applicationServerKeysEqual(subscription.options.applicationServerKey, applicationServerKey)) {
    return subscription;
  }

  if (subscription) {
    const unsubscribed = await subscription.unsubscribe();
    if (!unsubscribed) throw new Error('Unable to replace the existing Web Push subscription');
  }

  return registration.pushManager.subscribe({
    applicationServerKey,
    userVisibleOnly: true,
  });
};

export const enableWebPush = async ({ applicationServerKey }: EnableWebPushArgs): Promise<WebPushEnableResult> => {
  if (!isWebPushSupported()) return { status: 'unsupported' };

  const permission =
    Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;

  if (permission !== 'granted') return { status: 'denied' };

  await navigator.serviceWorker.register(NOTIFICATIONS_SERVICE_WORKER_URL);
  const registration = await navigator.serviceWorker.ready;
  const subscription = await getOrCreateSubscription(registration, applicationServerKey);

  return { status: 'enabled', subscription };
};
