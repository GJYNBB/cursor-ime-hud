package com.chestnutch.cursorimehud.helper

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class HelperRestartPolicyTest {
  @Test
  fun usesExponentialBackoffAndCapsBeforeCircuitOpens() {
    var now = 0L
    val policy = HelperRestartPolicy({ now }) { 0.5 }

    assertEquals(1_500L, policy.recordFailure().delayMs)
    assertEquals(3_000L, policy.recordFailure().delayMs)
    assertEquals(6_000L, policy.recordFailure().delayMs)
    assertEquals(12_000L, policy.recordFailure().delayMs)
    assertEquals(24_000L, policy.recordFailure().delayMs)
    assertEquals(30_000L, policy.recordFailure().delayMs)
    assertEquals(30_000L, policy.recordFailure().delayMs)
    assertEquals(30_000L, policy.recordFailure().delayMs)
    assertEquals(30_000L, policy.recordFailure().delayMs)

    val circuit = policy.recordFailure()
    assertFalse(circuit.shouldRestart)
    assertTrue(circuit.circuitOpened)
    assertTrue(policy.circuitOpen)
    assertEquals(10, policy.attemptCount)

    // An open circuit remains closed to automatic retries even after the
    // rolling window elapses; only an explicit reset is allowed to recover.
    now += HelperRestartPolicy.FAILURE_WINDOW_MS + 1
    assertTrue(policy.circuitOpen)
    assertFalse(policy.recordFailure().shouldRestart)
  }

  @Test
  fun prunesFailuresOutsideRollingWindowBeforeCountingNextFailure() {
    var now = 0L
    val policy = HelperRestartPolicy({ now }) { 0.5 }

    repeat(3) { policy.recordFailure() }
    now = HelperRestartPolicy.FAILURE_WINDOW_MS + 1

    val plan = policy.recordFailure()
    assertEquals(1, plan.attempt)
    assertEquals(1, policy.attemptCount)
    assertFalse(policy.circuitOpen)
  }

  @Test
  fun resetClearsCircuitAndFailureBudget() {
    val policy = HelperRestartPolicy(random = { 0.5 })
    repeat(HelperRestartPolicy.MAX_ATTEMPTS) { policy.recordFailure() }
    assertTrue(policy.circuitOpen)

    policy.reset()

    assertFalse(policy.circuitOpen)
    assertEquals(0, policy.attemptCount)
    assertEquals(1_500L, policy.recordFailure().delayMs)
  }
}
