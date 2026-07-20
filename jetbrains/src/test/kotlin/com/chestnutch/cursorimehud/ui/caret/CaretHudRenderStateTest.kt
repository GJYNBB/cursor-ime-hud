package com.chestnutch.cursorimehud.ui.caret

import kotlin.test.Test
import kotlin.test.assertNotEquals

class CaretHudRenderStateTest {
  @Test
  fun positionChangesInvalidateRenderState() {
    val previous = CaretHudRenderState(
      editorIdentity = 1,
      label = "中",
      state = "cn",
      cnColor = "#FF5252",
      enColor = "#1E90FF",
      opacity = 0.78,
      x = 120,
      y = 24,
      width = 28,
      height = 20
    )

    assertNotEquals(previous, previous.copy(x = 112))
    assertNotEquals(previous, previous.copy(y = 40))
    assertNotEquals(previous, previous.copy(cnColor = "#AA0000"))
    assertNotEquals(previous, previous.copy(enColor = "#0055AA"))
  }
}
