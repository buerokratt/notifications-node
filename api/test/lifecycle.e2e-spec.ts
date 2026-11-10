import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

import { HttpService } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';

import { lifecycleConfigFactory } from '../src/lifecycle/lifecycle-config.factory';
import { LIFECYCLE_SCHEDULE_KEY, LIFECYCLE_SCOPE_TYPE } from '../src/lifecycle/lifecycle.constants';
import { LifecycleModule } from '../src/lifecycle/lifecycle.module';
import { LifecycleService, LifecycleWorkerService } from '../src/lifecycle/services';
import { buildLifecycleScheduleMember } from '../src/lifecycle/utils';
import { ValkeyService } from '../src/valkey/services';

describe('Lifecycle (e2e)', () => {
  const FIRST_JTI = 'f400b026-cb4e-4c54-8afd-023805d6f5a4';
  const LATEST_JTI = 'be78e677-98f9-46cd-bd7f-01d24159bfb2';
  const USER_ID_CODE = 'test-user-id-code';
  const PRIVATE_ROUTER_URL = 'https://private-router.example.test';

  let moduleFixture: TestingModule;
  let lifecycleService: LifecycleService;
  let lifecycleWorker: LifecycleWorkerService;
  let valkeyService: ValkeyService;
  let lifecycleCallbackMock: ReturnType<typeof vi.fn>;
  let userUuid: string;

  const cleanUpLifecycleTestState = async (): Promise<void> => {
    const scope = { uuid: userUuid, type: LIFECYCLE_SCOPE_TYPE.Backoffice };

    await Promise.all([
      valkeyService.removeSortedSetMembers(LIFECYCLE_SCHEDULE_KEY, [buildLifecycleScheduleMember(scope)]),
      valkeyService.delete([
        `presence:${scope.type}:${scope.uuid}:clients`,
        `lifecycle:action:${scope.type}:${scope.uuid}`,
      ]),
    ]);
  };

  beforeEach(async () => {
    userUuid = randomUUID();
    lifecycleCallbackMock = vi.fn().mockResolvedValue({ status: 200 });

    moduleFixture = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          envFilePath: join(process.cwd(), 'config', `${process.env.NODE_ENV || 'development'}.env`),
          expandVariables: true,
        }),
        LifecycleModule.register({ workerEnabled: true }),
      ],
    })
      .overrideProvider(lifecycleConfigFactory.KEY)
      .useValue({
        privateRouterUrl: PRIVATE_ROUTER_URL,
        presenceLeaseSeconds: 31,
        pollIntervalMs: 500,
        batchSize: 10,
        actionLeaseSeconds: 30,
        maxAttempts: 5,
        terminationGraceSeconds: 1,
      })
      .overrideProvider(HttpService)
      .useValue({ axiosRef: { post: lifecycleCallbackMock } })
      .compile();

    await moduleFixture.init();

    lifecycleService = moduleFixture.get(LifecycleService);
    lifecycleWorker = moduleFixture.get(LifecycleWorkerService);
    valkeyService = moduleFixture.get(ValkeyService);
    await cleanUpLifecycleTestState();
  });

  afterEach(async () => {
    lifecycleWorker.beforeApplicationShutdown();
    await cleanUpLifecycleTestState();
    await moduleFixture.close();
  });

  it('should send the latest token JTI after a user reconnect', async () => {
    const connectionScope = { uuid: userUuid, type: 'user' as const };
    const firstConnectionId = randomUUID();
    const reconnectedConnectionId = randomUUID();

    await lifecycleService.registerConnection(connectionScope, firstConnectionId, FIRST_JTI, USER_ID_CODE);
    await lifecycleService.registerConnection(connectionScope, reconnectedConnectionId, LATEST_JTI, USER_ID_CODE);
    await lifecycleService.removeConnection(connectionScope, firstConnectionId);

    await new Promise((resolve) => setTimeout(resolve, 650));
    expect(lifecycleCallbackMock).not.toHaveBeenCalled();

    await lifecycleService.removeConnection(connectionScope, reconnectedConnectionId);

    await vi.waitFor(() => expect(lifecycleCallbackMock).toHaveBeenCalledTimes(1), {
      interval: 50,
      timeout: 5_000,
    });

    expect(lifecycleCallbackMock).toHaveBeenCalledWith(
      `${PRIVATE_ROUTER_URL}/notifications-node/accounts/logout`,
      expect.objectContaining({
        userIdCode: USER_ID_CODE,
        jwtId: LATEST_JTI,
      }),
      expect.objectContaining({ timeout: expect.any(Number) }),
    );
  });
});
