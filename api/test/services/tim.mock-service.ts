import type { Request } from 'express';
import { vi } from 'vitest';

import type { TimTokenVerificationContext } from '../../src/tim/types';

export const TIM_TEST_COOKIE = 'JWTTOKEN=authenticated-token';

export const TIM_TEST_TOKEN_CONTEXT: TimTokenVerificationContext = {
  type: 'cookie',
  cookieName: 'JWTTOKEN',
  cookieHeader: TIM_TEST_COOKIE,
};

type TimMockFunction = ReturnType<typeof vi.fn>;

export class TimMockService {
  public readonly tokenRevalidationIntervalMs = 1_000_000;

  public readonly extractTokenVerificationContext: TimMockFunction = vi.fn((request: Request) => {
    if (request.headers.cookie?.includes(TIM_TEST_COOKIE)) {
      return TIM_TEST_TOKEN_CONTEXT;
    }

    return;
  });

  public readonly verifyToken: TimMockFunction = vi.fn().mockResolvedValue(undefined);
}
