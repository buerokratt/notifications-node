import type { LIFECYCLE_STATUS } from '../lifecycle.constants';
import type { BackofficeLifecycleScope } from './lifecycle-scope.type';

export type ClaimedActionBase = {
  readonly actionId: string;
  readonly cycleToken: string;
  readonly status: typeof LIFECYCLE_STATUS.action.claimed | typeof LIFECYCLE_STATUS.action.processing;
  readonly claimToken: string;
  readonly attempt: number;
  readonly dueAt: number;
  readonly jti: string;
};

export type ClaimedLogoutAction = ClaimedActionBase & {
  readonly scope: BackofficeLifecycleScope;
  readonly type: 'LOGOUT';
  readonly userIdCode: string;
};

export type ClaimedLifecycleAction = ClaimedLogoutAction;
