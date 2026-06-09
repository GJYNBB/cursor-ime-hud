package com.chestnutch.cursorimehud.ui.caret

import com.chestnutch.cursorimehud.model.ImeState
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
  private val horizontalPadding = 9
  private val verticalPadding = 4

  init {
    isFocusable = false
    isOpaque = false
    isVisible = false
    val labelFont = JLabel().font
    font = labelFont.deriveFont(Font.BOLD, labelFont.size2D * 0.95f)
  }

  fun update(label: String, state: ImeState, opacity: Double) {
    this.label = label
    this.state = state
    this.opacity = opacity.coerceIn(0.15, 1.0)
    revalidate()
    repaint()
  }

  fun preferredSizeFor(label: String): Dimension {
    val metrics = getFontMetrics(font)
    return Dimension(
      metrics.stringWidth(label) + horizontalPadding * 2,
      metrics.height + verticalPadding * 2
    )
  }

  override fun getPreferredSize(): Dimension = preferredSizeFor(label)

  override fun contains(x: Int, y: Int): Boolean = false

  override fun paintComponent(g: Graphics) {
    if (label.isBlank()) return

    val g2 = g.create() as Graphics2D
    try {
      g2.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON)
      val visualAlpha = (opacity * 255).roundToInt().coerceIn(38, 255)
      val background = backgroundColor(visualAlpha)
      val radius = height - 1

      val shadowAlpha = (opacity * 160).roundToInt().coerceIn(24, 160)
      val borderAlpha = (opacity * 255).roundToInt().coerceIn(76, 255)

      g2.color = Color(0, 0, 0, shadowAlpha)
      g2.fillRoundRect(1, 2, width - 2, height - 2, radius, radius)

      g2.color = background
      g2.fillRoundRect(0, 0, width - 2, height - 2, radius, radius)

      g2.color = Color(255, 255, 255, borderAlpha)
      g2.drawRoundRect(0, 0, width - 2, height - 2, radius, radius)

      val metrics: FontMetrics = g2.fontMetrics
      g2.color = Color.WHITE
      val textX = (width - metrics.stringWidth(label)) / 2
      val textY = (height - metrics.height) / 2 + metrics.ascent - 1
      g2.drawString(label, textX, textY)
    } finally {
      g2.dispose()
    }
  }

  private fun backgroundColor(alpha: Int): Color = when (state) {
    ImeState.CN -> Color(217, 119, 6, alpha)
    ImeState.EN -> Color(37, 99, 235, alpha)
    ImeState.UNKNOWN -> Color(75, 85, 99, alpha)
  }
}
