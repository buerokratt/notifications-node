import { randomUUID } from 'node:crypto';

import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';

import { ValkeyService } from '../../valkey/services';
import { lifecycleConfigFactory } from '../lifecycle-config.factory';
import {
  CLAIM_ACTION_SCRIPT,
  COMPLETE_ACTION_SCRIPT,
  LIFECYCLE_EVENTS,
  LIFECYCLE_REASONS,
  LIFECYCLE_SCHEDULE_KEY,
  LIFECYCLE_SCOPE_TYPE,
  LIFECYCLE_STATUS,
  LOGOUT_ACTION_TYPE,
  RECONCILE_ACTION_SCRIPT,
  RECORD_ACTION_FAILURE_SCRIPT,
  REGISTER_CONNECTION_SCRIPT,
  REMOVE_CONNECTION_SCRIPT,
  TERMINATION_ACTION_TYPE,
} from '../lifecycle.constants';
import type {
  ClaimedLifecycleAction,
  ClaimedLifecycleActionResult,
  LifecycleActionResult,
  LifecycleActionScope,
  LifecycleConnectionScope,
} from '../types';
import { buildLifecycleActionId, buildLifecycleActionKey, buildLifecycleScheduleMember } from '../utils';

@Injectable()
export class LifecycleService {
  private readonly logger = new Logger(LifecycleService.name);
  public readonly replicaId = randomUUID();

  constructor(
    @Inject(lifecycleConfigFactory.KEY)
    private readonly config: ConfigType<typeof lifecycleConfigFactory>,
    private readonly valkeyService: ValkeyService,
  ) {}

  public async registerConnection(
    ...args:
      | [scope: Extract<LifecycleConnectionScope, { readonly type: 'chat' }>, connectionId: string, jti: string]
      | [
          scope: Extract<LifecycleConnectionScope, { readonly type: 'user' }>,
          connectionId: string,
          jti: string,
          userIdCode: string,
        ]
  ): Promise<void> {
    const [scope, connectionId, jti] = args;
    let actionUserIdCode = '';
    if (scope.type === 'user') {
      if (args.length !== 4 || !args[3]) throw new Error('Backoffice lifecycle connection requires user ID code');
      actionUserIdCode = args[3];
    }

    const actionScope =
      scope.type === 'user'
        ? { uuid: scope.uuid, type: LIFECYCLE_SCOPE_TYPE.Backoffice }
        : { uuid: scope.uuid, type: LIFECYCLE_SCOPE_TYPE.ChatEndUser };
    const actionType = scope.type === 'user' ? LOGOUT_ACTION_TYPE : TERMINATION_ACTION_TYPE;

    await this.valkeyService.executeScript(
      REGISTER_CONNECTION_SCRIPT,
      [this.presenceKey(actionScope), LIFECYCLE_SCHEDULE_KEY, this.actionKey(actionScope)],
      [
        connectionId,
        this.config.presenceLeaseSeconds.toString(),
        actionType,
        actionScope.type,
        actionScope.uuid,
        randomUUID(),
        this.config.terminationGraceSeconds.toString(),
        buildLifecycleScheduleMember(actionScope),
        jti,
        actionUserIdCode,
      ],
    );
  }

  public async removeConnection(scope: LifecycleConnectionScope, connectionId: string): Promise<void> {
    if (!this.valkeyService.isInitialized) return;

    const actionScope =
      scope.type === 'user'
        ? { uuid: scope.uuid, type: LIFECYCLE_SCOPE_TYPE.Backoffice }
        : { uuid: scope.uuid, type: LIFECYCLE_SCOPE_TYPE.ChatEndUser };
    const actionType = scope.type === 'user' ? LOGOUT_ACTION_TYPE : TERMINATION_ACTION_TYPE;

    await this.valkeyService.executeScript(
      REMOVE_CONNECTION_SCRIPT,
      [this.presenceKey(actionScope), LIFECYCLE_SCHEDULE_KEY, this.actionKey(actionScope)],
      [
        connectionId,
        this.config.terminationGraceSeconds.toString(),
        actionType,
        actionScope.type,
        actionScope.uuid,
        randomUUID(),
        buildLifecycleScheduleMember(actionScope),
      ],
    );
  }

  public async getDueScheduleMembers(limit: number): Promise<string[]> {
    return this.valkeyService.getSortedSetMembersByScore(LIFECYCLE_SCHEDULE_KEY, Date.now(), limit);
  }

  public async removeMalformedScheduleMember(member: string): Promise<void> {
    await this.valkeyService.removeSortedSetMembers(LIFECYCLE_SCHEDULE_KEY, [member]);
  }

