import { env } from 'node:process';

import { registerAs } from '@nestjs/config';

import { ConfigUtil } from '../utils';
import { ValkeyConfigSchema } from './valkey-config.schema';

export const valkeyConfigFactory = registerAs('valkey', (): ValkeyConfigSchema => {
  return ConfigUtil.validate(ValkeyConfigSchema, {
    connectTimeoutMs: <string>env['VALKEY_CONNECT_TIMEOUT_MS'],
    host: <string>env['VALKEY_HOST'],
    password: env['VALKEY_PASSWORD'] || undefined,
    port: <string>env['VALKEY_PORT'],
    requestTimeoutMs: <string>env['VALKEY_REQUEST_TIMEOUT_MS'],
    useTls: <string>env['VALKEY_USE_TLS'],
    username: env['VALKEY_USERNAME'] || undefined,
  });
});
