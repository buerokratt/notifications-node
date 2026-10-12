import type { NotificationsClient } from '../../core/index.js';
import { useNotificationsContext } from '../providers/notifications-provider.js';

/**
 * Internal full-client hook. Must not be exported from the hooks index barrel.
 */
export const useNotificationsClientInternal = (): NotificationsClient => {
  const client = useNotificationsContext();

  if (!client) {
    throw new Error('Notifications hooks must be used within NotificationsProvider');
  }

  return client;
};
