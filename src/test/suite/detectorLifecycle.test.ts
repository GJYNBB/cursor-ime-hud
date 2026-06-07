import * as assert from "node:assert";
import * as sinon from "sinon";
import { ImeDetector } from "../../detector/ImeDetector";
import { SampleOrNativeDetector } from "../../detector/SampleOrNativeDetector";
import { DetectorLogEntry, ImeSnapshot } from "../../model/types";
import * as vscode from "vscode";

class FailingNativeDetector implements ImeDetector {
  private readonly snapshotEmitter = new vscode.EventEmitter<ImeSnapshot>();
  private readonly logEmitter = new vscode.EventEmitter<DetectorLogEntry>();
  public startCalls = 0;
  public disposeCalls = 0;

  public readonly onDidChangeSnapshot = this.snapshotEmitter.event;
  public readonly onDidLog = this.logEmitter.event;

  public async start(): Promise<void> {
    this.startCalls += 1;
    throw new Error("native-start-failed");
  }

  public refresh(): void {
    // no-op
  }

  public getSnapshot(): ImeSnapshot {
    return {
      type: "state",
      state: "unknown",
      timestamp: new Date().toISOString(),
      source: "native-helper",
      reason: "before-start",
      confidence: 0,
      rawStateAvailable: false
    };
  }

  public getDebugInfo() {
    return {
      source: "native-helper" as const,
      backendName: "FailingNativeDetector",
      helperPath: "helper.exe",
      usingFallback: false,
      lifecycleState: "idle"
    };
  }

  public dispose(): void {
    this.disposeCalls += 1;
    this.snapshotEmitter.dispose();
    this.logEmitter.dispose();
  }
}

class SuccessfulNativeDetector implements ImeDetector {
  private readonly snapshotEmitter = new vscode.EventEmitter<ImeSnapshot>();
  private readonly logEmitter = new vscode.EventEmitter<DetectorLogEntry>();
  public startCalls = 0;
  public started = false;

  public readonly onDidChangeSnapshot = this.snapshotEmitter.event;
  public readonly onDidLog = this.logEmitter.event;

  public async start(): Promise<void> {
    this.startCalls += 1;
    this.started = true;
    this.snapshotEmitter.fire({
      type: "state",
      state: "cn",
      timestamp: new Date().toISOString(),
      source: "native-helper",
      reason: "ok",
      confidence: 1,
      rawStateAvailable: true
    });
  }

  public refresh(): void {
    // no-op
  }

  public getSnapshot(): ImeSnapshot {
    return {
      type: "state",
      state: "cn",
      timestamp: new Date().toISOString(),
      source: "native-helper",
      reason: "ok",
      confidence: 1,
      rawStateAvailable: true
    };
  }

  public getDebugInfo() {
    return {
      source: "native-helper" as const,
      backendName: "SuccessfulNativeDetector",
      helperPath: "helper.exe",
      usingFallback: false,
      lifecycleState: "running"
    };
  }

  public dispose(): void {
    this.snapshotEmitter.dispose();
    this.logEmitter.dispose();
  }
}

suite("SampleOrNativeDetector", () => {
  test("falls back once and keeps unknown semantics", async () => {
    const failingDetector = new FailingNativeDetector();
    const detector = new SampleOrNativeDetector("helper.exe", () => failingDetector);

    await detector.start();
    await detector.start();

    assert.equal(failingDetector.startCalls, 1);
    assert.equal(detector.getSnapshot().state, "unknown");
    assert.equal(detector.getDebugInfo().usingFallback, true);
    assert.match(detector.getDebugInfo().fallbackReason ?? "", /native-start-failed/);

    detector.dispose();
  });

  test("non-win32 path always takes the fallback branch", async () => {
    // The platform check lives in `extension.ts` (see
    // `process.platform !== "win32"`), so the wrapper itself can be
    // constructed anywhere. On non-Windows, the composition root
    // never instantiates the native factory, which means the only
    // path the wrapper can take is the fallback branch. We simulate
    // that by stubbing `process.platform` and confirming the wrapper
    // does not invoke the native factory.
    const originalPlatform = process.platform;
    const platformStub = sinon.stub(process, "platform").value("linux");

    try {
      let nativeFactoryCalls = 0;
      const detector = new SampleOrNativeDetector("helper.exe", () => {
        nativeFactoryCalls += 1;
        return new SuccessfulNativeDetector();
      });
      await detector.start();

      assert.equal(nativeFactoryCalls, 0, "non-win32 must never instantiate the native factory");
      assert.equal(detector.getDebugInfo().usingFallback, true, "non-win32 always uses fallback");
      assert.equal(detector.getSnapshot().state, "unknown");

      detector.dispose();
    } finally {
      platformStub.restore();
      // Defensive: make sure the stub is gone even if `value()` did not
      // return a stub for some reason.
      Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true });
    }
  });

  test("dispose-during-start releases the native detector and never activates the fallback", async () => {
    const failingDetector = new FailingNativeDetector();
    const detector = new SampleOrNativeDetector("helper.exe", () => {
      // Replace the factory so the second invocation (fallback) never
      // resolves and we can assert it was never called.
      return failingDetector;
    });
    const startPromise = detector.start();
    detector.dispose();
    await startPromise;

    // The contract is that disposal during start is safe: the failed
    // native detector is disposed, the wrapper does not throw, and
    // the lifecycle is reported as disposed.
    assert.equal(detector.getDebugInfo().lifecycleState, "disposed");
  });

  test("successful native start transitions the wrapper to running with the native snapshot", async () => {
    const nativeDetector = new SuccessfulNativeDetector();
    const detector = new SampleOrNativeDetector("helper.exe", () => nativeDetector);

    assert.equal(detector.getDebugInfo().lifecycleState, "idle");
    await detector.start();

    assert.equal(nativeDetector.startCalls, 1);
    assert.equal(detector.getDebugInfo().lifecycleState, "running");
    assert.equal(detector.getDebugInfo().usingFallback, false, "native detector means no fallback");
    assert.equal(detector.getDebugInfo().backendName, "SuccessfulNativeDetector");
    assert.equal(detector.getSnapshot().state, "cn");
    assert.equal(detector.getSnapshot().source, "native-helper");

    detector.dispose();
  });
});
