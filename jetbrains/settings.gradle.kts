import org.jetbrains.intellij.platform.gradle.extensions.intellijPlatform

pluginManagement {
  repositories {
    mavenCentral()
    gradlePluginPortal()
  }
}

plugins {
  id("org.jetbrains.intellij.platform.settings") version "2.16.0"
  // Auto-provisions the JDK 21 toolchain when the local JDK differs (CI keeps
  // using setup-java and is unaffected).
  id("org.gradle.toolchains.foojay-resolver-convention") version "1.0.0"
}

dependencyResolutionManagement {
  repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
  repositories {
    mavenCentral()
    intellijPlatform {
      defaultRepositories()
    }
  }
}

rootProject.name = "cursor-ime-hud-jetbrains"
