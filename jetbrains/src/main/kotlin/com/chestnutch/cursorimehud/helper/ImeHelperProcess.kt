package com.chestnutch.cursorimehud.helper

import com.chestnutch.cursorimehud.model.DetectorLogEntry
import com.chestnutch.cursorimehud.model.HelperDebugInfo
import com.chestnutch.cursorimehud.model.HelperLifecycleState
import com.chestnutch.cursorimehud.model.ImeSnapshot
import com.chestnutch.cursorimehud.model.ImeState
import com.chestnutch.cursorimehud.protocol.HelperProtocol
import com.chestnutch.cursorimehud.protocol.MAX_BUFFER_BYTES
import com.chestnutch.cursorimehud.protocol.MAX_LINE_BYTES
import com.chestnutch.cursorimehud.protocol.PROTOCOL_VERSION
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.util.SystemInfo
import java.io.BufferedWriter
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.InputStream
import java.io.OutputStreamWriter
import java.nio.charset.StandardCharsets
import java.nio.file.Files
import java.security.MessageDigest
import java.time.Instant
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

class ImeHelperProcess {
  interface Listener {
    fun onSnapshot(snapshot: ImeSnapshot)
    fun onLog(entry: DetectorLogEntry)
    fun onDebugChanged(debugInfo: HelperDebugInfo)
  }

  private companion object {
    private const val SHUTDOWN_TIMEOUT_MS = 2_000L
    private const val STARTUP_TIMEOUT_MS = 4_000L
    private const val RESTART_STABILITY_MS = 30_000L
  }

  private val log = Logger.getInstance(ImeHelperProcess::class.java)
  private val listeners = CopyOnWriteArrayList<Listener>()
  private val disposed = AtomicBoolean(false)
  private var process: Process? = null
  private var stdin: BufferedWriter? = null
  private var lifecycleState = HelperLifecycleState.IDLE
  /** Bumped on each real start attempt and on stop/dispose to invalidate in-flight starts. */
  private var startEpoch = 0L
  /** Set when start/refresh is requested while STOPPING; consumed when stop reaches IDLE. */
  private var pendingStart = false
  private var helperFile: File? = null
  private var expectedSha256: String? = null
  private var actualSha256: String? = null
  private var hashMatches: Boolean? = null
  private var restartCount = 0
  private var circuitOpen = false
  private var shouldRestartOnExit = false
  private var lastError: String? = null
  private val restartPolicy = HelperRestartPolicy()
  private val timerExecutor: ScheduledExecutorService = Executors.newSingleThreadScheduledExecutor { runnable ->
    Thread(runnable, "cursor-ime-hud-helper-timer").apply { isDaemon = true }
  }
  private var startupTimeoutTask: ScheduledFuture<*>? = null
  private var stabilityResetTask: ScheduledFuture<*>? = null
  private var restartTask: ScheduledFuture<*>? = null

  fun addListener(listener: Listener) {
    listeners.add(listener)
    listener.onDebugChanged(debugInfo())
  }

  fun removeListener(listener: Listener) {
    listeners.remove(listener)
  }

