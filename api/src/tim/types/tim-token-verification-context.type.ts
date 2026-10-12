import type { JwtPayload } from 'jsonwebtoken';

export type TimTokenVerificationContext = {
  readonly cookieHeader: string;
  readonly cookieName: string;
  readonly decodedToken: JwtPayload;
  readonly type: 'cookie';
};
