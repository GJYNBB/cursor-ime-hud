package com.chestnutch.cursorimehud.ui.caret

import com.chestnutch.cursorimehud.service.ImeHudService
import com.chestnutch.cursorimehud.settings.CursorImeHudSettings
import com.chestnutch.cursorimehud.settings.CursorImeHudSettingsListener
import com.intellij.openapi.Disposable
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.Service
import com.intellij.openapi.components.service
import com.intellij.openapi.editor.Document
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
import java.awt.AWTEvent
import java.awt.Component
import java.awt.KeyboardFocusManager
import java.awt.Toolkit
import java.awt.event.AWTEventListener
import java.awt.event.MouseWheelEvent
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
  private val ctrlWheelZoomListener = AWTEventListener { event: AWTEvent ->
    if (event is MouseWheelEvent && event.isControlDown) {
      scheduleCtrlWheelZoomRender(event)
    }
  }
  @Volatile
  private var renderScheduled = false
  @Volatile
  private var metricRenderScheduled = false
  @Volatile
  private var documentRenderScheduled = false
  @Volatile
  private var pendingChangedDocument: Document? = null
  private var started = false
  private var hudStarted = false
  private var ctrlWheelZoomListenerRegistered = false

  fun start() {
    if (started || project.isDisposed) return
    started = true

    ApplicationManager.getApplication().messageBus.connect(this).subscribe(
      CursorImeHudSettingsListener.TOPIC,
      object : CursorImeHudSettingsListener {
        override fun settingsChanged() {
          if (settings.state.caretHudEnabled) {
            val wasHudStarted = hudStarted
            startHud()
            ensureCtrlWheelListener()
            if (wasHudStarted) {
              scheduleRender(immediate = true)
            }
          } else {
            renderAlarm.cancelAllRequests()
            renderScheduled = false
            metricRenderScheduled = false
            documentRenderScheduled = false
            pendingChangedDocument = null
            removeCtrlWheelListener()
            renderer.hide()
          }
        }
      }
    )

    if (settings.state.caretHudEnabled) {
      startHud()
    }
  }

  override fun onImeHudChanged() {
    if (settings.state.caretHudEnabled) {
      scheduleRender(immediate = true)
    }
  }

  override fun dispose() {
    renderAlarm.cancelAllRequests()
    renderScheduled = false
    metricRenderScheduled = false
    documentRenderScheduled = false
    pendingChangedDocument = null
    if (ctrlWheelZoomListenerRegistered) {
      Toolkit.getDefaultToolkit().removeAWTEventListener(ctrlWheelZoomListener)
      ctrlWheelZoomListenerRegistered = false
    }
    KeyboardFocusManager.getCurrentKeyboardFocusManager().removePropertyChangeListener("focusOwner", focusListener)
    service.removeListener(this)
    renderer.hide()
  }

  private fun startHud() {
    if (hudStarted || project.isDisposed) return
    hudStarted = true

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
        if (CaretHudEventScheduling.shouldScheduleVisibleAreaRender(
            caretHudEnabled = settings.state.caretHudEnabled,
            editorBelongsToProject = event.editor.project == project,
            hudShowingForEditor = renderer.isShowingFor(event.editor),
            viewportMetricsChanged = CaretHudEventScheduling.viewportMetricsChanged(
              event.oldRectangle,
              event.newRectangle
            )
          )
        ) {
          if (renderer.isShowingFor(event.editor)) {
            scheduleMetricRender()
          } else {
            scheduleRender()
          }
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
        scheduleDocumentRender(event.document)
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

    KeyboardFocusManager.getCurrentKeyboardFocusManager().addPropertyChangeListener("focusOwner", focusListener)
    ensureCtrlWheelListener()
    scheduleRender(immediate = true)
  }

  private fun scheduleEditorRender() {
    if (!CaretHudEventScheduling.shouldScheduleEditorRender(settings.state.caretHudEnabled)) return
    scheduleRender()
  }

  private fun scheduleDocumentRender(changedDocument: Document) {
    if (project.isDisposed || !settings.state.caretHudEnabled) return
    pendingChangedDocument = changedDocument
    if (documentRenderScheduled) return

    documentRenderScheduled = true
    ApplicationManager.getApplication().invokeLater {
      val document = pendingChangedDocument
      pendingChangedDocument = null
      documentRenderScheduled = false
      if (project.isDisposed || !settings.state.caretHudEnabled) return@invokeLater
      if (activeEditor()?.document == document) {
        scheduleRender()
      }
    }
  }

  private fun scheduleCtrlWheelZoomRender(event: MouseWheelEvent) {
    if (!event.isControlDown) return
    val source = event.component ?: return
    val editor = editorForComponent(source) ?: return
    if (CaretHudEventScheduling.shouldScheduleCtrlWheelZoomRender(
        caretHudEnabled = settings.state.caretHudEnabled,
        editorBelongsToProject = editor.project == project,
        ctrlDown = true
      )
    ) {
      scheduleMetricRender()
    }
  }

  private fun scheduleMetricRender() {
    if (project.isDisposed || !settings.state.caretHudEnabled || metricRenderScheduled) return

    metricRenderScheduled = true
    renderAlarm.addRequest(
      {
        try {
          renderNow()
        } finally {
          metricRenderScheduled = false
        }
      },
      50
    )
  }

  private fun scheduleRender(immediate: Boolean = false) {
    if (project.isDisposed) return
    if (immediate) {
      renderAlarm.cancelAllRequests()
      renderScheduled = false
      metricRenderScheduled = false
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

  private fun ensureCtrlWheelListener() {
    if (ctrlWheelZoomListenerRegistered) return
    Toolkit.getDefaultToolkit().addAWTEventListener(ctrlWheelZoomListener, AWTEvent.MOUSE_WHEEL_EVENT_MASK)
    ctrlWheelZoomListenerRegistered = true
  }

  private fun removeCtrlWheelListener() {
    if (!ctrlWheelZoomListenerRegistered) return
    Toolkit.getDefaultToolkit().removeAWTEventListener(ctrlWheelZoomListener)
    ctrlWheelZoomListenerRegistered = false
  }

  private fun editorForComponent(source: Component): Editor? {
    return EditorFactory.getInstance().allEditors.firstOrNull { editor ->
      editor.project == project &&
        !editor.isDisposed &&
        CaretHudEventScheduling.isComponentInsideEditor(source, editor.component, editor.contentComponent)
    }
  }

  private fun activeEditor(): Editor? = FileEditorManager.getInstance(project).selectedTextEditor

  private fun isEditorFocused(editor: Editor): Boolean {
    val focusOwner = IdeFocusManager.getInstance(project).focusOwner
      ?: KeyboardFocusManager.getCurrentKeyboardFocusManager().focusOwner
      ?: return false
    return focusOwner === editor.contentComponent || SwingUtilities.isDescendingFrom(focusOwner, editor.contentComponent)
  }
}
