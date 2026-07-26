package com.chestnutch.cursorimehud.ui

import com.chestnutch.cursorimehud.model.ImeState
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class ImeStatusBarTextTest {
  @Test
  fun stateLabelsComeFromTheDefaultBundle() {
    assertEquals("Chinese", ImeStatusBarText.stateLabel(ImeState.CN))
    assertEquals("English", ImeStatusBarText.stateLabel(ImeState.EN))
    assertEquals("Unknown", ImeStatusBarText.stateLabel(ImeState.UNKNOWN))
  }

  @Test
  fun tooltipIsCompact() {
    val tip = ImeStatusBarText.tooltip(
      state = ImeState.CN,
      imeName = "Microsoft Pinyin",
      circuitOpen = false,
      lastError = null
    )
    assertTrue(tip.startsWith("IME: Chinese · Microsoft Pinyin"))
    assertTrue(tip.contains("Click to open the menu"))
    assertFalse(tip.contains("Cursor IME HUD"))
    assertFalse(tip.contains("Current state:"))
    assertEquals(2, tip.lines().size)
  }

  @Test
  fun tooltipMentionsCircuitWhenOpen() {
    val tip = ImeStatusBarText.tooltip(
      state = ImeState.UNKNOWN,
      imeName = null,
      circuitOpen = true,
      lastError = "spawn failed"
    )
    assertTrue(tip.startsWith("IME: Unknown"))
    assertTrue(tip.contains("Auto-restart circuit is open"))
  }
}
