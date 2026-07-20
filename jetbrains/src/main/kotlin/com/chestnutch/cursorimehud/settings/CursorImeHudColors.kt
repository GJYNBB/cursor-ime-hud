package com.chestnutch.cursorimehud.settings

import java.awt.Color

object CursorImeHudColors {
  const val DEFAULT_CN_COLOR: String = "#FF5252"
  const val DEFAULT_EN_COLOR: String = "#1E90FF"
  private val hexColor = Regex("^#([0-9a-fA-F]{6})$")

  fun normalizeHex(value: String?, fallback: String): String {
    val trimmed = value?.trim().orEmpty()
    return if (hexColor.matches(trimmed)) trimmed.uppercase() else fallback
  }

  fun toColor(value: String?, fallback: String): Color {
    val normalized = normalizeHex(value, fallback)
    val rgb = normalized.removePrefix("#").toInt(16)
    return Color(rgb)
  }
}
