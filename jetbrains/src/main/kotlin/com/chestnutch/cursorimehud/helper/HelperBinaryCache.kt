package com.chestnutch.cursorimehud.helper

import com.intellij.openapi.diagnostic.Logger
import java.io.File
import java.io.IOException
import java.io.InputStream
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.StandardCopyOption
import java.security.MessageDigest

/**
 * Materializes the bundled helper binary into a stable per-hash cache directory
 * (`<cacheRoot>/<sha256 prefix>/<fileName>`) so restarts reuse the verified copy
 * instead of unpacking a fresh temp file each time. A cached copy is only reused
 * after its actual SHA-256 matches [materialize]'s expected hash, so corrupted
 * or stale files are rewritten in place via an atomic move.
 */
object HelperBinaryCache {
  private const val HASH_DIRECTORY_NAME_LENGTH = 12
  private val log = Logger.getInstance(HelperBinaryCache::class.java)

  fun materialize(cacheRoot: Path, fileName: String, expectedSha256: String, openSource: () -> InputStream): File {
    val versionDir = cacheRoot.resolve(expectedSha256.lowercase().take(HASH_DIRECTORY_NAME_LENGTH))
    val target = versionDir.resolve(fileName)
    if (!isCachedCopyValid(target, expectedSha256)) {
      writeAtomically(versionDir, target, expectedSha256, openSource)
    }
    cleanupStaleVersionDirectories(cacheRoot, versionDir)
    val file = target.toFile()
    file.setExecutable(true)
    return file
  }

  internal fun sha256(file: File): String {
    val digest = MessageDigest.getInstance("SHA-256")
    file.inputStream().use { input ->
      val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
      while (true) {
        val read = input.read(buffer)
        if (read < 0) break
        digest.update(buffer, 0, read)
      }
    }
    return digest.digest().joinToString("") { "%02x".format(it) }
  }

  private fun isCachedCopyValid(target: Path, expectedSha256: String): Boolean =
    Files.isRegularFile(target) && sha256(target.toFile()).equals(expectedSha256, ignoreCase = true)

  private fun writeAtomically(versionDir: Path, target: Path, expectedSha256: String, openSource: () -> InputStream) {
    Files.createDirectories(versionDir)
    val temp = Files.createTempFile(versionDir, target.fileName.toString(), ".tmp")
    try {
      openSource().use { source ->
        Files.newOutputStream(temp).use { output -> source.copyTo(output) }
      }
      try {
        Files.move(temp, target, StandardCopyOption.ATOMIC_MOVE)
      } catch (_: IOException) {
        // Either a concurrent writer already produced a valid copy, or a stale
        // file blocks the atomic move (Windows); fall back accordingly.
        if (isCachedCopyValid(target, expectedSha256)) {
          Files.deleteIfExists(temp)
        } else {
          Files.move(temp, target, StandardCopyOption.REPLACE_EXISTING)
        }
      }
    } finally {
      try {
        Files.deleteIfExists(temp)
      } catch (_: IOException) {
      }
    }
  }

  /**
   * Best-effort removal of cache directories left behind by other helper versions.
   *
   * During a dynamic plugin update the previous helper process may still be
   * running from its old hash directory while the new version materializes.
   * That is safe by construction: on Windows the locked executable makes the
   * recursive delete fail, so the directory is skipped here and retried on a
   * later materialize; on POSIX the unlinked inode keeps the running process
   * alive until it exits. Failures are therefore only logged at debug level.
   */
  private fun cleanupStaleVersionDirectories(cacheRoot: Path, currentVersionDir: Path) {
    val children = try {
      Files.newDirectoryStream(cacheRoot).use { it.toList() }
    } catch (_: IOException) {
      return
    }
    children
      .filter { Files.isDirectory(it) && it.fileName != currentVersionDir.fileName }
      .forEach { stale ->
        if (!stale.toFile().deleteRecursively()) {
          log.debug("Stale helper cache directory not fully removed (likely still in use): $stale")
        }
      }
  }
}
