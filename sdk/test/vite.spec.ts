import { readFile } from 'node:fs/promises';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { notificationsServiceWorker } from '../src/vite.js';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  const mockedModuleReadFile = vi.fn();

  return {
    ...actual,
    default: { ...actual, readFile: mockedModuleReadFile },
    readFile: mockedModuleReadFile,
  };
});

interface MiddlewareResponse {
  statusCode: number;
  readonly end: ReturnType<typeof vi.fn>;
  readonly setHeader: ReturnType<typeof vi.fn>;
}

type Middleware = (
  request: { readonly method?: string },
  response: MiddlewareResponse,
  next: (error?: unknown) => void,
) => Promise<void>;

const WORKER_BYTES = Buffer.from('self.addEventListener("push", () => undefined);');
const mockedReadFile = vi.mocked(readFile);

const getMiddleware = (): {
  readonly handler: Middleware;
  readonly plugin: ReturnType<typeof notificationsServiceWorker>;
} => {
  const plugin = notificationsServiceWorker();
  const use = vi.fn();
  const configureServer = plugin.configureServer as (server: unknown) => void;

  configureServer({ middlewares: { use } });
  expect(use).toHaveBeenCalledWith('/notifications-service-worker.js', expect.any(Function));

  return { handler: use.mock.calls[0]![1] as Middleware, plugin };
};

const createResponse = (): MiddlewareResponse => ({
  end: vi.fn(),
  setHeader: vi.fn(),
  statusCode: 0,
});

describe('notificationsServiceWorker', () => {
  beforeEach(() => {
    mockedReadFile.mockReset();
    mockedReadFile.mockResolvedValue(WORKER_BYTES);
  });

  it('exposes the stable plugin identity and development route', () => {
    const { plugin } = getMiddleware();

    expect(plugin.name).toBe('buerokratt-notifications-service-worker');
  });

  it.each([
    ['GET', WORKER_BYTES, 1],
    ['HEAD', undefined, 0],
  ] as const)(
    'serves a %s request with worker headers and the expected body',
    async (method, expectedBody, readCalls) => {
      const { handler } = getMiddleware();
      const response = createResponse();
      const next = vi.fn();

      await handler({ method }, response, next);

      expect(response.statusCode).toBe(200);
      expect(response.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-cache');
      expect(response.setHeader).toHaveBeenCalledWith('Content-Type', 'text/javascript; charset=utf-8');
      expect(response.end).toHaveBeenCalledWith(expectedBody);
      expect(mockedReadFile).toHaveBeenCalledTimes(readCalls);
      expect(next).not.toHaveBeenCalled();
    },
  );

  it('forwards a filesystem Error by identity', async () => {
    const failure = new Error('worker missing');
    mockedReadFile.mockRejectedValueOnce(failure);
    const { handler } = getMiddleware();
    const response = createResponse();
    const next = vi.fn();

    await handler({ method: 'GET' }, response, next);

    expect(next).toHaveBeenCalledWith(failure);
    expect(response.end).not.toHaveBeenCalled();
  });

  it('normalizes a non-Error filesystem failure', async () => {
    mockedReadFile.mockRejectedValueOnce('worker missing');
    const { handler } = getMiddleware();
    const response = createResponse();
    const next = vi.fn();

    await handler({ method: 'GET' }, response, next);

    expect(next).toHaveBeenCalledWith(new Error('Unable to serve the notifications service worker'));
    expect(response.end).not.toHaveBeenCalled();
  });

  it('emits the worker as a production asset', async () => {
    const plugin = notificationsServiceWorker();
    const emitFile = vi.fn();
    const generateBundle = plugin.generateBundle as unknown as (this: {
      readonly emitFile: typeof emitFile;
    }) => Promise<void>;

    await generateBundle.call({ emitFile });

    expect(emitFile).toHaveBeenCalledWith({
      fileName: 'notifications-service-worker.js',
      source: WORKER_BYTES,
      type: 'asset',
    });
  });

  it('propagates a production asset read failure', async () => {
    const failure = new Error('worker missing');
    mockedReadFile.mockRejectedValueOnce(failure);
    const plugin = notificationsServiceWorker();
    const emitFile = vi.fn();
    const generateBundle = plugin.generateBundle as unknown as (this: {
      readonly emitFile: typeof emitFile;
    }) => Promise<void>;

    await expect(generateBundle.call({ emitFile })).rejects.toBe(failure);
    expect(emitFile).not.toHaveBeenCalled();
  });
});
