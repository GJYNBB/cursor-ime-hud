package com.chestnutch.cursorimehud.helper

import java.io.ByteArrayInputStream
import java.nio.file.Files
import java.nio.file.Path
import java.security.MessageDigest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import kotlin.test.fail

class HelperBinaryCacheTest {
  @Test
  fun writesFreshCopyWhenCacheIsEmpty() = withTempCacheRoot { cacheRoot ->
    val payload = "helper-binary".toByteArray()
    val expected = sha256(payload)

    val file = HelperBinaryCache.materialize(cacheRoot, "ImeWatcher.exe", expected) { ByteArrayInputStream(payload) }

    assertTrue(file.isFile)
    assertEquals(cacheRoot.resolve(expected.take(12)).resolve("ImeWatcher.exe"), file.toPath())
    assertTrue(payload.contentEquals(file.readBytes()))
  }

  @Test
  fun reusesCachedCopyWithoutOpeningSourceWhenHashMatches() = withTempCacheRoot { cacheRoot ->
    val payload = "helper-binary".toByteArray()
    val expected = sha256(payload)
    val cached = cacheRoot.resolve(expected.take(12)).resolve("ImeWatcher.exe")
    Files.createDirectories(cached.parent)
    Files.write(cached, payload)

    val file = HelperBinaryCache.materialize(cacheRoot, "ImeWatcher.exe", expected) {
      fail("cached copy with matching hash must be reused without re-unpacking")
    }

    assertEquals(cached, file.toPath())
    assertTrue(payload.contentEquals(file.readBytes()))
  }

  @Test
  fun rewritesCachedCopyWhenHashDoesNotMatch() = withTempCacheRoot { cacheRoot ->
    val payload = "helper-binary".toByteArray()
    val expected = sha256(payload)
    val cached = cacheRoot.resolve(expected.take(12)).resolve("ImeWatcher.exe")
    Files.createDirectories(cached.parent)
    Files.write(cached, "corrupted".toByteArray())

    val file = HelperBinaryCache.materialize(cacheRoot, "ImeWatcher.exe", expected) { ByteArrayInputStream(payload) }

    assertEquals(cached, file.toPath())
    assertTrue(payload.contentEquals(file.readBytes()))
  }

  @Test
  fun cleansUpStaleVersionDirectoriesAndLeavesNoTempFiles() = withTempCacheRoot { cacheRoot ->
    val stale = cacheRoot.resolve("0123456789ab").resolve("ImeWatcher.exe")
    Files.createDirectories(stale.parent)
    Files.write(stale, "old-version".toByteArray())
    val payload = "helper-binary".toByteArray()
    val expected = sha256(payload)

    HelperBinaryCache.materialize(cacheRoot, "ImeWatcher.exe", expected) { ByteArrayInputStream(payload) }

    assertFalse(Files.exists(stale.parent), "stale version directory should be removed")
    val leftovers = Files.newDirectoryStream(cacheRoot.resolve(expected.take(12))).use { entries ->
      entries.filter { it.fileName.toString().endsWith(".tmp") }
    }
    assertTrue(leftovers.isEmpty(), "temp files must not remain after materialization")
  }

  private fun sha256(bytes: ByteArray): String =
    MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }

  private fun withTempCacheRoot(block: (Path) -> Unit) {
    val cacheRoot = Files.createTempDirectory("cursor-ime-hud-cache-test")
    try {
      block(cacheRoot)
    } finally {
      cacheRoot.toFile().deleteRecursively()
    }
  }
}
