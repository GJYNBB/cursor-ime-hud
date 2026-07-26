package com.chestnutch.cursorimehud.service

import com.chestnutch.cursorimehud.helper.ImeHelperProcess
import com.chestnutch.cursorimehud.model.DetectorLogEntry
import com.chestnutch.cursorimehud.model.HelperDebugInfo
import com.chestnutch.cursorimehud.model.HelperLifecycleState
import com.chestnutch.cursorimehud.model.ImeSnapshot
import com.intellij.openapi.Disposable
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.Service
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.atomic.AtomicReference

/**
 * Application-level owner of the single helper process shared by all projects.
 * Project-level [ImeHudService] instances are thin subscription layers on top:
 * they register consumers scoped with their project identity and forward change
 * notifications to project UI. Helper callbacks arrive on pooled/reader threads,
 * so all state here is thread-safe without any read/write action.
 */
@Service(Service.Level.APP)
class ImeHelperAppService : Disposable, ImeHelperProcess.Listener {
  fun interface Listener {
    fun onChanged()
  }

  private companion object {
    private const val MAX_LOG_ENTRIES = 200
  }

  private val listeners = CopyOnWriteArrayList<Listener>()
  private val helperConsumers = mutableSetOf<String>()
  private val logs = ArrayDeque<DetectorLogEntry>()
  private val helper = ImeHelperProcess()
  private val snapshotState = AtomicReference(SnapshotState.initial())

  @Volatile
  private var debugInfo: HelperDebugInfo

  init {
    debugInfo = helper.debugInfo()
    helper.addListener(this)
  }

  fun start() {
    helper.start()
  }

  fun refresh() {
    helper.start()
    helper.refresh()
  }

  fun acquireConsumer(consumerId: String) {
    synchronized(helperConsumers) {
      helperConsumers.add(consumerId)
    }
    helper.start()
  }

  fun releaseConsumer(consumerId: String) {
    val empty = synchronized(helperConsumers) {
      helperConsumers.remove(consumerId)
      helperConsumers.isEmpty()
    }
    if (empty) {
      helper.stop()
    }
  }

  /** Releases every consumer carrying [consumerSuffix]; called when a project is disposed. */
  fun releaseConsumersMatching(consumerSuffix: String) {
    val becameEmpty = synchronized(helperConsumers) {
      val removed = helperConsumers.removeAll { it.endsWith(consumerSuffix) }
      removed && helperConsumers.isEmpty()
    }
    if (becameEmpty) {
      helper.stop()
    }
  }

  fun addListener(listener: Listener) {
    listeners.add(listener)
  }

  fun removeListener(listener: Listener) {
    listeners.remove(listener)
  }

  fun snapshotState(): SnapshotState = snapshotState.get()

  fun debugInfo(): HelperDebugInfo = debugInfo

  fun logsSnapshot(): List<DetectorLogEntry> = synchronized(logs) { logs.toList() }

  override fun onSnapshot(snapshot: ImeSnapshot) {
    // Runs on whichever thread the helper delivers from; the pure transition
    // moves latest/stable/unknown-timer in one atomic step.
    snapshotState.updateAndGet { current -> SnapshotState.advance(current, snapshot, System.currentTimeMillis()) }
    fireChanged()
  }

  override fun onLog(entry: DetectorLogEntry) {
    synchronized(logs) {
      logs.addLast(entry)
      while (logs.size > MAX_LOG_ENTRIES) {
        logs.removeFirst()
      }
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
    helper.removeListener(this)
    helper.dispose()
    listeners.clear()
    synchronized(helperConsumers) {
      helperConsumers.clear()
    }
  }

  private fun fireChanged() {
    ApplicationManager.getApplication().invokeLater {
      listeners.forEach { it.onChanged() }
    }
  }
}
