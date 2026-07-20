package com.chestnutch.cursorimehud.protocol

import com.chestnutch.cursorimehud.model.DetectorLogEntry
import com.chestnutch.cursorimehud.model.HelloMessage
import com.chestnutch.cursorimehud.model.ImeSnapshot
import com.chestnutch.cursorimehud.model.ImeState
import com.google.gson.JsonObject
import com.google.gson.JsonParser
import java.time.Instant

const val PROTOCOL_VERSION: Int = 1
const val MAX_LINE_BYTES: Int = 64 * 1024
const val MAX_BUFFER_BYTES: Int = 1024 * 1024

object HelperProtocol {
  fun parseHelloLine(line: String): HelloMessage? {
    val record = parseRecord(line) ?: return null
    if (record.stringOrNull("type") != "hello") return null
    val version = record.intOrNull("version") ?: return null
    val capabilities = record.get("capabilities")
      ?.takeIf { it.isJsonArray }
      ?.asJsonArray
      ?.mapNotNull { if (it.isJsonPrimitive && it.asJsonPrimitive.isString) it.asString else null }
      ?: emptyList()

    return HelloMessage(version, capabilities)
  }

  fun parseSnapshotLine(line: String): ImeSnapshot? {
    val record = parseRecord(line) ?: return null
    if (record.stringOrNull("type") != "state") return null
    val state = ImeState.fromWire(record.stringOrNull("state")) ?: return null

    return ImeSnapshot(
      state = state,
      timestamp = record.stringOrNull("timestamp") ?: Instant.now().toString(),
      imeName = record.stringOrNull("imeName"),
      isOpen = record.booleanOrNull("isOpen"),
      layoutHex = record.stringOrNull("layoutHex"),
      threadId = record.numberOrNull("threadId")?.toLong(),
      hwnd = record.stringOrNull("hwnd"),
      reason = record.stringOrNull("reason"),
      confidence = record.numberOrNull("confidence")?.toDouble(),
      rawStateAvailable = record.booleanOrNull("rawStateAvailable")
    )
  }

  fun parseLogLine(line: String): DetectorLogEntry? {
    val record = parseRecord(line) ?: return null
    if (record.stringOrNull("type") != "log") return null
    val message = record.stringOrNull("message") ?: return null
    val level = when (record.stringOrNull("level")) {
      "error" -> "error"
      "warn" -> "warn"
      else -> "info"
    }

    return DetectorLogEntry(
      level = level,
      message = message,
      timestamp = record.stringOrNull("timestamp") ?: Instant.now().toString(),
      source = record.stringOrNull("source") ?: "native-helper",
      details = record.get("details")?.toString()
    )
  }

  fun refreshCommand(): String = "{\"command\":\"refresh\"}\n"

  private fun parseRecord(line: String): JsonObject? = try {
    val parsed = JsonParser.parseString(line.trim())
    if (parsed.isJsonObject) parsed.asJsonObject else null
  } catch (_: Exception) {
    null
  }
}

private fun JsonObject.stringOrNull(name: String): String? {
  val value = get(name) ?: return null
  return if (value.isJsonPrimitive && value.asJsonPrimitive.isString) value.asString else null
}

private fun JsonObject.booleanOrNull(name: String): Boolean? {
  val value = get(name) ?: return null
  return if (value.isJsonPrimitive && value.asJsonPrimitive.isBoolean) value.asBoolean else null
}

private fun JsonObject.numberOrNull(name: String): Number? {
  val value = get(name) ?: return null
  return if (value.isJsonPrimitive && value.asJsonPrimitive.isNumber) value.asNumber else null
}

private fun JsonObject.intOrNull(name: String): Int? {
  val value = get(name) ?: return null
  if (!value.isJsonPrimitive || !value.asJsonPrimitive.isNumber) return null
  return value.asJsonPrimitive.asString.toIntOrNull()
}
