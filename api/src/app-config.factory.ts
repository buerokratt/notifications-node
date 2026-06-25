import { env } from 'process';

import { registerAs } from '@nestjs/config';

import { AppConfigSchema } from './app-config.schema';
import { ConfigUtil } from './utils';

export const appConfigFactory = registerAs('api', (): AppConfigSchema => {
  return ConfigUtil.validate(AppConfigSchema, {
    corsOrigin: split(<string>env['API_CORS_ORIGIN']),
    documentationEnabled: <string>env['API_DOCUMENTATION_ENABLED'],
    publicPort: <string>env['API_PORT_PUBLIC'],
    privatePort: <string>env['API_PORT_PRIVATE'],
  });
});

function split(value: string): string | string[] {
  const values = value.split(',');
  return values.length === 1 ? values[0] : values;
}
