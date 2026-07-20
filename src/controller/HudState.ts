import { HudDisplayReason, ImeSnapshot } from "../model/types";

/**
 * How long the HUD keeps showing the last stable (non-unknown) state after
 * the detector briefly reports `unknown`. Bridges the transient IME-switch
 * flicker where the helper reports a momentary blank state while the
 * user is actively switching input methods.
 */
export const UNKNOWN_GRACE_PERIOD_MS = 500;

/**
 * Result of merging the freshest detector snapshot with the controller's
 * cached "last stable" snapshot. The controller reads `displaySnapshot`
 * for everything user-visible and uses `displayReason` for tooltips /
 * diagnostics.
 */
export interface HudDisplayState {
  /** The raw snapshot reported by the detector this tick. */
  detectedSnapshot: ImeSnapshot;
  /** The snapshot the HUD should actually present to the user. */
  displaySnapshot: ImeSnapshot;
  /** Why the HUD is showing `displaySnapshot` (and not `detectedSnapshot`). */
  displayReason: HudDisplayReason;
  /**
   * When the grace period (if any) ends. Absent unless
   * `displayReason === "grace-period"`.
   */
  graceExpiresAt?: number;
}

interface ResolveHudDisplayStateInput {
  detectedSnapshot: ImeSnapshot;
  lastStableSnapshot?: ImeSnapshot;
  unknownObservedAt?: number;
  now: number;
  gracePeriodMs?: number;
}

/**
 * Decide what the HUD should show. Three cases:
 *   - detector reports a real state (`cn` / `en`): show it directly,
 *     `displayReason = "direct"`.
 *   - detector is `unknown` but we have a recent stable snapshot inside
 *     the grace window: keep showing the stable snapshot,
 *     `displayReason = "grace-period"`, and record `graceExpiresAt` so
 *     the controller can re-render when the window closes.
 *   - otherwise: show `unknown`, `displayReason = "unknown"`.
 *
 * The function is pure (no side effects) so it is trivial to unit test.
 */
export function resolveHudDisplayState(input: ResolveHudDisplayStateInput): HudDisplayState {
  const gracePeriodMs = input.gracePeriodMs ?? UNKNOWN_GRACE_PERIOD_MS;
  const { detectedSnapshot, lastStableSnapshot, unknownObservedAt, now } = input;

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
    typeof unknownObservedAt === "number"
  ) {
    const graceExpiresAt = unknownObservedAt + gracePeriodMs;
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
