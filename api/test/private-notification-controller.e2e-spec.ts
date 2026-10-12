import { HttpStatus, INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';

import { configureApp } from './helpers';
import { AppModule } from '../src/app.module';
import { AppType } from '../src/enums';
import { SSE_RESERVED_NOTIFICATION_EVENT_TYPES } from '../src/notification/notification.constants';
import { NotificationRecipient } from '../src/rabbitmq/enums';

describe('PrivateNotificationsController (e2e)', () => {
  const NOTIFICATION_EVENTS_ENDPOINT = '/private/v1/notifications/events';
  const CHAT_UUID = 'dee9c8da-2b40-4c6a-a31e-db278b6960b1';
  const USER_UUID = '39a67df5-61d2-4b70-8c82-3a4fda012475';
  const EVENT_UUID = 'b0e97ac6-47ef-4bbf-83a6-cf01ebae5f3d';

  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule.register(AppType.Private)],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app, AppType.Private);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe(`(POST) ${NOTIFICATION_EVENTS_ENDPOINT}`, () => {
    describe('success', () => {
      it('should publish a chat notification event to RabbitMQ', async () => {
        await request(app.getHttpServer())
          .post(NOTIFICATION_EVENTS_ENDPOINT)
          .send({
            eventUuid: EVENT_UUID,
            recipientUuid: CHAT_UUID,
            recipient: NotificationRecipient.Chat,
            type: 'stream_complete',
            payload: { isRandomPayload: true },
          })
          .expect(HttpStatus.ACCEPTED);
      });

      it('should publish a global notification event to RabbitMQ', async () => {
        await request(app.getHttpServer())
          .post(NOTIFICATION_EVENTS_ENDPOINT)
          .send({
            eventUuid: EVENT_UUID,
            recipient: NotificationRecipient.Global,
            type: 'broadcast',
            payload: { message: 'System maintenance' },
          })
          .expect(HttpStatus.ACCEPTED);
      });

      it('should publish a user notification event to RabbitMQ', async () => {
        await request(app.getHttpServer())
          .post(NOTIFICATION_EVENTS_ENDPOINT)
          .send({
            eventUuid: EVENT_UUID,
            recipientUuid: USER_UUID,
            recipient: NotificationRecipient.User,
            type: 'stream_complete',
            payload: { isRandomPayload: true },
          })
          .expect(HttpStatus.ACCEPTED);
      });

      it('should publish a notification event with Web Push content', async () => {
        await request(app.getHttpServer())
          .post(NOTIFICATION_EVENTS_ENDPOINT)
          .send({
            eventUuid: EVENT_UUID,
            recipient: NotificationRecipient.Global,
            type: 'broadcast',
            payload: { message: 'System maintenance' },
            webPush: {
              title: 'System maintenance',
              body: 'Maintenance starts in 15 minutes.',
              ttl: 300,
            },
          })
          .expect(HttpStatus.ACCEPTED);
      });
    });

    describe('error', () => {
      it(`should return ${HttpStatus.BAD_REQUEST} when a chat notification has no UUID`, async () => {
        const response = await request(app.getHttpServer())
          .post(NOTIFICATION_EVENTS_ENDPOINT)
          .send({
            eventUuid: EVENT_UUID,
            recipient: NotificationRecipient.Chat,
            type: 'stream_complete',
            payload: { isRandomPayload: true },
          })
          .expect(HttpStatus.BAD_REQUEST);

        expect(response.body).toEqual(
          expect.objectContaining({
            statusCode: HttpStatus.BAD_REQUEST,
            error: 'Bad Request',
            message: expect.arrayContaining(['recipientUuid must be a UUID v4 when recipient is one of: CHAT, USER']),
          }),
        );
      });

      it(`should return ${HttpStatus.BAD_REQUEST} when a global notification includes a UUID`, async () => {
        const response = await request(app.getHttpServer())
          .post(NOTIFICATION_EVENTS_ENDPOINT)
          .send({
            eventUuid: EVENT_UUID,
            recipientUuid: CHAT_UUID,
            recipient: NotificationRecipient.Global,
            type: 'broadcast',
            payload: { message: 'System maintenance' },
          })
          .expect(HttpStatus.BAD_REQUEST);

        expect(response.body).toEqual(
          expect.objectContaining({
            statusCode: HttpStatus.BAD_REQUEST,
            error: 'Bad Request',
            message: expect.arrayContaining(['recipientUuid must be omitted for this recipient']),
          }),
        );
      });

      it(`should return ${HttpStatus.BAD_REQUEST} when recipient is unsupported`, async () => {
        const response = await request(app.getHttpServer())
          .post(NOTIFICATION_EVENTS_ENDPOINT)
          .send({
            eventUuid: EVENT_UUID,
            recipient: 'EMAIL',
            type: 'broadcast',
            payload: { message: 'System maintenance' },
          })
          .expect(HttpStatus.BAD_REQUEST);

        expect(response.body).toEqual(
          expect.objectContaining({
            statusCode: HttpStatus.BAD_REQUEST,
            error: 'Bad Request',
            message: expect.arrayContaining(['recipient must be one of the following values: CHAT, GLOBAL, USER']),
          }),
        );
      });

      it.each([
        {
          name: 'title is missing',
          webPush: { body: 'Notification body' },
          expectedMessage: 'webPush.title should not be null or undefined',
        },
        {
          name: 'title is blank',
          webPush: { title: '   ', body: 'Notification body' },
          expectedMessage: 'webPush.title should not be empty',
        },
        {
          name: 'body is missing',
          webPush: { title: 'Notification title' },
          expectedMessage: 'webPush.body should not be null or undefined',
        },
        {
          name: 'body is blank',
          webPush: { title: 'Notification title', body: '   ' },
          expectedMessage: 'webPush.body should not be empty',
        },
        {
          name: 'TTL is negative',
          webPush: { title: 'Notification title', body: 'Notification body', ttl: -1 },
          expectedMessage: 'webPush.ttl must not be less than 0',
        },
        {
          name: 'TTL is not an integer',
          webPush: { title: 'Notification title', body: 'Notification body', ttl: 1.5 },
          expectedMessage: 'webPush.ttl must be an integer number',
        },
      ])(`should return ${HttpStatus.BAD_REQUEST} when Web Push $name`, async ({ expectedMessage, webPush }) => {
        const response = await request(app.getHttpServer())
          .post(NOTIFICATION_EVENTS_ENDPOINT)
          .send({
            eventUuid: EVENT_UUID,
            recipient: NotificationRecipient.Global,
            type: 'broadcast',
            payload: { message: 'System maintenance' },
            webPush,
          })
          .expect(HttpStatus.BAD_REQUEST);

        expect(response.body).toEqual(
          expect.objectContaining({
            statusCode: HttpStatus.BAD_REQUEST,
            error: 'Bad Request',
            message: expect.arrayContaining([expectedMessage]),
          }),
        );
      });

      it(`should return ${HttpStatus.BAD_REQUEST} when Web Push is not an object`, async () => {
        const response = await request(app.getHttpServer())
          .post(NOTIFICATION_EVENTS_ENDPOINT)
          .send({
            eventUuid: EVENT_UUID,
            recipient: NotificationRecipient.Global,
            type: 'broadcast',
            payload: { message: 'System maintenance' },
            webPush: 'not-an-object',
          })
          .expect(HttpStatus.BAD_REQUEST);

        expect(response.body).toEqual(
          expect.objectContaining({
            statusCode: HttpStatus.BAD_REQUEST,
            error: 'Bad Request',
            message: expect.arrayContaining(['webPush must be an object']),
          }),
        );
      });

      it.each(SSE_RESERVED_NOTIFICATION_EVENT_TYPES)(
        `should return ${HttpStatus.BAD_REQUEST} when event type is reserved: %s`,
        async (type) => {
          const response = await request(app.getHttpServer())
            .post(NOTIFICATION_EVENTS_ENDPOINT)
            .send({
              eventUuid: EVENT_UUID,
              recipient: NotificationRecipient.Global,
              type,
              payload: { message: 'System maintenance' },
            })
            .expect(HttpStatus.BAD_REQUEST);

          expect(response.body).toEqual(
            expect.objectContaining({
              statusCode: HttpStatus.BAD_REQUEST,
              error: 'Bad Request',
              message: expect.arrayContaining([
                `type must not be one of the reserved notification event types: ${SSE_RESERVED_NOTIFICATION_EVENT_TYPES.join(', ')}`,
              ]),
            }),
          );
        },
      );
    });
  });
});
