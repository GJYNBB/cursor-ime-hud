package com.chestnutch.cursorimehud.service

import com.chestnutch.cursorimehud.model.ImeSnapshot
import com.chestnutch.cursorimehud.model.ImeState
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class HudDisplayStateResolverTest {
  @Test
  fun showsChineseDuringUnknownGracePeriod() {
    val stable = ImeSnapshot(ImeState.CN)
    val detected = ImeSnapshot(ImeState.UNKNOWN)

    val state = HudDisplayStateResolver.resolve(
      detectedSnapshot = detected,
      lastStableSnapshot = stable,
      unknownObservedAtMillis = 1_000,
      nowMillis = 1_499
    )

    assertEquals(stable, state.displaySnapshot)
    assertEquals(HudDisplayReason.GRACE_PERIOD, state.displayReason)
    assertEquals(1_500, state.graceExpiresAtMillis)
  }

  @Test
  fun showsEnglishDuringUnknownGracePeriod() {
    val stable = ImeSnapshot(ImeState.EN)
    val detected = ImeSnapshot(ImeState.UNKNOWN)

    val state = HudDisplayStateResolver.resolve(
      detectedSnapshot = detected,
      lastStableSnapshot = stable,
      unknownObservedAtMillis = 1_000,
      nowMillis = 1_499
    )

    assertEquals(stable, state.displaySnapshot)
    assertEquals(HudDisplayReason.GRACE_PERIOD, state.displayReason)
  }

  @Test
  fun stopsShowingStableStateAfterGracePeriod() {
    val stable = ImeSnapshot(ImeState.CN)
    val detected = ImeSnapshot(ImeState.UNKNOWN)

    val state = HudDisplayStateResolver.resolve(
      detectedSnapshot = detected,
      lastStableSnapshot = stable,
      unknownObservedAtMillis = 1_000,
      nowMillis = 1_500
    )

    assertEquals(detected, state.displaySnapshot)
    assertEquals(HudDisplayReason.UNKNOWN, state.displayReason)
    assertNull(state.graceExpiresAtMillis)
  }

  @Test
  fun unknownWithoutStableHistoryStaysUnknown() {
    val detected = ImeSnapshot(ImeState.UNKNOWN)

    val state = HudDisplayStateResolver.resolve(
      detectedSnapshot = detected,
      lastStableSnapshot = null,
      unknownObservedAtMillis = null,
      nowMillis = 1_000
    )

    assertEquals(detected, state.displaySnapshot)
    assertEquals(HudDisplayReason.UNKNOWN, state.displayReason)
  }

  @Test
  fun stableStateShowsDirectly() {
    val detected = ImeSnapshot(ImeState.EN)

    val state = HudDisplayStateResolver.resolve(
      detectedSnapshot = detected,
      lastStableSnapshot = ImeSnapshot(ImeState.CN),
      unknownObservedAtMillis = 1_000,
      nowMillis = 1_100
    )

    assertEquals(detected, state.displaySnapshot)
    assertEquals(HudDisplayReason.DIRECT, state.displayReason)
  }
}
