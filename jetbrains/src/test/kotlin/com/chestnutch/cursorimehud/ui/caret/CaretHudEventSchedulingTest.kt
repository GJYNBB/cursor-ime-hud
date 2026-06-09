package com.chestnutch.cursorimehud.ui.caret

import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class CaretHudEventSchedulingTest {
  @Test
  fun editorEventsRenderOnlyWhenCaretHudIsEnabled() {
    assertTrue(CaretHudEventScheduling.shouldScheduleEditorRender(caretHudEnabled = true))
    assertFalse(CaretHudEventScheduling.shouldScheduleEditorRender(caretHudEnabled = false))
  }

  @Test
  fun visibleAreaChangesDoNotRenderWhenHudAlreadyScrollsWithEditorContent() {
    assertTrue(
      CaretHudEventScheduling.shouldScheduleVisibleAreaRender(
        caretHudEnabled = true,
        editorBelongsToProject = true,
        hudShowingForEditor = false
      )
    )
    assertFalse(
      CaretHudEventScheduling.shouldScheduleVisibleAreaRender(
        caretHudEnabled = true,
        editorBelongsToProject = true,
        hudShowingForEditor = true
      )
    )
    assertFalse(
      CaretHudEventScheduling.shouldScheduleVisibleAreaRender(
        caretHudEnabled = false,
        editorBelongsToProject = true,
        hudShowingForEditor = false
      )
    )
    assertFalse(
      CaretHudEventScheduling.shouldScheduleVisibleAreaRender(
        caretHudEnabled = true,
        editorBelongsToProject = false,
        hudShowingForEditor = false
      )
    )
  }
}
