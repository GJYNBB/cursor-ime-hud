package com.chestnutch.cursorimehud.service

import com.chestnutch.cursorimehud.model.CursorImeHudLabels
import com.chestnutch.cursorimehud.model.ImeSnapshot
import com.chestnutch.cursorimehud.settings.CursorImeHudBundle
import com.chestnutch.cursorimehud.settings.CursorImeHudSettings
import com.chestnutch.cursorimehud.ui.ImeStatusBarText
import com.intellij.openapi.Disposable
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.Service
import com.intellij.openapi.components.service
import com.intellij.openapi.project.Project
import java.util.concurrent.CopyOnWriteArrayList

/**
 * Project-level facade over [ImeHelperAppService]. Keeps the public API used by
 * the status-bar widget, caret HUD, and actions, while the helper process and
 * its shared state live at application level.
 */
@Service(Service.Level.PROJECT)
class ImeHudService(private val project: Project) : Disposable {
  interface Listener {
    fun onImeHudChanged()
  }

  private val listeners = CopyOnWriteArrayList<Listener>()
  private val appListener = ImeHelperAppService.Listener { fireChanged() }
  private val projectConsumerSuffix = CONSUMER_SCOPE_SEPARATOR + project.locationHash

  private val appService: ImeHelperAppService
    get() = service<ImeHelperAppService>()

  init {
    appService.addListener(appListener)
  }

  private companion object {
    private const val CONSUMER_SCOPE_SEPARATOR = ":"
  }

  fun start() {
    if (project.isDisposed) return
    appService.start()
  }

  fun acquireConsumer(consumerId: String) {
    if (project.isDisposed) return
    appService.acquireConsumer(consumerId + projectConsumerSuffix)
  }

  fun releaseConsumer(consumerId: String) {
    appService.releaseConsumer(consumerId + projectConsumerSuffix)
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
    appService.refresh()
  }

  fun snapshot(): ImeSnapshot = appService.snapshotState().latestSnapshot

  fun displayState(nowMillis: Long = System.currentTimeMillis()): HudDisplayState {
    val state = appService.snapshotState()
    return HudDisplayStateResolver.resolve(
      detectedSnapshot = state.latestSnapshot,
      lastStableSnapshot = state.lastStableSnapshot,
      unknownObservedAtMillis = state.unknownObservedAtMillis,
      nowMillis = nowMillis
    )
  }

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
    val debugInfo = appService.debugInfo()
    return ImeStatusBarText.tooltip(
      state = display.state,
      imeName = display.imeName,
      circuitOpen = debugInfo.circuitOpen,
      lastError = debugInfo.lastError
    )
  }

  fun statusSummaryLine(): String {
    val display = displayState().displaySnapshot
    val stateLabel = ImeStatusBarText.stateLabel(display.state)
    val ime = display.imeName?.trim().orEmpty()
    return if (ime.isEmpty()) {
      CursorImeHudBundle.message("statusBar.summary", stateLabel)
    } else {
      CursorImeHudBundle.message("statusBar.summaryWithIme", stateLabel, ime)
    }
  }

  fun diagnostics(): String = buildString {
    val notAvailable = notAvailableText()
    val present = CursorImeHudBundle.message("diagnostics.present")
    // One atomic read keeps the current/stable/display sections consistent
    // even while helper callbacks keep updating the shared state.
    val snapshotState = appService.snapshotState()
    val latestSnapshot = snapshotState.latestSnapshot
    val debugInfo = appService.debugInfo()
    appendLine(CursorImeHudBundle.message("diagnostics.header"))
    appendLine(CursorImeHudBundle.message("diagnostics.projectPresent"))
    appendLine()
    appendLine(CursorImeHudBundle.message("diagnostics.currentSnapshot"))
    appendLine("  state=${latestSnapshot.state.wireValue}")
    appendLine("  timestamp=${latestSnapshot.timestamp}")
    appendLine("  imeName=${latestSnapshot.imeName ?: notAvailable}")
    appendLine("  isOpen=${latestSnapshot.isOpen ?: notAvailable}")
    appendLine("  conversionNative=${latestSnapshot.conversionNative ?: notAvailable}")
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
        snapshotState.lastStableSnapshot?.state?.wireValue ?: notAvailable
      )
    )
    appendLine(CursorImeHudBundle.message("diagnostics.displayState"))
    val displayState = HudDisplayStateResolver.resolve(
      detectedSnapshot = snapshotState.latestSnapshot,
      lastStableSnapshot = snapshotState.lastStableSnapshot,
      unknownObservedAtMillis = snapshotState.unknownObservedAtMillis,
      nowMillis = System.currentTimeMillis()
    )
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
    val logs = appService.logsSnapshot()
    if (logs.isEmpty()) {
      appendLine("  ${CursorImeHudBundle.message("diagnostics.none")}")
    } else {
      logs.forEach { appendLine("  [${it.level}] ${it.timestamp} ${it.source}: ${it.message}") }
    }
  }

  override fun dispose() {
    appService.removeListener(appListener)
    appService.releaseConsumersMatching(projectConsumerSuffix)
    listeners.clear()
  }

  private fun fireChanged() {
    ApplicationManager.getApplication().invokeLater {
      listeners.forEach { it.onImeHudChanged() }
    }
  }

  private fun notAvailableText(): String = CursorImeHudBundle.message("diagnostics.notAvailable")
}
