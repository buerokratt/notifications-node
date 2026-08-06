import { HttpStatus, INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';

import { configureApp } from './helpers';
import { AppModule } from '../src/app.module';
import { AppType } from '../src/enums';
import { NotificationRecipient } from '../src/rabbitmq/enums';

describe('PrivateNotificationsController (e2e)', () => {
  const NOTIFICATION_EVENTS_ENDPOINT = '/private/v1/notifications/events';
  const CHAT_UUID = 'dee9c8da-2b40-4c6a-a31e-db278b6960b1';
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
            message: expect.arrayContaining(['recipientUuid must be a UUID v4 when recipient is CHAT']),
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
            message: expect.arrayContaining(['recipient must be one of the following values: GLOBAL, CHAT']),
          }),
        );
      });
    });
  });
});
