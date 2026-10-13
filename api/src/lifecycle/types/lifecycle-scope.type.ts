import type { LIFECYCLE_SCOPE_TYPE } from '../lifecycle.constants';

export type BackofficeLifecycleScope = {
  readonly uuid: string;
  readonly type: typeof LIFECYCLE_SCOPE_TYPE.Backoffice;
};

export type LifecycleActionScope = BackofficeLifecycleScope;

export type LifecycleConnectionScope = { readonly uuid: string; readonly type: 'user' };

type LifecycleConnectionBase = {
  readonly connectionId: string;
  readonly jti: string;
};

export type LifecycleConnection = LifecycleConnectionBase & {
  readonly scope: LifecycleConnectionScope;
  readonly userIdCode: string;
};
