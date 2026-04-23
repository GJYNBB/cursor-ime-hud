import { HudDisplayReason, ImeSnapshot } from "../model/types";

export const UNKNOWN_GRACE_PERIOD_MS = 500;

export interface HudDisplayState {
  detectedSnapshot: ImeSnapshot;
  displaySnapshot: ImeSnapshot;
  displayReason: HudDisplayReason;
  graceExpiresAt?: number;
}

interface ResolveHudDisplayStateInput {
  detectedSnapshot: ImeSnapshot;
  lastStableSnapshot?: ImeSnapshot;
  lastStableObservedAt?: number;
  now: number;
  gracePeriodMs?: number;
}

export function resolveHudDisplayState(input: ResolveHudDisplayStateInput): HudDisplayState {
  const gracePeriodMs = input.gracePeriodMs ?? UNKNOWN_GRACE_PERIOD_MS;
  const { detectedSnapshot, lastStableSnapshot, lastStableObservedAt, now } = input;

  if (detectedSnapshot.state !== "unknown") {
    return {
      detectedSnapshot,
      displaySnapshot: detectedSnapshot,
      displayReason: "direct"
    };
  }

  if (
    lastStableSnapshot &&
    lastStableSnapshot.state !== "unknown" &&
    typeof lastStableObservedAt === "number"
  ) {
    const graceExpiresAt = lastStableObservedAt + gracePeriodMs;
    if (now < graceExpiresAt) {
      return {
        detectedSnapshot,
        displaySnapshot: lastStableSnapshot,
        displayReason: "grace-period",
        graceExpiresAt
      };
    }
  }

  return {
    detectedSnapshot,
    displaySnapshot: detectedSnapshot,
    displayReason: "unknown"
  };
}
