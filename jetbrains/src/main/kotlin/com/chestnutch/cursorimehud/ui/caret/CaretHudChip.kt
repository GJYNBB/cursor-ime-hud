package com.chestnutch.cursorimehud.ui.caret

import com.chestnutch.cursorimehud.model.ImeState
import com.chestnutch.cursorimehud.settings.CursorImeHudColors
import java.awt.Color
import java.awt.Dimension
import java.awt.Font
import java.awt.FontMetrics
import java.awt.Graphics
import java.awt.Graphics2D
import java.awt.RenderingHints
import javax.swing.JComponent
import javax.swing.JLabel
import kotlin.math.roundToInt

class CaretHudChip : JComponent() {
  private var label: String = ""
  private var state: ImeState = ImeState.UNKNOWN
  private var opacity: Double = 0.78
  private var cnColor: String = CursorImeHudColors.DEFAULT_CN_COLOR
  private var enColor: String = CursorImeHudColors.DEFAULT_EN_COLOR
  private val tileSize = 20
  private val horizontalPadding = 2

  init {
    isFocusable = false
    isOpaque = false
    isVisible = false
    val labelFont = JLabel().font
    font = labelFont.deriveFont(Font.BOLD, labelFont.size2D * 0.95f)
  }

  fun update(label: String, state: ImeState, opacity: Double, cnColor: String, enColor: String) {
    val sizeChanged = this.label != label
    this.label = label
    this.state = state
    this.opacity = opacity.coerceIn(0.15, 1.0)
    this.cnColor = CursorImeHudColors.normalizeHex(cnColor, CursorImeHudColors.DEFAULT_CN_COLOR)
    this.enColor = CursorImeHudColors.normalizeHex(enColor, CursorImeHudColors.DEFAULT_EN_COLOR)
    if (sizeChanged) {
      revalidate()
    }
  }

  fun preferredSizeFor(label: String): Dimension {
    if (label.isBlank()) {
      return Dimension(tileSize, tileSize)
    }

    val textWidth = getFontMetrics(font).stringWidth(label)
    return Dimension(maxOf(tileSize, textWidth + horizontalPadding * 2), tileSize)
  }

  override fun getPreferredSize(): Dimension = preferredSizeFor(label)

  override fun contains(x: Int, y: Int): Boolean = false

  override fun paintComponent(g: Graphics) {
    if (label.isBlank()) return

    val g2 = g.create() as Graphics2D
    try {
      g2.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON)
      val visualAlpha = (opacity * 255).roundToInt().coerceIn(38, 255)
      val accent = accentColor()
      val radius = 6

      g2.color = Color(accent.red, accent.green, accent.blue, (visualAlpha * 0.72).roundToInt())
      g2.fillRoundRect(0, 0, width - 1, height - 1, radius, radius)

      g2.color = Color(accent.red, accent.green, accent.blue, (visualAlpha * 0.62).roundToInt())
      g2.drawRoundRect(0, 0, width - 1, height - 1, radius, radius)

      g2.color = Color(255, 255, 255, (visualAlpha * 0.10).roundToInt())
      g2.drawRoundRect(2, 2, width - 5, height - 5, radius - 3, radius - 3)

      val metrics: FontMetrics = g2.fontMetrics
      g2.color = Color(247, 250, 252, visualAlpha)
      val textX = (width - metrics.stringWidth(label)) / 2
      val textY = (height - metrics.height) / 2 + metrics.ascent - 1
      g2.drawString(label, textX, textY)
    } finally {
      g2.dispose()
    }
  }

  private fun accentColor(): Color = when (state) {
    ImeState.CN -> CursorImeHudColors.toColor(cnColor, CursorImeHudColors.DEFAULT_CN_COLOR)
    ImeState.EN -> CursorImeHudColors.toColor(enColor, CursorImeHudColors.DEFAULT_EN_COLOR)
    ImeState.UNKNOWN -> Color(148, 163, 184)
  }
}
