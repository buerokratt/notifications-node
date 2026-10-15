import { afterEach, describe, expect, it } from 'vitest';

import { enableWebPush } from '../../../src/core/web-push/enable-web-push.js';
import {
  APPLICATION_SERVER_KEY,
  createPushSubscription,
  installWebPushBrowser,
  type WebPushBrowserHarness,
} from '../../helpers/web-push.helper.js';

describe('enableWebPush', () => {
  let harness: WebPushBrowserHarness | undefined;

  afterEach(() => {
    harness?.restore();
    harness = undefined;
  });

  it.each(['notification', 'push-manager', 'service-worker'] as const)(
    'returns unsupported when %s support is absent',
    async (unsupportedCapability) => {
      harness = installWebPushBrowser({ unsupportedCapability });

      await expect(enableWebPush({ applicationServerKey: APPLICATION_SERVER_KEY })).resolves.toEqual({
        status: 'unsupported',
      });
      expect(harness.requestPermission).not.toHaveBeenCalled();
      expect(harness.register).not.toHaveBeenCalled();
    },
  );

  it('returns denied without prompting when permission was already denied', async () => {
    harness = installWebPushBrowser({ permission: 'denied' });

    await expect(enableWebPush({ applicationServerKey: APPLICATION_SERVER_KEY })).resolves.toEqual({
      status: 'denied',
    });
    expect(harness.requestPermission).not.toHaveBeenCalled();
    expect(harness.register).not.toHaveBeenCalled();
  });

  it('prompts for default permission and returns denied when the prompt is denied', async () => {
    harness = installWebPushBrowser({ permission: 'default', requestPermissionResult: 'denied' });

    await expect(enableWebPush({ applicationServerKey: APPLICATION_SERVER_KEY })).resolves.toEqual({
      status: 'denied',
    });
    expect(harness.requestPermission).toHaveBeenCalledOnce();
    expect(harness.register).not.toHaveBeenCalled();
  });

  it.each([
    ['existing permission', 'granted', 'granted', 0],
    ['prompted permission', 'default', 'granted', 1],
  ] as const)(
    'registers the worker and creates a subscription with %s',
    async (caseName, permission, requestPermissionResult, promptCalls) => {
      void caseName;
      harness = installWebPushBrowser({ permission, requestPermissionResult });

      await expect(enableWebPush({ applicationServerKey: APPLICATION_SERVER_KEY })).resolves.toEqual({
        status: 'enabled',
        subscription: harness.subscription,
      });
      expect(harness.requestPermission).toHaveBeenCalledTimes(promptCalls);
      expect(harness.register).toHaveBeenCalledWith('/notifications-service-worker.js');
      expect(harness.getSubscription).toHaveBeenCalledOnce();
      expect(harness.subscribe).toHaveBeenCalledWith({
        applicationServerKey: APPLICATION_SERVER_KEY,
        userVisibleOnly: true,
      });
    },
  );

  it('reuses an existing subscription with the configured application-server key', async () => {
    const existingSubscription = createPushSubscription();
    harness = installWebPushBrowser({ existingSubscription });

    await expect(enableWebPush({ applicationServerKey: APPLICATION_SERVER_KEY })).resolves.toEqual({
      status: 'enabled',
      subscription: existingSubscription,
    });
    expect(existingSubscription.unsubscribe).not.toHaveBeenCalled();
    expect(harness.subscribe).not.toHaveBeenCalled();
  });

  it('replaces an existing subscription with a different application-server key', async () => {
    const existingSubscription = createPushSubscription({ applicationServerKey: new Uint8Array([1, 2, 3]).buffer });
    harness = installWebPushBrowser({ existingSubscription });

    await expect(enableWebPush({ applicationServerKey: APPLICATION_SERVER_KEY })).resolves.toEqual({
      status: 'enabled',
      subscription: harness.subscription,
    });
    expect(existingSubscription.unsubscribe).toHaveBeenCalledOnce();
    expect(harness.subscribe).toHaveBeenCalledWith({
      applicationServerKey: APPLICATION_SERVER_KEY,
      userVisibleOnly: true,
    });
  });

  it('rejects when an existing mismatched subscription cannot be removed', async () => {
    const existingSubscription = createPushSubscription({
      applicationServerKey: new Uint8Array([1, 2, 3]).buffer,
      unsubscribeResult: false,
    });
    harness = installWebPushBrowser({ existingSubscription });

    await expect(enableWebPush({ applicationServerKey: APPLICATION_SERVER_KEY })).rejects.toThrow(
      'Unable to replace the existing Web Push subscription',
    );
    expect(harness.subscribe).not.toHaveBeenCalled();
  });

  it.each(['requestPermission', 'register', 'getSubscription', 'subscribe'] as const)(
    'preserves a failure from %s',
    async (boundary) => {
      const failure = new Error(`${boundary} failed`);
      harness = installWebPushBrowser({ permission: boundary === 'requestPermission' ? 'default' : 'granted' });
      harness[boundary].mockRejectedValueOnce(failure);

      await expect(enableWebPush({ applicationServerKey: APPLICATION_SERVER_KEY })).rejects.toBe(failure);
    },
  );

  it('preserves a rejected service-worker ready promise', async () => {
    const failure = new Error('ready failed');
    harness = installWebPushBrowser({ ready: Promise.reject(failure) });

    await expect(enableWebPush({ applicationServerKey: APPLICATION_SERVER_KEY })).rejects.toBe(failure);
    expect(harness.getSubscription).not.toHaveBeenCalled();
  });
});
