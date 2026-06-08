package com.chestnutch.cursorimehud.model

import kotlin.test.Test
import kotlin.test.assertEquals

class CursorImeHudLabelsTest {
  @Test
  fun resolvesBuiltInPresets() {
    assertEquals(CursorImeHudLabels("中", "英"), CursorImeHudLabels.fromSettings("zh-en", "x", "y"))
    assertEquals(CursorImeHudLabels("ZH", "EN"), CursorImeHudLabels.fromSettings("en-zh", "x", "y"))
  }

  @Test
  fun resolvesCustomPresetAndFallbacks() {
    assertEquals(CursorImeHudLabels("拼", "A"), CursorImeHudLabels.fromSettings("custom", "拼", "A"))
    assertEquals(CursorImeHudLabels("中", "英"), CursorImeHudLabels.fromSettings("custom", "", ""))
  }

  @Test
  fun unknownPresetFallsBackToChineseLabels() {
    assertEquals(CursorImeHudLabels("中", "英"), CursorImeHudLabels.fromSettings("unknown", "x", "y"))
  }
}
