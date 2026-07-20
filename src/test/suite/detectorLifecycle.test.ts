import * as assert from "node:assert";
import { ImeDetector } from "../../detector/ImeDetector";
import {
  isPermanentNativeStartFailure,
  SampleOrNativeDetector
} from "../../detector/SampleOrNativeDetector";
import { NativeHelperDescriptor, NativeHelperResolution } from "../../detector/nativeHelperPath";
import { DetectorLogEntry, ImeSnapshot } from "../../model/types";
import * as vscode from "vscode";

const helperDescriptor: NativeHelperDescriptor = {
  helperPath: "helper.exe",
  relativePath: "resources/bin/win32-x64/ImeWatcher.exe",
  backendName: "ime-watcher",
  platformKey: "win-x64",
  sha256Path: "helper.exe.sha256",
  sha256RelativePath: "resources/bin/win32-x64/ImeWatcher.exe.sha256"
};

class FailingNativeDetector implements ImeDetector {
  private readonly snapshotEmitter = new vscode.EventEmitter<ImeSnapshot>();
  private readonly logEmitter = new vscode.EventEmitter<DetectorLogEntry>();
  public startCalls = 0;
  public disposeCalls = 0;

  public constructor(private readonly startError = "native-start-failed") {}

  public readonly onDidChangeSnapshot = this.snapshotEmitter.event;
  public readonly onDidLog = this.logEmitter.event;

