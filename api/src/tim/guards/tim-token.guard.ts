import {
  applyDecorators,
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiCookieAuth } from '@nestjs/swagger';
import type { Request } from 'express';

import { TimService } from '../services';
import { TIM_COOKIE_AUTH_SECURITY_NAME } from '../tim.constants';

export function TimAuthentication() {
  return applyDecorators(ApiCookieAuth(TIM_COOKIE_AUTH_SECURITY_NAME), UseGuards(TimTokenGuard));
}

@Injectable()
export class TimTokenGuard implements CanActivate {
  constructor(private readonly timService: TimService) {}

  public async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const tokenVerificationContext = this.timService.extractTokenVerificationContext(request);

    if (!tokenVerificationContext) throw new UnauthorizedException('Missing JWT');

    await this.timService.verifyToken(tokenVerificationContext);

    Object.assign(request, {
      timTokenVerificationContext: tokenVerificationContext,
    });
    return true;
  }
}
