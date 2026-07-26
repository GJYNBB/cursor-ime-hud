package com.chestnutch.cursorimehud.ui

import com.chestnutch.cursorimehud.settings.CursorImeHudBundle
import com.intellij.openapi.project.Project
import com.intellij.openapi.wm.StatusBar
import com.intellij.openapi.wm.StatusBarWidget
import com.intellij.openapi.wm.StatusBarWidgetFactory

class ImeStatusBarWidgetFactory : StatusBarWidgetFactory {
  override fun getId(): String = ImeStatusBarWidget.WIDGET_ID

  override fun getDisplayName(): String = CursorImeHudBundle.message("statusBar.displayName")

  // Always available: the widget itself hides its component and releases its
  // helper consumer while the status-bar setting is off, so toggling the
  // setting works live without the internal StatusBarWidgetsManager API.
  override fun isAvailable(project: Project): Boolean = true

  override fun createWidget(project: Project): StatusBarWidget = ImeStatusBarWidget(project)

  override fun disposeWidget(widget: StatusBarWidget) {
    widget.dispose()
  }

  override fun canBeEnabledOn(statusBar: StatusBar): Boolean = true
}
