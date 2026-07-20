package com.chestnutch.cursorimehud.service

import com.chestnutch.cursorimehud.helper.ImeHelperProcess
import com.chestnutch.cursorimehud.model.CursorImeHudLabels
import com.chestnutch.cursorimehud.model.DetectorLogEntry
import com.chestnutch.cursorimehud.model.HelperDebugInfo
import com.chestnutch.cursorimehud.model.HelperLifecycleState
import com.chestnutch.cursorimehud.model.ImeSnapshot
import com.chestnutch.cursorimehud.model.ImeState
import com.chestnutch.cursorimehud.settings.CursorImeHudBundle
import com.chestnutch.cursorimehud.settings.CursorImeHudSettings
import com.intellij.openapi.Disposable
import com.intellij.openapi.components.Service
import com.intellij.openapi.components.service
import com.intellij.openapi.project.Project
import java.time.Instant
import java.util.concurrent.CopyOnWriteArrayList

@Service(Service.Level.PROJECT)
class ImeHudService(private val project: Project) : Disposable, ImeHelperProcess.Listener {
  interface Listener {
    fun onImeHudChanged()
  }

  private val listeners = CopyOnWriteArrayList<Listener>()
  private val helperConsumers = mutableSetOf<String>()
  private val logs = ArrayDeque<DetectorLogEntry>()
  private val helper = ImeHelperProcess()
  private var listenerRegistered = false
  private var latestSnapshot = ImeSnapshot(
    state = ImeState.UNKNOWN,
    timestamp = Instant.EPOCH.toString(),
    reason = "service-idle",
    confidence = 0.0,
    rawStateAvailable = false
  )
  private var lastStableSnapshot: ImeSnapshot? = null
  private var unknownObservedAtMillis: Long? = null
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

  fun displayState(nowMillis: Long = System.currentTimeMillis()): HudDisplayState = HudDisplayStateResolver.resolve(
    detectedSnapshot = latestSnapshot,
    lastStableSnapshot = lastStableSnapshot,
    unknownObservedAtMillis = unknownObservedAtMillis,
    nowMillis = nowMillis
  )

  fun notifyGracePeriodExpired() {
    fireChanged()
  }

  fun displayText(): String {
    val settings = service<CursorImeHudSettings>().state
    val labels = CursorImeHudLabels.fromSettings(settings.labelPreset)
    return CursorImeHudBundle.message("statusBar.prefix") + displayState().displaySnapshot.displayLabel(labels)
  }

  fun tooltipText(): String {
    val display = displayState().displaySnapshot
    return com.chestnutch.cursorimehud.ui.ImeStatusBarText.tooltip(
      state = display.state,
      imeName = display.imeName,
      circuitOpen = debugInfo.circuitOpen,
      lastError = debugInfo.lastError
    )
  }

  fun statusSummaryLine(): String {
    val display = displayState().displaySnapshot
    val stateLabel = com.chestnutch.cursorimehud.ui.ImeStatusBarText.stateLabel(display.state)
    val ime = display.imeName?.trim().orEmpty()
    return if (ime.isEmpty()) {
      "当前状态：$stateLabel"
    } else {
      "当前状态：$stateLabel · $ime"
    }
  }

