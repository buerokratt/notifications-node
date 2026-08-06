import { get } from 'node:http';
import type { ClientRequest, IncomingMessage, Server } from 'node:http';

import type { INestApplication } from '@nestjs/common';
import { createParser } from 'eventsource-parser';
import type { EventSourceMessage } from 'eventsource-parser';
import type { App } from 'supertest/types';

type SseQuery = Record<string, string | readonly string[]>;
type SseHeaders = Record<string, string>;

type SseEventWaiter = {
  readonly resolve: (event: SseEvent) => void;
  readonly timeout: NodeJS.Timeout;
};

export type SseEvent = {
  readonly type: string;
  readonly data: unknown;
};

export type SseStream = {
  readonly contentType: string | undefined;
  readonly statusCode: number | undefined;
  close(): Promise<void>;
  waitForEvent(eventType: string): Promise<SseEvent>;
};

const SSE_WAIT_TIMEOUT_MS = 15_000;
const SSE_CLOSE_CLEANUP_GRACE_MS = 500;

export const openSseStream = async (
  app: INestApplication<App>,
  path: string,
  query: SseQuery,
  headers: SseHeaders = {},
): Promise<SseStream> => {
  const server = app.getHttpServer() as Server;
  const address = server.address();

  if (!address || typeof address === 'string') {
    throw new Error('Unable to resolve SSE test server port');
  }

  const queryString = createQueryString(query);
  const requestPath = queryString ? `${path}?${queryString}` : path;

  return new Promise<SseStream>((resolve, reject) => {
    const pendingWaiters = new Map<string, SseEventWaiter[]>();
    const receivedEvents: SseEvent[] = [];
    let responseStream: IncomingMessage | undefined;
    const parser = createParser({
      onError: reject,
      onEvent: (message) => {
        const event = createSseEvent(message);

        receivedEvents.push(event);
        resolveWaiters(event, pendingWaiters);
      },
    });

    const clientRequest = get(
      {
        headers: {
          Accept: 'text/event-stream',
          ...headers,
        },
        hostname: '127.0.0.1',
        path: requestPath,
        port: address.port,
      },
      (response) => {
        responseStream = response;

        const stream: SseStream = {
          get contentType() {
            return getFirstHeaderValue(response.headers['content-type']);
          },
          get statusCode() {
            return response.statusCode;
          },
          close: () => closeSseStream(clientRequest, responseStream),
          waitForEvent: (eventType) => waitForSseEvent(eventType, receivedEvents, pendingWaiters),
        };

        response.on('data', (chunk: Buffer) => {
          parser.feed(chunk.toString());
        });
        response.once('error', reject);
        resolve(stream);
      },
    );

    clientRequest.once('error', reject);
  });
};

const waitForSseEvent = (
  eventType: string,
  receivedEvents: readonly SseEvent[],
  pendingWaiters: Map<string, SseEventWaiter[]>,
): Promise<SseEvent> => {
  const receivedEvent = receivedEvents.find((event) => event.type === eventType);

  if (receivedEvent) return Promise.resolve(receivedEvent);

  return new Promise<SseEvent>((resolve, reject) => {
    const timeout = setTimeout(() => {
      const waiters = pendingWaiters.get(eventType) ?? [];
      pendingWaiters.set(
        eventType,
        waiters.filter((waiter) => waiter.timeout !== timeout),
      );
      reject(new Error(`Timed out waiting for SSE event "${eventType}"`));
    }, SSE_WAIT_TIMEOUT_MS);

    const waiters = pendingWaiters.get(eventType) ?? [];

    waiters.push({ resolve, timeout });
    pendingWaiters.set(eventType, waiters);
  });
};

const resolveWaiters = (event: SseEvent, pendingWaiters: Map<string, SseEventWaiter[]>): void => {
  const waiters = pendingWaiters.get(event.type);

  if (!waiters?.length) return;

  pendingWaiters.delete(event.type);

  for (const waiter of waiters) {
    clearTimeout(waiter.timeout);
    waiter.resolve(event);
  }
};

const closeSseStream = async (
  clientRequest: ClientRequest,
  responseStream: IncomingMessage | undefined,
): Promise<void> => {
  if (!responseStream || responseStream.destroyed) {
    clientRequest.destroy();
    return wait(SSE_CLOSE_CLEANUP_GRACE_MS);
  }

  await new Promise<void>((resolve) => {
    responseStream.once('close', resolve);
    responseStream.destroy();
    clientRequest.destroy();
  });
  return wait(SSE_CLOSE_CLEANUP_GRACE_MS);
};

const wait = (milliseconds: number): Promise<void> => {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
};

const createSseEvent = (message: EventSourceMessage): SseEvent => {
  try {
    return {
      type: message.event ?? 'message',
      data: JSON.parse(message.data),
    };
  } catch {
    return {
      type: message.event ?? 'message',
      data: message.data,
    };
  }
};

const createQueryString = (query: SseQuery): string => {
  const params = new URLSearchParams();

  Object.entries(query).forEach(([key, value]) => {
    const values = Array.isArray(value) ? value : [value];

    values.forEach((singleValue) => {
      params.append(key, singleValue);
    });
  });

  return params.toString();
};

const getFirstHeaderValue = (header: readonly string[] | string | undefined): string | undefined => {
  if (typeof header === 'string') return header;
  if (!header) return undefined;

  return header[0];
};