  @Synchronized
  fun start() {
    if (disposed.get() || process?.isAlive == true || lifecycleState == HelperLifecycleState.STARTING) {
      return
    }

    if (lifecycleState == HelperLifecycleState.STOPPING) {
      // Remember the request; finishStopTransition will start once kill completes.
      pendingStart = true
      return
    }

    if (circuitOpen) {
      // Automatic callers must not bypass the circuit breaker.  refresh()
      // explicitly clears it and is the documented manual recovery path.
      lastError = "输入法助手自动重启已熔断，请执行“刷新输入法状态”后手动重试。"
      emitDebug()
      return
    }

    val descriptor = helperDescriptor()
    if (descriptor == null) {
      lifecycleState = HelperLifecycleState.UNAVAILABLE
      lastError = "没有可用的原生输入法助手：${System.getProperty("os.name")}/${System.getProperty("os.arch")}。"
      emitDebug()
      emitSnapshot(ImeSnapshot(state = ImeState.UNKNOWN, reason = "unsupported-os", confidence = 0.0, rawStateAvailable = false))
      return
    }

    pendingStart = false
    shouldRestartOnExit = true
    val epoch = ++startEpoch
    lifecycleState = HelperLifecycleState.STARTING
    emitDebug()
    ApplicationManager.getApplication().executeOnPooledThread {
      try {
        val helper = materializeHelper(descriptor)
        verifySha256(helper, descriptor)
        if (!shouldContinueStarting(epoch)) return@executeOnPooledThread
        val child = ProcessBuilder(helper.absolutePath)
          .redirectError(ProcessBuilder.Redirect.PIPE)
          .redirectOutput(ProcessBuilder.Redirect.PIPE)
          .start()
        val acceptedChild = acceptStartedChild(child, epoch)
        if (!acceptedChild) {
          child.destroy()
          waitThenForceKill(child)
          return@executeOnPooledThread
        }
        emitDebug()
        scheduleStartupTimeout(child)

        ApplicationManager.getApplication().executeOnPooledThread {
          try {
            consumeStdout(child, child.inputStream)
          } catch (error: Exception) {
            failActiveChild(child, "stdout", error)
          }
        }
        ApplicationManager.getApplication().executeOnPooledThread {
          try {
            consumeStderr(child, child.errorStream)
          } catch (error: Exception) {
            failActiveChild(child, "stderr", error)
          }
        }
        ApplicationManager.getApplication().executeOnPooledThread { waitForExit(child) }
      } catch (error: Exception) {
        val shouldFail = synchronized(this) {
          if (disposed.get() || epoch != startEpoch || lifecycleState != HelperLifecycleState.STARTING) {
            false
          } else {
            lifecycleState = HelperLifecycleState.FAILED
            process = null
            stdin = null
            lastError = redactedError(error)
            true
          }
        }
        if (!shouldFail) return@executeOnPooledThread
        emitLog("error", "启动 ImeWatcher 输入法助手失败：$lastError")
        emitSnapshot(ImeSnapshot(state = ImeState.UNKNOWN, reason = "helper-start-failed", confidence = 0.0, rawStateAvailable = false))
        emitDebug()
        scheduleRestartIfNeeded()
      }
    }
  }

  @Synchronized
  private fun shouldContinueStarting(epoch: Long): Boolean =
    !disposed.get() && lifecycleState == HelperLifecycleState.STARTING && epoch == startEpoch

  @Synchronized
  private fun acceptStartedChild(child: Process, epoch: Long): Boolean {
    if (disposed.get() || lifecycleState != HelperLifecycleState.STARTING || epoch != startEpoch) {
      return false
    }

    process = child
    stdin = BufferedWriter(OutputStreamWriter(child.outputStream, StandardCharsets.UTF_8))
    shouldRestartOnExit = true
    lastError = null
    return true
  }

  @Synchronized
  private fun markRunningAfterFirstSnapshot(child: Process): Boolean {
    if (disposed.get() || process !== child || lifecycleState != HelperLifecycleState.STARTING || !child.isAlive) {
      return false
    }

    lifecycleState = HelperLifecycleState.RUNNING
    cancelStartupTimeout()
    emitDebug()
    scheduleRestartBudgetReset(child)
    return true
  }

  private fun scheduleStartupTimeout(child: Process) {
    synchronized(this) {
      startupTimeoutTask?.cancel(false)
      startupTimeoutTask = timerExecutor.schedule({
        failStartingChildIfStillWaiting(child)
      }, STARTUP_TIMEOUT_MS, TimeUnit.MILLISECONDS)
    }
  }

  @Synchronized
  private fun failStartingChildIfStillWaiting(child: Process) {
    if (disposed.get() || process !== child || lifecycleState != HelperLifecycleState.STARTING) {
      return
    }

    lifecycleState = HelperLifecycleState.FAILED
    startupTimeoutTask = null
    lastError = "ImeWatcher 未在 ${STARTUP_TIMEOUT_MS} 毫秒内产生启动快照。"
    emitLog("error", lastError ?: "ImeWatcher 启动超时。")
    emitSnapshot(ImeSnapshot(state = ImeState.UNKNOWN, reason = "helper-startup-timeout", confidence = 0.0, rawStateAvailable = false))
    emitDebug()
    try {
      stdin?.close()
    } catch (_: Exception) {
    }
    child.destroy()
    waitThenForceKill(child)
    if (process === child) {
      process = null
      stdin = null
    }
    scheduleRestartIfNeeded()
  }

