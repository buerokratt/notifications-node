import { HttpStatus, INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { of } from 'rxjs';
import request from 'supertest';
import { App } from 'supertest/types';
import { vi } from 'vitest';

import { configureApp, openSseStream } from './helpers';
import { TIM_TEST_COOKIE, TIM_TEST_TOKEN_CONTEXT, TimMockService } from './services/tim.mock-service';
import { AppModule } from '../src/app.module';
import { AppType } from '../src/enums';
import { SSE_HEARTBEAT_EVENT_TYPE } from '../src/notification/notification.constants';
import { NotificationService } from '../src/notification/services';
import { PublicNotificationsController } from '../src/public-notifications/controllers';
import { NotificationRecipient } from '../src/rabbitmq/enums';
import { TimTokenGuard } from '../src/tim/guards';
import { TimService } from '../src/tim/services';

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
  const timMockService = new TimMockService();

  beforeAll(async () => {
    subscribeMock = vi.fn(() =>
      of({
        data: {},
        type: SSE_HEARTBEAT_EVENT_TYPE,
      }),
    );

    const publicModuleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule.register(AppType.Public)],
    })
      .overrideProvider(TimService)
      .useValue(timMockService)
      .compile();

    const mockedPublicModuleFixture: TestingModule = await Test.createTestingModule({
      controllers: [PublicNotificationsController],
      providers: [
        {
          provide: NotificationService,
          useValue: { getEventSse: subscribeMock },
        },
        {
          provide: TimService,
          useValue: timMockService,
        },
        TimTokenGuard,
      ],
    }).compile();

    const privateModuleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule.register(AppType.Private)],
    })
      .overrideProvider(TimService)
      .useValue(timMockService)
      .compile();

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
        timMockService.verifyToken.mockClear();
      });

      it('should receive a published event through the SSE stream', async () => {
        const stream = await openSseStream(
          publicApp,
          PUBLIC_NOTIFICATION_EVENTS_ENDPOINT,
          {
            chatUuid: [CHAT_UUID],
          },
          {
            Cookie: TIM_TEST_COOKIE,
          },
        );

        try {
          expect(stream.statusCode).toBe(HttpStatus.OK);
          expect(stream.contentType).toMatch(/text\/event-stream/);
          expect(timMockService.verifyToken).toHaveBeenCalledWith(TIM_TEST_TOKEN_CONTEXT);
          expect(timMockService.verifyToken).toHaveBeenCalledTimes(1);
          await stream.waitForEvent(SSE_HEARTBEAT_EVENT_TYPE);

          await request(privateApp.getHttpServer())
            .post(PRIVATE_NOTIFICATION_EVENTS_ENDPOINT)
            .set('Cookie', TIM_TEST_COOKIE)
            .send({
              eventUuid: EVENT_UUID,
              recipient: NotificationRecipient.Global,
              type: EVENT_TYPE,
              payload: EVENT_PAYLOAD,
            })
            .expect(HttpStatus.ACCEPTED);

          expect(timMockService.verifyToken).toHaveBeenCalledWith(TIM_TEST_TOKEN_CONTEXT);
          expect(timMockService.verifyToken).toHaveBeenCalledTimes(2);
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
          .set('Cookie', TIM_TEST_COOKIE)
          .query({ chatUuid: [CHAT_UUID, SECOND_CHAT_UUID] })
          .expect(HttpStatus.OK)
          .expect('Content-Type', /text\/event-stream/);

        expect(subscribeMock).toHaveBeenCalledWith(
          expect.objectContaining({
            chatUuid: [CHAT_UUID, SECOND_CHAT_UUID],
          }),
          expect.objectContaining({
            timTokenVerificationContext: TIM_TEST_TOKEN_CONTEXT,
          }),
        );
        expect(timMockService.verifyToken).toHaveBeenCalledWith(TIM_TEST_TOKEN_CONTEXT);
      });

      it('should discard query parameters that are not whitelisted', async () => {
        await request(mockedPublicApp.getHttpServer())
          .get(PUBLIC_NOTIFICATION_EVENTS_ENDPOINT)
          .set('Cookie', TIM_TEST_COOKIE)
          .query({ chatUuid: CHAT_UUID, randomParam: 'discard-me' })
          .expect(HttpStatus.OK)
          .expect('Content-Type', /text\/event-stream/);

        const subscribeQuery = subscribeMock.mock.calls[0][0];

        expect(subscribeQuery).toEqual(expect.objectContaining({ chatUuid: [CHAT_UUID] }));
        expect(subscribeQuery).not.toHaveProperty('randomParam');
        expect(timMockService.verifyToken).toHaveBeenCalledWith(TIM_TEST_TOKEN_CONTEXT);
      });
    });

    describe('error', () => {
      beforeEach(() => {
        subscribeMock.mockClear();
        timMockService.verifyToken.mockClear();
      });

      it(`should return ${HttpStatus.BAD_REQUEST} when "chatUuid" query parameter is missing`, async () => {
        const response = await request(mockedPublicApp.getHttpServer())
          .get(PUBLIC_NOTIFICATION_EVENTS_ENDPOINT)
          .set('Cookie', TIM_TEST_COOKIE)
          .expect(HttpStatus.BAD_REQUEST);

        expect(response.body).toEqual(
          expect.objectContaining({
            statusCode: HttpStatus.BAD_REQUEST,
            error: 'Bad Request',
            message: expect.arrayContaining(['chatUuid should not be null or undefined']),
          }),
        );
        expect(subscribeMock).not.toHaveBeenCalled();
        expect(timMockService.verifyToken).toHaveBeenCalledWith(TIM_TEST_TOKEN_CONTEXT);
      });

      it(`should return ${HttpStatus.BAD_REQUEST} when "chatUuid" query parameter is empty`, async () => {
        const response = await request(mockedPublicApp.getHttpServer())
          .get(PUBLIC_NOTIFICATION_EVENTS_ENDPOINT)
          .set('Cookie', TIM_TEST_COOKIE)
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
        expect(timMockService.verifyToken).toHaveBeenCalledWith(TIM_TEST_TOKEN_CONTEXT);
      });

      it(`should return ${HttpStatus.BAD_REQUEST} when "chatUuid" query parameter is not a UUID`, async () => {
        const response = await request(mockedPublicApp.getHttpServer())
          .get(PUBLIC_NOTIFICATION_EVENTS_ENDPOINT)
          .set('Cookie', TIM_TEST_COOKIE)
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
        expect(timMockService.verifyToken).toHaveBeenCalledWith(TIM_TEST_TOKEN_CONTEXT);
      });

      it(`should return ${HttpStatus.BAD_REQUEST} when one of many "chatUuid" query parameters is not a UUID`, async () => {
        const response = await request(mockedPublicApp.getHttpServer())
          .get(PUBLIC_NOTIFICATION_EVENTS_ENDPOINT)
          .set('Cookie', TIM_TEST_COOKIE)
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
        expect(timMockService.verifyToken).toHaveBeenCalledWith(TIM_TEST_TOKEN_CONTEXT);
      });

      it(`should return ${HttpStatus.BAD_REQUEST} when one of many "chatUuid" query parameters is empty`, async () => {
        const response = await request(mockedPublicApp.getHttpServer())
          .get(PUBLIC_NOTIFICATION_EVENTS_ENDPOINT)
          .set('Cookie', TIM_TEST_COOKIE)
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
        expect(timMockService.verifyToken).toHaveBeenCalledWith(TIM_TEST_TOKEN_CONTEXT);
      });

      it(`should return ${HttpStatus.BAD_REQUEST} when one of many "chatUuid" query parameters is numeric`, async () => {
        const response = await request(mockedPublicApp.getHttpServer())
          .get(PUBLIC_NOTIFICATION_EVENTS_ENDPOINT)
          .set('Cookie', TIM_TEST_COOKIE)
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
        expect(timMockService.verifyToken).toHaveBeenCalledWith(TIM_TEST_TOKEN_CONTEXT);
      });
    });
  });
});
