/**
 * GigaChat rejects a second simultaneous call for the same account with HTTP
 * 429, even when the first one is a tiny title-generation request. OpenCode
 * sends the session title and the first user prompt almost together, so the
 * plugin queues upstream calls per account instead of forwarding the overlap.
 */
export const DEFAULT_MAX_CONCURRENT_PER_ACCOUNT = 1;

/** `GIGACHAT_MAX_CONCURRENCY` overrides the per-account limit (paid tariffs). */
export function maxConcurrentPerAccount(): number {
  const raw = process.env.GIGACHAT_MAX_CONCURRENCY?.trim();
  if (!raw) return DEFAULT_MAX_CONCURRENT_PER_ACCOUNT;
  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed > 0
    ? parsed
    : DEFAULT_MAX_CONCURRENT_PER_ACCOUNT;
}

interface Waiter {
  resolve(): void;
  reject(error: unknown): void;
  cleanup(): void;
}

/**
 * FIFO semaphore keyed by account id. A released slot is handed directly to the
 * next waiter, so the active count never dips and a third caller cannot slip in.
 */
export class KeyedLimiter {
  private readonly active = new Map<string, number>();
  private readonly waiting = new Map<string, Waiter[]>();

  constructor(private readonly limitPerKey: number = DEFAULT_MAX_CONCURRENT_PER_ACCOUNT) {
    if (!Number.isInteger(limitPerKey) || limitPerKey < 1) {
      throw new Error(`Concurrency limit must be a positive integer, got ${limitPerKey}`);
    }
  }

  async acquire(key: string, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();

    const active = this.active.get(key) ?? 0;
    if (active < this.limitPerKey) {
      this.active.set(key, active + 1);
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const queue = this.waiting.get(key) ?? [];
      const waiter: Waiter = {
        resolve: () => {
          waiter.cleanup();
          resolve();
        },
        reject: (error) => {
          waiter.cleanup();
          reject(error);
        },
        cleanup: () => {},
      };

      const onAbort = () => {
        const index = queue.indexOf(waiter);
        if (index >= 0) queue.splice(index, 1);
        if (queue.length === 0) this.waiting.delete(key);
        waiter.reject(
          signal?.reason ??
            new Error("Aborted while waiting for a GigaChat account slot"),
        );
      };

      waiter.cleanup = () => signal?.removeEventListener("abort", onAbort);
      signal?.addEventListener("abort", onAbort, { once: true });
      queue.push(waiter);
      this.waiting.set(key, queue);
    });

    // The releaser handed its slot to this waiter: the active count is unchanged.
    if (signal?.aborted) {
      this.release(key);
      signal.throwIfAborted();
    }
  }

  release(key: string): void {
    const queue = this.waiting.get(key);
    const next = queue?.shift();
    if (next) {
      if (queue && queue.length === 0) this.waiting.delete(key);
      // Keep the slot reserved for this waiter; do not decrement the counter.
      next.resolve();
      return;
    }

    const active = this.active.get(key) ?? 0;
    if (active <= 1) this.active.delete(key);
    else this.active.set(key, active - 1);
  }
}
