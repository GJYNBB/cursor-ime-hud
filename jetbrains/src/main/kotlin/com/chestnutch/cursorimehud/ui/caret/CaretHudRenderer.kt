package com.chestnutch.cursorimehud.ui.caret

import com.chestnutch.cursorimehud.model.ImeState
import com.chestnutch.cursorimehud.settings.CursorImeHudSettings
import com.intellij.openapi.editor.Editor
import java.awt.Point
import java.awt.Rectangle
import javax.swing.JLayeredPane
import javax.swing.SwingUtilities
import kotlin.math.max

class CaretHudRenderer {
  private var chip: CaretHudChip? = null
  private var currentEditor: Editor? = null
  private var currentLayeredPane: JLayeredPane? = null
  private var lastState: CaretHudRenderState? = null

  fun show(editor: Editor, label: String, state: ImeState, settings: CursorImeHudSettings.State) {
    if (editor.isDisposed) {
      hide()
      return
    }

    val content = editor.contentComponent
    val layeredPane = content.rootPane?.layeredPane ?: run {
      hide()
      return
    }

    val caretPoint = editor.visualPositionToXY(editor.caretModel.primaryCaret.visualPosition)
    val visibleArea = editor.scrollingModel.visibleArea
    val caretBounds = Rectangle(caretPoint.x, caretPoint.y, 1, max(1, editor.lineHeight))
    if (!visibleArea.intersects(caretBounds)) {
      hide()
      return
    }

    if (currentEditor !== editor || currentLayeredPane !== layeredPane) {
      hide()
      currentEditor = editor
      currentLayeredPane = layeredPane
    }

    val hudChip = ensureChip(layeredPane)
    val size = hudChip.preferredSizeFor(label)
    val centeredY = caretPoint.y + max(0, (editor.lineHeight - size.height) / 2)
    val target = SwingUtilities.convertPoint(
      content,
      Point(caretPoint.x + settings.offsetX, centeredY + settings.offsetY),
      layeredPane
    )
    val x = target.x.coerceIn(0, max(0, layeredPane.width - size.width))
    val y = target.y.coerceIn(0, max(0, layeredPane.height - size.height))
    val nextState = CaretHudRenderState(
      editorIdentity = System.identityHashCode(editor),
      label = label,
      state = state.wireValue,
      opacity = settings.opacity,
      x = x,
      y = y,
      width = size.width,
      height = size.height
    )

    if (lastState == nextState && hudChip.isVisible) {
      return
    }

    val oldBounds = Rectangle(hudChip.bounds)
    hudChip.update(label, state, settings.opacity)
    hudChip.setBounds(x, y, size.width, size.height)
    hudChip.isVisible = true
    hudChip.repaint()
    layeredPane.revalidate()
    if (!oldBounds.isEmpty) {
      layeredPane.repaint(oldBounds)
    }
    layeredPane.repaint(hudChip.bounds)
    lastState = nextState
  }

  fun hideFor(editor: Editor) {
    if (currentEditor === editor) {
      hide()
    }
  }

  fun hide() {
    val pane = currentLayeredPane
    chip?.let { hudChip ->
      hudChip.isVisible = false
      pane?.remove(hudChip)
      pane?.revalidate()
      pane?.repaint(hudChip.bounds)
    }
    chip = null
    currentEditor = null
    currentLayeredPane = null
    lastState = null
  }

  private fun ensureChip(layeredPane: JLayeredPane): CaretHudChip {
    chip?.let { return it }
    return CaretHudChip().also { hudChip ->
      chip = hudChip
      layeredPane.add(hudChip, JLayeredPane.POPUP_LAYER)
    }
  }
}
