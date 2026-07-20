package com.chestnutch.cursorimehud.ui

import com.chestnutch.cursorimehud.settings.CursorImeHudBundle
import com.chestnutch.cursorimehud.settings.CursorImeHudSettings
import com.intellij.openapi.components.service
import com.intellij.openapi.project.Project
import com.intellij.openapi.wm.StatusBar
import com.intellij.openapi.wm.StatusBarWidget
import com.intellij.openapi.wm.StatusBarWidgetFactory

class ImeStatusBarWidgetFactory : StatusBarWidgetFactory {
  override fun getId(): String = "CursorImeHudStatusBar"

  override fun getDisplayName(): String = CursorImeHudBundle.message("statusBar.displayName")

  override fun isAvailable(project: Project): Boolean = service<CursorImeHudSettings>().state.statusBarEnabled

  override fun createWidget(project: Project): StatusBarWidget = ImeStatusBarWidget(project)

  override fun disposeWidget(widget: StatusBarWidget) {
    widget.dispose()
  }

  override fun canBeEnabledOn(statusBar: StatusBar): Boolean = true
}
