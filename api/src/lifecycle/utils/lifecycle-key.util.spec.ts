import { LIFECYCLE_SCOPE_TYPE, LOGOUT_ACTION_TYPE } from '../lifecycle.constants';

import {
  buildLifecycleActionId,
  buildLifecycleActionKey,
  buildLifecycleScheduleMember,
  parseLifecycleScheduleMember,
} from './index';

const USER_UUID = '4e3c74ba-dfe2-5934-ba4b-a60f268cef2b';

describe('lifecycle key utilities', () => {
  describe('buildLifecycleScheduleMember', () => {
    it('builds a backoffice schedule member', () => {
      expect(buildLifecycleScheduleMember({ uuid: USER_UUID, type: LIFECYCLE_SCOPE_TYPE.Backoffice })).toBe(
        `${LIFECYCLE_SCOPE_TYPE.Backoffice}|${USER_UUID}`,
      );
    });
  });

  describe('parseLifecycleScheduleMember', () => {
    it('parses a valid schedule member', () => {
      expect(parseLifecycleScheduleMember(`${LIFECYCLE_SCOPE_TYPE.Backoffice}|${USER_UUID}`)).toEqual({
        scopeType: LIFECYCLE_SCOPE_TYPE.Backoffice,
        scopeId: USER_UUID,
      });
    });

    it.each(['', LIFECYCLE_SCOPE_TYPE.Backoffice, '|scope-id', 'scope-type|', 'scope|id|extra'])(
      'rejects malformed schedule members: %s',
      (member) => {
        expect(parseLifecycleScheduleMember(member)).toBeUndefined();
      },
    );
  });

  describe('buildLifecycleActionKey', () => {
    it('builds a scope-specific action key', () => {
      expect(buildLifecycleActionKey('user:backoffice', USER_UUID)).toBe(
        `lifecycle:action:user:backoffice:${USER_UUID}`,
      );
    });
  });

  describe('buildLifecycleActionId', () => {
    it('combines the action type, scope UUID, and cycle token', () => {
      expect(buildLifecycleActionId(LOGOUT_ACTION_TYPE, USER_UUID, 'cycle-token')).toBe(
        `${LOGOUT_ACTION_TYPE}:${USER_UUID}:cycle-token`,
      );
    });
  });
});
