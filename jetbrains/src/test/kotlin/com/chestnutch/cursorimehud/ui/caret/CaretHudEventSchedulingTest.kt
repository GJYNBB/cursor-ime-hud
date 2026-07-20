package com.chestnutch.cursorimehud.ui.caret

import java.awt.Rectangle
import javax.swing.JPanel
import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class CaretHudEventSchedulingTest {
  @Test
  fun documentChangesNeverRenderDuringIntentionPreview() {
    assertTrue(CaretHudEventScheduling.shouldSkipDocumentRenderDuringIntentionPreview(true))
    assertFalse(CaretHudEventScheduling.shouldSkipDocumentRenderDuringIntentionPreview(false))
  }

  @Test
  fun editorEventsRenderOnlyWhenCaretHudIsEnabled() {
    assertTrue(CaretHudEventScheduling.shouldScheduleEditorRender(caretHudEnabled = true))
    assertFalse(CaretHudEventScheduling.shouldScheduleEditorRender(caretHudEnabled = false))
  }

  @Test
  fun foldingEventsRenderOnlyForEnabledHudInTheSameProject() {
    assertTrue(
      CaretHudEventScheduling.shouldScheduleFoldingRender(
        caretHudEnabled = true,
        editorBelongsToProject = true
      )
    )
    assertFalse(
      CaretHudEventScheduling.shouldScheduleFoldingRender(
        caretHudEnabled = false,
        editorBelongsToProject = true
      )
    )
    assertFalse(
      CaretHudEventScheduling.shouldScheduleFoldingRender(
        caretHudEnabled = true,
        editorBelongsToProject = false
      )
    )
  }

  @Test
  fun visibleAreaChangesRenderWhenViewportMetricsChangeEvenIfHudIsAlreadyShowing() {
    assertTrue(
      CaretHudEventScheduling.shouldScheduleVisibleAreaRender(
        caretHudEnabled = true,
        editorBelongsToProject = true,
        hudShowingForEditor = false,
        viewportMetricsChanged = false
      )
    )
    assertTrue(
      CaretHudEventScheduling.shouldScheduleVisibleAreaRender(
        caretHudEnabled = true,
        editorBelongsToProject = true,
        hudShowingForEditor = true,
        viewportMetricsChanged = true
      )
    )
    assertFalse(
      CaretHudEventScheduling.shouldScheduleVisibleAreaRender(
        caretHudEnabled = true,
        editorBelongsToProject = true,
        hudShowingForEditor = true,
        viewportMetricsChanged = false
      )
    )
    assertFalse(
      CaretHudEventScheduling.shouldScheduleVisibleAreaRender(
        caretHudEnabled = false,
        editorBelongsToProject = true,
        hudShowingForEditor = false,
        viewportMetricsChanged = true
      )
    )
    assertFalse(
      CaretHudEventScheduling.shouldScheduleVisibleAreaRender(
        caretHudEnabled = true,
        editorBelongsToProject = false,
        hudShowingForEditor = false,
        viewportMetricsChanged = true
      )
    )
  }

  @Test
  fun ctrlWheelZoomSchedulesWhenTheEditorBelongsToTheProject() {
    assertTrue(
      CaretHudEventScheduling.shouldScheduleCtrlWheelZoomRender(
        caretHudEnabled = true,
        editorBelongsToProject = true,
        ctrlDown = true
      )
    )
    assertFalse(
      CaretHudEventScheduling.shouldScheduleCtrlWheelZoomRender(
        caretHudEnabled = true,
        editorBelongsToProject = true,
        ctrlDown = false
      )
    )
    assertFalse(
      CaretHudEventScheduling.shouldScheduleCtrlWheelZoomRender(
        caretHudEnabled = false,
        editorBelongsToProject = true,
        ctrlDown = true
      )
    )
    assertFalse(
      CaretHudEventScheduling.shouldScheduleCtrlWheelZoomRender(
        caretHudEnabled = true,
        editorBelongsToProject = false,
        ctrlDown = true
      )
    )
  }

  @Test
  fun viewportMetricsChangedDetectsSizeChanges() {
    assertFalse(CaretHudEventScheduling.viewportMetricsChanged(Rectangle(0, 0, 100, 100), Rectangle(10, 10, 100, 100)))
    assertTrue(CaretHudEventScheduling.viewportMetricsChanged(Rectangle(0, 0, 100, 100), Rectangle(0, 0, 120, 100)))
    assertTrue(CaretHudEventScheduling.viewportMetricsChanged(null, Rectangle(0, 0, 120, 100)))
  }

  @Test
  fun componentLookupHandlesNullDescendantsAndUnrelatedSources() {
    val editorComponent = JPanel(null)
    val contentComponent = JPanel(null)
    val child = JPanel(null)
    editorComponent.add(contentComponent)
    contentComponent.add(child)
    val unrelated = JPanel(null)

    assertTrue(CaretHudEventScheduling.isComponentInsideEditor(child, editorComponent, contentComponent))
    assertTrue(CaretHudEventScheduling.isComponentInsideEditor(contentComponent, editorComponent, contentComponent))
    assertFalse(CaretHudEventScheduling.isComponentInsideEditor(unrelated, editorComponent, contentComponent))
    assertFalse(CaretHudEventScheduling.isComponentInsideEditor(null, editorComponent, contentComponent))
  }
}
