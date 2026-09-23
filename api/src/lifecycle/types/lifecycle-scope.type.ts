import type { LIFECYCLE_SCOPE_TYPE } from '../lifecycle.constants';

export type LifecycleScopeType = (typeof LIFECYCLE_SCOPE_TYPE)[keyof typeof LIFECYCLE_SCOPE_TYPE];

export type LifecycleScope<T extends LifecycleScopeType = LifecycleScopeType> = {
  readonly uuid: string;
  readonly type: T;
};

export type ChatLifecycleScope = LifecycleScope<typeof LIFECYCLE_SCOPE_TYPE.ChatEndUser>;

export type BackofficeLifecycleScope = LifecycleScope<typeof LIFECYCLE_SCOPE_TYPE.Backoffice>;

export type LifecycleActionScope = LifecycleScope;

/** Distinguishes chat termination connections from backoffice presence-only connections. */
export type LifecycleConnectionScope =
  | { readonly uuid: string; readonly type: 'chat' }
  | { readonly uuid: string; readonly type: 'user' };

type LifecycleConnectionBase = {
  readonly connectionId: string;
  readonly jti: string;
};

export type LifecycleConnection =
  | (LifecycleConnectionBase & { readonly scope: { readonly uuid: string; readonly type: 'chat' } })
  | (LifecycleConnectionBase & {
      readonly scope: { readonly uuid: string; readonly type: 'user' };
      readonly userIdCode: string;
    });
