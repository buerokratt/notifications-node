import { HttpService } from '@nestjs/axios';
import {
  BeforeApplicationShutdown,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';

import { lifecycleConfigFactory } from '../lifecycle-config.factory';
import {
  LIFECYCLE_CALLBACK_TIMEOUT_MS,
  LIFECYCLE_EVENTS,
  LIFECYCLE_REASONS,
  LIFECYCLE_RETRY_BASE_DELAY_MS,
  LIFECYCLE_RETRY_MAX_DELAY_MS,
  LIFECYCLE_SCHEDULE_SCAN_LIMIT_MULTIPLIER,
  LIFECYCLE_SCOPE_TYPE,
  LIFECYCLE_STATUS,
} from '../lifecycle.constants';
import type { ClaimedLifecycleAction, LifecycleActionScope } from '../types';
import { parseLifecycleScheduleMember } from '../utils';
import { LifecycleService } from './lifecycle.service';

@Injectable()
export class LifecycleWorkerService implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private readonly logger = new Logger(LifecycleWorkerService.name);
  private polling = false;
  private pollTimer?: NodeJS.Timeout;

  constructor(
    @Inject(lifecycleConfigFactory.KEY)
    private readonly config: ConfigType<typeof lifecycleConfigFactory>,
    private readonly lifecycleService: LifecycleService,
    private readonly httpService: HttpService,
  ) {}

  public onApplicationBootstrap(): void {
    this.pollTimer = setInterval(() => void this.poll(), this.config.pollIntervalMs);
    void this.poll();
  }

  public beforeApplicationShutdown(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = undefined;
  }

  private async poll(): Promise<void> {
    if (this.polling) return;
    this.polling = true;

    try {
      const scanLimit = this.config.batchSize * LIFECYCLE_SCHEDULE_SCAN_LIMIT_MULTIPLIER;
      const candidates = await this.lifecycleService.getDueScheduleMembers(scanLimit);
      let claimedCount = 0;

      for (const candidate of candidates) {
        if (claimedCount >= this.config.batchSize) break;

        const parsed = parseLifecycleScheduleMember(candidate);
        if (!parsed || parsed.scopeType !== LIFECYCLE_SCOPE_TYPE.Backoffice) {
          this.logger.error(
            JSON.stringify({
              event: LIFECYCLE_EVENTS.unsupportedAction,
              reason: LIFECYCLE_REASONS.invalidScheduleMember,
              scheduleMember: candidate,
            }),
          );
          await this.lifecycleService.removeMalformedScheduleMember(candidate);
          continue;
        }

        const scope: LifecycleActionScope = { uuid: parsed.scopeId, type: parsed.scopeType };
        const action = await this.lifecycleService.claimAction(scope);
        if (!action) continue;
        claimedCount += 1;

        await this.processLogout(action);
      }
    } catch (error) {
      this.logger.error(
        JSON.stringify({
          event: LIFECYCLE_EVENTS.pollFailed,
          replicaId: this.lifecycleService.replicaId,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    } finally {
      this.polling = false;
    }
  }

  private async processLogout(action: ClaimedLifecycleAction): Promise<void> {
    if (action.status === LIFECYCLE_STATUS.action.processing) {
      await this.processLogoutCallback(action);
      return;
    }

    const state = await this.lifecycleService.reconcileAction(action);
    if (state.status === LIFECYCLE_STATUS.result.terminate) {
      await this.processLogoutCallback(action);
    }
  }

  private async processLogoutCallback(action: ClaimedLifecycleAction): Promise<void> {
    await this.processCallback(action, () =>
      this.httpService.axiosRef.post(
        this.getCallbackUrl('/notifications-node/accounts/logout', this.config.privateRouterUrl),
        {
          userIdCode: action.userIdCode,
          jwtId: action.jti,
        },
        {
          headers: {
            'Content-Type': 'application/json',
          },
          timeout: LIFECYCLE_CALLBACK_TIMEOUT_MS,
        },
      ),
    );
  }

  private async processCallback(action: ClaimedLifecycleAction, callback: () => Promise<void>): Promise<void> {
    const startedAt = Date.now();

    try {
      await callback();
    } catch (error) {
      const attempt = action.attempt + 1;
      const retry = this.isRetryableCallbackError(error) && attempt < this.config.maxAttempts;
      const retryDelayMs = retry ? this.getRetryDelayMs(attempt) : 0;
      const result = await this.lifecycleService.recordActionFailure(action, retry, retryDelayMs);
      const errorMessage = error instanceof Error ? error.message : String(error);
      const logContext = {
        actionId: action.actionId,
        userUuid: action.scope.uuid,
        actionType: action.type,
        attempt: result.attempt ?? attempt,
        maxAttempts: this.config.maxAttempts,
        claimToken: action.claimToken,
        replicaId: this.lifecycleService.replicaId,
        error: errorMessage,
      };

      if (result.status === LIFECYCLE_STATUS.result.retryScheduled) {
        this.logger.warn(
          JSON.stringify({
            event: LIFECYCLE_EVENTS.callbackRetryScheduled,
            ...logContext,
            retryAt: result.retryAt,
            retryDelayMs,
          }),
        );
      } else if (result.status === LIFECYCLE_STATUS.result.failed) {
        this.logger.error(JSON.stringify({ event: LIFECYCLE_EVENTS.callbackMaxAttemptsExceeded, ...logContext }));
      } else {
        this.logger.warn(
          JSON.stringify({
            event: LIFECYCLE_EVENTS.callbackFailed,
            ...logContext,
            result: result.status,
          }),
        );
      }
      return;
    }

    await this.lifecycleService.completeAction(action);
    this.logger.log(
      JSON.stringify({
        event: LIFECYCLE_EVENTS.callbackSucceeded,
        actionId: action.actionId,
        actionType: action.type,
        scopeId: action.scope.uuid,
        attempt: action.attempt,
        durationMs: Date.now() - startedAt,
        replicaId: this.lifecycleService.replicaId,
      }),
    );
  }

  private getCallbackUrl(path: string, routerUrl: string): string {
    return new URL(path, routerUrl).toString();
  }

  private isRetryableCallbackError(error: unknown): boolean {
    if (!this.isAxiosError(error)) return false;

    const status = error.response?.status;
    return (
      status === undefined ||
      status === HttpStatus.REQUEST_TIMEOUT ||
      status === HttpStatus.TOO_MANY_REQUESTS ||
      status >= HttpStatus.INTERNAL_SERVER_ERROR
    );
  }

  private isAxiosError(error: unknown): error is { isAxiosError: true; response?: { status?: number } } {
    return typeof error === 'object' && error !== null && 'isAxiosError' in error && error.isAxiosError === true;
  }

  private getRetryDelayMs(attempt: number): number {
    const backoffMs = Math.min(LIFECYCLE_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1), LIFECYCLE_RETRY_MAX_DELAY_MS);
    const minimumDelayMs = Math.ceil(backoffMs / 2);

    return minimumDelayMs + Math.floor(Math.random() * (backoffMs - minimumDelayMs + 1));
  }
}
