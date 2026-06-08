package com.chestnutch.cursorimehud.protocol

import com.chestnutch.cursorimehud.model.ImeState
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull

class HelperProtocolTest {
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
