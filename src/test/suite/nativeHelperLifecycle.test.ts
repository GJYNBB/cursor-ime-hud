import * as assert from "node:assert";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { PassThrough } from "node:stream";
import { ChildProcessWithoutNullStreams } from "node:child_process";
import * as sinon from "sinon";
import {
  NativeHelperImeDetector,
  NATIVE_HELPER_FAILURE_WINDOW_MS,
  NATIVE_HELPER_MAX_RESTART_ATTEMPTS,
  NATIVE_HELPER_STABLE_RUN_MS
} from "../../detector/NativeHelperImeDetector";
import { PROTOCOL_VERSION } from "../../detector/helperProtocol";

class FakeHelperProcess {
  public readonly stdout = new PassThrough();
  public readonly stderr = new PassThrough();
  public readonly stdin = new PassThrough();
  public readonly stdinWrites: string[] = [];
  public readonly pid = 10_000;
  public killed = false;
  public exitCode: number | null = null;
  public signalCode: NodeJS.Signals | null = null;

  private readonly process = new (require("node:events").EventEmitter)();

  public constructor() {
    const write = this.stdin.write.bind(this.stdin);
    this.stdin.write = ((chunk: unknown, ...args: unknown[]) => {
      this.stdinWrites.push(Buffer.isBuffer(chunk) ? chunk.toString() : String(chunk));
      return write(chunk as never, ...(args as [never]));
    }) as typeof this.stdin.write;
  }

  public on(event: string, listener: (...args: never[]) => void): this {
    this.process.on(event, listener);
    return this;
  }

  public once(event: string, listener: (...args: never[]) => void): this {
    this.process.once(event, listener);
    return this;
  }

  public removeListener(event: string, listener: (...args: never[]) => void): this {
    this.process.removeListener(event, listener);
    return this;
  }

  public kill(): boolean {
    if (this.exitCode !== null || this.signalCode !== null) {
      return false;
    }

    this.killed = true;
    this.exitCode = 1;
    this.process.emit("exit", this.exitCode, null);
    return true;
  }

  public emitReady(state: "cn" | "en" = "cn"): void {
    this.stdout.write(
      `${JSON.stringify({
        type: "hello",
        version: PROTOCOL_VERSION,
        capabilities: ["state", "log"]
      })}\n`
    );
    this.stdout.write(
      `${JSON.stringify({
        type: "state",
        state,
        timestamp: new Date().toISOString(),
        reason: "test",
        confidence: 1,
        rawStateAvailable: true
      })}\n`
    );
  }

  public emitStdout(chunk: string): void {
    this.stdout.write(chunk);
  }

  public emitStderr(chunk: string): void {
    this.stderr.write(chunk);
  }

  public emitError(error = new Error("fake helper error")): void {
    this.process.emit("error", error);
  }

  public emitExit(code = 1): void {
    if (this.exitCode !== null || this.signalCode !== null) {
      return;
    }

    this.exitCode = code;
    this.process.emit("exit", code, null);
  }
}

function asChildProcess(process: FakeHelperProcess): ChildProcessWithoutNullStreams {
  return process as unknown as ChildProcessWithoutNullStreams;
}

interface TestFixture {
  helperPath: string;
  sha256Path: string;
  dispose(): void;
}

