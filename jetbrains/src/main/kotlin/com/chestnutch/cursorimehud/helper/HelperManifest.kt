package com.chestnutch.cursorimehud.helper

import com.intellij.openapi.util.SystemInfo
import java.nio.charset.StandardCharsets

private data class HelperManifestEntry(
  val targetKey: String,
  val platform: String,
  val arch: String,
  val platformKey: String,
  val resourcePath: String,
  val sha256Path: String,
  val resourceBinaryName: String,
  val backendName: String
)

data class HelperResourceDescriptor(
  val resourcePath: String,
  val hashPath: String,
  val fileName: String,
  val platformKey: String,
  val backendName: String
)

object HelperManifest {
  private const val SUPPORTED_MANIFEST_VERSION = 1

  private val entries: List<HelperManifestEntry> by lazy { parseManifest(readManifestText()) }

  fun descriptorForCurrentHost(): HelperResourceDescriptor? = descriptorForHost(currentPlatform(), normalizedArch())

  fun descriptorForHost(platform: String, arch: String): HelperResourceDescriptor? {
    val normalizedArch = if (platform == "linux" && arch == "arm") "armhf" else arch
    return entries.firstOrNull { it.platform == platform && it.arch == normalizedArch }?.toDescriptor()
  }

  private fun HelperManifestEntry.toDescriptor(): HelperResourceDescriptor = HelperResourceDescriptor(
    resourcePath = resourcePath.removePrefix("resources/"),
    hashPath = sha256Path.removePrefix("resources/"),
    fileName = resourceBinaryName,
    platformKey = platformKey,
    backendName = backendName
  )

  private fun currentPlatform(): String = when {
    SystemInfo.isWindows -> "win32"
    SystemInfo.isMac -> "darwin"
    SystemInfo.isLinux -> "linux"
    else -> System.getProperty("os.name", "").lowercase()
  }

  private fun normalizedArch(): String {
    val arch = System.getProperty("os.arch", "").lowercase()
    return when {
      arch == "x86_64" || arch == "amd64" -> "x64"
      arch == "aarch64" || arch == "arm64" -> "arm64"
      arch == "arm" || arch == "armv7" || arch == "armv7l" || arch == "armhf" -> "armhf"
      else -> arch
    }
  }

  private fun readManifestText(): String {
    val stream = HelperManifest::class.java.classLoader.getResourceAsStream("helper-manifest.json")
      ?: throw IllegalStateException("缺少输入法助手清单资源：helper-manifest.json")
    return stream.use { String(it.readBytes(), StandardCharsets.UTF_8) }
  }

  private fun parseManifest(text: String): List<HelperManifestEntry> {
    val version = text.requiredInt("version")
    if (version != SUPPORTED_MANIFEST_VERSION) {
      throw IllegalStateException("不支持的 helper-manifest.json 版本：'$version'")
    }

    return helperObjects(text)
      .map { entry ->
        HelperManifestEntry(
          targetKey = entry.requiredString("targetKey"),
          platform = entry.requiredString("platform"),
          arch = entry.requiredString("arch"),
          platformKey = entry.requiredString("platformKey"),
          resourcePath = entry.requiredString("resourcePath"),
          sha256Path = entry.requiredString("sha256Path"),
          resourceBinaryName = entry.requiredString("resourceBinaryName"),
          backendName = entry.requiredString("backendName")
        )
      }
      .toList()
  }

  private fun helperObjects(text: String): List<String> {
    val result = mutableListOf<String>()
    var searchFrom = 0
    while (true) {
      val targetKeyIndex = text.indexOf("\"targetKey\"", searchFrom)
      if (targetKeyIndex < 0) break
      val start = text.lastIndexOf('{', targetKeyIndex)
      if (start < 0) break
      var depth = 0
      var inString = false
      var escaped = false
      for (index in start until text.length) {
        val char = text[index]
        if (escaped) {
          escaped = false
        } else if (char == '\\') {
          escaped = true
        } else if (char == '"') {
          inString = !inString
        } else if (!inString && char == '{') {
          depth++
        } else if (!inString && char == '}') {
          depth--
          if (depth == 0) {
            result.add(text.substring(start, index + 1))
            searchFrom = index + 1
            break
          }
        }
      }
    }
    return result
  }

  private fun String.requiredInt(key: String): Int {
    val pattern = Regex("\"${Regex.escape(key)}\"\\s*:\\s*(\\d+)(?=\\s*[,}])")
    return pattern.find(this)?.groupValues?.get(1)?.toIntOrNull()
      ?: throw IllegalStateException("helper-manifest.json 缺少整数项 '$key'")
  }

  private fun String.requiredString(key: String): String {
    val pattern = Regex("\"${Regex.escape(key)}\"\\s*:\\s*\"([^\"]+)\"")
    return pattern.find(this)?.groupValues?.get(1)
      ?: throw IllegalStateException("helper-manifest.json 缺少字段 '$key'")
  }
}
