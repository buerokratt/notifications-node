import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { SSE_RESERVED_NOTIFICATION_EVENT_TYPES } from '../notification.constants';
import { IsNotReservedNotificationEventType } from './is-not-reserved-notification-event-type.validator';

const RESERVED_TYPE_MESSAGE = `type must not be one of the reserved notification event types: ${SSE_RESERVED_NOTIFICATION_EVENT_TYPES.join(', ')}`;

class Class {
  @IsNotReservedNotificationEventType()
  readonly type!: string;
}

describe('IsNotReservedNotificationEventType', () => {
  it('should allow a non reserved event type', async () => {
    const event = plainToInstance(Class, { type: 'STREAM_COMPLETE' });
    const errors = await validate(event);

    expect(errors).toHaveLength(0);
    expect(event.type).toBe('STREAM_COMPLETE');
  });

  it.each(['heartbeat', 'HEARTBEAT', ' Heartbeat '])(
    'should reject heartbeat reserved event type case-insensitively: %s',
    async (type) => {
      const errors = await validate(plainToInstance(Class, { type }));

      expect(errors).toHaveLength(1);
      expect(errors[0].constraints).toEqual({
        isNotReservedNotificationEventType: RESERVED_TYPE_MESSAGE,
      });
    },
  );

  it.each(['session_expired', 'SESSION_EXPIRED', ' Session_Expired '])(
    'should reject session expired reserved event type case-insensitively: %s',
    async (type) => {
      const errors = await validate(plainToInstance(Class, { type }));

      expect(errors).toHaveLength(1);
      expect(errors[0].constraints).toEqual({
        isNotReservedNotificationEventType: RESERVED_TYPE_MESSAGE,
      });
    },
  );

  it('should not transform the event type value', async () => {
    const event = plainToInstance(Class, { type: ' Custom.Event ' });
    const errors = await validate(event);

    expect(errors).toHaveLength(0);
    expect(event.type).toBe(' Custom.Event ');
  });
});
