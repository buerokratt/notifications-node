import { isUUID } from 'class-validator';
import { v5 as uuidV5 } from 'uuid';

export class UserRecipientUuidUtil {
  private static readonly ID_CODE_PATTERN = /^EE\d{11}$/;
  private static readonly UUID_NAMESPACE = '04eae988-e85b-5c0e-8ad4-ae96e0ea8c62';

  static isValid(value: unknown): value is string {
    try {
      this.normalize(value);
      return true;
    } catch {
      return false;
    }
  }

  static normalize(value: unknown): string {
    if (typeof value !== 'string') throw new Error('Invalid user recipient identifier');
    if (isUUID(value)) return value;

    return this.normalizeIdCode(value);
  }

  static normalizeIdCode(value: unknown): string {
    if (typeof value !== 'string' || !this.ID_CODE_PATTERN.test(value)) {
      throw new Error('Invalid user id code');
    }

    return uuidV5(value, this.UUID_NAMESPACE);
  }
}
