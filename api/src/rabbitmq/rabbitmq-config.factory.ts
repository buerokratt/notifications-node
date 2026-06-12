import { env } from 'process';

import { registerAs } from '@nestjs/config';

import { ConfigUtil } from '../utils';
import { RabbitmqConfigSchema } from './rabbitmq-config.schema';

export const rabbitmqConfigFactory = registerAs('rabbitmq', (): RabbitmqConfigSchema => {
  return ConfigUtil.validate(RabbitmqConfigSchema, {
    url: <string>env['RABBITMQ_URL'],
    prefix: <string>env['RABBITMQ_PREFIX'],
  });
});
