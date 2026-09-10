import { isUUID, IsUUIDVersion, ValidateBy, ValidationArguments } from 'class-validator';

import { NotificationRecipient } from '../../rabbitmq/enums';
import { CreateNotificationEventBodyDto } from '../dtos';
import { UserRecipientUuidUtil } from '../utils';

/**
 * @param recipientsRequiringUuid Notification recipients that require the
 * decorated property to contain UUIDs.
 * @param uuidVersion UUID version accepted for recipients that require the
 * decorated property. Defaults to UUID v4.
 */
export const IsValidNotificationRecipientUuid = (
  recipientsRequiringUuid: readonly `${NotificationRecipient}`[],
  uuidVersion?: IsUUIDVersion,
): PropertyDecorator => {
  const recipientsRequiringUuidLabel = recipientsRequiringUuid.join(', ');
  const recipientRequirementMessage =
    recipientsRequiringUuid.length === 1
      ? `recipient is ${recipientsRequiringUuidLabel}`
      : `recipient is one of: ${recipientsRequiringUuidLabel}`;

  uuidVersion = uuidVersion || '4';
  return ValidateBy({
    name: 'isValidNotificationRecipientUuid',
    validator: {
      validate: (value: unknown, args?: ValidationArguments): boolean => {
        const event = args?.object as CreateNotificationEventBodyDto;

        if (event.recipient === NotificationRecipient.User && recipientsRequiringUuid.includes(event.recipient)) {
          return (
            Array.isArray(value) &&
            value.length > 0 &&
            value.every((recipientUuid) => UserRecipientUuidUtil.isValid(recipientUuid))
          );
        }
        if (recipientsRequiringUuid.includes(event.recipient)) {
          return (
            Array.isArray(value) &&
            value.length > 0 &&
            value.every((recipientUuid) => isUUID(recipientUuid, uuidVersion))
          );
        }

        return value === undefined;
      },
      defaultMessage: (args?: ValidationArguments): string => {
        const event = args?.object as CreateNotificationEventBodyDto;

        if (event.recipient === NotificationRecipient.User && recipientsRequiringUuid.includes(event.recipient)) {
          return 'recipientUuid must be a non-empty array of UUIDs or values matching ^EE\\d{11}$ when recipient is USER';
        }
        if (recipientsRequiringUuid.includes(event.recipient)) {
          return `recipientUuid must be a non-empty array of UUID v${uuidVersion} values when ${recipientRequirementMessage}`;
        }

        return 'recipientUuid must be omitted for this recipient';
      },
    },
  });
};
