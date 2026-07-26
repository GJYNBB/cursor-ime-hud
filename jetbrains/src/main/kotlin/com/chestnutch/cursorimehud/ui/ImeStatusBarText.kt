package com.chestnutch.cursorimehud.ui

import com.chestnutch.cursorimehud.model.HelperLifecycleState
import com.chestnutch.cursorimehud.model.ImeState
import com.chestnutch.cursorimehud.settings.CursorImeHudBundle

/** Short status-bar text helpers; all user-visible strings come from the bundle. */
object ImeStatusBarText {
  fun stateLabel(state: ImeState): String = when (state) {
    ImeState.CN -> CursorImeHudBundle.message("state.cn")
    ImeState.EN -> CursorImeHudBundle.message("state.en")
    ImeState.UNKNOWN -> CursorImeHudBundle.message("state.unknown")
  }

  fun lifecycleLabel(state: HelperLifecycleState): String = when (state) {
    HelperLifecycleState.IDLE -> CursorImeHudBundle.message("lifecycle.idle")
    HelperLifecycleState.STARTING -> CursorImeHudBundle.message("lifecycle.starting")
    HelperLifecycleState.RUNNING -> CursorImeHudBundle.message("lifecycle.running")
    HelperLifecycleState.STOPPING -> CursorImeHudBundle.message("lifecycle.stopping")
    HelperLifecycleState.DISPOSED -> CursorImeHudBundle.message("lifecycle.disposed")
    HelperLifecycleState.UNAVAILABLE -> CursorImeHudBundle.message("lifecycle.unavailable")
    HelperLifecycleState.FAILED -> CursorImeHudBundle.message("lifecycle.failed")
  }

  /**
   * Compact hover text: one primary line, optional second line for issues.
   * Full diagnostics stay in the status-bar click menu / diagnostics action.
   */
  fun tooltip(
    state: ImeState,
    imeName: String?,
    circuitOpen: Boolean,
    lastError: String?
  ): String {
    val primary = buildString {
      append(CursorImeHudBundle.message("statusBar.prefix")).append(stateLabel(state))
      val name = imeName?.trim().orEmpty()
      if (name.isNotEmpty()) {
        append(" · ").append(name)
      }
    }

    return when {
      circuitOpen -> "$primary\n" + CursorImeHudBundle.message("tooltip.circuitOpenHint")
      !lastError.isNullOrBlank() -> "$primary\n" + CursorImeHudBundle.message("tooltip.errorHint")
      else -> "$primary\n" + CursorImeHudBundle.message("tooltip.clickHint")
    }
  }
}