  @Synchronized
  private fun resetRestartBudgetIfStillRunning(child: Process): Boolean {
    if (disposed.get() || process !== child || lifecycleState != HelperLifecycleState.RUNNING || !child.isAlive) {
      return false
    }

    clearRestartBudget()
    emitDebug()
    return true
  }

  private fun scheduleRestartBudgetReset(child: Process) {
    synchronized(this) {
      stabilityResetTask?.cancel(false)
      stabilityResetTask = timerExecutor.schedule({
        resetRestartBudgetIfStillRunning(child)
      }, RESTART_STABILITY_MS, TimeUnit.MILLISECONDS)
    }
  }

  @Synchronized
  fun refresh() {
    if (disposed.get()) return

    // A user-initiated refresh is the only recovery path after the circuit
    // opens.  It also cancels any pending exponential-backoff retry.
    clearRestartBudget()
    cancelRestartTask()
    shouldRestartOnExit = true
    emitDebug()

    if (lifecycleState == HelperLifecycleState.STOPPING) {
      pendingStart = true
      return
    }

    val currentProcess = process
    val currentStdin = stdin
    if (currentProcess != null && currentProcess.isAlive && currentStdin != null) {
      try {
        currentStdin.write(HelperProtocol.refreshCommand())
        currentStdin.flush()
        return
      } catch (error: Exception) {
        emitLog("warn", "向输入法助手发送刷新命令失败：${error.message}")
      }
    }

    // If the helper has already exited, start() creates a fresh child now
    // rather than waiting for the old backoff task.
    if (process == null || process?.isAlive != true) {
      process = null
      stdin = null
      start()
    }
  }

  @Synchronized
  fun stop() {
    if (disposed.get()) return
    // Kill already in progress: do not clear pendingStart that a concurrent
    // start/refresh may have set while waiting for the process to die.
    if (lifecycleState == HelperLifecycleState.STOPPING) {
      return
    }
    // This stop cancels an automatic pending restart; a later start/refresh
    // during STOPPING will set pendingStart again.
    pendingStart = false
    startEpoch++
    cancelAllTimers()
    clearRestartBudget()
    val child = process ?: run {
      shouldRestartOnExit = false
      if (lifecycleState != HelperLifecycleState.DISPOSED) {
        lifecycleState = HelperLifecycleState.IDLE
        emitDebug()
      }
      finishStopTransition()
      return
    }
    val writer = stdin
    process = null
    stdin = null
    shouldRestartOnExit = false
    lifecycleState = HelperLifecycleState.STOPPING
    emitDebug()

    ApplicationManager.getApplication().executeOnPooledThread {
      try {
        writer?.close()
      } catch (_: Exception) {
      }

      try {
        child.destroy()
      } catch (_: Exception) {
      }
      waitThenForceKill(child)

      synchronized(this) {
        if (!disposed.get() && process == null) {
          lifecycleState = HelperLifecycleState.IDLE
        }
        finishStopTransition()
      }
      emitDebug()
    }
  }

  /**
   * After stop reaches IDLE, honor any start/refresh that arrived during STOPPING.
   * Must be called while holding the instance lock (or from an @Synchronized method).
   */
  private fun finishStopTransition() {
    if (disposed.get()) return
    if (pendingStart && lifecycleState == HelperLifecycleState.IDLE) {
      pendingStart = false
      start()
    }
  }

