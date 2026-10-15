import { type LIFECYCLE_STATUS, LOGOUT_ACTION_TYPE } from '../lifecycle.constants';

export type LifecycleActionResultStatus = (typeof LIFECYCLE_STATUS.result)[keyof typeof LIFECYCLE_STATUS.result];

export type LifecycleActionResult = {
  readonly status: LifecycleActionResultStatus;
  readonly attempt?: number;
  readonly dueAt?: number;
  readonly retryAt?: number;
};

type ClaimedLifecycleActionResultBase = {
  readonly cycleToken: string;
  readonly status: typeof LIFECYCLE_STATUS.action.claimed | typeof LIFECYCLE_STATUS.action.processing;
  readonly claimToken: string;
  readonly attempt: number;
  readonly dueAt: number;
};

export type ClaimedLifecycleActionResult =
  | (ClaimedLifecycleActionResultBase & {
      readonly type: typeof LOGOUT_ACTION_TYPE;
      readonly jti: string;
      readonly userIdCode: string;
    })
  | { readonly status: typeof LIFECYCLE_STATUS.result.failed; readonly actionType: string };
