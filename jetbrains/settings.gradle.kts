pluginManagement {
  repositories {
    mavenCentral()
    gradlePluginPortal()
    intellijPlatform {
      defaultRepositories()
    }
  }
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
