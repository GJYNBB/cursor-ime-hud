package com.chestnutch.cursorimehud.service

import com.chestnutch.cursorimehud.model.ImeSnapshot
import com.chestnutch.cursorimehud.model.ImeState

const val UNKNOWN_GRACE_PERIOD_MS: Long = 500

enum class HudDisplayReason {
  DIRECT,
  GRACE_PERIOD,
  UNKNOWN
}

data class HudDisplayState(
  val detectedSnapshot: ImeSnapshot,
  val displaySnapshot: ImeSnapshot,
  val displayReason: HudDisplayReason,
  val graceExpiresAtMillis: Long? = null
)

object HudDisplayStateResolver {
  fun resolve(
    detectedSnapshot: ImeSnapshot,
    lastStableSnapshot: ImeSnapshot?,
    unknownObservedAtMillis: Long?,
    nowMillis: Long,
    gracePeriodMs: Long = UNKNOWN_GRACE_PERIOD_MS
  ): HudDisplayState {
    if (detectedSnapshot.state != ImeState.UNKNOWN) {
      return HudDisplayState(
        detectedSnapshot = detectedSnapshot,
        displaySnapshot = detectedSnapshot,
        displayReason = HudDisplayReason.DIRECT
      )
    }

    if (lastStableSnapshot != null &&
      lastStableSnapshot.state != ImeState.UNKNOWN &&
      unknownObservedAtMillis != null
    ) {
      val graceExpiresAt = unknownObservedAtMillis + gracePeriodMs
      if (nowMillis < graceExpiresAt) {
        return HudDisplayState(
          detectedSnapshot = detectedSnapshot,
          displaySnapshot = lastStableSnapshot,
          displayReason = HudDisplayReason.GRACE_PERIOD,
          graceExpiresAtMillis = graceExpiresAt
        )
      }
    }

    return HudDisplayState(
      detectedSnapshot = detectedSnapshot,
      displaySnapshot = detectedSnapshot,
      displayReason = HudDisplayReason.UNKNOWN
    )
  }
}
