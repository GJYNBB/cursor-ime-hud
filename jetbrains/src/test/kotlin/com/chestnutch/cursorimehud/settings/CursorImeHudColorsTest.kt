package com.chestnutch.cursorimehud.settings

import kotlin.test.Test
import kotlin.test.assertEquals

class CursorImeHudColorsTest {
  @Test
  fun normalizesValidHexColors() {
    assertEquals("#FF5252", CursorImeHudColors.normalizeHex("#ff5252", CursorImeHudColors.DEFAULT_CN_COLOR))
    assertEquals("#1E90FF", CursorImeHudColors.normalizeHex("  #1e90ff  ", CursorImeHudColors.DEFAULT_EN_COLOR))
  }

  @Test
  fun fallsBackForInvalidColors() {
    assertEquals(CursorImeHudColors.DEFAULT_CN_COLOR, CursorImeHudColors.normalizeHex("red", CursorImeHudColors.DEFAULT_CN_COLOR))
    assertEquals(CursorImeHudColors.DEFAULT_EN_COLOR, CursorImeHudColors.normalizeHex("#12", CursorImeHudColors.DEFAULT_EN_COLOR))
    assertEquals(CursorImeHudColors.DEFAULT_EN_COLOR, CursorImeHudColors.normalizeHex("", CursorImeHudColors.DEFAULT_EN_COLOR))
  }

  @Test
  fun convertsHexToAwtColor() {
    val red = CursorImeHudColors.toColor("#FF5252", CursorImeHudColors.DEFAULT_CN_COLOR)
    val blue = CursorImeHudColors.toColor("#1E90FF", CursorImeHudColors.DEFAULT_EN_COLOR)

    assertEquals(255, red.red)
    assertEquals(82, red.green)
    assertEquals(82, red.blue)
    assertEquals(30, blue.red)
    assertEquals(144, blue.green)
    assertEquals(255, blue.blue)
  }
}
