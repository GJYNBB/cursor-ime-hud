package com.chestnutch.cursorimehud.service

import com.chestnutch.cursorimehud.model.ImeSnapshot
import com.chestnutch.cursorimehud.model.ImeState
import java.time.Instant

/**
 * Immutable snapshot-tracking state written by helper callbacks (any thread) and
 * read by the UI (EDT). Stored in an [java.util.concurrent.atomic.AtomicReference]
 * so a single `get()` always yields a consistent view of all three fields.
 */
data class SnapshotState(
  val latestSnapshot: ImeSnapshot,
  val lastStableSnapshot: ImeSnapshot?,
  val unknownObservedAtMillis: Long?
) {
  companion object {
    fun initial(): SnapshotState = SnapshotState(
      latestSnapshot = ImeSnapshot(
        state = ImeState.UNKNOWN,
        timestamp = Instant.EPOCH.toString(),
        reason = "service-idle",
        confidence = 0.0,
        rawStateAvailable = false
      ),
      lastStableSnapshot = null,
      unknownObservedAtMillis = null
    )

    /**
     * Pure state transition applied via `AtomicReference.updateAndGet` on the
     * callback thread: stable snapshots reset the unknown timer, and only the
     * first unknown after a stable snapshot records when unknown was observed.
     */
    fun advance(current: SnapshotState, snapshot: ImeSnapshot, nowMillis: Long): SnapshotState = when {
      snapshot.state != ImeState.UNKNOWN -> SnapshotState(
        latestSnapshot = snapshot,
        lastStableSnapshot = snapshot,
        unknownObservedAtMillis = null
      )
      current.latestSnapshot.state != ImeState.UNKNOWN -> SnapshotState(
        latestSnapshot = snapshot,
        lastStableSnapshot = current.lastStableSnapshot,
        unknownObservedAtMillis = nowMillis
      )
      else -> current.copy(latestSnapshot = snapshot)
    }
  }
}