  fun dispose() {
    if (!disposed.compareAndSet(false, true)) return
    synchronized(this) {
      pendingStart = false
      startEpoch++
      cancelAllTimers()
      clearRestartBudget()
      timerExecutor.shutdownNow()
    }
    lifecycleState = HelperLifecycleState.STOPPING
    emitDebug()

    val child = process
    val writer = stdin
    process = null
    stdin = null
    shouldRestartOnExit = false
    ApplicationManager.getApplication().executeOnPooledThread {
      try {
        writer?.close()
      } catch (_: Exception) {
      }

      if (child != null) {
        try {
          child.destroy()
        } catch (_: Exception) {
        }
        waitThenForceKill(child)
      }

      synchronized(this) {
        process = null
        stdin = null
        pendingStart = false
        lifecycleState = HelperLifecycleState.DISPOSED
      }
      emitDebug()
    }
  }

  @Synchronized
  fun debugInfo(): HelperDebugInfo {
    restartCount = restartPolicy.attemptCount
    circuitOpen = restartPolicy.circuitOpen
    return HelperDebugInfo(
      lifecycleState = lifecycleState,
      helperPath = helperFile?.absolutePath,
      expectedSha256 = expectedSha256,
      actualSha256 = actualSha256,
      hashMatches = hashMatches,
      restartCount = restartCount,
      circuitOpen = circuitOpen,
      manualRefreshRequired = circuitOpen,
      lastError = lastError,
      osGate = helperDescriptor()?.platformKey ?: "unsupported-os"
    )
  }

  private fun helperDescriptor(): HelperResourceDescriptor? = HelperManifest.descriptorForCurrentHost()

  private fun materializeHelper(descriptor: HelperResourceDescriptor): File {
    val classLoader = javaClass.classLoader
    val hashText = classLoader.getResourceAsStream(descriptor.hashPath)?.bufferedReader(StandardCharsets.US_ASCII)?.use { it.readText().trim() }
      ?: throw IllegalStateException("缺少输入法助手 SHA-256 资源：${descriptor.hashPath}")
    val input = classLoader.getResourceAsStream(descriptor.resourcePath)
      ?: throw IllegalStateException("缺少输入法助手可执行资源：${descriptor.resourcePath}。请在打包前构建 ${descriptor.platformKey} 助手。")

    val dir = Files.createTempDirectory("cursor-ime-hud-jetbrains").toFile().apply { deleteOnExit() }
    val target = File(dir, descriptor.fileName)
    input.use { source -> target.outputStream().use { source.copyTo(it) } }
    target.setExecutable(true)
    helperFile = target
    expectedSha256 = hashText
    return target
  }

  private fun verifySha256(file: File, descriptor: HelperResourceDescriptor) {
    val expected = expectedSha256 ?: throw IllegalStateException("缺少输入法助手的预期 SHA-256。")
    val actual = sha256(file)
    actualSha256 = actual
    hashMatches = actual.equals(expected, ignoreCase = true)
    if (hashMatches != true) {
      throw IllegalStateException("${descriptor.fileName} SHA-256 不匹配：expected=$expected actual=$actual")
    }
  }

  private fun consumeStdout(child: Process, stream: InputStream) {
    var helloReceived = false
    readBoundedJsonLines(stream, "stdout") { line ->
      if (process !== child || disposed.get()) return@readBoundedJsonLines
      if (!helloReceived) {
        val hello = HelperProtocol.parseHelloLine(line)
          ?: throw IllegalStateException("输入法助手 stdout 的首行不是 hello 消息。")
        if (hello.version != PROTOCOL_VERSION) {
          throw IllegalStateException("不支持输入法助手协议版本 ${hello.version}；expected=$PROTOCOL_VERSION。")
        }
        helloReceived = true
        emitLog("info", "已收到 ImeWatcher hello：capabilities=${hello.capabilities.joinToString(",")}")
        return@readBoundedJsonLines
      }

      val snapshot = HelperProtocol.parseSnapshotLine(line)
      if (snapshot != null) {
        markRunningAfterFirstSnapshot(child)
        emitSnapshot(snapshot)
      } else {
        emitLog("warn", "已忽略输入法助手 stdout 中的无效行。")
      }
    }
  }

