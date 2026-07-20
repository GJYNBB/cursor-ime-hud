package com.chestnutch.cursorimehud.helper

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull

class HelperManifestTest {
  @Test
  fun resolvesWindowsX64DescriptorFromManifest() {
    val descriptor = HelperManifest.descriptorForHost("win32", "x64")

    assertNotNull(descriptor)
    assertEquals("bin/win32-x64/ImeWatcher.exe", descriptor.resourcePath)
    assertEquals("bin/win32-x64/ImeWatcher.exe.sha256", descriptor.hashPath)
    assertEquals("ImeWatcher.exe", descriptor.fileName)
    assertEquals("win-x64", descriptor.platformKey)
    assertEquals("ime-watcher", descriptor.backendName)
  }

  @Test
  fun resolvesWindowsArm64DescriptorFromManifest() {
    val descriptor = HelperManifest.descriptorForHost("win32", "arm64")

    assertNotNull(descriptor)
    assertEquals("bin/win32-arm64/ImeWatcher.exe", descriptor.resourcePath)
    assertEquals("bin/win32-arm64/ImeWatcher.exe.sha256", descriptor.hashPath)
    assertEquals("ImeWatcher.exe", descriptor.fileName)
    assertEquals("win-arm64", descriptor.platformKey)
  }

  @Test
  fun resolvesLinuxArmToArmhfDescriptorFromManifest() {
    val descriptor = HelperManifest.descriptorForHost("linux", "arm")

    assertNotNull(descriptor)
    assertEquals("bin/linux-armhf/ImeWatcher", descriptor.resourcePath)
    assertEquals("bin/linux-armhf/ImeWatcher.sha256", descriptor.hashPath)
    assertEquals("linux-armhf", descriptor.platformKey)
  }

  @Test
  fun returnsNullForUnsupportedHost() {
    assertNull(HelperManifest.descriptorForHost("freebsd", "x64"))
  }
}
