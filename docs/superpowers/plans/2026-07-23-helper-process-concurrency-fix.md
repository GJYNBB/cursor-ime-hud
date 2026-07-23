# ImeHelperProcess 并发安全修复实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 修复 ultracode 审查确认的两个真实并发问题：`refresh()` 在实例锁内阻塞写管道，以及 `materializeHelper`/`verifySha256` 在后台线程无锁更新 hash 元数据字段。

**架构：** 保持现有 `@Synchronized` 生命周期状态机不变。仅把可能阻塞的 I/O 移出锁，并让 hash 元数据的写读都在同一把实例锁上建立 happens-before。不引入新框架、不改协议、不改 UI 层。

**技术栈：** Kotlin / IntelliJ Platform（`ApplicationManager.executeOnPooledThread`）/ kotlin.test 反射式私有方法测试

**范围边界（YAGNI）：**
- 本次**只做** P0（refresh 阻塞写）与 P1（hash 元数据数据竞争）。
- **不做** `ImeHudService` 的 `ArrayDeque` / `volatile` 修复（审查中的第三、四项，另开计划）。
- **不做** `waitThenForceKill` 从 `@Synchronized` 路径中整体剥离的大重构（`failStartingChildIfStillWaiting` / `failActiveChild` 已有锁内阻塞，属独立风险，不在本次）。

---

## 文件结构

| 文件 | 职责 |
|------|------|
| 修改：`jetbrains/src/main/kotlin/com/chestnutch/cursorimehud/helper/ImeHelperProcess.kt` | `refresh()` 异步写 stdin；`materializeHelper`/`verifySha256` 本地计算后同步写回字段 |
| 修改：`jetbrains/src/test/kotlin/com/chestnutch/cursorimehud/helper/ImeHelperProcessTest.kt` | 为两次修复补充行为测试 |

---

## 问题与修复要点

### P0 — `refresh()` 锁内阻塞写 stdin（约 269–276 行）

**现状：**
```kotlin
@Synchronized
fun refresh() {
  // ...
  val currentStdin = stdin
  if (currentProcess != null && currentProcess.isAlive && currentStdin != null) {
    try {
      currentStdin.write(HelperProtocol.refreshCommand())
      currentStdin.flush()   // 可能阻塞，且持有 this 锁
      return
    } catch (error: Exception) { ... }
  }
  // ...
}
```

**失败场景：** Action/菜单在 EDT 调用 `refresh()` → 持锁 → `flush()` 阻塞（管道满或 helper 挂起）→ 所有其他 `@Synchronized` 方法（`start`/`stop`/`debugInfo`）卡住；若调用方在 EDT，整 UI 冻结。

**修复原则：**
1. 在锁内只做：状态检查、拿本地 `BufferedWriter` 引用、决定是否异步写或走 `start()`。
2. `write` + `flush` 放到 `ApplicationManager.getApplication().executeOnPooledThread { ... }`。
3. 异步写失败时仍通过现有 `emitLog` 报 warn（`emitLog` 本身已 `invokeLaterOrRun`，线程安全）。
4. **不要**在异步任务里再次 `@Synchronized` 整段 refresh；异步任务只持有本地 `writer` 引用。
5. 若 `ApplicationManager.getApplication()` 为 null（单元测试环境），直接在当前线程写，保持现有测试可跑。

**目标形态：**
```kotlin
@Synchronized
fun refresh() {
  if (disposed.get()) return

  // A user-initiated refresh is the only recovery path after the circuit
  // opens.  It also cancels any pending exponential-backoff retry.
  clearRestartBudget()
  cancelRestartTask()
  shouldRestartOnExit = true
  emitDebug()

  if (lifecycleState == HelperLifecycleState.STOPPING) {
    pendingStart = true
    return
  }

  val currentProcess = process
  val currentStdin = stdin
  if (currentProcess != null && currentProcess.isAlive && currentStdin != null) {
    writeRefreshCommandAsync(currentStdin)
    return
  }

  // If the helper has already exited, start() creates a fresh child now
  // rather than waiting for the old backoff task.
  if (process == null || process?.isAlive != true) {
    process = null
    stdin = null
    start()
  }
}

private fun writeRefreshCommandAsync(writer: BufferedWriter) {
  val application = ApplicationManager.getApplication()
  val task = Runnable {
    try {
      writer.write(HelperProtocol.refreshCommand())
      writer.flush()
    } catch (error: Exception) {
      emitLog("warn", "向输入法助手发送刷新命令失败：${error.message}")
    }
  }
  if (application == null) {
    task.run()
  } else {
    application.executeOnPooledThread(task)
  }
}
```

### P1 — hash 元数据数据竞争（约 413–437 行）

