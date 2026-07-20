package com.chestnutch.cursorimehud.ui.caret

import com.chestnutch.cursorimehud.model.ImeState
import com.chestnutch.cursorimehud.settings.CursorImeHudSettings
import com.intellij.openapi.editor.Editor
import java.awt.Rectangle
import javax.swing.JComponent
import kotlin.math.max

class CaretHudRenderer {
  private var chip: CaretHudChip? = null
  private var currentEditor: Editor? = null
  private var currentParent: JComponent? = null
  private var lastState: CaretHudRenderState? = null

  fun show(editor: Editor, label: String, state: ImeState, settings: CursorImeHudSettings.State) {
    if (editor.isDisposed) {
      hide()
      return
    }

    val content = editor.contentComponent
    val caretPoint = editor.visualPositionToXY(editor.caretModel.primaryCaret.visualPosition)
    val visibleArea = editor.scrollingModel.visibleArea
    val caretBounds = Rectangle(caretPoint.x, caretPoint.y, 1, max(1, editor.lineHeight))
    if (!visibleArea.intersects(caretBounds)) {
      hide()
      return
    }

    if (currentEditor !== editor || currentParent !== content) {
      hide()
      currentEditor = editor
      currentParent = content
    }

    val hudChip = ensureChip(content)
    val size = hudChip.preferredSizeFor(label)
    val centeredY = caretPoint.y + max(0, (editor.lineHeight - size.height) / 2)
    val xMin = visibleArea.x
    val yMin = visibleArea.y
    val xMax = max(xMin, visibleArea.x + visibleArea.width - size.width)
    val yMax = max(yMin, visibleArea.y + visibleArea.height - size.height)
    val x = (caretPoint.x + settings.offsetX).coerceIn(xMin, xMax)
    val y = (centeredY + settings.offsetY).coerceIn(yMin, yMax)
    val nextState = CaretHudRenderState(
      editorIdentity = System.identityHashCode(editor),
      label = label,
      state = state.wireValue,
      cnColor = settings.cnColor,
      enColor = settings.enColor,
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
    hudChip.update(label, state, settings.opacity, settings.cnColor, settings.enColor)
    hudChip.setBounds(x, y, size.width, size.height)
    hudChip.isVisible = true
    if (oldBounds == hudChip.bounds) {
      hudChip.repaint()
    } else {
      if (!oldBounds.isEmpty) {
        content.repaint(oldBounds)
      }
      content.repaint(hudChip.bounds)
    }
    lastState = nextState
  }

  fun isShowingFor(editor: Editor): Boolean = currentEditor === editor && chip?.isVisible == true

  fun hideFor(editor: Editor) {
    if (currentEditor === editor) {
      hide()
    }
  }

  fun hide() {
    val parent = currentParent
    chip?.let { hudChip ->
      val oldBounds = Rectangle(hudChip.bounds)
      hudChip.isVisible = false
      parent?.remove(hudChip)
      parent?.revalidate()
      parent?.repaint(oldBounds)
    }
    chip = null
    currentEditor = null
    currentParent = null
    lastState = null
  }

  private fun ensureChip(parent: JComponent): CaretHudChip {
    chip?.let { return it }
    return CaretHudChip().also { hudChip ->
      chip = hudChip
      parent.add(hudChip)
      parent.setComponentZOrder(hudChip, 0)
    }
  }
}
