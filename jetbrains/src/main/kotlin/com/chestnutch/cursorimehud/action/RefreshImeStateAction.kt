package com.chestnutch.cursorimehud.action

import com.chestnutch.cursorimehud.service.ImeHudService
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.components.service

class RefreshImeStateAction : AnAction() {
  override fun actionPerformed(event: AnActionEvent) {
    event.project?.service<ImeHudService>()?.refresh()
  }
}
