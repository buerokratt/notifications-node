import { readFile } from 'node:fs/promises';

import type { Plugin } from 'vite';

const SERVICE_WORKER_FILE_NAME = 'notifications-service-worker.js';
const SERVICE_WORKER_PATH = new URL(`./${SERVICE_WORKER_FILE_NAME}`, import.meta.url);
const SERVICE_WORKER_URL = `/${SERVICE_WORKER_FILE_NAME}`;

export const notificationsServiceWorker = (): Plugin => ({
  name: 'buerokratt-notifications-service-worker',
  configureServer(server) {
    server.middlewares.use(SERVICE_WORKER_URL, async (request, response, next) => {
      try {
        response.statusCode = 200;
        response.setHeader('Cache-Control', 'no-cache');
        response.setHeader('Content-Type', 'text/javascript; charset=utf-8');
        response.end(request.method === 'HEAD' ? undefined : await readFile(SERVICE_WORKER_PATH));
      } catch (error) {
        next(error instanceof Error ? error : new Error('Unable to serve the notifications service worker'));
      }
    });
  },
  async generateBundle() {
    this.emitFile({
      fileName: SERVICE_WORKER_FILE_NAME,
      source: await readFile(SERVICE_WORKER_PATH),
      type: 'asset',
    });
  },
});
