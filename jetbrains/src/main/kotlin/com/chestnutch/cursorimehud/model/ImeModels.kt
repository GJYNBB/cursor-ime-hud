package com.chestnutch.cursorimehud.model

import java.time.Instant

enum class ImeState(val wireValue: String) {
  CN("cn"),
  EN("en"),
  UNKNOWN("unknown");

  companion object {
    fun fromWire(value: String?): ImeState? = entries.firstOrNull { it.wireValue == value }
  }
}

data class HelloMessage(
  val version: Int,
  val capabilities: List<String>
)

data class ImeSnapshot(
  val state: ImeState,
  val timestamp: String = Instant.now().toString(),
  val imeName: String? = null,
  val isOpen: Boolean? = null,
  val layoutHex: String? = null,
  val threadId: Long? = null,
  val hwnd: String? = null,
  val reason: String? = null,
  val confidence: Double? = null,
  val rawStateAvailable: Boolean? = null,
  val source: String = "native-helper"
) {
  fun displayLabel(settings: CursorImeHudLabels): String = when (state) {
    ImeState.CN -> settings.cnLabel
    ImeState.EN -> settings.enLabel
    ImeState.UNKNOWN -> "?"
  }
}

data class DetectorLogEntry(
  val level: String = "info",
  val message: String,
  val timestamp: String = Instant.now().toString(),
  val source: String = "native-helper",
  val details: String? = null
)

enum class CursorImeHudLabelPreset(val id: String, val displayName: String) {
  ZH_EN("zh-en", "中 / 英"),
  EN_ZH("en-zh", "ZH / EN");

  override fun toString(): String = displayName

  companion object {
    fun fromId(id: String?): CursorImeHudLabelPreset = entries.firstOrNull { it.id == id } ?: ZH_EN
  }
}

data class CursorImeHudLabels(
  val cnLabel: String = "中",
  val enLabel: String = "英"
) {
  companion object {
    fun fromSettings(labelPreset: String?): CursorImeHudLabels = when (CursorImeHudLabelPreset.fromId(labelPreset)) {
      CursorImeHudLabelPreset.EN_ZH -> CursorImeHudLabels("ZH", "EN")
      CursorImeHudLabelPreset.ZH_EN -> CursorImeHudLabels("中", "英")
    }
  }
}

enum class HelperLifecycleState {
  IDLE,
  STARTING,
  RUNNING,
  STOPPING,
  DISPOSED,
  UNAVAILABLE,
  FAILED
}

data class HelperDebugInfo(
  val lifecycleState: HelperLifecycleState,
  val helperPath: String? = null,
  val expectedSha256: String? = null,
  val actualSha256: String? = null,
  val hashMatches: Boolean? = null,
  /** Number of automatic restart failures retained in the five-minute window. */
  val restartCount: Int = 0,
  /** True when automatic retries stopped and an explicit refresh is required. */
  val circuitOpen: Boolean = false,
  val manualRefreshRequired: Boolean = false,
  val lastError: String? = null,
  val osGate: String
)
