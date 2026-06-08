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
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

class WinImeWatcherProcess {
  interface Listener {
    fun onSnapshot(snapshot: ImeSnapshot)
    fun onLog(entry: DetectorLogEntry)
    fun onDebugChanged(debugInfo: HelperDebugInfo)
  }

  private companion object {
    private const val SHUTDOWN_TIMEOUT_MS = 2_000L
  }

  private val log = Logger.getInstance(WinImeWatcherProcess::class.java)
  private val listeners = CopyOnWriteArrayList<Listener>()
  private val disposed = AtomicBoolean(false)
  private var process: Process? = null
  private var stdin: BufferedWriter? = null
  private var lifecycleState = HelperLifecycleState.IDLE
  private var helperFile: File? = null
  private var expectedSha256: String? = null
  private var actualSha256: String? = null
  private var hashMatches: Boolean? = null
  private var restartCount = 0
  private var lastError: String? = null

  fun addListener(listener: Listener) {
    listeners.add(listener)
    listener.onDebugChanged(debugInfo())
  }

  fun removeListener(listener: Listener) {
    listeners.remove(listener)
  }

  @Synchronized
  fun start() {
    if (disposed.get() || process?.isAlive == true) return

    if (!SystemInfo.isWindows) {
      lifecycleState = HelperLifecycleState.UNAVAILABLE
      lastError = "Windows-only MVP: native helper is disabled on this operating system."
      emitDebug()
      emitSnapshot(ImeSnapshot(state = ImeState.UNKNOWN, reason = "unsupported-os", confidence = 0.0, rawStateAvailable = false))
      return
    }

    lifecycleState = HelperLifecycleState.STARTING
    emitDebug()
    ApplicationManager.getApplication().executeOnPooledThread {
      try {
        val helper = materializeHelper()
        verifySha256(helper)
        val child = ProcessBuilder(helper.absolutePath)
          .redirectError(ProcessBuilder.Redirect.PIPE)
          .redirectOutput(ProcessBuilder.Redirect.PIPE)
          .start()
        synchronized(this) {
          process = child
          stdin = BufferedWriter(OutputStreamWriter(child.outputStream, StandardCharsets.UTF_8))
          lifecycleState = HelperLifecycleState.RUNNING
          lastError = null
        }
        emitDebug()

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
        synchronized(this) {
          lifecycleState = HelperLifecycleState.FAILED
          process = null
          stdin = null
          lastError = error.message ?: error::class.java.name
        }
        emitLog("error", "Failed to start WinImeWatcher helper: $lastError")
        emitSnapshot(ImeSnapshot(state = ImeState.UNKNOWN, reason = "helper-start-failed", confidence = 0.0, rawStateAvailable = false))
        emitDebug()
      }
    }
  }

  fun refresh() {
    try {
      stdin?.apply {
        write(HelperProtocol.refreshCommand())
        flush()
      }
    } catch (error: Exception) {
      emitLog("warn", "Failed to send refresh command: ${error.message}")
    }
  }

