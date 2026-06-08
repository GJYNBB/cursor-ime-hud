import org.gradle.api.GradleException
import org.gradle.internal.os.OperatingSystem

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
val helperOutputDir = repoRoot.dir("resources/bin/win-x64")
val isWindowsHost = OperatingSystem.current().isWindows

val buildWindowsHelper by tasks.registering(Exec::class) {
  onlyIf { isWindowsHost }
  workingDir = repoRoot.asFile
  commandLine(
    "powershell",
    "-File",
    repoRoot.file("scripts/build-helper.ps1").asFile.absolutePath
  )
}

val verifyWindowsHelperResources by tasks.registering {
  if (isWindowsHost) {
    dependsOn(buildWindowsHelper)
  }

  val exe = helperOutputDir.file("WinImeWatcher.exe")
  val sha256 = helperOutputDir.file("WinImeWatcher.exe.sha256")
  inputs.files(exe, sha256)

  doLast {
    val missing = listOf(exe, sha256).map { it.asFile }.filterNot { it.isFile }
    if (missing.isNotEmpty()) {
      throw GradleException(
        "Missing Windows helper resource(s): ${missing.joinToString { it.absolutePath }}. " +
          "Build on Windows or provide a release-produced WinImeWatcher.exe and .sha256 before packaging."
      )
    }
  }
}

tasks.processResources {
  if (isWindowsHost) {
    dependsOn(buildWindowsHelper)
  }

  from(helperOutputDir) {
    into("bin/win-x64")
    include("WinImeWatcher.exe", "WinImeWatcher.exe.sha256")
  }
}

tasks.named("buildPlugin") {
  dependsOn(verifyWindowsHelperResources)
}

tasks.named("publishPlugin") {
  dependsOn(verifyWindowsHelperResources)
}

tasks.test {
  useJUnitPlatform()
}
