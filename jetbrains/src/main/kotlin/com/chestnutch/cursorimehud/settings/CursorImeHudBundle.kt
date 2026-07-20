package com.chestnutch.cursorimehud.settings

import com.intellij.DynamicBundle
import org.jetbrains.annotations.PropertyKey

object CursorImeHudBundle : DynamicBundle("messages.CursorImeHudBundle") {
  fun message(
    @PropertyKey(resourceBundle = "messages.CursorImeHudBundle") key: String,
    vararg params: Any
  ): String = getMessage(key, *params)
}
