import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { IsValidNotificationRecipientUuid } from './is-valid-notification-recipient-uuid.validator';
import { NotificationRecipient } from '../../rabbitmq/enums';

const UUID_REQUIRED_MESSAGE = `recipientUuid must be a non-empty array of UUID v4 values when recipient is ${NotificationRecipient.Chat}`;
const MULTIPLE_RECIPIENTS_UUID_REQUIRED_MESSAGE = `recipientUuid must be a non-empty array of UUID v4 values when recipient is one of: ${NotificationRecipient.Chat}, ${NotificationRecipient.Global}`;
const USER_UUID_REQUIRED_MESSAGE =
  'recipientUuid must be a non-empty array of UUIDs or values matching ^EE\\d{11}$ when recipient is USER';

class Class {
  readonly recipient!: NotificationRecipient;

  @IsValidNotificationRecipientUuid([NotificationRecipient.Chat])
  readonly recipientUuid?: string[];
}

class ClassWithUuidVersion {
  readonly recipient!: NotificationRecipient;

  @IsValidNotificationRecipientUuid([NotificationRecipient.Chat], '4')
  readonly recipientUuid?: string[];
}

class ClassWithMultipleRecipients {
  readonly recipient!: NotificationRecipient;

  @IsValidNotificationRecipientUuid([NotificationRecipient.Chat, NotificationRecipient.Global])
  readonly recipientUuid?: string[];
}

class ClassWithUserRecipient {
  readonly recipient!: NotificationRecipient;

  @IsValidNotificationRecipientUuid([NotificationRecipient.User])
  readonly recipientUuid?: string[];
}

describe('IsValidNotificationRecipientUuid', () => {
  it('should allow multiple UUID v4 values when recipient requires recipientUuid', async () => {
    const errors = await validate(
      plainToInstance(Class, {
        recipient: NotificationRecipient.Chat,
        recipientUuid: ['6e5ad6e1-570c-4f69-99e6-ab6f28c2f8c5', 'dee9c8da-2b40-4c6a-a31e-db278b6960b1'],
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
        recipientUuid: ['6e5ad6e1-570c-4f69-99e6-ab6f28c2f8c5', 'not-a-uuid'],
      }),
    );

    expect(errors).toHaveLength(1);
    expect(errors[0].constraints).toEqual({
      isValidNotificationRecipientUuid: UUID_REQUIRED_MESSAGE,
    });
  });

  it('should reject an empty array when recipient requires recipientUuid', async () => {
    const errors = await validate(
      plainToInstance(Class, {
        recipient: NotificationRecipient.Chat,
        recipientUuid: [],
      }),
    );

    expect(errors).toHaveLength(1);
    expect(errors[0].constraints).toEqual({
      isValidNotificationRecipientUuid: UUID_REQUIRED_MESSAGE,
    });
  });

  it('should reject a scalar value when recipient requires recipientUuid', async () => {
    const errors = await validate(
      plainToInstance(Class, {
        recipient: NotificationRecipient.Chat,
        recipientUuid: '6e5ad6e1-570c-4f69-99e6-ab6f28c2f8c5',
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
        recipientUuid: ['6e5ad6e1-570c-4f69-99e6-ab6f28c2f8c5'],
      }),
    );

    expect(errors).toHaveLength(0);
  });

  it('should reject a different UUID version when uuidVersion is provided', async () => {
    const errors = await validate(
      plainToInstance(ClassWithUuidVersion, {
        recipient: NotificationRecipient.Chat,
        recipientUuid: ['6ba7b810-9dad-51d1-80b4-00c04fd430c8'],
      }),
    );

    expect(errors).toHaveLength(1);
    expect(errors[0].constraints).toEqual({
      isValidNotificationRecipientUuid: UUID_REQUIRED_MESSAGE,
    });
  });

  it('should allow mixed UUID and Estonian identifier arrays for USER', async () => {
    const errors = await validate(
      plainToInstance(ClassWithUserRecipient, {
        recipient: NotificationRecipient.User,
        recipientUuid: ['39a67df5-61d2-4b70-8c82-3a4fda012475', 'EE30303039914'],
      }),
    );

    expect(errors).toHaveLength(0);
  });

  it('should reject an invalid USER recipient identifier in the array', async () => {
    const errors = await validate(
      plainToInstance(ClassWithUserRecipient, {
        recipient: NotificationRecipient.User,
        recipientUuid: ['39a67df5-61d2-4b70-8c82-3a4fda012475', 'not-a-user-identifier'],
      }),
    );

    expect(errors).toHaveLength(1);
    expect(errors[0].constraints).toEqual({
      isValidNotificationRecipientUuid: USER_UUID_REQUIRED_MESSAGE,
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
        recipientUuid: ['6e5ad6e1-570c-4f69-99e6-ab6f28c2f8c5'],
      }),
    );

    expect(errors).toHaveLength(1);
    expect(errors[0].constraints).toEqual({
      isValidNotificationRecipientUuid: 'recipientUuid must be omitted for this recipient',
    });
  });
});
