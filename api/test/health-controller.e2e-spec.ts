import { HttpStatus, INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { vi } from 'vitest';

import { configureApp } from './helpers';
import { AppModule } from '../src/app.module';
import { AppType } from '../src/enums';
import { RabbitmqService } from '../src/rabbitmq/services';

describe('HealthController (e2e)', () => {
  const HEALTH_ENDPOINT = '/health';

  const appConfigs = [
    {
      name: AppType.Public,
      appModule: AppModule.register(AppType.Public),
    },
    {
      name: AppType.Private,
      appModule: AppModule.register(AppType.Private),
    },
  ] as const;

  describe.each(appConfigs)('$name app (GET) /health', ({ appModule, name }) => {
    let app: INestApplication<App>;
    let isHealthyMock: ReturnType<typeof vi.fn>;
    let subscribeMock: ReturnType<typeof vi.fn>;

    beforeEach(async () => {
      isHealthyMock = vi.fn();
      subscribeMock = vi.fn();

      const moduleFixture: TestingModule = await Test.createTestingModule({
        imports: [appModule],
      })
        .overrideProvider(RabbitmqService)
        .useValue({ isHealthy: isHealthyMock, subscribe: subscribeMock })
        .compile();

      app = moduleFixture.createNestApplication();
      configureApp(app, name);
      await app.init();
      vi.clearAllMocks();
    });

    afterEach(async () => {
      await app.close();
    });

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
        expect(subscribeMock).not.toHaveBeenCalled();
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
        expect(subscribeMock).not.toHaveBeenCalled();
      });
    });
  });
});