  private fun consumeStderr(child: Process, stream: InputStream) {
    readBoundedJsonLines(stream, "stderr") { line ->
      if (process !== child || disposed.get()) return@readBoundedJsonLines
      val entry = HelperProtocol.parseLogLine(line)
        ?: DetectorLogEntry(level = "info", message = line, timestamp = Instant.now().toString())
      emitLog(entry)
    }
  }

  private fun readBoundedJsonLines(stream: InputStream, streamName: String, onLine: (String) -> Unit) {
    val line = ByteArrayOutputStream()
    var bufferedBytes = 0
    val chunk = ByteArray(8192)

    while (!disposed.get()) {
      val read = stream.read(chunk)
      if (read < 0) break

      for (index in 0 until read) {
        val byte = chunk[index]
        bufferedBytes++
        if (bufferedBytes > MAX_BUFFER_BYTES) {
          throw IllegalStateException("输入法助手 $streamName 超过滚动缓冲区上限：$MAX_BUFFER_BYTES bytes。")
        }

        if (byte.toInt() == '\n'.code) {
          emitBufferedLine(line, onLine)
          line.reset()
          bufferedBytes = 0
        } else {
          line.write(byte.toInt())
          if (line.size() > MAX_LINE_BYTES) {
            throw IllegalStateException("输入法助手 $streamName 单行超过上限：$MAX_LINE_BYTES bytes。")
          }
        }
      }
    }

    if (line.size() > 0 && !disposed.get()) {
      emitBufferedLine(line, onLine)
    }
  }

  private fun emitBufferedLine(line: ByteArrayOutputStream, onLine: (String) -> Unit) {
    val bytes = line.toByteArray()
    val length = if (bytes.isNotEmpty() && bytes.last().toInt() == '\r'.code) bytes.size - 1 else bytes.size
    onLine(String(bytes, 0, length, StandardCharsets.UTF_8))
  }

  private fun waitForExit(child: Process) {
    val code = child.waitFor()
    val wasActive = synchronized(this) {
      if (process === child) {
        cancelStartupTimeout()
        cancelStabilityReset()
        process = null
        stdin = null
        true
      } else {
        false
      }
    }

    if (!wasActive) return

    if (!disposed.get() && lifecycleState != HelperLifecycleState.FAILED) {
      lifecycleState = HelperLifecycleState.FAILED
      lastError = "ImeWatcher 已退出：exitCode=$code"
      emitLog("warn", lastError ?: "ImeWatcher 已退出。")
      emitSnapshot(ImeSnapshot(state = ImeState.UNKNOWN, reason = "helper-exited", confidence = 0.0, rawStateAvailable = false))
      emitDebug()
      scheduleRestartIfNeeded()
    }
  }

  @Synchronized
  private fun failActiveChild(child: Process, stream: String, error: Exception) {
    if (disposed.get() || process !== child) return
    cancelStartupTimeout()
    cancelStabilityReset()
    lifecycleState = HelperLifecycleState.FAILED
    lastError = redactedError(error)
    emitLog("error", "ImeWatcher $stream 处理失败：$lastError")
    emitSnapshot(ImeSnapshot(state = ImeState.UNKNOWN, reason = "helper-$stream-stream-failed", confidence = 0.0, rawStateAvailable = false))
    emitDebug()
    try {
      stdin?.close()
    } catch (_: Exception) {
    }
    child.destroy()
    waitThenForceKill(child)
    if (process === child) {
      process = null
      stdin = null
    }
    scheduleRestartIfNeeded()
  }

