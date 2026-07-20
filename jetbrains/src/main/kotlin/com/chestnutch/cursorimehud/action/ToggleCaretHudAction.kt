package com.chestnutch.cursorimehud.action

import com.chestnutch.cursorimehud.settings.CursorImeHudSettings
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.components.service

class ToggleCaretHudAction : AnAction() {
  override fun actionPerformed(event: AnActionEvent) {
    val settings = service<CursorImeHudSettings>()
    settings.update { it.caretHudEnabled = !it.caretHudEnabled }
    settings.publishChanged()
  }
}
