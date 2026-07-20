package com.chestnutch.cursorimehud

import kotlin.test.Test
import kotlin.test.assertContains
import kotlin.test.assertFalse

class PluginIconTest {
  @Test
  fun marketplaceIconsKeepAReadableTransparentPerimeter() {
    listOf("pluginIcon.svg", "pluginIcon_dark.svg").forEach { fileName ->
      val svg = requireNotNull(javaClass.getResource("/META-INF/$fileName")).readText()

      assertContains(svg, "width=\"40\"")
      assertContains(svg, "height=\"40\"")
      assertContains(svg, "viewBox=\"0 0 40 40\"")
      assertContains(svg, "<circle cx=\"20\" cy=\"20\" r=\"18\"")
      assertFalse(svg.contains("<text"), "$fileName must not depend on font rendering")
      assertFalse(
        svg.contains("<rect width=\"40\" height=\"40\""),
        "$fileName must preserve the two-pixel transparent perimeter required by JetBrains",
      )
    }
  }
}