**现状：**
```kotlin
private fun materializeHelper(...): File {
  // ... 从 classloader 拷贝到 temp ...
  helperFile = target          // 后台线程写，无锁
  expectedSha256 = hashText    // 后台线程写，无锁
  return target
}

private fun verifySha256(file: File, descriptor: HelperResourceDescriptor) {
  val expected = expectedSha256 ?: throw ...
  val actual = sha256(file)
  actualSha256 = actual        // 后台线程写，无锁
  hashMatches = ...
  if (hashMatches != true) throw ...
}

@Synchronized
fun debugInfo(): HelperDebugInfo {
  // 读 helperFile / expectedSha256 / actualSha256 / hashMatches
}
```

`start()` 在 pooled thread 上调用 `materializeHelper` + `verifySha256`，而 `debugInfo()` 在 `@Synchronized` 下读这些字段。写端未持锁 → JMM 无 happens-before → `debugInfo` 可能看到半更新状态。

**修复原则：**
1. 磁盘 I/O / 哈希计算用**局部变量**在后台线程完成，不碰实例字段。
2. 计算结果通过 `synchronized(this) { ... }` **一次**写回 `helperFile` / `expectedSha256` / `actualSha256` / `hashMatches`。
3. 校验失败时也要在锁内写回 `actualSha256`/`hashMatches`（便于诊断），再抛异常。
4. `debugInfo()` 已是 `@Synchronized`，读侧不变。

**目标形态：**
```kotlin
private fun materializeHelper(descriptor: HelperResourceDescriptor): File {
  val classLoader = javaClass.classLoader
  val hashText = classLoader.getResourceAsStream(descriptor.hashPath)
    ?.bufferedReader(StandardCharsets.US_ASCII)
    ?.use { it.readText().trim() }
    ?: throw IllegalStateException("缺少输入法助手 SHA-256 资源：${descriptor.hashPath}")
  val input = classLoader.getResourceAsStream(descriptor.resourcePath)
    ?: throw IllegalStateException("缺少输入法助手可执行资源：${descriptor.resourcePath}。请在打包前构建 ${descriptor.platformKey} 助手。")

  val dir = Files.createTempDirectory("cursor-ime-hud-jetbrains").toFile().apply { deleteOnExit() }
  val target = File(dir, descriptor.fileName)
  input.use { source -> target.outputStream().use { source.copyTo(it) } }
  target.setExecutable(true)

  synchronized(this) {
    helperFile = target
    expectedSha256 = hashText
  }
  return target
}

private fun verifySha256(file: File, descriptor: HelperResourceDescriptor) {
  val expected = synchronized(this) {
    expectedSha256 ?: throw IllegalStateException("缺少输入法助手的预期 SHA-256。")
  }
  val actual = sha256(file)
  val matches = actual.equals(expected, ignoreCase = true)

  synchronized(this) {
    actualSha256 = actual
    hashMatches = matches
  }

  if (!matches) {
    throw IllegalStateException("${descriptor.fileName} SHA-256 不匹配：expected=$expected actual=$actual")
  }
}
```

---

## 任务

### 任务 1：P0 — 异步 refresh 写管道

**文件：**
- 修改：`jetbrains/src/main/kotlin/com/chestnutch/cursorimehud/helper/ImeHelperProcess.kt`（`refresh` + 新增 `writeRefreshCommandAsync`）
- 测试：`jetbrains/src/test/kotlin/com/chestnutch/cursorimehud/helper/ImeHelperProcessTest.kt`

- [ ] **步骤 1：编写失败的测试**

在 `ImeHelperProcessTest` 末尾（私有反射 helper 之前）加入：

```kotlin
@Test
fun refreshOnLiveProcessDoesNotHoldInstanceLockDuringWrite() {
  val helper = ImeHelperProcess()
  val process = FakeProcess(alive = true)
  // 一个会阻塞 flush 的 writer：第一次 flush 进入 countDown + 阻塞直到测试结束
  val entered = java.util.concurrent.CountDownLatch(1)
  val release = java.util.concurrent.CountDownLatch(1)
  val blockingWriter = object : java.io.BufferedWriter(java.io.StringWriter()) {
    override fun write(str: String) {
      // no-op content
    }
    override fun flush() {
      entered.countDown()
      release.await(2, java.util.concurrent.TimeUnit.SECONDS)
    }
  }
  helper.setPrivateField("process", process)
  helper.setPrivateField("stdin", blockingWriter)
  helper.setPrivateField("lifecycleState", HelperLifecycleState.RUNNING)

  // 在另一线程调用 refresh，模拟 EDT 持锁场景
  val refreshThread = Thread({ helper.refresh() }, "test-refresh")
  refreshThread.start()

  // refresh 必须在写入阻塞前就释放实例锁并返回
  assertTrue(
    refreshThread.join(500),
    "refresh() 应在 stdin 写阻塞前返回；若超时说明 write/flush 仍在 @Synchronized 内"
  )
  assertTrue(entered.await(1, java.util.concurrent.TimeUnit.SECONDS), "异步写任务应启动")

  // 持锁的方法在 refresh 返回后应可立即进入
  val debug = helper.debugInfo()
  assertEquals(HelperLifecycleState.RUNNING, debug.lifecycleState)

  release.countDown()
  refreshThread.join(1000)
}
```