  @Synchronized
  private fun scheduleRestartIfNeeded() {
    if (
      disposed.get() ||
      !shouldRestartOnExit ||
      process != null ||
      restartTask != null ||
      circuitOpen ||
      restartCount >= HelperRestartPolicy.MAX_ATTEMPTS
    ) {
      return
    }

    val restartPlan = restartPolicy.recordFailure()
    restartCount = restartPlan.attempt
    circuitOpen = restartPlan.circuitOpened
    emitDebug()

    if (!restartPlan.shouldRestart) {
      shouldRestartOnExit = false
      lastError = "输入法助手在 ${HelperRestartPolicy.FAILURE_WINDOW_MS / 60_000} 分钟内失败 " +
        "${restartPlan.attempt} 次，已停止自动重启。请执行“刷新输入法状态”后手动重试。"
      emitLog("error", lastError ?: "输入法助手自动重启已熔断。")
      emitDebug()
      return
    }

    emitLog(
      "warn",
      "输入法助手发生故障，${restartPlan.delayMs} 毫秒后将进行第 ${restartPlan.attempt} 次自动重启。"
    )
    restartTask = timerExecutor.schedule({
      val shouldStart = synchronized(this) {
        restartTask = null
        !disposed.get() && shouldRestartOnExit && process == null && !circuitOpen
      }
      if (shouldStart) {
        start()
      }
    }, restartPlan.delayMs, TimeUnit.MILLISECONDS)
  }

  private fun redactedError(error: Exception): String = (error.message ?: error::class.java.name)
    .replace(Regex("[A-Za-z]:\\\\[^\\r\\n\"'`<>|]+"), "<path>")
    .replace(Regex("/(?:Users|home|tmp|var|opt|private|Applications|usr|etc|bin|sbin|lib|mnt|Volumes)/[^\\r\\n\"'`<>]*"), "<path>")

  @Synchronized
  private fun clearRestartBudget() {
    restartPolicy.reset()
    restartCount = 0
    circuitOpen = false
  }

  @Synchronized
  private fun cancelStartupTimeout() {
    startupTimeoutTask?.cancel(false)
    startupTimeoutTask = null
  }

  @Synchronized
  private fun cancelStabilityReset() {
    stabilityResetTask?.cancel(false)
    stabilityResetTask = null
  }

  @Synchronized
  private fun cancelRestartTask() {
    restartTask?.cancel(false)
    restartTask = null
  }

  @Synchronized
  private fun cancelAllTimers() {
    cancelStartupTimeout()
    cancelStabilityReset()
    cancelRestartTask()
  }

  private fun waitThenForceKill(child: Process) {
    try {
      if (child.waitFor(SHUTDOWN_TIMEOUT_MS, TimeUnit.MILLISECONDS) || !child.isAlive) return

      if (SystemInfo.isWindows) {
        try {
          ProcessBuilder("taskkill", "/F", "/T", "/PID", child.pid().toString())
            .redirectOutput(ProcessBuilder.Redirect.DISCARD)
            .redirectError(ProcessBuilder.Redirect.DISCARD)
            .start()
            .waitFor(SHUTDOWN_TIMEOUT_MS, TimeUnit.MILLISECONDS)
        } catch (_: Exception) {
          child.destroyForcibly()
        }
      } else {
        child.destroyForcibly()
      }
    } catch (_: Exception) {
      try {
        child.destroyForcibly()
      } catch (_: Exception) {
      }
    }
  }

  private fun emitSnapshot(snapshot: ImeSnapshot) {
    invokeLaterOrRun {
      listeners.forEach { it.onSnapshot(snapshot) }
    }
  }

  private fun emitLog(level: String, message: String) {
    emitLog(DetectorLogEntry(level = level, message = message))
  }

  private fun emitLog(entry: DetectorLogEntry) {
    when (entry.level) {
      "error" -> log.warn(entry.message)
      "warn" -> log.warn(entry.message)
      else -> log.info(entry.message)
    }
    invokeLaterOrRun {
      listeners.forEach { it.onLog(entry) }
    }
  }

  private fun emitDebug() {
    val debug = debugInfo()
    invokeLaterOrRun {
      listeners.forEach { it.onDebugChanged(debug) }
    }
  }

  private fun invokeLaterOrRun(action: () -> Unit) {
    val application = ApplicationManager.getApplication()
    if (application == null) {
      action()
    } else {
      application.invokeLater { action() }
    }
  }

  private fun sha256(file: File): String {
    val digest = MessageDigest.getInstance("SHA-256")
    file.inputStream().use { input ->
      val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
      while (true) {
        val read = input.read(buffer)
        if (read < 0) break
        digest.update(buffer, 0, read)
      }
    }
    return digest.digest().joinToString("") { "%02x".format(it) }
  }
}
