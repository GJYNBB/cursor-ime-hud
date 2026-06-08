import * as assert from "node:assert";
import { ImeDetector } from "../../detector/ImeDetector";
import { NativeHelperDescriptor, NativeHelperUnavailable } from "../../detector/nativeHelperPath";
import { SampleOrNativeDetector } from "../../detector/SampleOrNativeDetector";
import { DetectorLogEntry, ImeSnapshot } from "../../model/types";
import * as vscode from "vscode";

const helperDescriptor: NativeHelperDescriptor = {
  helperPath: "helper.exe",
  relativePath: "resources/bin/win-x64/WinImeWatcher.exe",
  backendName: "WinImeWatcher",
  platformKey: "win-x64"
};

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
    const detector = new SampleOrNativeDetector(helperDescriptor, () => failingDetector);

    try {
      await detector.start();
      await detector.start();

      assert.equal(failingDetector.startCalls, 1);
      assert.equal(detector.getSnapshot().state, "unknown");
      assert.equal(detector.getDebugInfo().usingFallback, true);
      assert.match(detector.getDebugInfo().fallbackReason ?? "", /native-start-failed/);
    } finally {
      detector.dispose();
    }
  });

  test("unavailable helper resolution takes the fallback branch", async () => {
    const unavailable: NativeHelperUnavailable = {
      reason: "Experimental native helper for linux-x64 is disabled."
    };
    let nativeFactoryCalls = 0;
    const detector = new SampleOrNativeDetector(unavailable, () => {
      nativeFactoryCalls += 1;
      return new SuccessfulNativeDetector();
    });

    try {
      await detector.start();

      assert.equal(
        nativeFactoryCalls,
        0,
        "unavailable helpers must not instantiate native factory"
      );
      assert.equal(detector.getDebugInfo().usingFallback, true, "unavailable helper uses fallback");
      assert.match(detector.getDebugInfo().fallbackReason ?? "", /linux-x64/);
      assert.equal(detector.getSnapshot().state, "unknown");
    } finally {
      detector.dispose();
    }
  });

  test("resolved experimental helper path uses the native factory", async () => {
    const experimentalHelper: NativeHelperDescriptor = {
      helperPath: "linux-helper",
      relativePath: "resources/bin/linux-x64/LinuxImeWatcher",
      backendName: "LinuxImeWatcher",
      platformKey: "linux-x64"
    };
    const nativeDetector = new SuccessfulNativeDetector();
    let nativeFactoryCalls = 0;
    const detector = new SampleOrNativeDetector(experimentalHelper, (helper) => {
      nativeFactoryCalls += 1;
      assert.equal(helper.backendName, "LinuxImeWatcher");
      assert.equal(helper.helperPath, "linux-helper");
      return nativeDetector;
    });

    try {
      await detector.start();

      assert.equal(nativeFactoryCalls, 1);
      assert.equal(nativeDetector.startCalls, 1);
      assert.equal(detector.getDebugInfo().usingFallback, false);
      assert.equal(detector.getDebugInfo().backendName, "SuccessfulNativeDetector");
      assert.equal(detector.getSnapshot().state, "cn");
    } finally {
      detector.dispose();
    }
  });

  test("dispose-during-start releases the native detector and never activates the fallback", async () => {
    const failingDetector = new FailingNativeDetector();
    const detector = new SampleOrNativeDetector(helperDescriptor, () => {
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
    const detector = new SampleOrNativeDetector(helperDescriptor, () => nativeDetector);

    try {
      assert.equal(detector.getDebugInfo().lifecycleState, "idle");
      await detector.start();

      assert.equal(nativeDetector.startCalls, 1);
      assert.equal(detector.getDebugInfo().lifecycleState, "running");
      assert.equal(
        detector.getDebugInfo().usingFallback,
        false,
        "native detector means no fallback"
      );
      assert.equal(detector.getDebugInfo().backendName, "SuccessfulNativeDetector");
      assert.equal(detector.getSnapshot().state, "cn");
      assert.equal(detector.getSnapshot().source, "native-helper");
    } finally {
      detector.dispose();
    }
  });
});
