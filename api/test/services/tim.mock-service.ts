import type { Request } from 'express';
import { decode, type JwtPayload } from 'jsonwebtoken';
import { vi } from 'vitest';

import type { TimTokenVerificationContext } from '../../src/tim/types';

const TOKEN =
  'eyJhbGciOiJSUzI1NiJ9.eyJpc3MiOiJsb2NhbGhvc3QiLCJzdWIiOiIiLCJleHAiOjQ5Mzg4MjE2MDgsImxvZ2luIjoiRUUzMDMwMzAzOTkxNCIsImlhdCI6MTc4NTIyMTYwOCwianRpIjoiNTM5OGJmYWEtZDNhOS00OWFiLTg1ZGItNzE1MTNkMzM1NGI1In0.Cq55zLFqv06mXzM35XapxmMuXzeQuUK05MHxTQzWaI9K0btl_GCZgfW5xYM8g-qkOSK44pu9tZo6v77XetCST5M0Px-b93gz-qtfNvRnEC8WHRQzn-DyAdr0C74i5JzhDSf3qfv3-zSZyPopDD3PRpuyh0kWB66J4GyyxVvXMT_lVdXxZ6CYjAN0s5bHMmL0J_DGesV5RTYRWPSZ_hP8-30sh9A2bs3rUpSEzDmjJ4j9C99Ixy9j9YEvhfVr7-Lwd-CqC3EH6pZI7WzUOCzZEv1uSG7TLVF0DXyJ84sZKxROlElqnhj7boq0oPcPlX46I-925hgpoO_U4xXmmnIANw';
export const TIM_TEST_COOKIE = `JWTTOKEN=${TOKEN}`;

export const TIM_TEST_TOKEN_CONTEXT: TimTokenVerificationContext = {
  type: 'cookie',
  cookieName: 'JWTTOKEN',
  cookieHeader: TIM_TEST_COOKIE,
  decodedToken: decode(TOKEN) as JwtPayload,
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
