import { vi } from 'vitest';

import { waitForCondition } from './async.helper.js';

type FetchPlan =
  | { readonly kind: 'failure'; readonly error: unknown }
  | { readonly kind: 'response'; readonly onAbort?: () => void; readonly response: Response };

const abortError = (): DOMException => new DOMException('The operation was aborted', 'AbortError');

export class ControlledSseStream {
  readonly response: Response;

  private controller?: ReadableStreamDefaultController<Uint8Array>;
  private isFinished = false;
  private readonly encoder = new TextEncoder();

  constructor(status = 200, headers: HeadersInit = { 'Content-Type': 'text/event-stream' }) {
    const body = new ReadableStream<Uint8Array>({
      cancel: () => {
        this.isFinished = true;
      },
      start: (controller) => {
        this.controller = controller;
      },
    });

    this.response = new Response(body, { headers, status });
  }

  write(chunk: string): void {
    if (this.isFinished) throw new Error('Cannot write to a finished SSE stream');
    this.controller?.enqueue(this.encoder.encode(chunk));
  }

  close(): void {
    if (this.isFinished) return;
    this.isFinished = true;
    this.controller?.close();
  }

  fail(error: unknown): void {
    if (this.isFinished) return;
    this.isFinished = true;
    this.controller?.error(error);
  }
}

export interface ObservedFetchRequest {
  readonly init: RequestInit | undefined;
  readonly signal: AbortSignal | undefined;
  readonly url: string;
}

export class ControlledFetchHarness {
  readonly fetch = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();
  readonly requests: ObservedFetchRequest[] = [];

  private readonly plans: FetchPlan[] = [];
  private readonly pending: {
    readonly reject: (error: unknown) => void;
    readonly resolve: (response: Response, onAbort?: () => void) => void;
  }[] = [];

  constructor() {
    this.fetch.mockImplementation((input, init) => {
      const signal = init?.signal ?? undefined;
      this.requests.push({ init, signal, url: String(input) });

      return new Promise<Response>((resolve, reject) => {
        if (signal?.aborted) {
          reject(abortError());
          return;
        }

        let abortBody: (() => void) | undefined;
        const pendingRequest = {
          reject: (error: unknown): void => reject(error),
          resolve: (response: Response, onAbort?: () => void): void => {
            abortBody = onAbort;
            resolve(response);
          },
        };
        const abort = (): void => {
          const pendingIndex = this.pending.indexOf(pendingRequest);
          if (pendingIndex >= 0) this.pending.splice(pendingIndex, 1);
          abortBody?.();
          reject(abortError());
        };
        signal?.addEventListener('abort', abort, { once: true });
        const plan = this.plans.shift();

        if (plan) this.applyPlan(pendingRequest, plan);
        else this.pending.push(pendingRequest);
      });
    });
  }

  install(): void {
    vi.stubGlobal('fetch', this.fetch);
  }

  queueResponse(response: Response): void {
    this.enqueue({ kind: 'response', response });
  }

  queueFailure(error: unknown): void {
    this.enqueue({ error, kind: 'failure' });
  }

  queueSse(status = 200): ControlledSseStream {
    const stream = new ControlledSseStream(status);
    this.enqueue({
      kind: 'response',
      onAbort: () => stream.fail(abortError()),
      response: stream.response,
    });
    return stream;
  }

  async request(index: number): Promise<ObservedFetchRequest> {
    await waitForCondition(() => this.requests.length > index, `fetch request ${index + 1}`);
    return this.requests[index]!;
  }

  private applyPlan(
    pending: {
      readonly reject: (error: unknown) => void;
      readonly resolve: (response: Response, onAbort?: () => void) => void;
    },
    plan: FetchPlan,
  ): void {
    if (plan.kind === 'failure') pending.reject(plan.error);
    else pending.resolve(plan.response, plan.onAbort);
  }

  private enqueue(plan: FetchPlan): void {
    const pending = this.pending.shift();
    if (pending) this.applyPlan(pending, plan);
    else this.plans.push(plan);
  }
}
