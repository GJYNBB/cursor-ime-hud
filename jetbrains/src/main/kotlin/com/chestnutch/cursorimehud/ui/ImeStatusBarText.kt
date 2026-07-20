package com.chestnutch.cursorimehud.ui

import com.chestnutch.cursorimehud.model.HelperLifecycleState
import com.chestnutch.cursorimehud.model.ImeState

/** Short Chinese status-bar tooltip helpers (kept pure for unit tests). */
object ImeStatusBarText {
  fun stateLabel(state: ImeState): String = when (state) {
    ImeState.CN -> "中文"
    ImeState.EN -> "英文"
    ImeState.UNKNOWN -> "未知"
  }

  fun lifecycleLabel(state: HelperLifecycleState): String = when (state) {
    HelperLifecycleState.IDLE -> "空闲"
    HelperLifecycleState.STARTING -> "启动中"
    HelperLifecycleState.RUNNING -> "运行中"
    HelperLifecycleState.STOPPING -> "停止中"
    HelperLifecycleState.DISPOSED -> "已释放"
    HelperLifecycleState.UNAVAILABLE -> "不可用"
    HelperLifecycleState.FAILED -> "失败"
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
      append("输入法：").append(stateLabel(state))
      val name = imeName?.trim().orEmpty()
      if (name.isNotEmpty()) {
        append(" · ").append(name)
      }
    }

    return when {
      circuitOpen -> "$primary\n熔断已开启，点击可刷新或打开菜单"
      !lastError.isNullOrBlank() -> "$primary\n点击查看菜单与设置"
      else -> "$primary\n点击打开菜单"
    }
  }
}
