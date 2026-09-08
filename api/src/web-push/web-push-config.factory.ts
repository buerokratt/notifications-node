import { env } from 'process';

import { registerAs } from '@nestjs/config';

import { ConfigUtil } from '../utils';
import { WebPushConfigSchema } from './web-push-config.schema';

export const webPushConfigFactory = registerAs('webPush', (): WebPushConfigSchema => {
  return ConfigUtil.validate(WebPushConfigSchema, {
    concurrency: <string>env['WEB_PUSH_CONCURRENCY'],
    defaultTtlSeconds: <string>env['WEB_PUSH_TTL_SECONDS'],
    requestTimeoutMs: <string>env['WEB_PUSH_REQUEST_TIMEOUT_MS'],
    vapidPrivateKey: <string>env['WEB_PUSH_VAPID_PRIVATE_KEY'],
    vapidPublicKey: <string>env['WEB_PUSH_VAPID_PUBLIC_KEY'],
    vapidSubject: <string>env['WEB_PUSH_VAPID_SUBJECT'],
  });
});
