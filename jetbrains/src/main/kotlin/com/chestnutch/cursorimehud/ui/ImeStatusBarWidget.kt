package com.chestnutch.cursorimehud.ui

import com.chestnutch.cursorimehud.service.ImeHudService
import com.intellij.openapi.components.service
import com.intellij.openapi.project.Project
import com.intellij.openapi.wm.StatusBar
import com.intellij.openapi.wm.StatusBarWidget
import java.awt.Component
import java.awt.event.MouseEvent
import com.intellij.util.Consumer

class ImeStatusBarWidget(project: Project) : StatusBarWidget, StatusBarWidget.TextPresentation, ImeHudService.Listener {
  private val service = project.service<ImeHudService>()
  private var statusBar: StatusBar? = null

  override fun ID(): String = "CursorImeHudStatusBar"

  override fun install(statusBar: StatusBar) {
    this.statusBar = statusBar
    service.addListener(this)
    service.start()
  }

  override fun dispose() {
    service.removeListener(this)
    statusBar = null
  }

  override fun getPresentation(): StatusBarWidget.WidgetPresentation = this

  override fun getText(): String = service.displayText()

  override fun getTooltipText(): String = service.tooltipText()

  override fun getAlignment(): Float = Component.CENTER_ALIGNMENT

  override fun getClickConsumer(): Consumer<MouseEvent>? = Consumer { service.refresh() }

  override fun onImeHudChanged() {
    statusBar?.updateWidget(ID())
  }
}