  public async claimAction(scope: LifecycleActionScope): Promise<ClaimedLifecycleAction | undefined> {
    const result = await this.valkeyService.executeScript(
      CLAIM_ACTION_SCRIPT,
      [LIFECYCLE_SCHEDULE_KEY, this.actionKey(scope)],
      [
        buildLifecycleScheduleMember(scope),
        this.config.actionLeaseSeconds.toString(),
        randomUUID(),
        this.replicaId,
        scope.type === LIFECYCLE_SCOPE_TYPE.Backoffice ? LOGOUT_ACTION_TYPE : TERMINATION_ACTION_TYPE,
      ],
    );
    const action = this.parseClaimedActionResult(result);
    if (!action) return;
    if (action.status === LIFECYCLE_STATUS.result.failed) {
      this.logger.error(
        JSON.stringify({
          event: LIFECYCLE_EVENTS.unsupportedAction,
          reason: LIFECYCLE_REASONS.unsupportedActionType,
          actionType: action.actionType,
          scope,
        }),
      );
      return;
    }

    const resultBase = {
      actionId: buildLifecycleActionId(action.type, scope.uuid, action.cycleToken),
      cycleToken: action.cycleToken,
      status: action.status,
      claimToken: action.claimToken,
      attempt: action.attempt,
      dueAt: action.dueAt,
      jti: action.jti,
    };
    if (action.type === TERMINATION_ACTION_TYPE && scope.type === LIFECYCLE_SCOPE_TYPE.ChatEndUser) {
      return {
        ...resultBase,
        scope: { uuid: scope.uuid, type: LIFECYCLE_SCOPE_TYPE.ChatEndUser },
        type: 'TERMINATION',
      };
    }

    if (action.type === LOGOUT_ACTION_TYPE && scope.type === LIFECYCLE_SCOPE_TYPE.Backoffice) {
      return {
        ...resultBase,
        scope: { uuid: scope.uuid, type: LIFECYCLE_SCOPE_TYPE.Backoffice },
        type: 'LOGOUT',
        userIdCode: action.userIdCode,
      };
    }

    return;
  }

  public async reconcileAction(action: ClaimedLifecycleAction): Promise<LifecycleActionResult> {
    const result = await this.valkeyService.executeScript(
      RECONCILE_ACTION_SCRIPT,
      [this.presenceKey(action.scope), LIFECYCLE_SCHEDULE_KEY, this.actionKey(action.scope)],
      [
        buildLifecycleScheduleMember(action.scope),
        action.cycleToken,
        action.claimToken,
        this.config.terminationGraceSeconds.toString(),
        this.config.actionLeaseSeconds.toString(),
      ],
    );

    return this.parseActionResult<LifecycleActionResult>(result);
  }

  public async completeAction(action: ClaimedLifecycleAction): Promise<LifecycleActionResult> {
    const result = await this.valkeyService.executeScript(
      COMPLETE_ACTION_SCRIPT,
      [LIFECYCLE_SCHEDULE_KEY, this.actionKey(action.scope)],
      [buildLifecycleScheduleMember(action.scope), action.cycleToken, action.claimToken],
    );

    return this.parseActionResult<LifecycleActionResult>(result);
  }

  public async recordActionFailure(
    action: ClaimedLifecycleAction,
    retry: boolean,
    retryDelayMs: number,
  ): Promise<LifecycleActionResult> {
    const result = await this.valkeyService.executeScript(
      RECORD_ACTION_FAILURE_SCRIPT,
      [LIFECYCLE_SCHEDULE_KEY, this.actionKey(action.scope)],
      [
        buildLifecycleScheduleMember(action.scope),
        action.cycleToken,
        action.claimToken,
        retry ? '1' : '0',
        retryDelayMs.toString(),
      ],
    );

    return this.parseActionResult<LifecycleActionResult>(result);
  }

  private presenceKey(scope: LifecycleActionScope): string {
    return `presence:${scope.type}:${scope.uuid}:clients`;
  }

  private actionKey(scope: LifecycleActionScope): string {
    return buildLifecycleActionKey(scope.type, scope.uuid);
  }

  private parseActionResult<T>(result: unknown): T {
    if (typeof result !== 'string') return { status: LIFECYCLE_STATUS.result.stale } as T;

    try {
      return JSON.parse(result) as T;
    } catch {
      return { status: LIFECYCLE_STATUS.result.stale } as T;
    }
  }

  private parseClaimedActionResult(result: unknown): ClaimedLifecycleActionResult | undefined {
    if (typeof result !== 'string' || !result) return;

    try {
      const parsed: unknown = JSON.parse(result);
      if (!this.isClaimedLifecycleActionResult(parsed)) return;

      return parsed;
    } catch {
      return;
    }
  }

  private isClaimedLifecycleActionResult(value: unknown): value is ClaimedLifecycleActionResult {
    if (!this.isRecord(value)) return false;

    if (value.status === LIFECYCLE_STATUS.result.failed) {
      return typeof value.actionType === 'string' && value.actionType.length > 0;
    }

    const { cycleToken, type, status, claimToken, attempt, dueAt, jti } = value;
    const { userIdCode } = value;
    if (
      typeof cycleToken !== 'string' ||
      cycleToken.length === 0 ||
      typeof type !== 'string' ||
      type.length === 0 ||
      typeof claimToken !== 'string' ||
      claimToken.length === 0 ||
      (status !== LIFECYCLE_STATUS.action.claimed && status !== LIFECYCLE_STATUS.action.processing) ||
      typeof attempt !== 'number' ||
      !Number.isFinite(attempt) ||
      typeof dueAt !== 'number' ||
      !Number.isFinite(dueAt) ||
      typeof jti !== 'string' ||
      !jti.length
    ) {
      return false;
    }

    if (type === LOGOUT_ACTION_TYPE) return typeof userIdCode === 'string' && !!userIdCode.trim();
    return type === TERMINATION_ACTION_TYPE && userIdCode === undefined;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}
