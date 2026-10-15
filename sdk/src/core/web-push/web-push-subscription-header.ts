export const encodeWebPushSubscriptionHeader = (subscription: PushSubscription): string => {
  const bytes = new TextEncoder().encode(JSON.stringify(subscription.toJSON()));
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join('');

  // btoa() emits standard Base64; the API header requires unpadded Base64URL.
  return btoa(binary).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/u, '');
};
