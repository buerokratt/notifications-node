import { env } from 'node:process';

import { registerAs } from '@nestjs/config';

import { LifecycleConfigSchema } from './lifecycle-config.schema';
import { ConfigUtil } from '../utils';

export const lifecycleConfigFactory = registerAs('lifecycle', (): LifecycleConfigSchema => {
  return ConfigUtil.validate(LifecycleConfigSchema, {
    batchSize: <string>env['LIFECYCLE_BATCH_SIZE'],
    actionLeaseSeconds: <string>env['LIFECYCLE_ACTION_LEASE_SECONDS'],
    maxAttempts: <string>env['LIFECYCLE_MAX_ATTEMPTS'],
    pollIntervalMs: <string>env['LIFECYCLE_POLL_INTERVAL_MS'],
    privateRouterUrl: <string>env['PRIVATE_RUUTER_URL'],
    presenceLeaseSeconds: <string>env['PRESENCE_LEASE_SECONDS'],
    terminationGraceSeconds: <string>env['TERMINATION_GRACE_SECONDS'],
  });
});
