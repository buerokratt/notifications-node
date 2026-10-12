import { HttpStatus, INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { vi } from 'vitest';

import { configureApp } from './helpers';
import { AppModule } from '../src/app.module';
import { AppType } from '../src/enums';
import { RabbitmqService } from '../src/rabbitmq/services';
import { ValkeyService } from '../src/valkey/services';

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
    let rabbitmqIsHealthyMock: ReturnType<typeof vi.fn>;
    let subscribeMock: ReturnType<typeof vi.fn>;
    let valkeyIsHealthyMock: ReturnType<typeof vi.fn>;

    beforeEach(async () => {
      rabbitmqIsHealthyMock = vi.fn();
      subscribeMock = vi.fn();
      valkeyIsHealthyMock = vi.fn();

      const moduleFixture: TestingModule = await Test.createTestingModule({
        imports: [appModule],
      })
        .overrideProvider(RabbitmqService)
        .useValue({ isHealthy: rabbitmqIsHealthyMock, subscribe: subscribeMock, subscribeWebPush: vi.fn() })
        .overrideProvider(ValkeyService)
        .useValue({ isHealthy: valkeyIsHealthyMock })
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
      it(`should return ${HttpStatus.OK} when RabbitMQ and Valkey are healthy`, async () => {
        rabbitmqIsHealthyMock.mockReturnValue({ rabbitmq: { status: 'up' } });
        valkeyIsHealthyMock.mockReturnValue({ valkey: { status: 'up' } });

        const response = await request(app.getHttpServer()).get(HEALTH_ENDPOINT).expect(HttpStatus.OK);

        expect(response.body).toEqual({
          status: 'ok',
          info: {
            rabbitmq: { status: 'up' },
            valkey: { status: 'up' },
          },
          error: {},
          details: {
            rabbitmq: { status: 'up' },
            valkey: { status: 'up' },
          },
        });
        expect(rabbitmqIsHealthyMock).toHaveBeenCalledTimes(1);
        expect(valkeyIsHealthyMock).toHaveBeenCalledTimes(1);
        expect(subscribeMock).not.toHaveBeenCalled();
      });
    });

    describe('error', () => {
      it(`should return ${HttpStatus.SERVICE_UNAVAILABLE} when RabbitMQ is unhealthy`, async () => {
        rabbitmqIsHealthyMock.mockReturnValue({ rabbitmq: { status: 'down' } });
        valkeyIsHealthyMock.mockReturnValue({ valkey: { status: 'up' } });

        const response = await request(app.getHttpServer()).get(HEALTH_ENDPOINT).expect(HttpStatus.SERVICE_UNAVAILABLE);

        expect(response.body).toEqual({
          status: 'error',
          info: { valkey: { status: 'up' } },
          error: { rabbitmq: { status: 'down' } },
          details: {
            rabbitmq: { status: 'down' },
            valkey: { status: 'up' },
          },
        });
        expect(rabbitmqIsHealthyMock).toHaveBeenCalledTimes(1);
        expect(valkeyIsHealthyMock).toHaveBeenCalledTimes(1);
        expect(subscribeMock).not.toHaveBeenCalled();
      });

      it(`should return ${HttpStatus.SERVICE_UNAVAILABLE} when Valkey is unhealthy`, async () => {
        rabbitmqIsHealthyMock.mockReturnValue({ rabbitmq: { status: 'up' } });
        valkeyIsHealthyMock.mockReturnValue({ valkey: { status: 'down' } });

        const response = await request(app.getHttpServer()).get(HEALTH_ENDPOINT).expect(HttpStatus.SERVICE_UNAVAILABLE);

        expect(response.body).toEqual({
          status: 'error',
          info: { rabbitmq: { status: 'up' } },
          error: { valkey: { status: 'down' } },
          details: {
            rabbitmq: { status: 'up' },
            valkey: { status: 'down' },
          },
        });
        expect(rabbitmqIsHealthyMock).toHaveBeenCalledTimes(1);
        expect(valkeyIsHealthyMock).toHaveBeenCalledTimes(1);
        expect(subscribeMock).not.toHaveBeenCalled();
      });
    });
  });
});
