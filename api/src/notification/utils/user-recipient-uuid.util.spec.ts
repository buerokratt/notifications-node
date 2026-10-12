import { UserRecipientUuidUtil } from './user-recipient-uuid.util';

const VALID_UUID = '6e5ad6e1-570c-4f69-99e6-ab6f28c2f8c5';
const VALID_ID_CODE = 'EE12345678901';
const NORMALIZED_ID_CODE_UUID = '7eba63ac-08aa-5fa3-b04d-b53f2be30e7c';

describe('UserRecipientUuidUtil', () => {
  describe('isValid', () => {
    it.each([VALID_UUID, VALID_ID_CODE])('should accept a valid user recipient identifier: %s', (value) => {
      expect(UserRecipientUuidUtil.isValid(value)).toBe(true);
    });

    it.each([
      undefined,
      null,
      123,
      {},
      'not-a-uuid',
      'ee12345678901',
      'EE1234567890',
      'EE123456789012',
      'EE1234567890A',
      ' EE12345678901 ',
    ])('should reject an invalid user recipient identifier: %j', (value) => {
      expect(UserRecipientUuidUtil.isValid(value)).toBe(false);
    });
  });

  describe('normalize', () => {
    it('should return an existing UUID unchanged', () => {
      expect(UserRecipientUuidUtil.normalize(VALID_UUID)).toBe(VALID_UUID);
    });

    it('should normalize a valid id code to a deterministic UUID v5', () => {
      expect(UserRecipientUuidUtil.normalize(VALID_ID_CODE)).toBe(NORMALIZED_ID_CODE_UUID);
    });

    it('should reject a non string value', () => {
      expect(() => UserRecipientUuidUtil.normalize(undefined)).toThrow('Invalid user recipient identifier');
    });

    it('should reject an invalid string value', () => {
      expect(() => UserRecipientUuidUtil.normalize('not-a-user-identifier')).toThrow('Invalid user id code');
    });
  });

  describe('normalizeIdCode', () => {
    it('should normalize a valid id code to a deterministic UUID v5', () => {
      expect(UserRecipientUuidUtil.normalizeIdCode(VALID_ID_CODE)).toBe(NORMALIZED_ID_CODE_UUID);
    });

    it.each([undefined, null, 123, 'ee12345678901', 'EE1234567890', 'EE123456789012', 'EE1234567890A'])(
      'should reject an invalid id code: %j',
      (value) => {
        expect(() => UserRecipientUuidUtil.normalizeIdCode(value)).toThrow('Invalid user id code');
      },
    );
  });
});
