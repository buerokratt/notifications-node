/**
 * Immutable API location used by a notifications client.
 */
export interface NotificationsClientConfig {
  readonly apiBaseUrl: string;
  readonly vapidPublicKey: string;
}
