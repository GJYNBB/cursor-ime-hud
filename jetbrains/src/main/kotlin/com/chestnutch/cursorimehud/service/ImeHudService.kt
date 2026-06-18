package com.chestnutch.cursorimehud.service

import com.chestnutch.cursorimehud.helper.WinImeWatcherProcess
import com.chestnutch.cursorimehud.model.CursorImeHudLabels
import com.chestnutch.cursorimehud.model.DetectorLogEntry
import com.chestnutch.cursorimehud.model.HelperDebugInfo
import com.chestnutch.cursorimehud.model.HelperLifecycleState
import com.chestnutch.cursorimehud.model.ImeSnapshot
import com.chestnutch.cursorimehud.model.ImeState
import com.chestnutch.cursorimehud.settings.CursorImeHudSettings
import com.intellij.openapi.Disposable
import com.intellij.openapi.components.Service
import com.intellij.openapi.components.service
import com.intellij.openapi.project.Project
import java.time.Instant
import java.util.concurrent.CopyOnWriteArrayList

@Service(Service.Level.PROJECT)
class ImeHudService(private val project: Project) : Disposable, WinImeWatcherProcess.Listener {
  interface Listener {
    fun onImeHudChanged()
  }

  private val listeners = CopyOnWriteArrayList<Listener>()
  private val helperConsumers = mutableSetOf<String>()
  private val logs = ArrayDeque<DetectorLogEntry>()
  private val helper = WinImeWatcherProcess()
  private var listenerRegistered = false
  private var latestSnapshot = ImeSnapshot(
    state = ImeState.UNKNOWN,
    timestamp = Instant.EPOCH.toString(),
    reason = "service-idle",
    confidence = 0.0,
    rawStateAvailable = false
  )
  private var lastStableSnapshot: ImeSnapshot? = null
  private var debugInfo = helper.debugInfo()

  @Synchronized
  fun start() {
    if (project.isDisposed) return
    ensureHelperListener()
    helper.start()
  }

  @Synchronized
  fun acquireConsumer(consumerId: String) {
    if (project.isDisposed) return
    helperConsumers.add(consumerId)
    start()
  }

  @Synchronized
  fun releaseConsumer(consumerId: String) {
    helperConsumers.remove(consumerId)
    if (helperConsumers.isEmpty()) {
      helper.stop()
    }
  }

  private fun ensureHelperListener() {
    if (!listenerRegistered) {
      listenerRegistered = true
      helper.addListener(this)
    }
  }

  fun addListener(listener: Listener) {
    listeners.add(listener)
    listener.onImeHudChanged()
  }

  fun removeListener(listener: Listener) {
    listeners.remove(listener)
  }

  fun refresh() {
    start()
    helper.refresh()
  }

  fun snapshot(): ImeSnapshot = latestSnapshot

  fun displayText(): String {
    val settings = service<CursorImeHudSettings>().state
    val labels = CursorImeHudLabels.fromSettings(settings.labelPreset, settings.cnLabel, settings.enLabel)
    return "IME: ${latestSnapshot.displayLabel(labels)}"
  }

  fun tooltipText(): String = buildString {
    append("Cursor IME HUD")
    append("\nState: ${latestSnapshot.state.wireValue}")
    append("\nReason: ${latestSnapshot.reason ?: "n/a"}")
    latestSnapshot.imeName?.let { append("\nIME: $it") }
    latestSnapshot.layoutHex?.let { append("\nLayout: $it") }
    append("\nLifecycle: ${debugInfo.lifecycleState}")
    debugInfo.lastError?.let { append("\nLast error: $it") }
  }

  fun diagnostics(): String = buildString {
    appendLine("Cursor IME HUD for JetBrains Diagnostics")
    appendLine("Project: ${project.name}")
    appendLine()
    appendLine("Current snapshot:")
    appendLine("  state=${latestSnapshot.state.wireValue}")
    appendLine("  timestamp=${latestSnapshot.timestamp}")
    appendLine("  imeName=${latestSnapshot.imeName ?: "n/a"}")
    appendLine("  isOpen=${latestSnapshot.isOpen ?: "n/a"}")
    appendLine("  layoutHex=${latestSnapshot.layoutHex ?: "n/a"}")
    appendLine("  threadId=${latestSnapshot.threadId ?: "n/a"}")
    appendLine("  hwnd=${latestSnapshot.hwnd ?: "n/a"}")
    appendLine("  reason=${latestSnapshot.reason ?: "n/a"}")
    appendLine("  confidence=${latestSnapshot.confidence ?: "n/a"}")
    appendLine("  rawStateAvailable=${latestSnapshot.rawStateAvailable ?: "n/a"}")
    appendLine()
    appendLine("Last stable snapshot: ${lastStableSnapshot?.state?.wireValue ?: "n/a"}")
    appendLine()
    appendLine("Helper:")
    appendLine("  lifecycle=${debugInfo.lifecycleState}")
    appendLine("  osGate=${debugInfo.osGate}")
    appendLine("  path=${debugInfo.helperPath ?: "n/a"}")
    appendLine("  expectedSha256=${debugInfo.expectedSha256 ?: "n/a"}")
    appendLine("  actualSha256=${debugInfo.actualSha256 ?: "n/a"}")
    appendLine("  hashMatches=${debugInfo.hashMatches ?: "n/a"}")
    appendLine("  restartCount=${debugInfo.restartCount}")
    appendLine("  lastError=${debugInfo.lastError ?: "n/a"}")
    appendLine()
    appendLine("Settings:")
    val settings = service<CursorImeHudSettings>().state
    appendLine("  statusBarEnabled=${settings.statusBarEnabled}")
    appendLine("  caretHudEnabled=${settings.caretHudEnabled}")
    appendLine("  labelPreset=${settings.labelPreset}")
    appendLine("  cnLabel=${settings.cnLabel}")
    appendLine("  enLabel=${settings.enLabel}")
    appendLine("  opacity=${settings.opacity}")
    appendLine("  offsetX=${settings.offsetX}")
    appendLine("  offsetY=${settings.offsetY}")
    appendLine("  hideWhenEditorUnfocused=${settings.hideWhenEditorUnfocused}")
    appendLine()
    appendLine("Recent logs:")
    if (logs.isEmpty()) {
      appendLine("  <none>")
    } else {
      logs.forEach { appendLine("  [${it.level}] ${it.timestamp} ${it.source}: ${it.message}") }
    }
  }

  override fun onSnapshot(snapshot: ImeSnapshot) {
    latestSnapshot = snapshot
    if (snapshot.state != ImeState.UNKNOWN) {
      lastStableSnapshot = snapshot
    }
    fireChanged()
  }

  override fun onLog(entry: DetectorLogEntry) {
    logs.addLast(entry)
    while (logs.size > 200) {
      logs.removeFirst()
    }
    fireChanged()
  }

  override fun onDebugChanged(debugInfo: HelperDebugInfo) {
    this.debugInfo = debugInfo
    if (debugInfo.lifecycleState == HelperLifecycleState.UNAVAILABLE || debugInfo.lifecycleState == HelperLifecycleState.FAILED) {
      fireChanged()
    }
  }

  override fun dispose() {
    helperConsumers.clear()
    helper.removeListener(this)
    helper.dispose()
    listeners.clear()
  }

  private fun fireChanged() {
    listeners.forEach { it.onImeHudChanged() }
  }
}
