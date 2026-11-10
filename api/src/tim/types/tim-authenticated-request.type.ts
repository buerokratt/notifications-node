import type { Request } from 'express';
import type { JwtPayload } from 'jsonwebtoken';

import type { TimTokenVerificationContext } from './tim-token-verification-context.type';

export type TimAuthenticatedRequest = Request & {
  readonly timTokenVerificationContext: Omit<TimTokenVerificationContext, 'decodedToken'> & {
    readonly decodedToken: JwtPayload & { readonly jti: string };
  };
};
