import org.gradle.api.GradleException
import org.gradle.internal.os.OperatingSystem
import java.util.regex.Pattern

plugins {
  kotlin("jvm") version "2.3.20"
  id("org.jetbrains.intellij.platform")
}

group = "com.chestnutch"
version = providers.gradleProperty("pluginVersion").get()

kotlin {
  jvmToolchain(21)
}

intellijPlatform {
  pluginConfiguration {
    id = "com.chestnutch.cursor-ime-hud"
    name = "Cursor IME HUD"
    version = project.version.toString()
    ideaVersion {
      sinceBuild = "261"
    }
  }

  pluginVerification {
    ides {
      recommended()
    }
  }

  signing {
    certificateChain = providers.environmentVariable("CERTIFICATE_CHAIN")
    privateKey = providers.environmentVariable("PRIVATE_KEY")
    password = providers.environmentVariable("PRIVATE_KEY_PASSWORD")
  }

  publishing {
    token = providers.environmentVariable("PUBLISH_TOKEN")
  }
}

dependencies {
  intellijPlatform {
    intellijIdea("2026.1.3")
  }

  testImplementation(kotlin("test"))
}

val repoRoot = layout.projectDirectory.dir("..")
val helperManifestFile = repoRoot.file("resources/helper-manifest.json")
val helperProtocolVectorsFile = repoRoot.file("docs/helper-protocol-vectors.json")
val helperManifestText = helperManifestFile.asFile.readText()
val supportedHelperManifestVersion = 1
fun helperManifestInt(key: String): Int {
  val pattern = Pattern.compile("\\\"" + Pattern.quote(key) + "\\\"\\s*:\\s*(\\d+)(?=\\s*[,}])")
  val matcher = pattern.matcher(helperManifestText)
  if (!matcher.find()) {
    throw GradleException("helper-manifest.json is missing integer '$key'")
  }
  return matcher.group(1).toInt()
}
val helperManifestVersion = helperManifestInt("version")
if (helperManifestVersion != supportedHelperManifestVersion) {
  throw GradleException("Unsupported helper-manifest.json version '$helperManifestVersion'")
}
val helperResourcesDir = repoRoot.dir("resources/bin")
fun helperManifestValues(key: String): List<String> {
  val pattern = Pattern.compile("\\\"" + Pattern.quote(key) + "\\\"\\s*:\\s*\\\"([^\\\"]+)\\\"")
  val matcher = pattern.matcher(helperManifestText)
  val values = mutableListOf<String>()
  while (matcher.find()) {
    values.add(matcher.group(1))
  }
  return values
}
val helperPlatformKeys = helperManifestValues("platformKey")
val helperResourcePaths = helperManifestValues("resourcePath").map { it.removePrefix("resources/bin/") }
val helperSha256Paths = helperManifestValues("sha256Path").map { it.removePrefix("resources/bin/") }
if (helperPlatformKeys.size != helperResourcePaths.size || helperResourcePaths.size != helperSha256Paths.size) {
  throw GradleException("helper-manifest.json helper resource fields are inconsistent")
}
val currentOs = OperatingSystem.current()
val normalizedArch = System.getProperty("os.arch", "").lowercase().let { arch ->
  when (arch) {
    "x86_64", "amd64" -> "x64"
    "aarch64", "arm64" -> "arm64"
    "arm", "armv7", "armv7l", "armhf" -> "armhf"
    else -> arch
  }
}
val hostPlatformKey = when {
  currentOs.isWindows && normalizedArch == "arm64" -> "win-arm64"
  currentOs.isWindows -> "win-x64"
  currentOs.isMacOsX && normalizedArch in setOf("x64", "arm64") -> "darwin-$normalizedArch"
  currentOs.isLinux && normalizedArch in setOf("x64", "arm64") -> "linux-$normalizedArch"
  currentOs.isLinux && normalizedArch == "armhf" -> "linux-armhf"
  else -> null
}
val verifyAllNativeHelpers = providers.gradleProperty("verifyAllNativeHelpers")
  .map { it.equals("true", ignoreCase = true) }
  .orElse(providers.environmentVariable("CI").map { it.equals("true", ignoreCase = true) })
  .getOrElse(false)
val requiredHelperResourcePaths = helperResourcePaths.zip(helperPlatformKeys)
  .filter { (_, platformKey) -> verifyAllNativeHelpers || platformKey == hostPlatformKey }
  .map { (resourcePath, _) -> resourcePath }
val requiredHelperSha256Paths = helperSha256Paths.zip(helperPlatformKeys)
  .filter { (_, platformKey) -> verifyAllNativeHelpers || platformKey == hostPlatformKey }
  .map { (sha256Path, _) -> sha256Path }
val buildNativeHelper by tasks.registering(Exec::class) {
  onlyIf { hostPlatformKey != null }
  workingDir = repoRoot.asFile
  commandLine("node", repoRoot.file("scripts/build-helper.js").asFile.absolutePath)
}

val verifyNativeHelperResources by tasks.registering {
  if (!verifyAllNativeHelpers && hostPlatformKey != null) {
    dependsOn(buildNativeHelper)
  }

  doLast {
    val missing = (requiredHelperResourcePaths + requiredHelperSha256Paths)
      .map { helperResourcesDir.file(it).asFile }
      .filterNot { it.isFile }
    if (missing.isNotEmpty()) {
      throw GradleException(
        "Missing native helper resource(s): ${missing.joinToString { it.absolutePath }}. " +
          if (verifyAllNativeHelpers) {
            "Build and assemble all release helpers before packaging."
          } else {
            "Build the native helper for this host before packaging."
          }
      )
    }
  }
}

val publishVerifyNativeHelperResources by tasks.registering {
  doLast {
    val missing = (helperResourcePaths + helperSha256Paths)
      .map { helperResourcesDir.file(it).asFile }
      .filterNot { it.isFile }
    if (missing.isNotEmpty()) {
      throw GradleException(
        "Missing native helper resource(s): ${missing.joinToString { it.absolutePath }}. " +
          "Build and assemble all release helpers before publishing."
      )
    }
  }
}

tasks.processResources {
  if (!verifyAllNativeHelpers && hostPlatformKey != null) {
    dependsOn(buildNativeHelper)
  }

  from(helperResourcesDir) {
    into("bin")
    include(helperResourcePaths + helperSha256Paths)
  }
  from(helperManifestFile) {
    into("")
  }
}

tasks.processTestResources {
  from(helperProtocolVectorsFile)
}

tasks.named("buildPlugin") {
  dependsOn(verifyNativeHelperResources)
}

tasks.named("publishPlugin") {
  dependsOn(publishVerifyNativeHelperResources)
}

tasks.test {
  useJUnitPlatform()
}
