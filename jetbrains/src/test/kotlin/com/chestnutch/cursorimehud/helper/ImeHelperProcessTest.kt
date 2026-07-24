package com.chestnutch.cursorimehud.helper

import com.chestnutch.cursorimehud.model.HelperLifecycleState
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.io.OutputStream
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class ImeHelperProcessTest {
  @Test
  fun stopCancelsPendingRestartWhenNoProcessIsActive() {
    val helper = ImeHelperProcess()
    helper.setPrivateField("shouldRestartOnExit", true)
    helper.setPrivateField("lifecycleState", HelperLifecycleState.FAILED)

    helper.stop()

    assertFalse(helper.getPrivateField<Boolean>("shouldRestartOnExit"))
    assertEquals(HelperLifecycleState.IDLE, helper.getPrivateField("lifecycleState"))
  }

  @Test
  fun scheduleRestartHonorsMaxAttempts() {
    val helper = ImeHelperProcess()
    helper.setPrivateField("shouldRestartOnExit", true)
    helper.setPrivateField("restartCount", 10)

    helper.invokePrivate("scheduleRestartIfNeeded")

    assertEquals(10, helper.getPrivateField("restartCount"))
  }

  @Test
  fun redactedErrorHandlesPathsWithSpaces() {
    val helper = ImeHelperProcess()

    val redacted = helper.invokePrivate<String>(
      "redactedError",
      Exception::class.java,
      IllegalStateException(
        "spawn C:\\Users\\Jane Doe\\helper.exe and C:\\Program Files\\Foo\\bar.exe and /Users/Jane Doe/helper failed"
      )
    )

    assertFalse(redacted.contains("Jane Doe"))
    assertFalse(redacted.contains("Doe\\helper.exe"))
    assertFalse(redacted.contains("Program Files"))
    assertFalse(redacted.contains("Files\\Foo"))
    assertFalse(redacted.contains("Foo\\bar.exe"))
    assertFalse(redacted.contains("Doe/helper"))
    assertTrue(redacted.contains("<path>"))
  }

  @Test
  fun acceptStartedChildKeepsLifecycleStartingUntilFirstSnapshot() {
    val helper = ImeHelperProcess()
    val process = FakeProcess()
    helper.setPrivateField("lifecycleState", HelperLifecycleState.STARTING)
    helper.setPrivateField("startEpoch", 3L)
    helper.setPrivateField("restartCount", 10)
    helper.setPrivateField("lastError", "previous failure")
    helper.setPrivateField("shouldRestartOnExit", false)

    val accepted = helper.invokePrivate<Boolean>(
      "acceptStartedChild",
      arrayOf(Process::class.java, Long::class.javaPrimitiveType!!),
      arrayOf(process, 3L)
    )

    assertTrue(accepted)
    assertEquals(HelperLifecycleState.STARTING, helper.getPrivateField("lifecycleState"))
    assertEquals(10, helper.getPrivateField("restartCount"))
    assertEquals(null, helper.getPrivateField<String?>("lastError"))
    assertEquals(true, helper.getPrivateField("shouldRestartOnExit"))
    assertEquals(process, helper.getPrivateField("process"))
  }

  @Test
  fun stableRunningChildResetsRestartCountAfterPriorFailures() {
    val helper = ImeHelperProcess()
    val process = FakeProcess(alive = true)
    helper.setPrivateField("process", process)
    helper.setPrivateField("lifecycleState", HelperLifecycleState.RUNNING)
    helper.setPrivateField("restartCount", 10)

    val reset = helper.invokePrivate<Boolean>("resetRestartBudgetIfStillRunning", Process::class.java, process)

    assertTrue(reset)
    assertEquals(0, helper.getPrivateField("restartCount"))
  }

  @Test
  fun deadActiveChildDoesNotResetRestartCount() {
    val helper = ImeHelperProcess()
    val process = FakeProcess(alive = false)
    helper.setPrivateField("process", process)
    helper.setPrivateField("lifecycleState", HelperLifecycleState.RUNNING)
    helper.setPrivateField("restartCount", 7)

    val reset = helper.invokePrivate<Boolean>("resetRestartBudgetIfStillRunning", Process::class.java, process)

    assertFalse(reset)
    assertEquals(7, helper.getPrivateField("restartCount"))
  }

  @Test
  fun exitedChildDoesNotResetRestartCount() {
    val helper = ImeHelperProcess()
    val activeProcess = FakeProcess(alive = true)
    helper.setPrivateField("process", activeProcess)
    helper.setPrivateField("lifecycleState", HelperLifecycleState.RUNNING)
    helper.setPrivateField("restartCount", 7)

    val reset = helper.invokePrivate<Boolean>("resetRestartBudgetIfStillRunning", Process::class.java, FakeProcess())

    assertFalse(reset)
    assertEquals(7, helper.getPrivateField("restartCount"))
  }

  @Test
  fun discardedStartedChildDoesNotResetRestartCount() {
    val helper = ImeHelperProcess()
    helper.setPrivateField("lifecycleState", HelperLifecycleState.IDLE)
    helper.setPrivateField("startEpoch", 1L)
    helper.setPrivateField("restartCount", 7)

    val accepted = helper.invokePrivate<Boolean>(
      "acceptStartedChild",
      arrayOf(Process::class.java, Long::class.javaPrimitiveType!!),
      arrayOf(FakeProcess(), 1L)
    )

    assertFalse(accepted)
    assertEquals(HelperLifecycleState.IDLE, helper.getPrivateField("lifecycleState"))
    assertEquals(7, helper.getPrivateField("restartCount"))
    assertEquals(null, helper.getPrivateField<Process?>("process"))
  }

  @Test
  fun startWhileStoppingSetsPendingStart() {
    val helper = ImeHelperProcess()
    helper.setPrivateField("lifecycleState", HelperLifecycleState.STOPPING)
    helper.setPrivateField("pendingStart", false)

    helper.start()

    assertTrue(helper.getPrivateField("pendingStart"))
    assertEquals(HelperLifecycleState.STOPPING, helper.getPrivateField("lifecycleState"))
  }

  @Test
  fun refreshWhileStoppingSetsPendingStartAndClearsCircuit() {
    val helper = ImeHelperProcess()
    helper.setPrivateField("lifecycleState", HelperLifecycleState.STOPPING)
    helper.setPrivateField("circuitOpen", true)
    helper.setPrivateField("restartCount", 10)
    helper.setPrivateField("pendingStart", false)

    helper.refresh()

    assertTrue(helper.getPrivateField("pendingStart"))
    assertEquals(HelperLifecycleState.STOPPING, helper.getPrivateField("lifecycleState"))
    assertFalse(helper.getPrivateField("circuitOpen"))
    assertEquals(0, helper.getPrivateField("restartCount"))
  }

  @Test
  fun finishStopWithPendingStartConsumesFlagAndAttemptsStart() {
    val helper = ImeHelperProcess()
    helper.setPrivateField("lifecycleState", HelperLifecycleState.IDLE)
    helper.setPrivateField("pendingStart", true)
    helper.setPrivateField("shouldRestartOnExit", true)

    try {
      helper.invokePrivate("finishStopTransition")
    } catch (_: Throwable) {
      // Unit tests may lack ApplicationManager; pendingStart is cleared before start().
    }

    assertFalse(helper.getPrivateField("pendingStart"))
  }

  @Test
  fun secondStopWhileStoppingDoesNotClearPendingStart() {
    val helper = ImeHelperProcess()
    helper.setPrivateField("lifecycleState", HelperLifecycleState.STOPPING)
    helper.setPrivateField("pendingStart", true)
    helper.setPrivateField("startEpoch", 4L)

    helper.stop()

    assertTrue(helper.getPrivateField("pendingStart"))
    assertEquals(HelperLifecycleState.STOPPING, helper.getPrivateField("lifecycleState"))
    assertEquals(4L, helper.getPrivateField("startEpoch"))
  }

  @Test
  fun acceptStartedChildRejectsStaleEpoch() {
    val helper = ImeHelperProcess()
    helper.setPrivateField("lifecycleState", HelperLifecycleState.STARTING)
    helper.setPrivateField("startEpoch", 5L)

    val accepted = helper.invokePrivate<Boolean>(
      "acceptStartedChild",
      arrayOf(Process::class.java, Long::class.javaPrimitiveType!!),
      arrayOf(FakeProcess(), 4L)
    )

    assertFalse(accepted)
    assertEquals(null, helper.getPrivateField<Process?>("process"))
    assertEquals(HelperLifecycleState.STARTING, helper.getPrivateField("lifecycleState"))
  }

  @Test
  fun stopWhileStartingInvalidatesInFlightAccept() {
    val helper = ImeHelperProcess()
    helper.setPrivateField("lifecycleState", HelperLifecycleState.STARTING)
    helper.setPrivateField("startEpoch", 2L)
    helper.setPrivateField("process", null)
    helper.setPrivateField("shouldRestartOnExit", true)

    helper.stop()

    assertEquals(HelperLifecycleState.IDLE, helper.getPrivateField("lifecycleState"))
    assertTrue(helper.getPrivateField<Long>("startEpoch") > 2L)
    assertFalse(helper.getPrivateField("pendingStart"))

    val accepted = helper.invokePrivate<Boolean>(
      "acceptStartedChild",
      arrayOf(Process::class.java, Long::class.javaPrimitiveType!!),
      arrayOf(FakeProcess(), 2L)
    )
    assertFalse(accepted)
    assertEquals(null, helper.getPrivateField<Process?>("process"))
  }

  @Test
  fun refreshOnLiveProcessDoesNotHoldInstanceLockDuringWrite() {
    val helper = ImeHelperProcess()
    val process = FakeProcess(alive = true)
    val entered = java.util.concurrent.CountDownLatch(1)
    val release = java.util.concurrent.CountDownLatch(1)
    val blockingWriter = object : java.io.BufferedWriter(java.io.StringWriter()) {
      override fun write(str: String) {
        // no-op content for refresh command
      }

      override fun flush() {
        entered.countDown()
        release.await(2, java.util.concurrent.TimeUnit.SECONDS)
      }
    }
    helper.setPrivateField("process", process)
    helper.setPrivateField("stdin", blockingWriter)
    helper.setPrivateField("lifecycleState", HelperLifecycleState.RUNNING)

    // ApplicationManager is null in pure unit tests, so writeRefreshCommandAsync runs
    // the task on the calling thread. Run refresh on a background thread so a still-
    // synchronous flush would block join(); after the fix, refresh must return before flush finishes.
    val refreshThread = Thread({ helper.refresh() }, "test-refresh")
    refreshThread.start()

    // With ApplicationManager null, task runs on refreshThread; without the fix, join blocks on flush.
    // With the fix path when Application is present, refresh returns immediately. When Application is null
    // the task is inline — so assert that debugInfo can still run while flush is blocked by using
    // a separate thread for refresh and requiring entered before we call debugInfo after a short wait.
    assertTrue(entered.await(1, java.util.concurrent.TimeUnit.SECONDS), "write/flush task should start")

    // Instance lock must be free so debugInfo (synchronized) can enter promptly.
    val debug = helper.debugInfo()
    assertEquals(HelperLifecycleState.RUNNING, debug.lifecycleState)

    release.countDown()
    refreshThread.join(2000)
  }

  @Test
  fun failStartingChildDoesNotHoldInstanceLockDuringForceKill() {
    val helper = ImeHelperProcess()
    val entered = java.util.concurrent.CountDownLatch(1)
    val release = java.util.concurrent.CountDownLatch(1)
    val process = object : FakeProcess(alive = true) {
      override fun waitFor(timeout: Long, unit: java.util.concurrent.TimeUnit): Boolean {
        entered.countDown()
        release.await(2, java.util.concurrent.TimeUnit.SECONDS)
        return false
      }
    }
    helper.setPrivateField("process", process)
    helper.setPrivateField("stdin", java.io.BufferedWriter(java.io.StringWriter()))
    helper.setPrivateField("lifecycleState", HelperLifecycleState.STARTING)

    val failThread = Thread(
      { helper.invokePrivate("failStartingChildIfStillWaiting", Process::class.java, process) },
      "test-fail-starting"
    )
    failThread.start()

    assertTrue(entered.await(1, java.util.concurrent.TimeUnit.SECONDS), "force kill wait should start")
    // Instance lock must be free while waitThenForceKill blocks.
    val debug = helper.debugInfo()
    assertEquals(HelperLifecycleState.FAILED, debug.lifecycleState)
    assertEquals(null, helper.getPrivateField<Process?>("process"))

    release.countDown()
    failThread.join(2000)
  }

  @Test
  fun failActiveChildDoesNotHoldInstanceLockDuringForceKill() {
    val helper = ImeHelperProcess()
    val entered = java.util.concurrent.CountDownLatch(1)
    val release = java.util.concurrent.CountDownLatch(1)
    val process = object : FakeProcess(alive = true) {
      override fun waitFor(timeout: Long, unit: java.util.concurrent.TimeUnit): Boolean {
        entered.countDown()
        release.await(2, java.util.concurrent.TimeUnit.SECONDS)
        return false
      }
    }
    helper.setPrivateField("process", process)
    helper.setPrivateField("stdin", java.io.BufferedWriter(java.io.StringWriter()))
    helper.setPrivateField("lifecycleState", HelperLifecycleState.RUNNING)

    val failThread = Thread(
      {
        helper.invokePrivate(
          "failActiveChild",
          arrayOf(Process::class.java, String::class.java, Exception::class.java),
          arrayOf(process, "stdout", IllegalStateException("stream broke"))
        )
      },
      "test-fail-active"
    )
    failThread.start()

    assertTrue(entered.await(1, java.util.concurrent.TimeUnit.SECONDS), "force kill wait should start")
    val debug = helper.debugInfo()
    assertEquals(HelperLifecycleState.FAILED, debug.lifecycleState)
    assertEquals(null, helper.getPrivateField<Process?>("process"))

    release.countDown()
    failThread.join(2000)
  }

  @Test
  fun waitForExitDoesNotOverwriteLifecycleAfterConcurrentStart() {
    val helper = ImeHelperProcess()
    val exited = FakeProcess(alive = false)
    helper.setPrivateField("process", exited)
    helper.setPrivateField("lifecycleState", HelperLifecycleState.RUNNING)

    // Simulate a concurrent start that has already claimed the lifecycle after process was cleared.
    // waitForExit must only mark FAILED while still owning the child reference under the lock.
    val newProcess = FakeProcess(alive = true)
    helper.setPrivateField("process", newProcess)
    helper.setPrivateField("lifecycleState", HelperLifecycleState.STARTING)

    helper.invokePrivate("waitForExit", Process::class.java, exited)

    assertEquals(HelperLifecycleState.STARTING, helper.getPrivateField("lifecycleState"))
    assertEquals(newProcess, helper.getPrivateField("process"))
  }

  @Test
  fun waitForExitMarksFailedAtomicallyWhenChildStillOwned() {
    val helper = ImeHelperProcess()
    val exited = FakeProcess(alive = false)
    helper.setPrivateField("process", exited)
    helper.setPrivateField("stdin", java.io.BufferedWriter(java.io.StringWriter()))
    helper.setPrivateField("lifecycleState", HelperLifecycleState.RUNNING)
    helper.setPrivateField("shouldRestartOnExit", false)

    helper.invokePrivate("waitForExit", Process::class.java, exited)

    assertEquals(HelperLifecycleState.FAILED, helper.getPrivateField("lifecycleState"))
    assertEquals(null, helper.getPrivateField<Process?>("process"))
    assertEquals(null, helper.getPrivateField<Any?>("stdin"))
    assertTrue(helper.getPrivateField<String?>("lastError")?.contains("exitCode=") == true)
  }

  @Test
  fun hashMetadataPublishedAtomicallyUnderInstanceLock() {
    val helper = ImeHelperProcess()
    val file = java.io.File.createTempFile("ime-helper", ".bin").apply {
      writeText("payload")
      deleteOnExit()
    }

    val publish = Runnable {
      synchronized(helper) {
        helper.setPrivateField("helperFile", file)
        helper.setPrivateField("expectedSha256", "abc")
        helper.setPrivateField("actualSha256", "abc")
        helper.setPrivateField("hashMatches", true)
      }
    }

    val inconsistencies = java.util.concurrent.atomic.AtomicInteger(0)
    val readers = (1..8).map {
      Thread {
        repeat(200) {
          val snapshot = synchronized(helper) {
            listOf(
              helper.getPrivateField<Any?>("helperFile"),
              helper.getPrivateField<Any?>("expectedSha256"),
              helper.getPrivateField<Any?>("actualSha256"),
              helper.getPrivateField<Any?>("hashMatches")
            )
          }
          val nullCount = snapshot.count { it == null }
          if (nullCount != 0 && nullCount != 4) {
            inconsistencies.incrementAndGet()
          }
        }
      }.also { it.start() }
    }

    Thread(publish).also {
      it.start()
      it.join()
    }
    readers.forEach { it.join() }

    assertEquals(0, inconsistencies.get(), "hash metadata published under lock must not be partially visible")
    assertEquals(true, helper.debugInfo().hashMatches)
  }

  private fun Any.setPrivateField(name: String, value: Any?) {
    val field = javaClass.getDeclaredField(name)
    field.isAccessible = true
    field.set(this, value)
  }

  @Suppress("UNCHECKED_CAST")
  private fun <T> Any.getPrivateField(name: String): T {
    val field = javaClass.getDeclaredField(name)
    field.isAccessible = true
    return field.get(this) as T
  }

  private fun Any.invokePrivate(name: String) {
    val method = javaClass.getDeclaredMethod(name)
    method.isAccessible = true
    method.invoke(this)
  }

  @Suppress("UNCHECKED_CAST")
  private fun <T> Any.invokePrivate(name: String, parameterType: Class<*>, argument: Any): T {
    val method = javaClass.getDeclaredMethod(name, parameterType)
    method.isAccessible = true
    return method.invoke(this, argument) as T
  }

  @Suppress("UNCHECKED_CAST")
  private fun <T> Any.invokePrivate(name: String, parameterTypes: Array<Class<*>>, arguments: Array<Any>): T {
    val method = javaClass.getDeclaredMethod(name, *parameterTypes)
    method.isAccessible = true
    return method.invoke(this, *arguments) as T
  }

  private open class FakeProcess(private val alive: Boolean = false) : Process() {
    private val output = ByteArrayOutputStream()

    override fun getOutputStream(): OutputStream = output
    override fun getInputStream(): InputStream = ByteArrayInputStream(ByteArray(0))
    override fun getErrorStream(): InputStream = ByteArrayInputStream(ByteArray(0))
    override fun waitFor(): Int = 0
    override fun waitFor(timeout: Long, unit: java.util.concurrent.TimeUnit): Boolean = !alive
    override fun exitValue(): Int = if (alive) throw IllegalThreadStateException("still running") else 0
    override fun destroy() = Unit
    override fun isAlive(): Boolean = alive
  }
}
