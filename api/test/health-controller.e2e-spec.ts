import {
  ClassSerializerInterceptor,
  HttpStatus,
  INestApplication,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { vi } from 'vitest';

import { AppModule } from '../src/app.module';
import { RabbitmqService } from '../src/rabbitmq/services';

describe('HealthController (e2e)', () => {
  const HEALTH_ENDPOINT = '/health';
  let app: INestApplication<App>;
  let isHealthyMock: ReturnType<typeof vi.fn>;
  let subscribeMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    isHealthyMock = vi.fn();
    subscribeMock = vi.fn();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(RabbitmqService)
      .useValue({ isHealthy: isHealthyMock, subscribe: subscribeMock })
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

  describe(`(GET) ${HEALTH_ENDPOINT}`, () => {
    describe('success', () => {
      it(`should return ${HttpStatus.OK} when RabbitMQ is healthy`, async () => {
        isHealthyMock.mockReturnValue({ rabbitmq: { status: 'up' } });

        const response = await request(app.getHttpServer()).get(HEALTH_ENDPOINT).expect(HttpStatus.OK);

        expect(response.body).toEqual({
          status: 'ok',
          info: { rabbitmq: { status: 'up' } },
          error: {},
          details: { rabbitmq: { status: 'up' } },
        });
        expect(isHealthyMock).toHaveBeenCalledTimes(1);
        expect(subscribeMock).toHaveBeenCalledTimes(1);
      });
    });

    describe('error', () => {
      it(`should return ${HttpStatus.SERVICE_UNAVAILABLE} when RabbitMQ is unhealthy`, async () => {
        isHealthyMock.mockReturnValue({ rabbitmq: { status: 'down' } });

        const response = await request(app.getHttpServer()).get(HEALTH_ENDPOINT).expect(HttpStatus.SERVICE_UNAVAILABLE);

        expect(response.body).toEqual({
          status: 'error',
          info: {},
          error: { rabbitmq: { status: 'down' } },
          details: { rabbitmq: { status: 'down' } },
        });
        expect(isHealthyMock).toHaveBeenCalledTimes(1);
        expect(subscribeMock).toHaveBeenCalledTimes(1);
      });
    });
  });
});
