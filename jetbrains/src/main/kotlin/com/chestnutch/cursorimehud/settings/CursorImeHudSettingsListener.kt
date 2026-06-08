package com.chestnutch.cursorimehud.settings

import com.intellij.util.messages.Topic

interface CursorImeHudSettingsListener {
  fun settingsChanged()

  companion object {
    val TOPIC: Topic<CursorImeHudSettingsListener> = Topic.create(
      "Cursor IME HUD settings changed",
      CursorImeHudSettingsListener::class.java
    )
  }
}
