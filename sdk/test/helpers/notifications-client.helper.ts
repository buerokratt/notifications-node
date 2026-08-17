import type { NotificationsClient, NotificationsConnectionState } from '../../src/core/index.js';

const noop = (): void => undefined;
const unsubscribe = (): void => undefined;

export const createNotificationsClientStub = (overrides: Partial<NotificationsClient> = {}): NotificationsClient => ({
  connect: noop,
  disconnect: noop,
  enableWebPush: () => Promise.resolve({ status: 'unsupported' }),
  getState: (): NotificationsConnectionState => ({ status: 'disconnected' }),
  reconnect: noop,
  subscribeToEvent: (): (() => void) => unsubscribe,
  subscribeToEvents: (): (() => void) => unsubscribe,
  subscribeToState: (): (() => void) => unsubscribe,
  ...overrides,
});
