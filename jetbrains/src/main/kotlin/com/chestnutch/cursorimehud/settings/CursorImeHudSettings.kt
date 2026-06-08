package com.chestnutch.cursorimehud.settings

import com.intellij.openapi.components.PersistentStateComponent
import com.intellij.openapi.components.Service
import com.intellij.openapi.components.State
import com.intellij.openapi.components.Storage

@Service(Service.Level.APP)
@State(name = "CursorImeHudSettings", storages = [Storage("cursorImeHud.xml")])
class CursorImeHudSettings : PersistentStateComponent<CursorImeHudSettings.State> {
  data class State(
    var statusBarEnabled: Boolean = true,
    var caretHudEnabled: Boolean = true,
    var cnLabel: String = "中",
    var enLabel: String = "英",
    var opacity: Double = 0.78,
    var offsetX: Int = 6,
    var offsetY: Int = 0,
    var hideWhenEditorUnfocused: Boolean = true
  )

  private var state = State()

  override fun getState(): State = state

  override fun loadState(state: State) {
    this.state = state
  }

  fun update(mutator: (State) -> Unit) {
    mutator(state)
  }
}
