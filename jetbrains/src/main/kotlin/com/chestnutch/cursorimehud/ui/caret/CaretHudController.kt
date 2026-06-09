package com.chestnutch.cursorimehud.ui.caret

import com.chestnutch.cursorimehud.service.ImeHudService
import com.chestnutch.cursorimehud.settings.CursorImeHudSettings
import com.chestnutch.cursorimehud.settings.CursorImeHudSettingsListener
import com.intellij.openapi.Disposable
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.Service
import com.intellij.openapi.components.service
import com.intellij.openapi.editor.Editor
import com.intellij.openapi.editor.EditorFactory
import com.intellij.openapi.editor.event.CaretEvent
import com.intellij.openapi.editor.event.CaretListener
import com.intellij.openapi.editor.event.DocumentEvent
import com.intellij.openapi.editor.event.DocumentListener
import com.intellij.openapi.editor.event.EditorFactoryEvent
import com.intellij.openapi.editor.event.EditorFactoryListener
import com.intellij.openapi.editor.event.SelectionEvent
import com.intellij.openapi.editor.event.SelectionListener
import com.intellij.openapi.editor.event.VisibleAreaEvent
import com.intellij.openapi.editor.event.VisibleAreaListener
import com.intellij.openapi.fileEditor.FileEditorManager
import com.intellij.openapi.fileEditor.FileEditorManagerEvent
import com.intellij.openapi.fileEditor.FileEditorManagerListener
import com.intellij.openapi.project.Project
import com.intellij.openapi.wm.IdeFocusManager
import com.intellij.util.Alarm
import java.awt.KeyboardFocusManager
import java.beans.PropertyChangeEvent
import java.beans.PropertyChangeListener
import javax.swing.SwingUtilities

@Service(Service.Level.PROJECT)
class CaretHudController(private val project: Project) : Disposable, ImeHudService.Listener {
  private val service = project.service<ImeHudService>()
  private val settings = service<CursorImeHudSettings>()
  private val renderer = CaretHudRenderer()
  private val renderAlarm = Alarm(Alarm.ThreadToUse.SWING_THREAD, this)
  private val focusListener = PropertyChangeListener { event: PropertyChangeEvent ->
    if (event.propertyName == "focusOwner") {
      scheduleRender()
    }
  }
  @Volatile
  private var renderScheduled = false
  private var started = false

  fun start() {
    if (started || project.isDisposed) return
    started = true

    service.addListener(this)
    service.start()

    val editorFactory = EditorFactory.getInstance()
    editorFactory.eventMulticaster.addCaretListener(object : CaretListener {
      override fun caretPositionChanged(event: CaretEvent) {
        if (event.editor.project == project) {
          scheduleEditorRender()
        }
      }
    }, this)
    editorFactory.eventMulticaster.addVisibleAreaListener(object : VisibleAreaListener {
      override fun visibleAreaChanged(event: VisibleAreaEvent) {
        if (event.editor.project == project) {
          scheduleEditorRender()
        }
      }
    }, this)
    editorFactory.eventMulticaster.addSelectionListener(object : SelectionListener {
      override fun selectionChanged(event: SelectionEvent) {
        if (event.editor.project == project) {
          scheduleEditorRender()
        }
      }
    }, this)
    editorFactory.eventMulticaster.addDocumentListener(object : DocumentListener {
      override fun documentChanged(event: DocumentEvent) {
        if (!settings.state.caretHudEnabled) return
        val changedDocument = event.document
        ApplicationManager.getApplication().invokeLater {
          if (project.isDisposed || !settings.state.caretHudEnabled) return@invokeLater
          if (activeEditor()?.document == changedDocument) {
            scheduleRender()
          }
        }
      }
    }, this)
    editorFactory.addEditorFactoryListener(object : EditorFactoryListener {
      override fun editorReleased(event: EditorFactoryEvent) {
        renderer.hideFor(event.editor)
      }
    }, this)

    project.messageBus.connect(this).subscribe(
      FileEditorManagerListener.FILE_EDITOR_MANAGER,
      object : FileEditorManagerListener {
        override fun selectionChanged(event: FileEditorManagerEvent) {
          scheduleRender(immediate = true)
        }
      }
    )
    ApplicationManager.getApplication().messageBus.connect(this).subscribe(
      CursorImeHudSettingsListener.TOPIC,
      object : CursorImeHudSettingsListener {
        override fun settingsChanged() {
          scheduleRender(immediate = true)
        }
      }
    )

    KeyboardFocusManager.getCurrentKeyboardFocusManager().addPropertyChangeListener("focusOwner", focusListener)
    scheduleRender(immediate = true)
  }

  override fun onImeHudChanged() {
    scheduleRender(immediate = true)
  }

  override fun dispose() {
    renderAlarm.cancelAllRequests()
    renderScheduled = false
    KeyboardFocusManager.getCurrentKeyboardFocusManager().removePropertyChangeListener("focusOwner", focusListener)
    service.removeListener(this)
    renderer.hide()
  }

  private fun scheduleEditorRender() {
    if (!settings.state.caretHudEnabled) return
    scheduleRender()
  }

  private fun scheduleRender(immediate: Boolean = false) {
    if (project.isDisposed) return
    if (immediate) {
      renderAlarm.cancelAllRequests()
      renderScheduled = false
    } else if (renderScheduled) {
      return
    }

    renderScheduled = true
    renderAlarm.addRequest(
      {
        try {
          renderNow()
        } finally {
          renderScheduled = false
        }
      },
      if (immediate) 0 else 16
    )
  }

  private fun renderNow() {
    if (project.isDisposed) {
      renderer.hide()
      return
    }

    val editor = activeEditor()
    val snapshot = service.snapshot()
    val state = CaretHudVisibility.resolve(
      snapshot = snapshot,
      settings = settings.state,
      editorAvailable = editor != null && !editor.isDisposed,
      editorFocused = editor?.let { isEditorFocused(it) } ?: false
    )

    if (!state.visible || editor == null || state.label == null) {
      renderer.hide()
      return
    }

    renderer.show(editor, state.label, snapshot.state, settings.state)
  }

  private fun activeEditor(): Editor? = FileEditorManager.getInstance(project).selectedTextEditor

  private fun isEditorFocused(editor: Editor): Boolean {
    val focusOwner = IdeFocusManager.getInstance(project).focusOwner
      ?: KeyboardFocusManager.getCurrentKeyboardFocusManager().focusOwner
      ?: return false
    return focusOwner === editor.contentComponent || SwingUtilities.isDescendingFrom(focusOwner, editor.contentComponent)
  }
}
