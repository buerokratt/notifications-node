/// <reference lib="webworker" />

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type PushListener = (event: PushEvent) => void;

describe('notifications service worker', () => {
  let pushListener: PushListener;
  let showNotification: ReturnType<typeof vi.fn>;
  let matchAllClients: ReturnType<typeof vi.fn>;
  let postMessage: ReturnType<typeof vi.fn>;
  let secondPostMessage: ReturnType<typeof vi.fn>;

  const pushData = (value: unknown): PushMessageData =>
    ({
      json: () => value,
    }) as PushMessageData;

  const dispatchPush = (
    data?: PushMessageData,
  ): { readonly completion: Promise<void>; readonly waitUntil: ReturnType<typeof vi.fn> } => {
    let completion: Promise<void> | undefined;
    const waitUntil = vi.fn((work: PromiseLike<unknown>) => {
      completion = Promise.resolve(work).then(() => undefined);
    });

    pushListener({ data, waitUntil } as unknown as PushEvent);

    if (!completion) throw new TypeError('The push listener did not call waitUntil');
    return { completion, waitUntil };
  };

  beforeEach(async () => {
    vi.resetModules();
    showNotification = vi.fn(() => Promise.resolve());
    postMessage = vi.fn();
    secondPostMessage = vi.fn();
    matchAllClients = vi.fn(() => Promise.resolve([{ postMessage }, { postMessage: secondPostMessage }]));
    const addEventListener = vi.fn((type: string, listener: PushListener) => {
      if (type === 'push') pushListener = listener;
    });
    vi.stubGlobal('self', {
      addEventListener,
      clients: { matchAll: matchAllClients },
      registration: { showNotification },
    });

    // @ts-expect-error The worker is intentionally a side-effect-only classic script with no exports.
    await import('../../src/worker/notifications-service-worker.js');
    expect(addEventListener).toHaveBeenCalledWith('push', expect.any(Function));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('displays a trimmed notification from a valid push payload', async () => {
    const { completion, waitUntil } = dispatchPush(
      pushData({
        notification: {
          body: '  You have a message.  ',
          event: { type: '  message.created  ', uuid: '  event-uuid  ' },
          title: '  New notification  ',
        },
      }),
    );

    await completion;

    expect(waitUntil).toHaveBeenCalledOnce();
    expect(matchAllClients).toHaveBeenCalledWith({ includeUncontrolled: true, type: 'window' });
    expect(postMessage).toHaveBeenCalledWith({
      type: 'WEB_PUSH',
      event: { type: 'message.created', uuid: 'event-uuid' },
    });
    expect(secondPostMessage).toHaveBeenCalledWith({
      type: 'WEB_PUSH',
      event: { type: 'message.created', uuid: 'event-uuid' },
    });
    expect(showNotification).toHaveBeenCalledWith('New notification', { body: 'You have a message.' });
  });

  it('ignores a push without data', async () => {
    const { completion } = dispatchPush();

    await completion;

    expect(showNotification).not.toHaveBeenCalled();
  });

  it('forwards an empty event name after trimming without rejecting the push', async () => {
    const { completion } = dispatchPush(
      pushData({
        notification: {
          body: 'Body',
          event: { type: '   ', uuid: ' event-uuid ' },
          title: 'Title',
        },
      }),
    );

    await completion;

    expect(postMessage).toHaveBeenCalledWith({
      type: 'WEB_PUSH',
      event: { type: '', uuid: 'event-uuid' },
    });
    expect(showNotification).toHaveBeenCalledWith('Title', { body: 'Body' });
  });

  it('ignores push data that cannot be decoded as JSON', async () => {
    const data = {
      json: () => {
        throw new SyntaxError('invalid payload');
      },
    } as unknown as PushMessageData;
    const { completion } = dispatchPush(data);

    await completion;

    expect(showNotification).not.toHaveBeenCalled();
  });

  it.each([
    ['null root', null],
    ['array root', []],
    ['scalar root', 'notification'],
    ['missing notification', {}],
    ['non-object notification', { notification: 'invalid' }],
    ['missing event', { notification: { body: 'Body', title: 'Title' } }],
    ['missing event type', { notification: { body: 'Body', event: { uuid: 'event-uuid' }, title: 'Title' } }],
    ['missing event UUID', { notification: { body: 'Body', event: { type: 'created' }, title: 'Title' } }],
    ['missing title', { notification: { body: 'Body', event: { type: 'created', uuid: 'event-uuid' } } }],
    [
      'non-string title',
      { notification: { body: 'Body', event: { type: 'created', uuid: 'event-uuid' }, title: 123 } },
    ],
    ['missing body', { notification: { event: { type: 'created', uuid: 'event-uuid' }, title: 'Title' } }],
    [
      'non-string body',
      { notification: { body: 123, event: { type: 'created', uuid: 'event-uuid' }, title: 'Title' } },
    ],
  ])('ignores %s', async (caseName, value) => {
    void caseName;
    const { completion } = dispatchPush(pushData(value));

    await completion;

    expect(showNotification).not.toHaveBeenCalled();
  });

  it('exposes notification display failures through waitUntil', async () => {
    const failure = new Error('display failed');
    showNotification.mockRejectedValueOnce(failure);
    const { completion } = dispatchPush(
      pushData({
        notification: {
          body: 'You have a message.',
          event: { type: 'message.created', uuid: 'event-uuid' },
          title: 'New notification',
        },
      }),
    );

    await expect(completion).rejects.toBe(failure);
  });
});
