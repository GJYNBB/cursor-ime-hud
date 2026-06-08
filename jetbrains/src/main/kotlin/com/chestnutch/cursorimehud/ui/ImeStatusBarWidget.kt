package com.chestnutch.cursorimehud.ui

import com.chestnutch.cursorimehud.service.ImeHudService
import com.chestnutch.cursorimehud.settings.CursorImeHudSettingsListener
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.service
import com.intellij.openapi.project.Project
import com.intellij.openapi.wm.StatusBar
import com.intellij.openapi.wm.StatusBarWidget
import com.intellij.util.Consumer
import com.intellij.util.messages.MessageBusConnection
import java.awt.Component
import java.awt.event.MouseEvent

class ImeStatusBarWidget(project: Project) : StatusBarWidget, StatusBarWidget.TextPresentation, ImeHudService.Listener {
  private val service = project.service<ImeHudService>()
  private var statusBar: StatusBar? = null
  private var settingsConnection: MessageBusConnection? = null

  override fun ID(): String = "CursorImeHudStatusBar"

  override fun install(statusBar: StatusBar) {
    this.statusBar = statusBar
    service.addListener(this)
    settingsConnection = ApplicationManager.getApplication().messageBus.connect().also { connection ->
      connection.subscribe(CursorImeHudSettingsListener.TOPIC, object : CursorImeHudSettingsListener {
        override fun settingsChanged() {
          statusBar.updateWidget(ID())
        }
      })
    }
    service.start()
  }

  override fun dispose() {
    settingsConnection?.disconnect()
    settingsConnection = null
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
