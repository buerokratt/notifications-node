import { HttpService } from '@nestjs/axios';
import { HttpStatus, Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import type { Request } from 'express';

import { timConfigFactory } from '../tim-config.factory';
import type { TimTokenVerificationContext } from '../types';

@Injectable()
export class TimService {
  private readonly logger = new Logger(TimService.name);

  constructor(
    @Inject(timConfigFactory.KEY) private readonly timConfig: ConfigType<typeof timConfigFactory>,
    private readonly httpService: HttpService,
  ) {}

  public get tokenRevalidationIntervalMs(): number {
    return this.timConfig.tokenRevalidationIntervalMs;
  }

  public extractTokenVerificationContext(request: Request): TimTokenVerificationContext | undefined {
    const cookies = this.parseCookieHeader(request.headers.cookie);

    for (const cookieName of this.timConfig.jwtCookieNames) {
      const cookieValue = cookies.get(cookieName);
      if (cookieValue) {
        return {
          type: 'cookie',
          cookieName,
          cookieHeader: `${cookieName}=${cookieValue}`,
        };
      }
    }

    return;
  }

  public async verifyToken(context: TimTokenVerificationContext): Promise<void> {
    return this.verifyCookieToken(context.cookieName, context.cookieHeader);
  }

  private async verifyCookieToken(cookieName: string, cookieHeader: string): Promise<void> {
    try {
      const response = await this.httpService.axiosRef.post(
        new URL('/jwt/custom-jwt-verify', this.timConfig.url).toString(),
        cookieName,
        {
          headers: {
            'Cookie': cookieHeader,
            'Content-Type': 'text/plain',
          },
          validateStatus: () => true,
        },
      );

      if (response.status === HttpStatus.OK) return;

      throw new UnauthorizedException();
    } catch (error) {
      this.logger.warn('TIM cookie token verification failed', error);
      throw new UnauthorizedException();
    }
  }

  private parseCookieHeader(cookieHeader?: string): Map<string, string> {
    const cookies = new Map<string, string>();
    if (!cookieHeader) return cookies;

    for (const cookie of cookieHeader.split(';')) {
      const separatorIndex = cookie.indexOf('=');
      if (separatorIndex < 0) continue;

      const name = cookie.slice(0, separatorIndex).trim();
      const value = cookie.slice(separatorIndex + 1).trim();
      if (!name || !value) continue;

      cookies.set(name, value);
    }

    return cookies;
  }
}
