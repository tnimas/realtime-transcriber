import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const startMock = vi.fn();
const stopMock = vi.fn();
const serviceCtorMock = vi.fn(() => ({
  start: startMock,
  stop: stopMock,
}));

vi.mock("../src/service", () => ({
  TranscriberService: serviceCtorMock,
}));

describe("index entrypoint", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    startMock.mockResolvedValue(undefined);
    stopMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("starts service and handles graceful shutdown signals", async () => {
    const handlers: Record<string, () => Promise<void> | void> = {};
    const processOn = vi
      .spyOn(process, "on")
      .mockImplementation(((event: string, handler: () => Promise<void> | void) => {
        handlers[event] = handler;
        return process;
      }) as typeof process.on);

    const processExit = vi.spyOn(process, "exit").mockImplementation(((code?: number) => code as never) as typeof process.exit);

    await import("../src/index");

    expect(serviceCtorMock).toHaveBeenCalledTimes(1);
    expect(String(serviceCtorMock.mock.calls[0][0])).toContain("config.json");
    expect(processOn).toHaveBeenCalledWith("SIGINT", expect.any(Function));
    expect(processOn).toHaveBeenCalledWith("SIGTERM", expect.any(Function));
    expect(startMock).toHaveBeenCalledTimes(1);

    await handlers.SIGINT();
    expect(stopMock).toHaveBeenCalledTimes(1);
    expect(processExit).toHaveBeenCalledWith(0);

    await handlers.SIGTERM();
    expect(stopMock).toHaveBeenCalledTimes(2);
    expect(processExit).toHaveBeenCalledWith(0);
  });

  it("logs startup failure and exits with code 1", async () => {
    const startupError = new Error("startup failed");
    startMock.mockRejectedValueOnce(startupError);

    vi.spyOn(process, "on").mockImplementation(((event: string, _handler: () => void) => process) as typeof process.on);
    const processExit = vi.spyOn(process, "exit").mockImplementation(((code?: number) => code as never) as typeof process.exit);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await import("../src/index");
    await Promise.resolve();

    expect(consoleError).toHaveBeenCalledWith("Failed to start service:", startupError);
    expect(processExit).toHaveBeenCalledWith(1);
  });
});
