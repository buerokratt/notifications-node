import type { PropsWithChildren } from 'react';
import { createContext, useContext } from 'react';

import type { NotificationsClient } from '../../core/index.js';

const NotificationsContext = createContext<NotificationsClient | undefined>(undefined);

export const NotificationsProvider = ({
  children,
  client,
}: PropsWithChildren<{ readonly client: NotificationsClient }>) => (
  <NotificationsContext.Provider value={client}>{children}</NotificationsContext.Provider>
);

export const useNotificationsContext = (): NotificationsClient | undefined => useContext(NotificationsContext);
