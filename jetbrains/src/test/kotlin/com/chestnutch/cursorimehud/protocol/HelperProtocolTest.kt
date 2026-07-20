package com.chestnutch.cursorimehud.protocol

import com.chestnutch.cursorimehud.model.ImeState
import com.google.gson.JsonParser
import java.io.InputStreamReader
import java.nio.charset.StandardCharsets
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class HelperProtocolTest {
  @Test
  fun matchesSharedCrossClientProtocolVectors() {
    val stream = javaClass.getResourceAsStream("/helper-protocol-vectors.json")
    assertNotNull(stream, "shared protocol vector resource must be packaged for tests")
    val root = InputStreamReader(stream, StandardCharsets.UTF_8).use { reader ->
      JsonParser.parseReader(reader).asJsonObject
    }
    assertEquals(1, root.get("schemaVersion").asInt)

    root.getAsJsonArray("cases").forEach { element ->
      val vector = element.asJsonObject
      val id = vector.get("id").asString
      val kind = vector.get("kind").asString
      val line = vector.getAsJsonObject("record").toString()
      val expected = vector.get("expected")

      when (kind) {
        "hello" -> {
          val actual = HelperProtocol.parseHelloLine(line)
          if (expected.isJsonNull) {
            assertNull(actual, id)
          } else {
            assertNotNull(actual, id)
            val expectedObject = expected.asJsonObject
            assertEquals(expectedObject.get("version").asInt, actual.version, id)
            // Capabilities are intentionally string-only on both clients;
            // non-string values in the vector exercise the parser's tolerant
            // filtering behavior and must not become implicit string casts.
            val expectedCapabilities = expectedObject.getAsJsonArray("capabilities")
              .filter { it.isJsonPrimitive && it.asJsonPrimitive.isString }
              .map { it.asString }
            assertEquals(expectedCapabilities, actual.capabilities, id)
          }
        }

        "state" -> {
          val actual = HelperProtocol.parseSnapshotLine(line)
          if (expected.isJsonNull) {
            assertNull(actual, id)
          } else {
            assertNotNull(actual, id)
            val expectedObject = expected.asJsonObject
            assertEquals(expectedObject.get("state").asString, actual.state.wireValue, id)
            expectedObject.get("timestamp")?.let { assertEquals(it.asString, actual.timestamp, id) }
            expectedObject.get("imeName")?.let { assertEquals(it.asString, actual.imeName, id) }
            expectedObject.get("isOpen")?.let { assertEquals(it.asBoolean, actual.isOpen, id) }
            expectedObject.get("layoutHex")?.let { assertEquals(it.asString, actual.layoutHex, id) }
            expectedObject.get("threadId")?.let { assertEquals(it.asLong, actual.threadId, id) }
            expectedObject.get("hwnd")?.let { assertEquals(it.asString, actual.hwnd, id) }
            expectedObject.get("reason")?.let { assertEquals(it.asString, actual.reason, id) }
            expectedObject.get("confidence")?.let { assertEquals(it.asDouble, actual.confidence, id) }
            expectedObject.get("rawStateAvailable")?.let {
              assertEquals(it.asBoolean, actual.rawStateAvailable, id)
            }
          }
        }

        "log" -> {
          val actual = HelperProtocol.parseLogLine(line)
          if (expected.isJsonNull) {
            assertNull(actual, id)
          } else {
            assertNotNull(actual, id)
            val expectedObject = expected.asJsonObject
            assertEquals(expectedObject.get("level").asString, actual.level, id)
            assertEquals(expectedObject.get("message").asString, actual.message, id)
            expectedObject.get("timestamp")?.let { assertEquals(it.asString, actual.timestamp, id) }
            expectedObject.get("source")?.let { assertEquals(it.asString, actual.source, id) }
          }
        }

        else -> assertTrue(false, "unknown vector kind $kind ($id)")
      }
    }
  }

  @Test
  fun parsesHelloMessages() {
    val hello = HelperProtocol.parseHelloLine("""{"type":"hello","version":1,"capabilities":["state","log",7]}""")

    assertNotNull(hello)
    assertEquals(1, hello.version)
    assertEquals(listOf("state", "log"), hello.capabilities)
  }

  @Test
  fun rejectsInvalidHelloMessages() {
    assertNull(HelperProtocol.parseHelloLine("""{"type":"state","version":1}"""))
    assertNull(HelperProtocol.parseHelloLine("""{"type":"hello","version":1.5}"""))
    assertNull(HelperProtocol.parseHelloLine("""{"type":"hello","version":2147483648}"""))
    assertNull(HelperProtocol.parseHelloLine("not json"))
  }

  @Test
  fun parsesStateSnapshots() {
    val snapshot = HelperProtocol.parseSnapshotLine(
      """{"type":"state","state":"cn","timestamp":"2026-06-05T08:00:00.000Z","imeName":"Microsoft Pinyin","isOpen":true,"layoutHex":"0804","threadId":1234,"hwnd":"0x1","reason":"refresh","confidence":0.94,"rawStateAvailable":true}"""
    )

    assertNotNull(snapshot)
    assertEquals(ImeState.CN, snapshot.state)
    assertEquals("Microsoft Pinyin", snapshot.imeName)
    assertEquals(true, snapshot.isOpen)
    assertEquals("0804", snapshot.layoutHex)
    assertEquals(1234, snapshot.threadId)
    assertEquals("refresh", snapshot.reason)
  }

  @Test
  fun rejectsInvalidStateValues() {
    assertNull(HelperProtocol.parseSnapshotLine("""{"type":"state","state":"jp"}"""))
    assertNull(HelperProtocol.parseSnapshotLine("""{"type":"state"}"""))
  }

  @Test
  fun parsesHelperLogs() {
    val log = HelperProtocol.parseLogLine("""{"type":"log","level":"warn","message":"hello","source":"native-helper"}""")

    assertNotNull(log)
    assertEquals("warn", log.level)
    assertEquals("hello", log.message)
  }

  @Test
  fun coercesUnknownLogLevelToInfo() {
    val log = HelperProtocol.parseLogLine("""{"type":"log","level":"trace","message":"hello"}""")

    assertNotNull(log)
    assertEquals("info", log.level)
  }
}
