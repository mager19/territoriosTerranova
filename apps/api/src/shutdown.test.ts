import { describe, expect, it, vi } from 'vitest';

import { createShutdown } from './shutdown.js';

describe('createShutdown', () => {
  it('closes the app and ends the pool exactly once, however many signals arrive', async () => {
    const close = vi.fn(async () => undefined);
    const end = vi.fn(async () => undefined);
    const shutdown = createShutdown({ close, log: { info: () => undefined } }, { end });

    await Promise.all([shutdown('SIGTERM'), shutdown('SIGINT'), shutdown('SIGTERM')]);
    await shutdown('SIGTERM');

    expect(close).toHaveBeenCalledTimes(1);
    expect(end).toHaveBeenCalledTimes(1);
  });

  it('closes the app before ending the pool', async () => {
    const order: string[] = [];
    const shutdown = createShutdown(
      { close: async () => void order.push('close'), log: { info: () => undefined } },
      { end: async () => void order.push('end') }
    );
    await shutdown('SIGTERM');
    expect(order).toEqual(['close', 'end']);
  });
});
