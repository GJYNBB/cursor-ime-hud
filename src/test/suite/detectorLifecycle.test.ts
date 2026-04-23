import * as assert from "node:assert";
import { ImeDetector } from "../../detector/ImeDetector";
import { SampleOrNativeDetector } from "../../detector/SampleOrNativeDetector";
import { DetectorLogEntry, ImeSnapshot } from "../../model/types";
import * as vscode from "vscode";

class FailingNativeDetector implements ImeDetector {
  private readonly snapshotEmitter = new vscode.EventEmitter<ImeSnapshot>();
  private readonly logEmitter = new vscode.EventEmitter<DetectorLogEntry>();
  public startCalls = 0;

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
});
