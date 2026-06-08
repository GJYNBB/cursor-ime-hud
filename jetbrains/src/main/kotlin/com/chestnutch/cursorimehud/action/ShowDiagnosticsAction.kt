package com.chestnutch.cursorimehud.action

import com.chestnutch.cursorimehud.service.ImeHudService
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.components.service
import com.intellij.openapi.ui.Messages

class ShowDiagnosticsAction : AnAction() {
  override fun actionPerformed(event: AnActionEvent) {
    val project = event.project ?: return
    val service = project.service<ImeHudService>()
    service.start()
    Messages.showInfoMessage(project, service.diagnostics(), "Cursor IME HUD Diagnostics")
  }
}
