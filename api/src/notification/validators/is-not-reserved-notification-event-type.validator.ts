import { ValidateBy, ValidationOptions } from 'class-validator';

import { SSE_RESERVED_NOTIFICATION_EVENT_TYPES } from '../notification.constants';

export const IsNotReservedNotificationEventType = (validationOptions?: ValidationOptions): PropertyDecorator => {
  return ValidateBy(
    {
      name: 'isNotReservedNotificationEventType',
      validator: {
        validate: (value: unknown): boolean => {
          if (typeof value !== 'string') return true;

          const normalizedValue = value.trim().toLowerCase();

          return !SSE_RESERVED_NOTIFICATION_EVENT_TYPES.some(
            (reservedType) => reservedType.toLowerCase() === normalizedValue,
          );
        },
        defaultMessage: (): string => {
          return (
            'type must not be one of the reserved notification event types: ' +
            SSE_RESERVED_NOTIFICATION_EVENT_TYPES.join(', ')
          );
        },
      },
    },
    validationOptions,
  );
};
