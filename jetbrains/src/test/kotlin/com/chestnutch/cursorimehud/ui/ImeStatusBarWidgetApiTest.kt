package com.chestnutch.cursorimehud.ui

import com.intellij.openapi.wm.CustomStatusBarWidget
import com.intellij.openapi.wm.StatusBarWidget
import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class ImeStatusBarWidgetApiTest {
  @Test
  fun usesCustomStatusBarWidgetWithoutDeprecatedPresentationApi() {
    val widgetClass = ImeStatusBarWidget::class.java

    assertTrue(CustomStatusBarWidget::class.java.isAssignableFrom(widgetClass))
    assertFalse(StatusBarWidget.TextPresentation::class.java.isAssignableFrom(widgetClass))
    assertFalse(widgetClass.declaredMethods.any { it.name == "getPresentation" })
  }
}
