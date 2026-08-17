import type { NotificationsClient } from '../../core/index.js';
import { useNotificationsClientInternal } from './use-notifications-client-internal.js';

export const useNotificationsClient = (): Omit<NotificationsClient, 'subscribeToEvent' | 'subscribeToEvents'> =>
  useNotificationsClientInternal();
