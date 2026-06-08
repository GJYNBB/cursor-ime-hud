package com.chestnutch.cursorimehud.ui.caret

import com.chestnutch.cursorimehud.model.CursorImeHudLabels
import com.chestnutch.cursorimehud.model.ImeSnapshot
import com.chestnutch.cursorimehud.model.ImeState
import com.chestnutch.cursorimehud.settings.CursorImeHudSettings

data class CaretHudDisplayState(
  val visible: Boolean,
  val label: String? = null,
  val hiddenReason: String? = null
)

object CaretHudVisibility {
  fun resolve(
    snapshot: ImeSnapshot,
    settings: CursorImeHudSettings.State,
    editorAvailable: Boolean,
    editorFocused: Boolean
  ): CaretHudDisplayState {
    if (!settings.caretHudEnabled) {
      return CaretHudDisplayState(visible = false, hiddenReason = "caret-hud-disabled")
    }

    if (!editorAvailable) {
      return CaretHudDisplayState(visible = false, hiddenReason = "no-active-editor")
    }

    if (settings.hideWhenEditorUnfocused && !editorFocused) {
      return CaretHudDisplayState(visible = false, hiddenReason = "editor-unfocused")
    }

    val labels = CursorImeHudLabels.fromSettings(settings.labelPreset, settings.cnLabel, settings.enLabel)
    val label = when (snapshot.state) {
      ImeState.CN -> labels.cnLabel
      ImeState.EN -> labels.enLabel
      ImeState.UNKNOWN -> null
    }?.trim()

    if (label.isNullOrEmpty()) {
      return CaretHudDisplayState(visible = false, hiddenReason = "no-display-label")
    }

    return CaretHudDisplayState(visible = true, label = label)
  }
}
