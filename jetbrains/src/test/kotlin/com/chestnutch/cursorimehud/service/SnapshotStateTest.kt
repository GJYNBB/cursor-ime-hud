package com.chestnutch.cursorimehud.service

import com.chestnutch.cursorimehud.model.ImeSnapshot
import com.chestnutch.cursorimehud.model.ImeState
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class SnapshotStateTest {
  @Test
  fun initialStateIsUnknownWithoutStableSnapshot() {
    val state = SnapshotState.initial()

    assertEquals(ImeState.UNKNOWN, state.latestSnapshot.state)
    assertEquals("service-idle", state.latestSnapshot.reason)
    assertNull(state.lastStableSnapshot)
    assertNull(state.unknownObservedAtMillis)
  }

  @Test
  fun stableSnapshotBecomesLatestAndStableAndClearsUnknownTimer() {
    val previous = SnapshotState(
      latestSnapshot = snapshot(ImeState.UNKNOWN),
      lastStableSnapshot = snapshot(ImeState.EN),
      unknownObservedAtMillis = 500L
    )
    val stable = snapshot(ImeState.CN)

    val next = SnapshotState.advance(previous, stable, nowMillis = 1_000L)

    assertEquals(stable, next.latestSnapshot)
    assertEquals(stable, next.lastStableSnapshot)
    assertNull(next.unknownObservedAtMillis)
  }

  @Test
  fun firstUnknownAfterStableRecordsObservationTimeAndKeepsStable() {
    val stable = snapshot(ImeState.CN)
    val previous = SnapshotState(
      latestSnapshot = stable,
      lastStableSnapshot = stable,
      unknownObservedAtMillis = null
    )
    val unknown = snapshot(ImeState.UNKNOWN)

    val next = SnapshotState.advance(previous, unknown, nowMillis = 2_000L)

    assertEquals(unknown, next.latestSnapshot)
    assertEquals(stable, next.lastStableSnapshot)
    assertEquals(2_000L, next.unknownObservedAtMillis)
  }

  @Test
  fun repeatedUnknownPreservesOriginalObservationTime() {
    val stable = snapshot(ImeState.EN)
    val previous = SnapshotState(
      latestSnapshot = snapshot(ImeState.UNKNOWN),
      lastStableSnapshot = stable,
      unknownObservedAtMillis = 2_000L
    )
    val unknown = snapshot(ImeState.UNKNOWN, reason = "still-unknown")

    val next = SnapshotState.advance(previous, unknown, nowMillis = 3_000L)

    assertEquals(unknown, next.latestSnapshot)
    assertEquals(stable, next.lastStableSnapshot)
    assertEquals(2_000L, next.unknownObservedAtMillis)
  }

  @Test
  fun unknownFromInitialStateKeepsTimerUnsetUntilStableSeen() {
    val next = SnapshotState.advance(SnapshotState.initial(), snapshot(ImeState.UNKNOWN), nowMillis = 4_000L)

    assertNull(next.lastStableSnapshot)
    assertNull(next.unknownObservedAtMillis)
  }

  private fun snapshot(state: ImeState, reason: String? = null): ImeSnapshot = ImeSnapshot(
    state = state,
    timestamp = "2026-01-01T00:00:00Z",
    reason = reason,
    confidence = 1.0,
    rawStateAvailable = true
  )
}
