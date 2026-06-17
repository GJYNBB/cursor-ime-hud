package com.chestnutch.cursorimehud.ui.caret

import com.chestnutch.cursorimehud.model.ImeState
import com.chestnutch.cursorimehud.settings.CursorImeHudSettings
import com.intellij.openapi.editor.Caret
import com.intellij.openapi.editor.CaretModel
import com.intellij.openapi.editor.Editor
import com.intellij.openapi.editor.ScrollingModel
import com.intellij.openapi.editor.VisualPosition
import java.awt.Point
import java.awt.Rectangle
import java.lang.reflect.Proxy
import javax.swing.JPanel
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertSame
import kotlin.test.assertTrue

class CaretHudRendererTest {
  @Test
  fun attachesChipToEditorContentAndRemovesItOnHide() {
    val content = JPanel(null)
    val editor = fakeEditor(content = content, caretPoint = Point(32, 20), visibleArea = Rectangle(0, 0, 300, 200))
    val renderer = CaretHudRenderer()

    renderer.show(editor, "中", ImeState.CN, CursorImeHudSettings.State())

    assertEquals(1, content.componentCount)
    val chip = content.getComponent(0)
    assertTrue(chip is CaretHudChip)
    assertTrue(chip.isVisible)
    assertTrue(renderer.isShowingFor(editor))

    renderer.hide()

    assertEquals(0, content.componentCount)
    assertFalse(renderer.isShowingFor(editor))
  }

  @Test
  fun clampsChipInsideVisibleAreaWhenCaretIsAtViewportEdge() {
    val content = JPanel(null)
    val visibleArea = Rectangle(1000, 200, 500, 240)
    val editor = fakeEditor(content = content, caretPoint = Point(1499, 430), visibleArea = visibleArea)
    val renderer = CaretHudRenderer()

    renderer.show(editor, "ZH", ImeState.CN, CursorImeHudSettings.State())

    val chip = content.getComponent(0)
    assertTrue(chip.bounds.x >= visibleArea.x)
    assertTrue(chip.bounds.y >= visibleArea.y)
    assertTrue(chip.bounds.x + chip.bounds.width <= visibleArea.x + visibleArea.width)
    assertTrue(chip.bounds.y + chip.bounds.height <= visibleArea.y + visibleArea.height)
  }

  @Test
  fun switchesChipBetweenEditorContentParents() {
    val firstContent = JPanel(null)
    val secondContent = JPanel(null)
    val firstEditor = fakeEditor(content = firstContent, caretPoint = Point(32, 20), visibleArea = Rectangle(0, 0, 300, 200))
    val secondEditor = fakeEditor(content = secondContent, caretPoint = Point(48, 30), visibleArea = Rectangle(0, 0, 300, 200))
    val renderer = CaretHudRenderer()

    renderer.show(firstEditor, "中", ImeState.CN, CursorImeHudSettings.State())
    val firstChip = firstContent.getComponent(0)

    renderer.show(secondEditor, "英", ImeState.EN, CursorImeHudSettings.State())

    assertEquals(0, firstContent.componentCount)
    assertEquals(1, secondContent.componentCount)
    assertTrue(firstChip is CaretHudChip)
    assertSame(secondContent, secondContent.getComponent(0).parent)
    assertTrue(renderer.isShowingFor(secondEditor))
    assertFalse(renderer.isShowingFor(firstEditor))
  }

  @Test
  fun rerendersWhenEditorGeometryChangesAfterZoom() {
    val content = JPanel(null)
    var caretPoint = Point(32, 20)
    var lineHeight = 20
    val editor = fakeEditor(
      content = content,
      caretPoint = caretPoint,
      visibleArea = Rectangle(0, 0, 300, 200),
      caretPointProvider = { caretPoint },
      lineHeightProvider = { lineHeight }
    )
    val renderer = CaretHudRenderer()
    val settings = CursorImeHudSettings.State()

    renderer.show(editor, "中", ImeState.CN, settings)
    val chip = content.getComponent(0)
    val firstBounds = Rectangle(chip.bounds)

    caretPoint = Point(64, 38)
    lineHeight = 28
    renderer.show(editor, "中", ImeState.CN, settings)
    val secondBounds = Rectangle(chip.bounds)

    caretPoint = Point(96, 54)
    lineHeight = 34
    renderer.show(editor, "中", ImeState.CN, settings)
    val thirdBounds = Rectangle(chip.bounds)

    assertTrue(firstBounds != secondBounds)
    assertTrue(secondBounds != thirdBounds)
    assertEquals(caretPoint.x + settings.offsetX, thirdBounds.x)
    assertTrue(secondBounds.y != firstBounds.y)
    assertTrue(thirdBounds.y != secondBounds.y)
    assertSame(chip, content.getComponent(0))
  }

  private fun fakeEditor(
    content: JPanel,
    caretPoint: Point,
    visibleArea: Rectangle,
    lineHeight: Int = 20,
    disposed: Boolean = false,
    caretPointProvider: () -> Point = { caretPoint },
    lineHeightProvider: () -> Int = { lineHeight }
  ): Editor {
    val caret = proxy<Caret> { method, _ ->
      when (method.name) {
        "getVisualPosition" -> VisualPosition(0, 0)
        else -> defaultValue(method.returnType)
      }
    }
    val caretModel = proxy<CaretModel> { method, _ ->
      when (method.name) {
        "getPrimaryCaret" -> caret
        else -> defaultValue(method.returnType)
      }
    }
    val scrollingModel = proxy<ScrollingModel> { method, _ ->
      when (method.name) {
        "getVisibleArea" -> visibleArea
        else -> defaultValue(method.returnType)
      }
    }

    return proxy { method, _ ->
      when (method.name) {
        "getContentComponent" -> content
        "getComponent" -> content
        "getCaretModel" -> caretModel
        "getScrollingModel" -> scrollingModel
        "getLineHeight" -> lineHeightProvider()
        "isDisposed" -> disposed
        "visualPositionToXY" -> caretPointProvider()
        else -> defaultValue(method.returnType)
      }
    }
  }

  private inline fun <reified T : Any> proxy(noinline handler: (java.lang.reflect.Method, Array<Any?>?) -> Any?): T =
    Proxy.newProxyInstance(
      T::class.java.classLoader,
      arrayOf(T::class.java)
    ) { proxy, method, args ->
      when (method.name) {
        "toString" -> "Fake${T::class.simpleName}"
        "hashCode" -> System.identityHashCode(proxy)
        "equals" -> proxy === args?.firstOrNull()
        else -> handler(method, args)
      }
    } as T

  private fun defaultValue(returnType: Class<*>): Any? = when {
    returnType == java.lang.Boolean.TYPE -> false
    returnType == java.lang.Integer.TYPE -> 0
    returnType == java.lang.Long.TYPE -> 0L
    returnType == java.lang.Float.TYPE -> 0f
    returnType == java.lang.Double.TYPE -> 0.0
    returnType == java.lang.Void.TYPE -> null
    else -> null
  }
}
