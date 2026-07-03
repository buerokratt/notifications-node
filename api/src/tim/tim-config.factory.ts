import { env } from 'process';

import { registerAs } from '@nestjs/config';

import { ConfigUtil } from '../utils';
import { TimConfigSchema } from './tim-config.schema';

export const timConfigFactory = registerAs('tim', (): TimConfigSchema => {
  return ConfigUtil.validate(TimConfigSchema, {
    url: <string>env['TIM_URL'],
    jwtCookieNames: split(<string>env['TIM_JWT_COOKIE_NAMES']),
    tokenRevalidationIntervalMs: <string>env['TIM_TOKEN_REVALIDATION_INTERVAL_MS'],
  });
});

function split(value: string): string[] {
  return value.split(',');
}
