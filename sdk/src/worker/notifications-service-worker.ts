/// <reference lib="webworker" />

interface WebPushPayload {
  readonly notification: {
    readonly body: string;
    readonly title: string;
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const parseWebPushPayload = (data: PushMessageData): WebPushPayload | undefined => {
  try {
    const value = data.json() as unknown;

    if (!isRecord(value) || !isRecord(value.notification)) return;

    const { body, title } = value.notification;

    if (typeof title !== 'string' || title.trim() === '' || typeof body !== 'string' || body.trim() === '') {
      return;
    }

    return {
      notification: {
        body: body.trim(),
        title: title.trim(),
      },
    };
  } catch {
    return;
  }
};

const serviceWorker = self as unknown as ServiceWorkerGlobalScope;

serviceWorker.addEventListener('push', (event: PushEvent) => {
  event.waitUntil(
    (async () => {
      if (!event.data) return;

      const payload = parseWebPushPayload(event.data);
      if (!payload) return;

      const { body, title } = payload.notification;
      await serviceWorker.registration.showNotification(title, { body });
    })(),
  );
});