  fun dispose() {
    if (!disposed.compareAndSet(false, true)) return
    lifecycleState = HelperLifecycleState.STOPPING
    emitDebug()

    val child = process
    val writer = stdin
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
        lifecycleState = HelperLifecycleState.DISPOSED
      }
      emitDebug()
    }
  }

  fun debugInfo(): HelperDebugInfo = HelperDebugInfo(
    lifecycleState = lifecycleState,
    helperPath = helperFile?.absolutePath,
    expectedSha256 = expectedSha256,
    actualSha256 = actualSha256,
    hashMatches = hashMatches,
    restartCount = restartCount,
    lastError = lastError,
    osGate = if (SystemInfo.isWindows) "windows" else "non-windows-disabled"
  )

  private fun materializeHelper(): File {
    val resourcePath = "bin/win-x64/WinImeWatcher.exe"
    val hashPath = "bin/win-x64/WinImeWatcher.exe.sha256"
    val classLoader = javaClass.classLoader
    val hashText = classLoader.getResourceAsStream(hashPath)?.bufferedReader(StandardCharsets.US_ASCII)?.use { it.readText().trim() }
      ?: throw IllegalStateException("Missing helper SHA-256 resource: $hashPath")
    val input = classLoader.getResourceAsStream(resourcePath)
      ?: throw IllegalStateException("Missing helper executable resource: $resourcePath. Build on Windows so Gradle can package WinImeWatcher.exe.")

    val dir = Files.createTempDirectory("cursor-ime-hud-jetbrains").toFile().apply { deleteOnExit() }
    val target = File(dir, "WinImeWatcher.exe")
    input.use { source -> target.outputStream().use { source.copyTo(it) } }
    target.setExecutable(true)
    helperFile = target
    expectedSha256 = hashText
    return target
  }

  private fun verifySha256(file: File) {
    val expected = expectedSha256 ?: throw IllegalStateException("Missing expected helper SHA-256.")
    val actual = sha256(file)
    actualSha256 = actual
    hashMatches = actual.equals(expected, ignoreCase = true)
    if (hashMatches != true) {
      throw IllegalStateException("WinImeWatcher.exe SHA-256 mismatch: expected=$expected actual=$actual")
    }
  }

  private fun consumeStdout(child: Process, stream: InputStream) {
    var helloReceived = false
    readBoundedJsonLines(stream, "stdout") { line ->
      if (process !== child || disposed.get()) return@readBoundedJsonLines
      if (!helloReceived) {
        val hello = HelperProtocol.parseHelloLine(line)
          ?: throw IllegalStateException("First helper stdout line was not a hello message.")
        if (hello.version != PROTOCOL_VERSION) {
          throw IllegalStateException("Unsupported helper protocol version ${hello.version}; expected $PROTOCOL_VERSION.")
        }
        helloReceived = true
        emitLog("info", "WinImeWatcher hello received with capabilities=${hello.capabilities.joinToString(",")}")
        return@readBoundedJsonLines
      }

      val snapshot = HelperProtocol.parseSnapshotLine(line)
      if (snapshot != null) {
        emitSnapshot(snapshot)
      } else {
        emitLog("warn", "Ignored invalid helper stdout line.")
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
          throw IllegalStateException("Helper $streamName exceeded rolling buffer limit of $MAX_BUFFER_BYTES bytes.")
        }

        if (byte.toInt() == '\n'.code) {
          emitBufferedLine(line, onLine)
          line.reset()
          bufferedBytes = 0
        } else {
          line.write(byte.toInt())
          if (line.size() > MAX_LINE_BYTES) {
            throw IllegalStateException("Helper $streamName line exceeded $MAX_LINE_BYTES bytes.")
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
    synchronized(this) {
      if (process === child) {
        process = null
        stdin = null
      }
    }

    if (!disposed.get() && lifecycleState != HelperLifecycleState.FAILED) {
      lifecycleState = HelperLifecycleState.FAILED
      lastError = "WinImeWatcher exited with code $code"
      emitLog("warn", lastError ?: "WinImeWatcher exited")
      emitSnapshot(ImeSnapshot(state = ImeState.UNKNOWN, reason = "helper-exited", confidence = 0.0, rawStateAvailable = false))
      emitDebug()
    }
  }

  @Synchronized
  private fun failActiveChild(child: Process, stream: String, error: Exception) {
    if (disposed.get() || process !== child) return
    lifecycleState = HelperLifecycleState.FAILED
    lastError = error.message ?: error::class.java.name
    restartCount++
    emitLog("error", "WinImeWatcher $stream handler failed: $lastError")
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
    ApplicationManager.getApplication().invokeLater {
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
    ApplicationManager.getApplication().invokeLater {
      listeners.forEach { it.onLog(entry) }
    }
  }

  private fun emitDebug() {
    val debug = debugInfo()
    ApplicationManager.getApplication().invokeLater {
      listeners.forEach { it.onDebugChanged(debug) }
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
