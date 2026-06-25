import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { IsValidNotificationRecipientUuid } from './is-valid-notification-recipient-uuid.validator';
import { NotificationRecipient } from '../../rabbitmq/enums';

const UUID_REQUIRED_MESSAGE = `recipientUuid must be a UUID v4 when recipient is ${NotificationRecipient.Chat}`;
const MULTIPLE_RECIPIENTS_UUID_REQUIRED_MESSAGE = `recipientUuid must be a UUID v4 when recipient is one of: ${NotificationRecipient.Chat}, ${NotificationRecipient.Global}`;

class Class {
  readonly recipient!: NotificationRecipient;

  @IsValidNotificationRecipientUuid([NotificationRecipient.Chat])
  readonly recipientUuid?: string;
}

class ClassWithUuidVersion {
  readonly recipient!: NotificationRecipient;

  @IsValidNotificationRecipientUuid([NotificationRecipient.Chat], '4')
  readonly recipientUuid?: string;
}

class ClassWithMultipleRecipients {
  readonly recipient!: NotificationRecipient;

  @IsValidNotificationRecipientUuid([NotificationRecipient.Chat, NotificationRecipient.Global])
  readonly recipientUuid?: string;
}

describe('IsValidNotificationRecipientUuid', () => {
  it('should allow a UUID v4 when recipient requires recipientUuid', async () => {
    const errors = await validate(
      plainToInstance(Class, {
        recipient: NotificationRecipient.Chat,
        recipientUuid: '6e5ad6e1-570c-4f69-99e6-ab6f28c2f8c5',
      }),
    );

    expect(errors).toHaveLength(0);
  });

  it('should reject a missing recipientUuid when recipient requires recipientUuid', async () => {
    const errors = await validate(plainToInstance(Class, { recipient: NotificationRecipient.Chat }));

    expect(errors).toHaveLength(1);
    expect(errors[0].constraints).toEqual({
      isValidNotificationRecipientUuid: UUID_REQUIRED_MESSAGE,
    });
  });

  it('should reject a non UUID v4 when recipient requires recipientUuid', async () => {
    const errors = await validate(
      plainToInstance(Class, {
        recipient: NotificationRecipient.Chat,
        recipientUuid: 'not-a-uuid',
      }),
    );

    expect(errors).toHaveLength(1);
    expect(errors[0].constraints).toEqual({
      isValidNotificationRecipientUuid: UUID_REQUIRED_MESSAGE,
    });
  });

  it('should allow a matching UUID version when uuidVersion is provided', async () => {
    const errors = await validate(
      plainToInstance(ClassWithUuidVersion, {
        recipient: NotificationRecipient.Chat,
        recipientUuid: '6e5ad6e1-570c-4f69-99e6-ab6f28c2f8c5',
      }),
    );

    expect(errors).toHaveLength(0);
  });

  it('should reject a different UUID version when uuidVersion is provided', async () => {
    const errors = await validate(
      plainToInstance(ClassWithUuidVersion, {
        recipient: NotificationRecipient.Chat,
        recipientUuid: '6ba7b810-9dad-51d1-80b4-00c04fd430c8',
      }),
    );

    expect(errors).toHaveLength(1);
    expect(errors[0].constraints).toEqual({
      isValidNotificationRecipientUuid: UUID_REQUIRED_MESSAGE,
    });
  });

  it('should use plural message when multiple recipients require recipientUuid', async () => {
    const errors = await validate(
      plainToInstance(ClassWithMultipleRecipients, {
        recipient: NotificationRecipient.Global,
      }),
    );

    expect(errors).toHaveLength(1);
    expect(errors[0].constraints).toEqual({
      isValidNotificationRecipientUuid: MULTIPLE_RECIPIENTS_UUID_REQUIRED_MESSAGE,
    });
  });

  it('should allow an omitted recipientUuid when recipient does not require recipientUuid', async () => {
    const errors = await validate(plainToInstance(Class, { recipient: NotificationRecipient.Global }));

    expect(errors).toHaveLength(0);
  });

  it('should reject a recipientUuid when recipient does not require recipientUuid', async () => {
    const errors = await validate(
      plainToInstance(Class, {
        recipient: NotificationRecipient.Global,
        recipientUuid: '6e5ad6e1-570c-4f69-99e6-ab6f28c2f8c5',
      }),
    );

    expect(errors).toHaveLength(1);
    expect(errors[0].constraints).toEqual({
      isValidNotificationRecipientUuid: 'recipientUuid must be omitted for this recipient',
    });
  });
});
