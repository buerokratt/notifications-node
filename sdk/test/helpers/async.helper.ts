import { vi } from 'vitest';

export const flushMicrotasks = async (turns = 10): Promise<void> => {
  for (let turn = 0; turn < turns; turn += 1) await Promise.resolve();
};

export const waitForCondition = async (condition: () => boolean, message: string, turns = 100): Promise<void> => {
  for (let turn = 0; turn < turns; turn += 1) {
    if (condition()) return;
    await Promise.resolve();
  }

  throw new Error(`Timed out waiting for ${message}`);
};

export const advanceTimers = async (milliseconds: number): Promise<void> => {
  await vi.advanceTimersByTimeAsync(milliseconds);
  await flushMicrotasks();
};
