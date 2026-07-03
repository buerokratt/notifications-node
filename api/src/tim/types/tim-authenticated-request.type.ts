import type { Request } from 'express';

import type { TimTokenVerificationContext } from './tim-token-verification-context.type';

export type TimAuthenticatedRequest = Request & {
  readonly timTokenVerificationContext: TimTokenVerificationContext;
};