  fun diagnostics(): String = buildString {
    val notAvailable = notAvailableText()
    val present = CursorImeHudBundle.message("diagnostics.present")
    appendLine(CursorImeHudBundle.message("diagnostics.header"))
    appendLine(CursorImeHudBundle.message("diagnostics.projectPresent"))
    appendLine()
    appendLine(CursorImeHudBundle.message("diagnostics.currentSnapshot"))
    appendLine("  state=${latestSnapshot.state.wireValue}")
    appendLine("  timestamp=${latestSnapshot.timestamp}")
    appendLine("  imeName=${latestSnapshot.imeName ?: notAvailable}")
    appendLine("  isOpen=${latestSnapshot.isOpen ?: notAvailable}")
    appendLine("  layoutHex=${latestSnapshot.layoutHex ?: notAvailable}")
    appendLine("  threadId=${latestSnapshot.threadId ?: notAvailable}")
    appendLine("  hwnd=${latestSnapshot.hwnd ?: notAvailable}")
    appendLine("  reason=${latestSnapshot.reason ?: notAvailable}")
    appendLine("  confidence=${latestSnapshot.confidence ?: notAvailable}")
    appendLine("  rawStateAvailable=${latestSnapshot.rawStateAvailable ?: notAvailable}")
    appendLine()
    appendLine(
      CursorImeHudBundle.message(
        "diagnostics.lastStableSnapshot",
        lastStableSnapshot?.state?.wireValue ?: notAvailable
      )
    )
    appendLine(CursorImeHudBundle.message("diagnostics.displayState"))
    val displayState = displayState()
    appendLine("  state=${displayState.displaySnapshot.state.wireValue}")
    appendLine("  reason=${displayState.displayReason}")
    appendLine("  graceExpiresAtMillis=${displayState.graceExpiresAtMillis ?: notAvailable}")
    appendLine()
    appendLine(CursorImeHudBundle.message("diagnostics.helper"))
    appendLine("  lifecycle=${debugInfo.lifecycleState}")
    appendLine("  osGate=${debugInfo.osGate}")
    appendLine("  path=${if (debugInfo.helperPath == null) notAvailable else present}")
    appendLine("  expectedSha256=${if (debugInfo.expectedSha256 == null) notAvailable else present}")
    appendLine("  actualSha256=${if (debugInfo.actualSha256 == null) notAvailable else present}")
    appendLine("  hashMatches=${debugInfo.hashMatches ?: notAvailable}")
    appendLine("  restartCount=${debugInfo.restartCount}")
    appendLine("  circuitOpen=${debugInfo.circuitOpen}")
    appendLine("  manualRefreshRequired=${debugInfo.manualRefreshRequired}")
    appendLine("  lastError=${debugInfo.lastError ?: notAvailable}")
    appendLine()
    appendLine(CursorImeHudBundle.message("diagnostics.settings"))
    val settings = service<CursorImeHudSettings>().state
    val labels = CursorImeHudLabels.fromSettings(settings.labelPreset)
    appendLine("  statusBarEnabled=${settings.statusBarEnabled}")
    appendLine("  caretHudEnabled=${settings.caretHudEnabled}")
    appendLine("  labelPreset=${settings.labelPreset}")
    appendLine("  resolvedCnLabel=${labels.cnLabel}")
    appendLine("  resolvedEnLabel=${labels.enLabel}")
    appendLine("  cnColor=${settings.cnColor}")
    appendLine("  enColor=${settings.enColor}")
    appendLine("  opacity=${settings.opacity}")
    appendLine("  offsetX=${settings.offsetX}")
    appendLine("  offsetY=${settings.offsetY}")
    appendLine("  hideWhenEditorUnfocused=${settings.hideWhenEditorUnfocused}")
    appendLine()
    appendLine(CursorImeHudBundle.message("diagnostics.recentLogs"))
    if (logs.isEmpty()) {
      appendLine("  ${CursorImeHudBundle.message("diagnostics.none")}")
    } else {
      logs.forEach { appendLine("  [${it.level}] ${it.timestamp} ${it.source}: ${it.message}") }
    }
  }

  override fun onSnapshot(snapshot: ImeSnapshot) {
    val previousState = latestSnapshot.state
    latestSnapshot = snapshot
    if (snapshot.state != ImeState.UNKNOWN) {
      lastStableSnapshot = snapshot
      unknownObservedAtMillis = null
    } else if (previousState != ImeState.UNKNOWN) {
      unknownObservedAtMillis = System.currentTimeMillis()
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

  private fun notAvailableText(): String = CursorImeHudBundle.message("diagnostics.notAvailable")
}
