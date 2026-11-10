/// <reference lib="webworker" />

interface WebPushPayload {
  readonly notification: {
    readonly body: string;
    readonly event: {
      readonly type: string;
      readonly uuid: string;
    };
    readonly title: string;
  };
}

const parseWebPushPayload = (data: PushMessageData): WebPushPayload | undefined => {
  try {
    const value = data.json() as WebPushPayload;

    return {
      notification: {
        title: value.notification.title.trim(),
        body: value.notification.body.trim(),
        event: {
          type: value.notification.event.type.trim(),
          uuid: value.notification.event.uuid.trim(),
        },
      },
    };
  } catch {
    return;
  }
};

const serviceWorker = self as unknown as ServiceWorkerGlobalScope;

serviceWorker.addEventListener('push', (pushEvent: PushEvent) => {
  pushEvent.waitUntil(
    (async () => {
      if (!pushEvent.data) {
        return;
      }

      const payload = parseWebPushPayload(pushEvent.data);
      if (!payload) {
        return;
      }

      const { body, title } = payload.notification;
      const clients = await serviceWorker.clients.matchAll({
        includeUncontrolled: true,
        type: 'window',
      });
      for (const client of clients) {
        client.postMessage({
          type: 'WEB_PUSH',
          event: {
            uuid: payload.notification.event.uuid,
            type: payload.notification.event.type,
          },
        });
      }

      await serviceWorker.registration.showNotification(title, { body });
    })(),
  );
});