function createFixture(): TestFixture {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cursor-ime-hud-helper-"));
  const helperPath = path.join(directory, "helper");
  const sha256Path = `${helperPath}.sha256`;
  const contents = Buffer.from("test helper");
  fs.writeFileSync(helperPath, contents);
  fs.writeFileSync(sha256Path, `${crypto.createHash("sha256").update(contents).digest("hex")}\n`);

  return {
    helperPath,
    sha256Path,
    dispose: () => fs.rmSync(directory, { recursive: true, force: true })
  };
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

suite("NativeHelperImeDetector restart policy", () => {
  let clock: sinon.SinonFakeTimers;
  let fixture: TestFixture;

  setup(() => {
    clock = sinon.useFakeTimers({ now: 0 });
    fixture = createFixture();
  });

  teardown(() => {
    clock.restore();
    fixture.dispose();
  });

  function createDetector(processes: FakeHelperProcess[]): NativeHelperImeDetector {
    return new NativeHelperImeDetector(
      fixture.helperPath,
      "TestImeWatcher",
      "test",
      fixture.sha256Path,
      {
        now: () => clock.now,
        random: () => 0.5,
        spawn: () => {
          const process = new FakeHelperProcess();
          processes.push(process);
          return asChildProcess(process);
        }
      }
    );
  }

  test("keeps the failure budget until 30 seconds of stable runtime", async () => {
    const processes: FakeHelperProcess[] = [];
    const detector = createDetector(processes);
    const startPromise = detector.start();
    processes[0].emitReady();
    await startPromise;

    processes[0].emitExit();
    assert.equal(detector.getDebugInfo().restartAttempts, 1);
    assert.equal(detector.getDebugInfo().circuitOpen, false);

    await clock.tickAsync(1499);
    assert.equal(processes.length, 1, "backoff must delay the restart");
    await clock.tickAsync(1);
    await flushPromises();
    assert.equal(processes.length, 2, "first restart should start after the base delay");

    processes[1].emitReady();
    await flushPromises();
    assert.equal(detector.getDebugInfo().restartAttempts, 1);

    await clock.tickAsync(NATIVE_HELPER_STABLE_RUN_MS - 1);
    assert.equal(detector.getDebugInfo().restartAttempts, 1);
    await clock.tickAsync(1);
    assert.equal(detector.getDebugInfo().restartAttempts, 0);
    assert.equal(detector.getDebugInfo().circuitOpen, false);

    detector.dispose();
  });

  test("coalesces concurrent starts and treats a running helper as idempotent", async () => {
    const processes: FakeHelperProcess[] = [];
    const detector = createDetector(processes);
    const firstStart = detector.start();
    const secondStart = detector.start();

    // A second caller while startup is in flight must await the in-flight
    // operation, rather than spawning a duplicate helper process. `async`
    // methods may wrap the internal promise, so compare behavior instead of
    // promise object identity.
    assert.equal(processes.length, 1);
    processes[0].emitReady();
    await Promise.all([firstStart, secondStart]);

    await detector.start();
    assert.equal(processes.length, 1);
    detector.dispose();
  });

  test("rejects starts after disposal and ignores refresh after disposal", async () => {
    const detector = createDetector([]);
    detector.dispose();

    await assert.rejects(detector.start(), /检测器已释放/);
    detector.refresh();
    detector.dispose();
  });

  test("refreshes a running helper through stdin", async () => {
    const processes: FakeHelperProcess[] = [];
    const detector = createDetector(processes);
    const startPromise = detector.start();
    processes[0].emitReady();
    await startPromise;

    assert.equal(detector.getDebugInfo().lifecycleState, "running");
    assert.equal(processes[0].stdin.writable, true);
    detector.refresh();
    await flushPromises();
    assert.ok(processes[0].stdinWrites.some((chunk) => chunk.includes('"command":"refresh"')));

    detector.dispose();
  });

  test("uses exponential backoff and opens a circuit after repeated failures", async () => {
    const processes: FakeHelperProcess[] = [];
    const detector = createDetector(processes);
    const startPromise = detector.start();
    processes[0].emitReady();
    await startPromise;

    // The first crash is a runtime failure. Every subsequent attempt exits
    // before the first snapshot, which exercises the start() rejection path.
    processes[0].emitExit();
    for (let attempt = 1; attempt < NATIVE_HELPER_MAX_RESTART_ATTEMPTS; attempt += 1) {
      const expectedDelay = Math.min(30_000, 1500 * 2 ** (attempt - 1));
      await clock.tickAsync(expectedDelay);
      await flushPromises();
      assert.equal(processes.length, attempt + 1, `restart ${attempt} should be spawned`);
      processes[attempt].emitExit();
      await flushPromises();
    }

    const debugInfo = detector.getDebugInfo();
    assert.equal(debugInfo.restartAttempts, NATIVE_HELPER_MAX_RESTART_ATTEMPTS);
    assert.equal(debugInfo.circuitOpen, true);
    const processCountAtCircuitOpen = processes.length;
    await clock.tickAsync(NATIVE_HELPER_FAILURE_WINDOW_MS + 60_000);
    assert.equal(
      processes.length,
      processCountAtCircuitOpen,
      "an open circuit must not schedule background restarts"
    );

    detector.dispose();
  });

  test("manual refresh clears the circuit and starts a fresh helper", async () => {
    const processes: FakeHelperProcess[] = [];
    const detector = createDetector(processes);
    const startPromise = detector.start();
    processes[0].emitReady();
    await startPromise;
    processes[0].emitExit();

    for (let attempt = 1; attempt < NATIVE_HELPER_MAX_RESTART_ATTEMPTS; attempt += 1) {
      await clock.tickAsync(Math.min(30_000, 1500 * 2 ** (attempt - 1)));
      await flushPromises();
      processes[attempt].emitExit();
      await flushPromises();
    }

    assert.equal(detector.getDebugInfo().circuitOpen, true);
    await assert.rejects(detector.start(), /熔断/);
    detector.refresh();
    await flushPromises();
    assert.equal(processes.length, NATIVE_HELPER_MAX_RESTART_ATTEMPTS + 1);
    assert.equal(detector.getDebugInfo().restartAttempts, 0);
    assert.equal(detector.getDebugInfo().circuitOpen, false);

    processes.at(-1)?.emitReady();
    await flushPromises();
    detector.dispose();
  });

  test("reports missing helper and hash sidecars before spawning", async () => {
    const missing = new NativeHelperImeDetector(
      path.join(fixture.helperPath, "does-not-exist"),
      "TestImeWatcher",
      "test",
      path.join(fixture.helperPath, "missing.sha256"),
      { spawn: () => assert.fail("missing helper must not spawn") as never }
    );
    await assert.rejects(missing.start(), /IME helper not found/);
    assert.equal(missing.getDebugInfo().helperPathExists, false);
    missing.dispose();

    fs.rmSync(fixture.sha256Path);
    const missingHash = createDetector([]);
    await assert.rejects(missingHash.start(), /hash sidecar is missing/);
    assert.equal(missingHash.getDebugInfo().helperSha256PathExists, false);
    assert.equal(missingHash.getDebugInfo().helperHashStatus, "missing-sidecar");
    missingHash.dispose();
  });

  test("rejects malformed and mismatched hash sidecars", async () => {
    fs.writeFileSync(fixture.sha256Path, "not-a-sha256\n");
    const invalid = createDetector([]);
    await assert.rejects(invalid.start(), /hash sidecar is invalid/);
    assert.equal(invalid.getDebugInfo().helperHashStatus, "invalid-sidecar");
    invalid.dispose();

    fs.writeFileSync(fixture.sha256Path, `${"0".repeat(64)}\n`);
    const mismatch = createDetector([]);
    await assert.rejects(mismatch.start(), /SHA-256 mismatch/);
    assert.equal(mismatch.getDebugInfo().helperHashStatus, "mismatch");
    mismatch.dispose();
  });

  test("rejects a helper that does not send a valid hello", async () => {
    const processes: FakeHelperProcess[] = [];
    const detector = createDetector(processes);
    const startPromise = detector.start();
    processes[0].emitStdout('{"type":"state","state":"cn"}\n');
    await assert.rejects(startPromise, /hello/);
    assert.equal(detector.getDebugInfo().lifecycleState, "idle");
    detector.dispose();
  });

  test("rejects a helper with a protocol version mismatch", async () => {
    const processes: FakeHelperProcess[] = [];
    const detector = createDetector(processes);
    const startPromise = detector.start();
    processes[0].emitStdout(
      `${JSON.stringify({ type: "hello", version: 99, capabilities: [] })}\n`
    );
    await assert.rejects(startPromise, /expected=1 actual=99/);
    detector.dispose();
  });

  test("handles invalid snapshots and stderr logs after startup", async () => {
    const processes: FakeHelperProcess[] = [];
    const detector = createDetector(processes);
    const logs: string[] = [];
    detector.onDidLog((entry) => logs.push(entry.message));
    const startPromise = detector.start();
    processes[0].emitReady();
    await startPromise;

    processes[0].emitStdout('{"type":"state","state":"not-valid"}\n');
    processes[0].emitStderr("plain stderr line\n");
    assert.equal(detector.getDebugInfo().lifecycleState, "running");
    assert.ok(logs.length > 0);
    detector.dispose();
  });

  test("fails active helper on oversized protocol buffers", async () => {
    const processes: FakeHelperProcess[] = [];
    const detector = createDetector(processes);
    const startPromise = detector.start();
    processes[0].emitReady();
    await startPromise;

    processes[0].emitStdout(`${"x".repeat(1024 * 1024 + 1)}\n`);
    await flushPromises();
    assert.equal(detector.getDebugInfo().restartAttempts, 1);
    assert.equal(detector.getSnapshot().state, "unknown");
    detector.dispose();
  });

  test("times out when the helper never sends its first snapshot", async () => {
    const processes: FakeHelperProcess[] = [];
    const detector = createDetector(processes);
    const startPromise = detector.start();
    await clock.tickAsync(4000);
    await assert.rejects(startPromise, /startup timeout/);
    assert.equal(processes[0].killed, true);
    detector.dispose();
  });

  test("dispose cancels a pending restart timer", async () => {
    const processes: FakeHelperProcess[] = [];
    const detector = createDetector(processes);
    const startPromise = detector.start();
    processes[0].emitReady();
    await startPromise;
    processes[0].emitExit();
    assert.equal(detector.getDebugInfo().restartAttempts, 1);

    detector.dispose();
    await clock.tickAsync(NATIVE_HELPER_FAILURE_WINDOW_MS + NATIVE_HELPER_STABLE_RUN_MS);
    assert.equal(processes.length, 1);
  });
});
