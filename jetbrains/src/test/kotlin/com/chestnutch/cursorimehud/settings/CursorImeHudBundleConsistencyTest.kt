package com.chestnutch.cursorimehud.settings

import java.io.InputStreamReader
import java.nio.charset.StandardCharsets
import java.util.Properties
import javax.xml.parsers.DocumentBuilderFactory
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotEquals
import kotlin.test.assertTrue

class CursorImeHudBundleConsistencyTest {
  private fun loadBundle(resourcePath: String): Map<String, String> {
    val stream = requireNotNull(javaClass.getResourceAsStream(resourcePath)) {
      "bundle resource $resourcePath must be on the test classpath"
    }
    val properties = Properties()
    InputStreamReader(stream, StandardCharsets.UTF_8).use { properties.load(it) }
    return properties.entries.associate { (key, value) -> key.toString() to value.toString() }
  }

  private val defaultBundle = loadBundle("/messages/CursorImeHudBundle.properties")
  private val chineseBundle = loadBundle("/messages/CursorImeHudBundle_zh_CN.properties")

  @Test
  fun defaultAndChineseBundlesShareTheSameKeys() {
    assertEquals(defaultBundle.keys, chineseBundle.keys)
  }

  @Test
  fun defaultBundleIsTranslatedNotACopyOfTheChineseBundle() {
    // The default bundle is the English fallback for every non-Chinese locale;
    // identical content would mean the translation was never written.
    assertNotEquals(defaultBundle, chineseBundle)
    val untranslated = defaultBundle.filterValues { value -> value.any { it in '一'..'鿿' } }
    assertTrue(untranslated.isEmpty(), "default bundle values must not contain CJK text: ${untranslated.keys}")
  }

  @Test
  fun pluginXmlRegistrationsResolveThroughTheBundle() {
    val pluginXml = requireNotNull(javaClass.getResourceAsStream("/META-INF/plugin.xml")) {
      "plugin.xml must be on the test classpath"
    }
    val document = DocumentBuilderFactory.newInstance().newDocumentBuilder().parse(pluginXml)

    val configurable = document.getElementsByTagName("applicationConfigurable").item(0)
    requireNotNull(configurable) { "plugin.xml must register an applicationConfigurable" }
    val configurableKey = configurable.attributes.getNamedItem("key")?.nodeValue
    assertEquals("messages.CursorImeHudBundle", configurable.attributes.getNamedItem("bundle")?.nodeValue)
    assertTrue(configurable.attributes.getNamedItem("displayName") == null, "configurable must use key-based registration")
    assertTrue(defaultBundle.containsKey(configurableKey), "configurable key '$configurableKey' must exist in the bundle")

    val actionsElement = document.getElementsByTagName("actions").item(0)
    requireNotNull(actionsElement) { "plugin.xml must register actions" }
    assertEquals("messages.CursorImeHudBundle", actionsElement.attributes.getNamedItem("resource-bundle")?.nodeValue)
    val actions = document.getElementsByTagName("action")
    assertTrue(actions.length > 0, "plugin.xml must declare at least one action")
    for (index in 0 until actions.length) {
      val action = actions.item(index)
      val id = requireNotNull(action.attributes.getNamedItem("id")?.nodeValue) { "every action needs an id" }
      assertTrue(action.attributes.getNamedItem("text") == null, "action $id must use bundle-based text")
      assertTrue(defaultBundle.containsKey("action.$id.text"), "bundle must define action.$id.text")
      assertTrue(defaultBundle.containsKey("action.$id.description"), "bundle must define action.$id.description")
    }
  }
}
