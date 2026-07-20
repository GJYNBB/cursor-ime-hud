package com.chestnutch.cursorimehud.model

import kotlin.test.Test
import kotlin.test.assertEquals

class CursorImeHudLabelsTest {
  @Test
  fun resolvesBuiltInPresets() {
    assertEquals(CursorImeHudLabels("中", "英"), CursorImeHudLabels.fromSettings("zh-en"))
    assertEquals(CursorImeHudLabels("ZH", "EN"), CursorImeHudLabels.fromSettings("en-zh"))
  }

  @Test
  fun unknownOrLegacyPresetFallsBackToChineseLabels() {
    assertEquals(CursorImeHudLabels("中", "英"), CursorImeHudLabels.fromSettings("unknown"))
    assertEquals(CursorImeHudLabels("中", "英"), CursorImeHudLabels.fromSettings("custom"))
    assertEquals(CursorImeHudLabels("中", "英"), CursorImeHudLabels.fromSettings(null))
  }
}
