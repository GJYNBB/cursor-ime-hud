import * as assert from "node:assert";
import { resolveHudDisplayState, UNKNOWN_GRACE_PERIOD_MS } from "../../controller/HudState";
import { ImeSnapshot } from "../../model/types";

suite("HudState", () => {
  const stableSnapshot: ImeSnapshot = {
    type: "state",
    state: "cn",
    timestamp: "2026-04-23T00:00:00.000Z",
    source: "native-helper"
  };

  const unknownSnapshot: ImeSnapshot = {
    type: "state",
    state: "unknown",
    timestamp: "2026-04-23T00:00:00.500Z",
    source: "native-helper"
  };

  test("expires unknown grace exactly 500ms after the first unknown", () => {
    const unknownObservedAt = 1_000;

    const insideGrace = resolveHudDisplayState({
      detectedSnapshot: unknownSnapshot,
      lastStableSnapshot: stableSnapshot,
      unknownObservedAt,
      now: unknownObservedAt + UNKNOWN_GRACE_PERIOD_MS - 1
    });

    assert.equal(insideGrace.displaySnapshot, stableSnapshot);
    assert.equal(insideGrace.displayReason, "grace-period");
    assert.equal(insideGrace.graceExpiresAt, unknownObservedAt + UNKNOWN_GRACE_PERIOD_MS);

    const atBoundary = resolveHudDisplayState({
      detectedSnapshot: unknownSnapshot,
      lastStableSnapshot: stableSnapshot,
      unknownObservedAt,
      now: unknownObservedAt + UNKNOWN_GRACE_PERIOD_MS
    });

    assert.equal(atBoundary.displaySnapshot, unknownSnapshot);
    assert.equal(atBoundary.displayReason, "unknown");
  });
});
