import { describe, it, expect, vi, afterEach } from "vitest";

const drawingBuffer = require("../socket/drawingBuffer");

describe("drawingBuffer", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("flushes once the count threshold is reached, without waiting for the timer", async () => {
    const flushFn = vi.fn().mockResolvedValue(undefined);

    for (let i = 0; i < 20; i += 1) {
      drawingBuffer.addAction("room-1", { id: `a${i}` }, flushFn);
    }

    // The 20th addAction triggers a fire-and-forget flush — let its
    // internal `await flushFn(...)` settle before asserting.
    await Promise.resolve();
    await Promise.resolve();

    expect(flushFn).toHaveBeenCalledTimes(1);
    expect(flushFn.mock.calls[0][0]).toBe("room-1");
    expect(flushFn.mock.calls[0][1]).toHaveLength(20);
  });

  it("flushes after the timer elapses even below the count threshold", async () => {
    vi.useFakeTimers();
    const flushFn = vi.fn().mockResolvedValue(undefined);

    drawingBuffer.addAction("room-2", { id: "single" }, flushFn);
    expect(flushFn).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(800);

    expect(flushFn).toHaveBeenCalledTimes(1);
    expect(flushFn).toHaveBeenCalledWith("room-2", [{ id: "single" }]);
  });

  it("removeRoom cancels a pending flush and drops buffered actions", async () => {
    vi.useFakeTimers();
    const flushFn = vi.fn().mockResolvedValue(undefined);

    drawingBuffer.addAction("room-3", { id: "one" }, flushFn);
    drawingBuffer.removeRoom("room-3");

    await vi.advanceTimersByTimeAsync(1000);

    expect(flushFn).not.toHaveBeenCalled();
  });

  it("flushRoom swallows a failing flushFn instead of throwing", async () => {
    const flushFn = vi.fn().mockRejectedValue(new Error("mongo down"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    drawingBuffer.addAction("room-4", { id: "one" }, flushFn);

    await expect(drawingBuffer.flushRoom("room-4", flushFn)).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalled();

    errorSpy.mockRestore();
  });
});
