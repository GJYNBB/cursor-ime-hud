package com.chestnutch.cursorimehud.service

/**
 * Reference-counted gate around the helper lifecycle. The consumer-set change
 * and the resulting [startHelper]/[stopHelper] call run under one lock, so a
 * release that observes an empty set can never stop the helper after a
 * concurrent acquire already restarted it. Both callbacks must be cheap and
 * must not call back into this registry; [ImeHelperProcess][com.chestnutch.cursorimehud.helper.ImeHelperProcess]
 * satisfies this because its blocking work runs on pooled threads.
 */
internal class HelperConsumerRegistry(
  private val startHelper: () -> Unit,
  private val stopHelper: () -> Unit
) {
  private val consumers = mutableSetOf<String>()

  fun acquire(consumerId: String) {
    synchronized(consumers) {
      consumers.add(consumerId)
      startHelper()
    }
  }

  fun release(consumerId: String) {
    synchronized(consumers) {
      consumers.remove(consumerId)
      if (consumers.isEmpty()) {
        stopHelper()
      }
    }
  }

  /** Releases every consumer carrying [consumerSuffix]; used on project disposal. */
  fun releaseMatching(consumerSuffix: String) {
    synchronized(consumers) {
      val removed = consumers.removeAll { it.endsWith(consumerSuffix) }
      if (removed && consumers.isEmpty()) {
        stopHelper()
      }
    }
  }

  fun clear() {
    synchronized(consumers) {
      consumers.clear()
    }
  }
}
