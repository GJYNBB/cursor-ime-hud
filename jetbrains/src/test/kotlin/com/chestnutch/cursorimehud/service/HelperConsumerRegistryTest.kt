package com.chestnutch.cursorimehud.service

import java.util.concurrent.CountDownLatch
import kotlin.concurrent.thread
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class HelperConsumerRegistryTest {
  private class RecordingLifecycle {
    // Callbacks run under the registry lock, so plain fields are safe here.
    var started = false
    var startCalls = 0
    var stopCalls = 0

    fun registry(): HelperConsumerRegistry = HelperConsumerRegistry(
      startHelper = {
        started = true
        startCalls++
      },
      stopHelper = {
        started = false
        stopCalls++
      }
    )
  }

  @Test
  fun startsOnAcquireAndStopsWhenLastConsumerReleases() {
    val lifecycle = RecordingLifecycle()
    val registry = lifecycle.registry()

    registry.acquire("widget:a")
    registry.acquire("caret:a")
    assertTrue(lifecycle.started)

    registry.release("widget:a")
    assertTrue(lifecycle.started, "helper keeps running while a consumer remains")

    registry.release("caret:a")
    assertFalse(lifecycle.started)
    assertEquals(1, lifecycle.stopCalls)
  }

  @Test
  fun releaseMatchingOnlyStopsWhenItRemovedTheLastConsumer() {
    val lifecycle = RecordingLifecycle()
    val registry = lifecycle.registry()

    registry.acquire("widget:a")
    registry.acquire("widget:b")

    registry.releaseMatching(":a")
    assertTrue(lifecycle.started)

    registry.releaseMatching(":missing")
    assertTrue(lifecycle.started, "a no-op suffix release must not stop the helper")

    registry.releaseMatching(":b")
    assertFalse(lifecycle.started)
  }

  @Test
  fun interleavedReleaseAndAcquireNeverLeavesAConsumerWithoutARunningHelper() {
    // Reproduces the check-then-act race the registry exists to prevent:
    // T1 releases the last consumer while T2 acquires a new one. Whatever the
    // interleaving, a registered consumer implies the last lifecycle call was
    // start. Without the shared lock, T1 could observe "empty" before T2's
    // acquire and still call stop afterwards.
    repeat(1_000) { iteration ->
      val lifecycle = RecordingLifecycle()
      val registry = lifecycle.registry()
      registry.acquire("seed")

      val ready = CountDownLatch(2)
      val go = CountDownLatch(1)
      val releaser = thread {
        ready.countDown()
        go.await()
        registry.release("seed")
      }
      val acquirer = thread {
        ready.countDown()
        go.await()
        registry.acquire("late")
      }
      ready.await()
      go.countDown()
      releaser.join()
      acquirer.join()

      assertTrue(lifecycle.started, "iteration $iteration: 'late' is registered, helper must be started")
      registry.release("late")
      assertFalse(lifecycle.started, "iteration $iteration: releasing the last consumer stops the helper")
    }
  }
}
