import {
  buildLifecycleActionId,
  buildLifecycleActionKey,
  buildLifecycleScheduleMember,
  parseLifecycleScheduleMember,
} from './index';

const CHAT_UUID = 'dee9c8da-2b40-4c6a-a31e-db278b6960b1';
const USER_UUID = '4e3c74ba-dfe2-5934-ba4b-a60f268cef2b';

describe('lifecycle key utilities', () => {
  describe('buildLifecycleScheduleMember', () => {
    it('builds a chat schedule member', () => {
      expect(buildLifecycleScheduleMember({ uuid: CHAT_UUID, type: 'chat:end-user' })).toBe(
        `chat:end-user|${CHAT_UUID}`,
      );
    });

    it('builds a backoffice schedule member', () => {
      expect(buildLifecycleScheduleMember({ uuid: USER_UUID, type: 'user:backoffice' })).toBe(
        `user:backoffice|${USER_UUID}`,
      );
    });
  });

  describe('parseLifecycleScheduleMember', () => {
    it('parses a valid schedule member', () => {
      expect(parseLifecycleScheduleMember(`chat:end-user|${CHAT_UUID}`)).toEqual({
        scopeType: 'chat:end-user',
        scopeId: CHAT_UUID,
      });
    });

    it.each(['', 'chat:end-user', '|scope-id', 'scope-type|', 'scope|id|extra'])(
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
      expect(buildLifecycleActionId('chat-end-user-disconnected', CHAT_UUID, 'cycle-token')).toBe(
        `chat-end-user-disconnected:${CHAT_UUID}:cycle-token`,
      );
    });
  });
});
