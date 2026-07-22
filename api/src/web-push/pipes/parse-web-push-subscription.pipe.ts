import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import type { PushSubscription } from 'web-push';

import { INVALID_WEB_PUSH_SUBSCRIPTION_HEADER_MESSAGE } from '../web-push.constants';

@Injectable()
export class ParseWebPushSubscriptionPipe implements PipeTransform<string | undefined, PushSubscription | undefined> {
  public transform(encodedSubscription?: string): PushSubscription | undefined {
    if (!encodedSubscription) return;

    if (!/^[A-Za-z0-9_-]+={0,2}$/.test(encodedSubscription)) {
      throw new BadRequestException(INVALID_WEB_PUSH_SUBSCRIPTION_HEADER_MESSAGE);
    }

    const subscription = this.parseSubscription(encodedSubscription);

    if (!this.isPushSubscription(subscription)) {
      throw new BadRequestException(INVALID_WEB_PUSH_SUBSCRIPTION_HEADER_MESSAGE);
    }

    return subscription;
  }

  private parseSubscription(encoded: string): unknown {
    try {
      return JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as unknown;
    } catch {
      throw new BadRequestException(INVALID_WEB_PUSH_SUBSCRIPTION_HEADER_MESSAGE);
    }
  }

  private isPushSubscription(value: unknown): value is PushSubscription {
    if (!this.isRecord(value)) return false;

    const { endpoint, expirationTime, keys } = value;

    return (
      this.hasOnlyKeys(value, ['endpoint', 'expirationTime', 'keys']) &&
      typeof endpoint === 'string' &&
      this.isHttpsUrl(endpoint) &&
      (expirationTime == null || (typeof expirationTime === 'number' && Number.isFinite(expirationTime))) &&
      this.isRecord(keys) &&
      this.hasOnlyKeys(keys, ['auth', 'p256dh']) &&
      this.isNonEmptyString(keys.auth) &&
      this.isNonEmptyString(keys.p256dh)
    );
  }

  private isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0;
  }

  private hasOnlyKeys(value: Record<string, unknown>, allowedKeys: readonly string[]): boolean {
    return Object.keys(value).every((key) => allowedKeys.includes(key));
  }

  private isHttpsUrl(value: string): boolean {
    try {
      return new URL(value).protocol === 'https:';
    } catch {
      return false;
    }
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}