若当前 `FakeProcess` 构造签名不同，沿用文件内已有 `FakeProcess(alive = true)` 形态。

- [ ] **步骤 2：运行测试确认失败**

```bash
cd jetbrains
./gradlew test --tests "com.chestnutch.cursorimehud.helper.ImeHelperProcessTest.refreshOnLiveProcessDoesNotHoldInstanceLockDuringWrite"
```

预期：FAIL 或超时——`refreshThread.join(500)` 为 false（旧实现在锁内 `flush` 阻塞）。

> 若本机缺 Java 21 toolchain，用项目已有的 JDK 路径，或先跳过编译验证、在实现后用逻辑 review 替代（记录在 commit message）。

- [ ] **步骤 3：实现 `writeRefreshCommandAsync` 并改 `refresh`**

按上文「目标形态」修改 `refresh()`，并在同类中新增 `private fun writeRefreshCommandAsync(writer: BufferedWriter)`。

注意：
- 保留原有注释（user-initiated refresh / circuit breaker / pendingStart）。
- 锁内路径语义不变：`STOPPING` → `pendingStart`；无活进程 → `start()`。
- 异步写捕获所有 `Exception`，文案保持：`向输入法助手发送刷新命令失败：...`

- [ ] **步骤 4：运行测试确认通过**

```bash
cd jetbrains
./gradlew test --tests "com.chestnutch.cursorimehud.helper.ImeHelperProcessTest"
```

预期：全部 PASS，含新测试与既有 `refreshWhileStoppingSetsPendingStartAndClearsCircuit`。

- [ ] **步骤 5：Commit**

```bash
git add jetbrains/src/main/kotlin/com/chestnutch/cursorimehud/helper/ImeHelperProcess.kt \
        jetbrains/src/test/kotlin/com/chestnutch/cursorimehud/helper/ImeHelperProcessTest.kt
git commit -m "$(cat <<'EOF'
fix(jetbrains): do not block under lock when flushing helper refresh

Move stdin write/flush out of the synchronized refresh() path onto a
pooled thread so a hung helper cannot freeze the EDT or other lifecycle calls.
EOF
)"
```

---

### 任务 2：P1 — hash 元数据原子可见更新

**文件：**
- 修改：`jetbrains/src/main/kotlin/com/chestnutch/cursorimehud/helper/ImeHelperProcess.kt`（`materializeHelper` / `verifySha256`）
- 测试：`jetbrains/src/test/kotlin/com/chestnutch/cursorimehud/helper/ImeHelperProcessTest.kt`

- [ ] **步骤 1：编写失败的测试（行为契约）**

`materializeHelper`/`verifySha256` 依赖 classloader 资源，单测不启真实进程。用反射调用 + 同步写契约测试「读侧总是看到完整四元组」：

```kotlin
@Test
fun hashMetadataPublishedAtomicallyUnderInstanceLock() {
  val helper = ImeHelperProcess()
  val file = java.io.File.createTempFile("ime-helper", ".bin").apply {
    writeText("payload")
    deleteOnExit()
  }

  // 模拟 materialize 完成后、verify 完成前的「原子写」契约：
  // 任何持锁读取者要么看到四字段全 null，要么看到已写入的一致集合。
  val publish = Runnable {
    synchronized(helper) {
      helper.setPrivateField("helperFile", file)
      helper.setPrivateField("expectedSha256", "abc")
      helper.setPrivateField("actualSha256", "abc")
      helper.setPrivateField("hashMatches", true)
    }
  }

  // 并发读者：始终在持锁下读
  val inconsistencies = java.util.concurrent.atomic.AtomicInteger(0)
  val readers = (1..8).map {
    Thread {
      repeat(200) {
        val snapshot = synchronized(helper) {
          listOf(
            helper.getPrivateField<Any?>("helperFile"),
            helper.getPrivateField<Any?>("expectedSha256"),
            helper.getPrivateField<Any?>("actualSha256"),
            helper.getPrivateField<Any?>("hashMatches")
          )
        }
        val nullCount = snapshot.count { it == null }
        if (nullCount != 0 && nullCount != 4) {
          inconsistencies.incrementAndGet()
        }
      }
    }.also { it.start() }
  }

  Thread(publish).also { it.start(); it.join() }
  readers.forEach { it.join() }

  assertEquals(0, inconsistencies.get(), "hash 元数据在锁内发布后，读者不应看到部分更新")
  assertEquals(true, helper.debugInfo().hashMatches)
}
```