  public async start(): Promise<void> {
    this.startCalls += 1;
    throw new Error(this.startError);
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
  public refreshCalls = 0;
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
    this.refreshCalls += 1;
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

async function waitFor(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error("waitFor timed out");
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

class MutableLifecycleNativeDetector implements ImeDetector {
  private readonly snapshotEmitter = new vscode.EventEmitter<ImeSnapshot>();
  private readonly logEmitter = new vscode.EventEmitter<DetectorLogEntry>();
  public lifecycleState = "idle";

  public readonly onDidChangeSnapshot = this.snapshotEmitter.event;
  public readonly onDidLog = this.logEmitter.event;

  public async start(): Promise<void> {
    this.lifecycleState = "running";
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
      backendName: "MutableLifecycleNativeDetector",
      helperPath: "helper.exe",
      usingFallback: false,
      lifecycleState: this.lifecycleState,
      restartAttempts: this.lifecycleState === "idle" ? 2 : 0,
      circuitOpen: this.lifecycleState === "idle"
    };
  }

  public dispose(): void {
    this.lifecycleState = "disposed";
    this.snapshotEmitter.dispose();
    this.logEmitter.dispose();
  }
}

suite("SampleOrNativeDetector", () => {
  test("classifies permanent integrity failures", () => {
    assert.equal(
      isPermanentNativeStartFailure("IME helper not found"),
      true,
      "missing binary is permanent"
    );
    assert.equal(
      isPermanentNativeStartFailure("IME helper hash sidecar is missing"),
      true,
      "missing hash is permanent"
    );
    assert.equal(
      isPermanentNativeStartFailure("IME helper hash sidecar is invalid"),
      true,
      "invalid hash is permanent"
    );
    assert.equal(
      isPermanentNativeStartFailure("IME helper SHA-256 mismatch"),
      true,
      "hash mismatch is permanent"
    );
    assert.equal(isPermanentNativeStartFailure("startup timeout"), false, "timeouts are temporary");
    assert.equal(
      isPermanentNativeStartFailure("spawn failed"),
      false,
      "spawn failures are temporary"
    );
    assert.equal(
      isPermanentNativeStartFailure("native-start-failed"),
      false,
      "generic start failures are temporary"
    );
  });

  test("temporary native start failure falls back once but marks recoverable", async () => {
    const failingDetector = new FailingNativeDetector();
    const detector = new SampleOrNativeDetector(helperDescriptor, () => failingDetector);

    try {
      await detector.start();
      await detector.start();

      assert.equal(failingDetector.startCalls, 1, "start() does not recreate native while running");
      assert.equal(detector.getSnapshot().state, "unknown");
      assert.equal(detector.getDebugInfo().usingFallback, true);
      assert.equal(detector.getDebugInfo().fallbackRecoverable, true);
      assert.match(detector.getDebugInfo().fallbackReason ?? "", /native-start-failed/);
    } finally {
      detector.dispose();
    }
  });

  test("refresh after temporary failure recreates the native detector", async () => {
    let factoryCalls = 0;
    const detector = new SampleOrNativeDetector(helperDescriptor, () => {
      factoryCalls += 1;
      if (factoryCalls === 1) {
        return new FailingNativeDetector("startup timeout");
      }
      return new SuccessfulNativeDetector();
    });

    try {
      await detector.start();
      assert.equal(detector.getDebugInfo().usingFallback, true);
      assert.equal(detector.getDebugInfo().fallbackRecoverable, true);
      assert.equal(factoryCalls, 1);

      detector.refresh();
      await waitFor(
        () =>
          factoryCalls === 2 &&
          detector.getDebugInfo().usingFallback === false &&
          detector.getDebugInfo().lifecycleState === "running"
      );

      assert.equal(factoryCalls, 2, "refresh must recreate native after a temporary failure");
      assert.equal(detector.getDebugInfo().usingFallback, false);
      assert.equal(detector.getDebugInfo().fallbackRecoverable, undefined);
      assert.equal(detector.getSnapshot().state, "cn");
      assert.equal(detector.getSnapshot().source, "native-helper");
      assert.equal(detector.getDebugInfo().lifecycleState, "running");
    } finally {
      detector.dispose();
    }
  });

  test("hash verification failures stay permanent and refresh does not recreate native", async () => {
    let factoryCalls = 0;
    const failingDetector = new FailingNativeDetector("IME helper SHA-256 mismatch.");
    const detector = new SampleOrNativeDetector(helperDescriptor, () => {
      factoryCalls += 1;
      return failingDetector;
    });

    try {
      await detector.start();

      assert.equal(detector.getDebugInfo().usingFallback, true);
      assert.equal(detector.getDebugInfo().fallbackRecoverable, false);
      assert.match(detector.getDebugInfo().fallbackReason ?? "", /哈希校验失败/);
      assert.match(detector.getDebugInfo().fallbackReason ?? "", /win-x64/);
      assert.equal(factoryCalls, 1);

      detector.refresh();
      await new Promise((resolve) => setTimeout(resolve, 30));

      assert.equal(factoryCalls, 1, "permanent hash failures must not recreate native on refresh");
      assert.equal(detector.getDebugInfo().usingFallback, true);
      assert.equal(detector.getDebugInfo().fallbackRecoverable, false);
    } finally {
      detector.dispose();
    }
  });

  test("missing helper file is a permanent fallback", async () => {
    let factoryCalls = 0;
    const detector = new SampleOrNativeDetector(helperDescriptor, () => {
      factoryCalls += 1;
      return new FailingNativeDetector("IME helper not found");
    });

    try {
      await detector.start();
      assert.equal(detector.getDebugInfo().fallbackRecoverable, false);

      detector.refresh();
      await new Promise((resolve) => setTimeout(resolve, 30));
      assert.equal(factoryCalls, 1);
    } finally {
      detector.dispose();
    }
  });

  test("unavailable helper resolution always takes the permanent fallback branch", async () => {
    const unavailable: NativeHelperResolution = {
      reason: "当前平台没有可用的原生输入法辅助程序：test-platform/test-arch。"
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
        "unavailable helpers must never instantiate the native factory"
      );
      assert.equal(detector.getDebugInfo().usingFallback, true, "unavailable helpers use fallback");
      assert.equal(detector.getDebugInfo().fallbackRecoverable, false);
      assert.equal(detector.getSnapshot().state, "unknown");
      assert.match(detector.getDebugInfo().fallbackReason ?? "", /test-platform/);

      detector.refresh();
      await new Promise((resolve) => setTimeout(resolve, 30));
      assert.equal(nativeFactoryCalls, 0, "refresh must not invent a native helper");
    } finally {
      detector.dispose();
    }
  });

  test("dispose-during-start releases the native detector and never activates the fallback", async () => {
    const failingDetector = new FailingNativeDetector();
    const detector = new SampleOrNativeDetector(helperDescriptor, () => failingDetector);

    const startPromise = detector.start();
    detector.dispose();
    await startPromise;

    assert.equal(detector.getDebugInfo().wrapperLifecycleState, "disposed");
    assert.equal(detector.getDebugInfo().lifecycleState, "disposed");
  });

  test("wrapper lifecycle does not overwrite the active helper lifecycle", async () => {
    const nativeDetector = new MutableLifecycleNativeDetector();
    const detector = new SampleOrNativeDetector(helperDescriptor, () => nativeDetector);

    try {
      await detector.start();
      assert.equal(detector.getDebugInfo().lifecycleState, "running");
      assert.equal(detector.getDebugInfo().wrapperLifecycleState, "running");

      // Simulate native helper restarting/idle while the wrapper stays running.
      nativeDetector.lifecycleState = "idle";
      const debug = detector.getDebugInfo();
      assert.equal(debug.lifecycleState, "idle", "helper lifecycle must remain visible");
      assert.equal(
        debug.wrapperLifecycleState,
        "running",
        "wrapper stays running after first start"
      );
      assert.equal(debug.restartAttempts, 2);
      assert.equal(debug.circuitOpen, true);
    } finally {
      detector.dispose();
    }
  });

  test("successful native start transitions the wrapper to running with the native snapshot", async () => {
    const nativeDetector = new SuccessfulNativeDetector();
    const detector = new SampleOrNativeDetector(helperDescriptor, () => nativeDetector);

    try {
      assert.equal(detector.getDebugInfo().lifecycleState, "idle");
      assert.equal(detector.getDebugInfo().wrapperLifecycleState, "idle");
      await detector.start();

      assert.equal(nativeDetector.startCalls, 1);
      assert.equal(detector.getDebugInfo().lifecycleState, "running");
      assert.equal(detector.getDebugInfo().wrapperLifecycleState, "running");
      assert.equal(
        detector.getDebugInfo().usingFallback,
        false,
        "native detector means no fallback"
      );
      assert.equal(detector.getDebugInfo().fallbackRecoverable, undefined);
      assert.equal(detector.getDebugInfo().backendName, "SuccessfulNativeDetector");
      assert.equal(detector.getSnapshot().state, "cn");
      assert.equal(detector.getSnapshot().source, "native-helper");

      detector.refresh();
      assert.equal(
        nativeDetector.refreshCalls,
        1,
        "successful native path still forwards refresh to the active detector"
      );
    } finally {
      detector.dispose();
    }
  });

  test("temporary failure that remains temporary stays recoverable after refresh", async () => {
    let factoryCalls = 0;
    const detector = new SampleOrNativeDetector(helperDescriptor, () => {
      factoryCalls += 1;
      return new FailingNativeDetector("spawn failed");
    });

    try {
      await detector.start();
      assert.equal(detector.getDebugInfo().fallbackRecoverable, true);

      detector.refresh();
      await waitFor(
        () =>
          factoryCalls === 2 &&
          detector.getDebugInfo().usingFallback === true &&
          detector.getDebugInfo().fallbackRecoverable === true &&
          detector.getDebugInfo().lifecycleState === "running"
      );

      assert.equal(detector.getDebugInfo().usingFallback, true);
      assert.equal(detector.getDebugInfo().fallbackRecoverable, true);
      assert.equal(factoryCalls, 2);
    } finally {
      detector.dispose();
    }
  });
});
