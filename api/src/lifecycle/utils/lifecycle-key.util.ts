import { LIFECYCLE_ACTION_KEY_PREFIX } from '../lifecycle.constants';
import type { LifecycleActionScope } from '../types';

export const buildLifecycleScheduleMember = (scope: LifecycleActionScope): string => `${scope.type}|${scope.uuid}`;

export const parseLifecycleScheduleMember = (
  member: string,
): { readonly scopeType: string; readonly scopeId: string } | undefined => {
  const separator = member.indexOf('|');
  if (separator <= 0 || separator === member.length - 1 || member.indexOf('|', separator + 1) !== -1) return;

  return {
    scopeType: member.slice(0, separator),
    scopeId: member.slice(separator + 1),
  };
};

export const buildLifecycleActionKey = (scopeType: string, scopeId: string): string =>
  `${LIFECYCLE_ACTION_KEY_PREFIX}${scopeType}:${scopeId}`;

export const buildLifecycleActionId = (type: string, scopeId: string, cycleToken: string): string =>
  `${type}:${scopeId}:${cycleToken}`;
