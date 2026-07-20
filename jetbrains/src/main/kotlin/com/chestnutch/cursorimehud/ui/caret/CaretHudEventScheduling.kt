package com.chestnutch.cursorimehud.ui.caret

import java.awt.Component
import java.awt.Rectangle
import javax.swing.SwingUtilities

object CaretHudEventScheduling {
  fun shouldScheduleEditorRender(caretHudEnabled: Boolean): Boolean = caretHudEnabled

  fun shouldSkipDocumentRenderDuringIntentionPreview(intentionPreviewActive: Boolean): Boolean = intentionPreviewActive

  fun shouldScheduleFoldingRender(
    caretHudEnabled: Boolean,
    editorBelongsToProject: Boolean
  ): Boolean = caretHudEnabled && editorBelongsToProject

  fun shouldScheduleVisibleAreaRender(
    caretHudEnabled: Boolean,
    editorBelongsToProject: Boolean,
    hudShowingForEditor: Boolean,
    viewportMetricsChanged: Boolean
  ): Boolean = caretHudEnabled && editorBelongsToProject && (!hudShowingForEditor || viewportMetricsChanged)

  fun shouldScheduleCtrlWheelZoomRender(
    caretHudEnabled: Boolean,
    editorBelongsToProject: Boolean,
    ctrlDown: Boolean
  ): Boolean = caretHudEnabled && editorBelongsToProject && ctrlDown

  fun isComponentInsideEditor(source: Component?, editorComponent: Component, editorContentComponent: Component): Boolean =
    source != null &&
      (source === editorComponent ||
        source === editorContentComponent ||
        SwingUtilities.isDescendingFrom(source, editorComponent) ||
        SwingUtilities.isDescendingFrom(source, editorContentComponent))

  fun viewportMetricsChanged(oldRectangle: Rectangle?, newRectangle: Rectangle?): Boolean =
    oldRectangle == null ||
      newRectangle == null ||
      oldRectangle.width != newRectangle.width ||
      oldRectangle.height != newRectangle.height

  // Plain scrolling keeps the HUD attached to editor.contentComponent moving with the content,
  // so x/y changes alone do not require a rerender.
}