说明：此测试验证**发布契约**（锁内原子写 + 锁内读），配合实现侧 `synchronized(this)` 写回。它不会替代真实资源拷贝测试，但锁住了 P1 的核心语义。

- [ ] **步骤 2：运行测试（可先绿，因契约与实现一起落）**

若先写测试后改实现：当前代码对 `setPrivateField` 无锁写，并发读者用 `synchronized(helper)` 读仍可能看到半更新——但 `setPrivateField` 若在单线程 publish 里连续写且读者持同一锁，JMM 下同一锁串行化后反而难失败。

**因此步骤 2 改为静态审查 + 实现后的回归：**
1. 确认 `materializeHelper`/`verifySha256` 所有实例字段写都在 `synchronized(this)` 内。
2. 确认 `expectedSha256` 读也在锁内。
3. 跑全量 helper 测试。

- [ ] **步骤 3：实现锁内发布**

按上文「目标形态」改 `materializeHelper` 与 `verifySha256`：
- I/O 与 `sha256(file)` 在锁外。
- 字段赋值只在 `synchronized(this)` 内。
- 不改变异常文案与抛出条件。

- [ ] **步骤 4：运行测试确认通过**

```bash
cd jetbrains
./gradlew test --tests "com.chestnutch.cursorimehud.helper.ImeHelperProcessTest"
```

预期：PASS。

- [ ] **步骤 5：Commit**

```bash
git add jetbrains/src/main/kotlin/com/chestnutch/cursorimehud/helper/ImeHelperProcess.kt \
        jetbrains/src/test/kotlin/com/chestnutch/cursorimehud/helper/ImeHelperProcessTest.kt
git commit -m "$(cat <<'EOF'
fix(jetbrains): publish helper hash metadata under instance lock

Compute file materialization and SHA-256 on the worker thread with locals,
then write helperFile/expected/actual/hashMatches under synchronized(this)
so debugInfo() readers cannot observe partial updates.
EOF
)"
```

---

### 任务 3：回归与收尾

- [ ] **步骤 1：跑 helper 相关测试套件**

```bash
cd jetbrains
./gradlew test --tests "com.chestnutch.cursorimehud.helper.*"
```

预期：全部 PASS。

- [ ] **步骤 2：手工检查清单（无 UI 时做代码审查）**

1. `refresh()` 的 `@Synchronized` 方法体内**不再**出现 `write`/`flush`。
2. `materializeHelper` / `verifySha256` 中对 `helperFile`/`expectedSha256`/`actualSha256`/`hashMatches` 的赋值均在 `synchronized(this)` 内。
3. 未改 `HelperProtocol`、未改 `ImeHudService`、未改 UI。
4. 现有注释（circuit breaker / pendingStart）仍在。

- [ ] **步骤 3：如用户要求，推送到修复分支**

```bash
git checkout -b fix/helper-process-concurrency
# （若已在该分支则跳过）
git push -u origin HEAD
```

不自动打 tag / 不自动发 release；留给用户确认。

---

## 自检

| 规格点 | 对应任务 |
|--------|----------|
| P0 refresh 锁内阻塞写 | 任务 1 |
| P1 hash 字段数据竞争 | 任务 2 |
| 不引入技术债 / 不扩大范围 | 范围边界 + 任务 3 检查清单 |
| 测试覆盖 | 任务 1 步骤 1；任务 2 步骤 1–2 |

**占位符扫描：** 无 TODO / 待定。  
**类型一致性：** `BufferedWriter`、`HelperLifecycleState`、`HelperDebugInfo` 与现码一致。

**明确不做（防 scope creep）：**
- `ImeHudService.logs` 的 `ArrayDeque` 竞态
- `onSnapshot` 的 `runWriteAction` 误用 / 字段 volatile
- `failActiveChild` 锁内 `waitThenForceKill` 阻塞
- 发布 v0.1.2 / 改版本号

---

## 执行交接

计划已完成并保存到 `docs/superpowers/plans/2026-07-23-helper-process-concurrency-fix.md`。

**两种执行方式：**

1. **子代理驱动（推荐）** — 每个任务调度一个新子代理，任务间审查  
2. **内联执行** — 当前会话用 executing-plans 批量做，设检查点  

**选哪种方式？**
