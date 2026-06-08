package com.chestnutch.cursorimehud.ui.caret

import com.intellij.ui.JBColor
import java.awt.Color
import java.awt.Dimension
import java.awt.FontMetrics
import java.awt.Graphics
import java.awt.Graphics2D
import java.awt.RenderingHints
import javax.swing.JComponent
import javax.swing.JLabel
import kotlin.math.roundToInt

class CaretHudChip : JComponent() {
  private var label: String = ""
  private var opacity: Double = 0.78
  private val horizontalPadding = 7
  private val verticalPadding = 3

  init {
    isFocusable = false
    isOpaque = false
    isVisible = false
    val labelFont = JLabel().font
    font = labelFont.deriveFont(labelFont.size2D * 0.92f)
  }

  fun update(label: String, opacity: Double) {
    this.label = label
    this.opacity = opacity.coerceIn(0.15, 1.0)
    revalidate()
    repaint()
  }

  override fun getPreferredSize(): Dimension {
    val metrics = getFontMetrics(font)
    return Dimension(
      metrics.stringWidth(label) + horizontalPadding * 2,
      metrics.height + verticalPadding * 2
    )
  }

  override fun contains(x: Int, y: Int): Boolean = false

  override fun paintComponent(g: Graphics) {
    if (label.isBlank()) return

    val g2 = g.create() as Graphics2D
    try {
      g2.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON)
      val alpha = (opacity * 255).roundToInt().coerceIn(38, 255)
      val borderAlpha = (opacity * 76).roundToInt().coerceIn(12, 96)
      g2.color = Color(28, 32, 38, alpha)
      g2.fillRoundRect(0, 0, width - 1, height - 1, height, height)
      g2.color = Color(255, 255, 255, borderAlpha)
      g2.drawRoundRect(0, 0, width - 1, height - 1, height, height)

      val metrics: FontMetrics = g2.fontMetrics
      g2.color = JBColor.WHITE
      val textX = (width - metrics.stringWidth(label)) / 2
      val textY = (height - metrics.height) / 2 + metrics.ascent
      g2.drawString(label, textX, textY)
    } finally {
      g2.dispose()
    }
  }
}
