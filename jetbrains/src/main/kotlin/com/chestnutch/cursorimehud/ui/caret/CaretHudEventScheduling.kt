package com.chestnutch.cursorimehud.ui.caret

object CaretHudEventScheduling {
  fun shouldScheduleEditorRender(caretHudEnabled: Boolean): Boolean = caretHudEnabled

  fun shouldScheduleVisibleAreaRender(
    caretHudEnabled: Boolean,
    editorBelongsToProject: Boolean,
    hudShowingForEditor: Boolean
  ): Boolean = caretHudEnabled && editorBelongsToProject && !hudShowingForEditor
}
