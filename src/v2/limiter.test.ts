import { describe, expect, it } from "vitest";
import { KeyedLimiter } from "./limiter.js";

describe("KeyedLimiter", () => {
  it("serializes calls for the same account", async () => {
    const limiter = new KeyedLimiter(1);
    let active = 0;
    let maxActive = 0;
    const order: string[] = [];

    const task = async (name: string) => {
      await limiter.acquire("account");
      active += 1;
      maxActive = Math.max(maxActive, active);
      order.push(`start:${name}`);
      await new Promise((resolve) => setTimeout(resolve, 20));
      order.push(`end:${name}`);
      active -= 1;
      limiter.release("account");
    };

    await Promise.all([task("a"), task("b"), task("c")]);

    expect(maxActive).toBe(1);
    expect(order).toEqual([
      "start:a",
      "end:a",
      "start:b",
      "end:b",
      "start:c",
      "end:c",
    ]);
  });

  it("keeps different accounts independent", async () => {
    const limiter = new KeyedLimiter(1);
    let active = 0;
    let maxActive = 0;

    const task = async (key: string) => {
      await limiter.acquire(key);
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 20));
      active -= 1;
      limiter.release(key);
    };

    await Promise.all([task("first"), task("second")]);
    expect(maxActive).toBe(2);
  });

  it("allows a configured number of parallel calls", async () => {
    const limiter = new KeyedLimiter(2);
    let active = 0;
    let maxActive = 0;

    const task = async () => {
      await limiter.acquire("account");
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 20));
      active -= 1;
      limiter.release("account");
    };

    await Promise.all([task(), task(), task()]);
    expect(maxActive).toBe(2);
  });

  it("removes an aborted waiter without consuming a slot", async () => {
    const limiter = new KeyedLimiter(1);
    await limiter.acquire("account");

    const controller = new AbortController();
    const waiting = limiter.acquire("account", controller.signal);
    controller.abort();
    await expect(waiting).rejects.toThrow();

    limiter.release("account");
    // The aborted waiter must not have received the released slot.
    await expect(Promise.race([
      limiter.acquire("account").then(() => "acquired"),
      new Promise((resolve) => setTimeout(() => resolve("timeout"), 50)),
    ])).resolves.toBe("acquired");
  });
});
