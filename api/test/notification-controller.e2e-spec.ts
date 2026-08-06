import {
  ClassSerializerInterceptor,
  HttpStatus,
  INestApplication,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { of } from 'rxjs';
import request from 'supertest';
import { App } from 'supertest/types';
import { vi } from 'vitest';

import { AppModule } from '../src/app.module';
import { NotificationService } from '../src/notification/services';

describe('NotificationController (e2e)', () => {
  const GET_NOTIFICATION_EVENTS_ENDPOINT = '/v1/notifications/events';
  const CHAT_UUID = 'dee9c8da-2b40-4c6a-a31e-db278b6960b1';
  const SECOND_CHAT_UUID = '8f1406dd-7e13-46c8-94e5-32b617b76cfd';
  let app: INestApplication<App>;
  let subscribeMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    subscribeMock = vi.fn(() =>
      of({
        data: {},
        type: 'heartbeat',
      }),
    );

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(NotificationService)
      .useValue({ getEventSse: subscribeMock })
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    app.enableVersioning({ type: VersioningType.URI });
    app.useGlobalInterceptors(
      new ClassSerializerInterceptor(app.get(Reflector), {
        excludeExtraneousValues: true,
      }),
    );
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  describe(`(GET) ${GET_NOTIFICATION_EVENTS_ENDPOINT}`, () => {
    describe('success', () => {
      it('should subscribe to notification events with one chat UUID', async () => {
        await request(app.getHttpServer())
          .get(GET_NOTIFICATION_EVENTS_ENDPOINT)
          .query({ chatUuid: CHAT_UUID })
          .expect(HttpStatus.OK)
          .expect('Content-Type', /text\/event-stream/);

        expect(subscribeMock).toHaveBeenCalledWith(expect.objectContaining({ chatUuid: [CHAT_UUID] }));
      });

      it('should subscribe to notification events with multiple chat UUIDs', async () => {
        await request(app.getHttpServer())
          .get(GET_NOTIFICATION_EVENTS_ENDPOINT)
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
        await request(app.getHttpServer())
          .get(GET_NOTIFICATION_EVENTS_ENDPOINT)
          .query({ chatUuid: CHAT_UUID, randomParam: 'discard-me' })
          .expect(HttpStatus.OK)
          .expect('Content-Type', /text\/event-stream/);

        const subscribeQuery = subscribeMock.mock.calls[0][0];

        expect(subscribeQuery).toEqual(expect.objectContaining({ chatUuid: [CHAT_UUID] }));
        expect(subscribeQuery).not.toHaveProperty('randomParam');
      });
    });

    describe('error', () => {
      it(`should return ${HttpStatus.BAD_REQUEST} when "chatUuid" query parameter is missing`, async () => {
        const response = await request(app.getHttpServer())
          .get(GET_NOTIFICATION_EVENTS_ENDPOINT)
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
        const response = await request(app.getHttpServer())
          .get(GET_NOTIFICATION_EVENTS_ENDPOINT)
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
        const response = await request(app.getHttpServer())
          .get(GET_NOTIFICATION_EVENTS_ENDPOINT)
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
        const response = await request(app.getHttpServer())
          .get(GET_NOTIFICATION_EVENTS_ENDPOINT)
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
        const response = await request(app.getHttpServer())
          .get(GET_NOTIFICATION_EVENTS_ENDPOINT)
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
        const response = await request(app.getHttpServer())
          .get(GET_NOTIFICATION_EVENTS_ENDPOINT)
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
