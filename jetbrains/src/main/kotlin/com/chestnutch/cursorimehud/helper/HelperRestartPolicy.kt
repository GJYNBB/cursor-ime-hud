package com.chestnutch.cursorimehud.helper

import java.util.ArrayDeque
import kotlin.math.min
import kotlin.math.round

/**
 * Restart-budget state machine shared by the JetBrains helper process wrapper
 * and its unit tests. The random source is injectable so tests can keep the
 * backoff deterministic while production uses a small anti-herd jitter.
 *
 * A failed start/exit consumes one slot in a five-minute rolling window.  The
 * first nine failures are retried with exponential backoff; the tenth failure
 * opens the circuit and leaves recovery to an explicit refresh.  A running
 * helper is reset by the caller only after the thirty-second stability window.
 */
internal class HelperRestartPolicy(
  private val nowMillis: () -> Long = { System.currentTimeMillis() },
  private val random: () -> Double = { kotlin.random.Random.nextDouble() }
) {
  companion object {
    const val BASE_DELAY_MS = 1_500L
    const val MAX_DELAY_MS = 30_000L
    const val FAILURE_WINDOW_MS = 5 * 60 * 1_000L
    const val MAX_ATTEMPTS = 10
    const val JITTER_RATIO = 0.20
  }

  private val failureTimes = ArrayDeque<Long>()

  var circuitOpen: Boolean = false
    private set

  val attemptCount: Int
    get() {
      prune()
      return failureTimes.size
    }

  fun recordFailure(now: Long = nowMillis()): RestartPlan {
    prune(now)
    if (circuitOpen) {
      return RestartPlan(
        shouldRestart = false,
        attempt = failureTimes.size,
        delayMs = 0L,
        circuitOpened = true
      )
    }

    failureTimes.addLast(now)
    val attempt = failureTimes.size
    if (attempt >= MAX_ATTEMPTS) {
      circuitOpen = true
      return RestartPlan(
        shouldRestart = false,
        attempt = attempt,
        delayMs = 0L,
        circuitOpened = true
      )
    }

    // There are only nine retry delays before the circuit opens, so the shift
    // is bounded and cannot overflow a Long. Keep the same +/-20% jitter as
    // the VS Code client so simultaneous IDEs do not form a restart herd.
    val exponent = (attempt - 1).coerceAtMost(20)
    val baseDelay = min(MAX_DELAY_MS, BASE_DELAY_MS * (1L shl exponent))
    val jitterFactor = 1.0 + ((random().coerceIn(0.0, 1.0) * 2.0) - 1.0) * JITTER_RATIO
    val delay = round(baseDelay.toDouble() * jitterFactor)
      .toLong()
      .coerceIn(0L, MAX_DELAY_MS)
    return RestartPlan(
      shouldRestart = true,
      attempt = attempt,
      delayMs = delay,
      circuitOpened = false
    )
  }

  fun reset() {
    failureTimes.clear()
    circuitOpen = false
  }

  private fun prune(now: Long = nowMillis()) {
    val cutoff = now - FAILURE_WINDOW_MS
    while (failureTimes.isNotEmpty() && failureTimes.first < cutoff) {
      failureTimes.removeFirst()
    }
  }
}

internal data class RestartPlan(
  val shouldRestart: Boolean,
  val attempt: Int,
  val delayMs: Long,
  val circuitOpened: Boolean
)
