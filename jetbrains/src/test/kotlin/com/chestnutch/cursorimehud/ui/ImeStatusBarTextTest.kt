package com.chestnutch.cursorimehud.ui

import com.chestnutch.cursorimehud.model.ImeState
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class ImeStatusBarTextTest {
  @Test
  fun stateLabelsAreChinese() {
    assertEquals("中文", ImeStatusBarText.stateLabel(ImeState.CN))
    assertEquals("英文", ImeStatusBarText.stateLabel(ImeState.EN))
    assertEquals("未知", ImeStatusBarText.stateLabel(ImeState.UNKNOWN))
  }

  @Test
  fun tooltipIsCompactAndChinese() {
    val tip = ImeStatusBarText.tooltip(
      state = ImeState.CN,
      imeName = "Microsoft Pinyin",
      circuitOpen = false,
      lastError = null
    )
    assertTrue(tip.startsWith("输入法：中文 · Microsoft Pinyin"))
    assertTrue(tip.contains("点击打开菜单"))
    assertFalse(tip.contains("Cursor IME HUD"))
    assertFalse(tip.contains("\n状态："))
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
    assertTrue(tip.startsWith("输入法：未知"))
    assertTrue(tip.contains("熔断已开启"))
  }
}
