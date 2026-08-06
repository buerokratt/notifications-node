import { HttpStatus, INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { of } from 'rxjs';
import request from 'supertest';
import { App } from 'supertest/types';
import { vi } from 'vitest';

import { configureApp, openSseStream } from './helpers';
import { AppModule } from '../src/app.module';
import { AppType } from '../src/enums';
import { SSE_HEARTBEAT_EVENT_TYPE } from '../src/notification/notification.constants';
import { NotificationService } from '../src/notification/services';
import { PublicNotificationsController } from '../src/public-notifications/controllers';
import { NotificationRecipient } from '../src/rabbitmq/enums';

describe('PublicNotificationsController (e2e)', () => {
  const PUBLIC_NOTIFICATION_EVENTS_ENDPOINT = '/public/v1/notifications/events';
  const PRIVATE_NOTIFICATION_EVENTS_ENDPOINT = '/private/v1/notifications/events';
  const CHAT_UUID = 'dee9c8da-2b40-4c6a-a31e-db278b6960b1';
  const SECOND_CHAT_UUID = '8f1406dd-7e13-46c8-94e5-32b617b76cfd';
  const EVENT_UUID = 'b0e97ac6-47ef-4bbf-83a6-cf01ebae5f3d';
  const EVENT_TYPE = 'stream_complete';
  const EVENT_PAYLOAD = { isRandomPayload: true };

  let publicApp: INestApplication<App>;
  let mockedPublicApp: INestApplication<App>;
  let privateApp: INestApplication<App>;
  let subscribeMock: ReturnType<typeof vi.fn>;

  beforeAll(async () => {
    subscribeMock = vi.fn(() =>
      of({
        data: {},
        type: SSE_HEARTBEAT_EVENT_TYPE,
      }),
    );

    const publicModuleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule.register(AppType.Public)],
    }).compile();

    const mockedPublicModuleFixture: TestingModule = await Test.createTestingModule({
      controllers: [PublicNotificationsController],
      providers: [
        {
          provide: NotificationService,
          useValue: { getEventSse: subscribeMock },
        },
      ],
    }).compile();

    const privateModuleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule.register(AppType.Private)],
    }).compile();

    publicApp = publicModuleFixture.createNestApplication();
    configureApp(publicApp, AppType.Public);
    await publicApp.listen(0);

    mockedPublicApp = mockedPublicModuleFixture.createNestApplication();
    configureApp(mockedPublicApp, AppType.Public);
    await mockedPublicApp.init();

    privateApp = privateModuleFixture.createNestApplication();
    configureApp(privateApp, AppType.Private);
    await privateApp.listen(0);
  });

  afterAll(async () => {
    await privateApp.close();
    await mockedPublicApp.close();
    await publicApp.close();
  });

  describe(`(GET) ${PUBLIC_NOTIFICATION_EVENTS_ENDPOINT}`, () => {
    describe('success', () => {
      beforeEach(() => {
        subscribeMock.mockClear();
      });

      it('should receive a published event through the SSE stream', async () => {
        const stream = await openSseStream(publicApp, PUBLIC_NOTIFICATION_EVENTS_ENDPOINT, {
          chatUuid: [CHAT_UUID],
        });

        try {
          expect(stream.statusCode).toBe(HttpStatus.OK);
          expect(stream.contentType).toMatch(/text\/event-stream/);
          await stream.waitForEvent(SSE_HEARTBEAT_EVENT_TYPE);

          await request(privateApp.getHttpServer())
            .post(PRIVATE_NOTIFICATION_EVENTS_ENDPOINT)
            .send({
              eventUuid: EVENT_UUID,
              recipient: NotificationRecipient.Global,
              type: EVENT_TYPE,
              payload: EVENT_PAYLOAD,
            })
            .expect(HttpStatus.ACCEPTED);

          await expect(stream.waitForEvent(EVENT_TYPE)).resolves.toEqual({
            type: EVENT_TYPE,
            data: {
              eventUuid: EVENT_UUID,
              recipient: NotificationRecipient.Global,
              type: EVENT_TYPE,
              payload: EVENT_PAYLOAD,
            },
          });
        } finally {
          await stream.close();
        }
      });

      it('should open an SSE stream with multiple chat UUIDs', async () => {
        await request(mockedPublicApp.getHttpServer())
          .get(PUBLIC_NOTIFICATION_EVENTS_ENDPOINT)
          .query({ chatUuid: [CHAT_UUID, SECOND_CHAT_UUID] })
          .expect(HttpStatus.OK)
          .expect('Content-Type', /text\/event-stream/);

        expect(subscribeMock).toHaveBeenCalledWith(
          expect.objectContaining({
            chatUuid: [CHAT_UUID, SECOND_CHAT_UUID],
          }),
        );
      });

      it('should discard query parameters that are not whitelisted', async () => {
        await request(mockedPublicApp.getHttpServer())
          .get(PUBLIC_NOTIFICATION_EVENTS_ENDPOINT)
          .query({ chatUuid: CHAT_UUID, randomParam: 'discard-me' })
          .expect(HttpStatus.OK)
          .expect('Content-Type', /text\/event-stream/);

        const subscribeQuery = subscribeMock.mock.calls[0][0];

        expect(subscribeQuery).toEqual(expect.objectContaining({ chatUuid: [CHAT_UUID] }));
        expect(subscribeQuery).not.toHaveProperty('randomParam');
      });
    });

    describe('error', () => {
      beforeEach(() => {
        subscribeMock.mockClear();
      });

      it(`should return ${HttpStatus.BAD_REQUEST} when "chatUuid" query parameter is missing`, async () => {
        const response = await request(mockedPublicApp.getHttpServer())
          .get(PUBLIC_NOTIFICATION_EVENTS_ENDPOINT)
          .expect(HttpStatus.BAD_REQUEST);

        expect(response.body).toEqual(
          expect.objectContaining({
            statusCode: HttpStatus.BAD_REQUEST,
            error: 'Bad Request',
            message: expect.arrayContaining(['chatUuid should not be null or undefined']),
          }),
        );
        expect(subscribeMock).not.toHaveBeenCalled();
      });

      it(`should return ${HttpStatus.BAD_REQUEST} when "chatUuid" query parameter is empty`, async () => {
        const response = await request(mockedPublicApp.getHttpServer())
          .get(PUBLIC_NOTIFICATION_EVENTS_ENDPOINT)
          .query({ chatUuid: '' })
          .expect(HttpStatus.BAD_REQUEST);

        expect(response.body).toEqual(
          expect.objectContaining({
            statusCode: HttpStatus.BAD_REQUEST,
            error: 'Bad Request',
            message: expect.arrayContaining(['each value in chatUuid should not be empty']),
          }),
        );
        expect(subscribeMock).not.toHaveBeenCalled();
      });

      it(`should return ${HttpStatus.BAD_REQUEST} when "chatUuid" query parameter is not a UUID`, async () => {
        const response = await request(mockedPublicApp.getHttpServer())
          .get(PUBLIC_NOTIFICATION_EVENTS_ENDPOINT)
          .query({ chatUuid: 'not-a-uuid' })
          .expect(HttpStatus.BAD_REQUEST);

        expect(response.body).toEqual(
          expect.objectContaining({
            statusCode: HttpStatus.BAD_REQUEST,
            error: 'Bad Request',
            message: expect.arrayContaining(['each value in chatUuid must be a UUID']),
          }),
        );
        expect(subscribeMock).not.toHaveBeenCalled();
      });

      it(`should return ${HttpStatus.BAD_REQUEST} when one of many "chatUuid" query parameters is not a UUID`, async () => {
        const response = await request(mockedPublicApp.getHttpServer())
          .get(PUBLIC_NOTIFICATION_EVENTS_ENDPOINT)
          .query({ chatUuid: [CHAT_UUID, 'not-a-uuid'] })
          .expect(HttpStatus.BAD_REQUEST);

        expect(response.body).toEqual(
          expect.objectContaining({
            statusCode: HttpStatus.BAD_REQUEST,
            error: 'Bad Request',
            message: expect.arrayContaining(['each value in chatUuid must be a UUID']),
          }),
        );
        expect(subscribeMock).not.toHaveBeenCalled();
      });

      it(`should return ${HttpStatus.BAD_REQUEST} when one of many "chatUuid" query parameters is empty`, async () => {
        const response = await request(mockedPublicApp.getHttpServer())
          .get(PUBLIC_NOTIFICATION_EVENTS_ENDPOINT)
          .query({ chatUuid: [CHAT_UUID, ''] })
          .expect(HttpStatus.BAD_REQUEST);

        expect(response.body).toEqual(
          expect.objectContaining({
            statusCode: HttpStatus.BAD_REQUEST,
            error: 'Bad Request',
            message: expect.arrayContaining(['each value in chatUuid should not be empty']),
          }),
        );
        expect(subscribeMock).not.toHaveBeenCalled();
      });

      it(`should return ${HttpStatus.BAD_REQUEST} when one of many "chatUuid" query parameters is numeric`, async () => {
        const response = await request(mockedPublicApp.getHttpServer())
          .get(PUBLIC_NOTIFICATION_EVENTS_ENDPOINT)
          .query({ chatUuid: [CHAT_UUID, 123] })
          .expect(HttpStatus.BAD_REQUEST);

        expect(response.body).toEqual(
          expect.objectContaining({
            statusCode: HttpStatus.BAD_REQUEST,
            error: 'Bad Request',
            message: expect.arrayContaining(['each value in chatUuid must be a UUID']),
          }),
        );
        expect(subscribeMock).not.toHaveBeenCalled();
      });
    });
  });
});
