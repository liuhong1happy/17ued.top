Flutter 面试里有一道题很能区分「会用」和「懂」：

> Flutter 是 JIT 还是 AOT？

标准答案是：**看构建模式。Debug 用 JIT，Profile/Release 用 AOT。** 但如果只答这一句，追问马上就来：

- JIT 和 AOT 分别编译了什么？产物是什么？
- 为什么 Release 不能 Hot Reload？
- 为什么 iOS 上架必须 AOT？
- AOT 是不是就没有 Dart VM 了？
- AOT 的 Tree Shaking 会删掉什么？`@pragma('vm:entry-point')` 是干什么的？
- 线上崩溃栈没有符号怎么办？

这篇文章把 Dart 编译链路、JIT/AOT 的执行模型、Flutter 三种构建模式、产物结构、性能与包体积、Tree Shaking 和符号化一次讲清。

![Flutter 的 Dart 编译链路：源码经 CFE 生成 kernel，Debug 把 kernel 打进 kernel_blob.bin 由 Dart VM JIT 执行，Profile/Release 经 gen_snapshot 生成 libapp.so 或 App.framework 由预编译运行时执行](/images/blog/flutter-jit-aot/compile-pipeline.svg)

# 一、先分清三个层次

讨论 Flutter 的 JIT/AOT，必须先分清三层，否则很容易把「Dart 代码」「Flutter 引擎」「平台原生代码」混在一起：

| 层次 | 语言 | 编译方式 | 说明 |
| --- | --- | --- | --- |
| **Dart 代码** | Dart | Debug JIT / Profile·Release AOT | 你写的业务代码、Widget、状态管理 |
| **Flutter 引擎** | C++ | 始终 AOT（预编译） | `libflutter.so` / `Flutter.framework`，包含 Skia、Dart VM 运行时等 |
| **平台代码** | Kotlin/Java、Swift/ObjC | 平台工具链 | Android Gradle、Xcode，和 Dart 编译无关 |

**JIT/AOT 说的是 Dart 代码怎么变成机器码**，不是 Flutter 引擎本身。引擎的 C++ 部分一直是预编译好的。

另一个常见误解是「AOT 就没有 Dart VM 了」。不是。AOT 只是**没有 JIT 编译器**，Dart VM 的运行时能力仍然存在：垃圾回收、Isolate、异常、类型系统、FFI 都还在。Release 包里跑的是一个**预编译运行时（precompiled runtime）**。

# 二、Dart 的编译链路

## 2.1 从源码到 Kernel

Dart 源码不会直接变成机器码，中间要先经过 **Kernel**：

```text
Dart 源码 (.dart)
   ↓  CFE（Common Front End）/ frontend_server
Kernel IR (.dill)
   ↓
Debug：kernel_blob.bin → Dart VM 在运行时编译
Profile/Release：gen_snapshot → 机器码
```

Kernel 是 Dart 的中间表示（IR），包含类型信息、类结构、函数体等。它的作用是把「解析 + 类型检查」和「目标平台代码生成」分开：

- **Debug**：Flutter 把 Kernel 打进 `kernel_blob.bin`，Dart VM 在设备上加载并 JIT 执行
- **Profile/Release**：`gen_snapshot` 把 Kernel 编译成目标架构的机器码，打包成 `libapp.so`（Android）或 `App.framework`（iOS）

在 Flutter 的构建流程里，`flutter assemble` 负责编排这些步骤；你看到的 `frontend_server`、`gen_snapshot`、`kernel_snapshot` 都是这条链路上的工具。

## 2.2 Debug 的产物

Debug APK 里可以看到：

```text
assets/flutter_assets/kernel_blob.bin   ← Dart Kernel
lib/<abi>/libflutter.so                 ← Flutter 引擎（C++）
lib/<abi>/libapp.so                     ← 通常不存在或不是 Dart AOT 代码
```

Debug 模式下，Dart 代码以 Kernel 形式存在，由设备上的 Dart VM 在运行时编译。这也是 Hot Reload 能工作的前提：VM 可以接收新的 Kernel 增量并替换代码。

## 2.3 Release 的产物

Release APK 里：

```text
lib/<abi>/libapp.so                     ← Dart AOT 机器码
lib/<abi>/libflutter.so                 ← Flutter 引擎
assets/flutter_assets/                  ← 资源、字体、图片
```

iOS Release：

```text
Runner.app/Frameworks/App.framework/App  ← Dart AOT 代码（Mach-O）
Runner.app/Frameworks/Flutter.framework  ← Flutter 引擎
```

`libapp.so` 不是「共享库形式的 Java/Kotlin 代码」，而是 **Dart AOT snapshot 的 ELF 封装**；iOS 的 `App` 是 Mach-O。它们都是**架构相关**的：`armeabi-v7a`、`arm64-v8a`、`x86_64` 各一份。

## 2.4 脱离 Flutter 看 Dart 的编译方式

Dart SDK 本身也提供多种编译目标，有助于理解概念：

```bash
# 只生成 Kernel
dart compile kernel bin/main.dart -o build/main.dill

# JIT snapshot：需要 Dart VM 执行
dart compile jit-snapshot bin/main.dart -o build/main.jit

# AOT snapshot：需要 dartaotruntime 执行
dart compile aot-snapshot bin/main.dart -o build/main.aot

# 独立可执行文件：把运行时和代码打在一起
dart compile exe bin/main.dart -o build/main
```

Flutter 用的是同一套 Dart 编译基础设施，只是由 `flutter build` 封装了参数和目标平台。

# 三、JIT：运行时编译

## 3.1 JIT 怎么工作

JIT（Just-In-Time）的核心是：**代码在运行时才被编译成机器码**。

Dart VM 在 JIT 模式下的典型流程：

```text
加载 Kernel
   ↓
函数第一次执行：先执行未优化代码（或由 VM 快速生成代码）
   ↓
收集类型反馈（参数实际类型、调用目标、分支走向）
   ↓
热点函数被优化编译器重新编译成高质量机器码
   ↓
如果运行时假设被打破（类型变了、调用目标变了）→ 反优化（deoptimize）
   ↓
回到未优化代码，重新收集反馈，可能再次优化
```

几个关键词：

- **惰性编译**：不是启动时把所有函数都编译，而是用到才编译
- **类型反馈**：JIT 能看到「这个参数实际总是 int」，从而做特化、内联、去虚化
- **优化与反优化**：JIT 可以基于运行时假设激进优化，假设不成立时退回安全代码
- **代码缓存**：编译后的机器码占内存，JIT 编译线程也占 CPU

这也解释了为什么 Debug 模式「刚启动有点慢，跑一会儿变快」：热点代码需要预热。

## 3.2 JIT 与 Hot Reload

Hot Reload 只在 Debug（JIT）下可用，流程大致是：

```text
修改 Dart 源码
   ↓
frontend_server 增量编译出新的 Kernel
   ↓
通过 VM Service 发送到设备
   ↓
Dart VM 替换受影响的代码
   ↓
触发 reassemble，重建 Widget 树
   ↓
State 保留（不会重新执行 initState）
```

Hot Reload 的限制：

- 不能修改 `main()`、全局初始化、`initState` 里的初始化逻辑（改了也不会重新执行）
- 不能修改原生代码（Kotlin/Swift/C++）
- 不能修改 `const` 构造相关的深层结构（可能需要 Hot Restart）
- 语法错误、类型错误会导致 reload 失败，需要修复后重试

Hot Restart 则是**重启 Isolate、重新执行 `main()`**，State 全部丢失，但比完整重新安装快。

**Release 不能 Hot Reload 的根本原因**：AOT 代码已经是目标平台的机器码，没有 Kernel、没有 JIT 编译器、没有可替换的代码缓存。要改代码只能重新编译、重新签名、重新安装。

## 3.3 JIT 的优缺点

| 优点 | 缺点 |
| --- | --- |
| 支持 Hot Reload，开发迭代快 | 启动有预热，首屏/首次交互可能慢 |
| 可根据运行时类型反馈做激进优化 | JIT 编译线程占 CPU，代码缓存占内存 |
| 调试信息丰富，断点/热重载方便 | 运行时行为更复杂，性能不如 AOT 可预测 |
| 不需要提前知道所有代码 | iOS 上架不允许 JIT（只能 Debug 开发用） |

## 3.4 iOS 为什么不能 JIT

iOS 的应用沙盒和代码签名机制要求：**可执行内存不能同时可写**（W^X）。JIT 需要在运行时生成机器码并写入可执行内存，这在 App Store 应用里是不允许的。

开发阶段可以通过调试器附加、`get-task-allow` entitlement 等机制使用 JIT，所以 Debug 模式在 iOS 真机上可以跑、可以 Hot Reload；但**上架版本必须 AOT**。

Android 没有同样的限制，但 Flutter 仍然在 Release 使用 AOT，因为性能、启动、内存和包体积更可控。

# 四、AOT：构建时编译

## 4.1 AOT 怎么工作

AOT（Ahead-Of-Time）在**构建时**把 Dart 代码编译成目标平台的机器码：

```text
Dart 源码
   ↓ CFE
Kernel
   ↓ 全程序分析 + Tree Shaking
   ↓ gen_snapshot
目标架构机器码（libapp.so / App.framework）
   ↓
设备上由预编译运行时直接执行，无 JIT
```

和 JIT 最大的区别：

- **没有运行时编译**：代码在安装前就已经是机器码
- **全程序视角**：编译器能看到整个程序，做跨函数内联、常量折叠、死代码消除
- **封闭世界假设**：所有可能执行的代码在编译时确定，不能动态加载新代码
- **没有反优化**：优化基于静态分析，不需要运行时假设

## 4.2 AOT 的优点

| 优点 | 说明 |
| --- | --- |
| 启动快 | 不需要 JIT 预热，代码直接执行 |
| 性能可预测 | 没有编译线程、没有反优化抖动 |
| 内存更可控 | 不需要 JIT 代码缓存和编译器 |
| 包体积可优化 | Tree Shaking 删除不可达代码 |
| 符合 iOS 上架要求 | 不依赖运行时生成可执行代码 |
| 更安全 | 没有运行时代码生成，攻击面更小（但不等于不可逆向） |

## 4.3 AOT 的代价

| 代价 | 说明 |
| --- | --- |
| 构建更慢 | 全程序编译、Tree Shaking、按 ABI 生成 |
| 不能 Hot Reload | 代码已固化，只能重新构建 |
| 动态能力受限 | 反射、`eval`、动态加载代码不可用或受限 |
| 调试更难 | 需要符号文件、`flutter symbolize` |
| 产物按架构拆分 | 多 ABI 导致包体积增大，需要 split/App Bundle |
| 不能运行时改代码 | 插件化/热更新不能走 Dart 代码替换 |

## 4.4 AOT 与 Tree Shaking

AOT 是**封闭世界**编译：编译器从入口（`main`、`@pragma('vm:entry-point')` 标记的函数等）出发，标记所有可达代码，删除不可达的类、函数、字段。

这对包体积是好事，但会带来两个问题：

1. **反射/动态调用可能失效**：只通过字符串名字调用的代码，编译器看不到引用，可能被删掉
2. **原生回调的入口可能被删**：通过 FFI、平台通道、`Isolate.spawn` 调用的顶层/静态函数，需要显式标记

```dart
@pragma('vm:entry-point')
void nativeCallback(int value) {
  // 被 C/Java/Swift 通过函数指针调用
}

@pragma('vm:entry-point')
void isolateEntry(SendPort port) {
  // Isolate.spawn 的入口
}
```

常见需要 `@pragma('vm:entry-point')` 的场景：

- `Isolate.spawn` / `Isolate.run` 的入口（如果是顶层/静态函数）
- `NativeCallable` / FFI 回调
- 平台通道调用的 Dart 入口
- 通过 `Function.apply` 动态调用的函数（不总是需要，但被删时考虑）
- 插件注册、反射式框架的入口

另外，Flutter 不支持 `dart:mirrors`，`eval` 也不可用；AOT 的 Tree Shaking 还会进一步删除只被动态引用的代码。依赖运行时反射的框架（某些 JSON 序列化、依赖注入）需要代码生成或显式注册。

## 4.5 AOT 与 Isolate

AOT 下 Isolate 仍然可用。`Isolate.spawn` 的入口必须是**顶层或静态函数**；`Isolate.run` 可以接受闭包，但闭包捕获的对象必须可跨 Isolate 传递，且入口代码要保证被 AOT 保留：

```dart
Future<void> runInBackground(String data) {
  return Isolate.run(() => heavyWork(data));
}

String heavyWork(String data) {
  // CPU 密集任务；闭包捕获的 data 必须可跨 Isolate 传递
  return data.toUpperCase();
}
```

`Isolate.run` 的闭包在 AOT 下同样要能跨 Isolate 传递；捕获的对象必须可发送。不要把 `BuildContext`、`StreamController`、原生句柄等不可发送对象带进 Isolate。

# 五、Flutter 的三种构建模式

![Flutter 三种构建模式：Debug 使用 JIT、开启断言与 Hot Reload，Profile 使用 AOT 并保留性能追踪，Release 使用 AOT、关闭断言并做 Tree Shaking](/images/blog/flutter-jit-aot/build-modes.svg)

| 维度 | Debug | Profile | Release |
| --- | --- | --- | --- |
| Dart 执行方式 | **JIT** | **AOT** | **AOT** |
| 断言 `assert` | 开启 | 关闭 | 关闭 |
| Hot Reload | ✓ | ✗ | ✗ |
| 性能追踪 / DevTools | 有限，数据不具代表性 | ✓ | 有限 |
| Tree Shaking | 基本不做 | ✓ | ✓ |
| 包体积 | 大（含 Kernel、调试信息） | 中 | 小（可混淆/拆 ABI） |
| 用途 | 日常开发、调试 | 性能分析、真机验证 | 生产发布 |

## 5.1 Debug

```bash
flutter run
```

- JIT，支持 Hot Reload
- 开启断言、调试检查、服务扩展
- 包含 `kernel_blob.bin`
- **性能数据没有参考价值**：断言、检查、JIT 预热都会影响结果

## 5.2 Profile

```bash
flutter run --profile
```

- AOT，保留 Timeline、DevTools 等性能追踪能力
- 关闭断言，接近 Release 的执行性能
- 不支持 Hot Reload
- 用于真机性能分析；模拟器/仿真器通常不能反映真实性能
- 可以配合 `flutter drive --profile` 做集成性能测试

**做性能优化时，必须以 Profile/Release 的数据为准。** Debug 下的帧耗时、启动时间、内存都不能直接外推。

## 5.3 Release

```bash
flutter build apk --release
flutter build appbundle --release
flutter build ipa --release
```

- AOT，关闭断言，Tree Shaking
- 可配合 `--split-debug-info`、`--obfuscate`、`--split-per-abi`
- 生产发布使用

## 5.4 如何判断当前模式

```dart
import 'package:flutter/foundation.dart';

if (kDebugMode) {
  // Debug
} else if (kProfileMode) {
  // Profile
} else if (kReleaseMode) {
  // Release
}
```

或者用编译期常量：

```dart
const isProduct = bool.fromEnvironment('dart.vm.product');
const isProfile = bool.fromEnvironment('dart.vm.profile');
```

注意：`assert` 只在 Debug 生效，不要用 `assert` 做业务校验。

# 六、JIT 与 AOT 的性能差异

![JIT 与 AOT 的执行模型对比：JIT 惰性编译、收集类型反馈、热点优化并可能反优化；AOT 在全程序分析后直接生成机器码，启动即执行](/images/blog/flutter-jit-aot/jit-vs-aot.svg)

## 6.1 启动

- **JIT**：需要加载 Kernel、初始化 JIT、按需编译，启动有预热成本
- **AOT**：机器码已就绪，启动直接执行，通常更快

但启动时间不只取决于 Dart 编译方式，还包括引擎初始化、资源加载、首帧构建、插件初始化等。AOT 能消除 JIT 预热，但不能消除所有启动成本。

## 6.2 峰值性能

不能简单说「AOT 一定比 JIT 快」：

- **JIT 的优势**：能看到真实运行时类型，做投机优化、内联、去虚化；热点代码可能达到很高性能
- **AOT 的优势**：没有编译线程干扰、没有反优化抖动、内存更稳定、启动即峰值
- **Flutter 的实际选择**：生产用 AOT，因为可预测性、启动、内存、iOS 合规比「理论峰值」更重要

对大多数 UI 业务，瓶颈通常在布局、绘制、图片解码、网络 I/O，而不是 Dart 代码的峰值算力。AOT 的稳定性和启动优势更关键。

## 6.3 内存

- JIT：需要保存 Kernel、编译后的代码、类型反馈、JIT 编译器本身
- AOT：只有预编译代码和运行时数据，通常内存更低

但 AOT 代码体积可能比 Kernel 大，具体取决于代码量和优化；包体积要看 APK/IPA 的实际产物。

## 6.4 帧率与卡顿

Flutter 的帧预算：

```text
60 FPS  → 16.67 ms/帧
90 FPS  → 11.11 ms/帧
120 FPS → 8.33 ms/帧
```

无论 JIT 还是 AOT，**在 UI 线程做耗时同步计算都会掉帧**。JIT 的编译线程、AOT 的代码布局都可能影响抖动，但业务代码的布局/绘制/图片处理才是大头。

性能优化顺序：

1. 用 Profile 模式复现
2. 用 DevTools Performance 看 UI/Raster 线程
3. 定位是 build/layout/paint、图片解码、GC、平台通道还是同步计算
4. 再决定用缓存、Isolate、减少重建、降级等手段

# 七、包体积与产物优化

## 7.1 多 ABI

Android 的 `libapp.so` 按 ABI 生成：

```text
armeabi-v7a
arm64-v8a
x86_64
```

如果打一个包含全部 ABI 的 APK，体积会明显增大。优化方式：

```bash
# 按 ABI 拆分 APK
flutter build apk --release --split-per-abi

# 使用 App Bundle，由 Play 按设备下发对应 ABI
flutter build appbundle --release
```

## 7.2 移除调试信息

```bash
flutter build apk --release \
  --split-debug-info=build/symbols \
  --obfuscate
```

- `--split-debug-info` 把调试符号从产物中剥离，减小体积，同时生成符号文件用于崩溃还原
- `--obfuscate` 混淆 Dart 符号名，进一步增加逆向难度；必须配合 `--split-debug-info`
- **符号文件不能丢**：线上崩溃栈需要它来还原

## 7.3 Tree Shaking 图标

```bash
flutter build apk --release --tree-shake-icons
```

Flutter 默认会对 `IconData` 做图标字体裁剪，只保留用到的图标。如果通过动态方式使用图标（字符串拼名字），可能被误删，需要 `--no-tree-shake-icons` 或改成静态引用。

## 7.4 体积分析

```bash
flutter build apk --release --analyze-size
```

生成体积分析数据，可在 DevTools 的 App Size 工具里查看哪些库/资源占用最大。优化顺序通常是：

1. 图片/视频资源（压缩、WebP、按需下载）
2. 字体（子集化、按需加载）
3. 多 ABI（split/App Bundle）
4. 第三方 SDK（能移除就移除）
5. Dart 代码（Tree Shaking 已经做了大部分）

## 7.5 混淆的边界

`--obfuscate` **不是加密**：

- 它只重命名 Dart 符号，不改变逻辑
- 反编译/逆向仍然可能，只是成本更高
- 密钥、令牌、业务规则不要放在客户端
- 真正的安全靠服务端鉴权、签名、加密和风控

# 八、调试、崩溃与符号化

## 8.1 Debug 调试

- `flutter run` 启动 VM Service
- DevTools 可以看 Widget 树、性能、内存、网络
- Hot Reload 快速验证 UI
- 断点、日志、`debugPrint` 都在 Debug 下最方便

## 8.2 Profile 性能分析

```bash
flutter run --profile
```

- DevTools Performance 看帧耗时、UI/Raster 线程
- Timeline 看具体阶段
- `flutter drive --profile` 做可重复的性能测试
- 不要用 Debug 数据下结论

## 8.3 AOT 崩溃符号化

Release 的 Dart 崩溃栈默认可能是地址或混淆后的名字。构建时保留符号：

```bash
flutter build apk --release \
  --split-debug-info=build/symbols \
  --obfuscate
```

拿到崩溃栈后：

```bash
flutter symbolize -i crash.txt -d build/symbols
```

注意事项：

- 符号文件按构建版本保存，版本必须与线上包完全一致
- 不要随包发布符号文件
- Android 原生崩溃（`libflutter.so`、`libapp.so`）可能还需要 `ndk-stack` / `addr2line`
- iOS 符号化用 `dSYM` + `atos`，Flutter 的 Dart 栈仍用 `flutter symbolize`

## 8.4 常见崩溃排查顺序

1. 确认是 Dart 异常还是原生崩溃（SIGSEGV、OOM、ANR）
2. Dart：看 `FlutterError.onError`、`runZonedGuarded`、日志、符号化栈
3. 原生：看 tombstone、`ndk-stack`、Xcode Organizer
4. 版本：确认符号文件与包版本一致
5. 复现：Profile/Release 真机复现，不要在 Debug 下猜测

# 九、常见误区

| 误区 | 事实 |
| --- | --- |
| Flutter Release 也是 JIT | 移动端 Release/Profile 是 AOT；Debug 才是 JIT |
| AOT 就没有 Dart VM 了 | 仍有预编译运行时：GC、Isolate、异常、类型系统都在 |
| JIT 一定比 AOT 慢 | JIT 可用运行时反馈做投机优化；AOT 胜在启动、稳定、内存、合规 |
| Release 可以 Hot Reload | 不可以；AOT 代码已固化 |
| Hot Reload 会重新执行 initState | 不会；State 保留，只有 Hot Restart 才重建 |
| AOT 支持 dart:mirrors / eval | 不支持或受限；依赖反射的代码需要代码生成/显式注册 |
| Tree Shaking 只会删无用代码 | 动态调用/反射/原生回调的入口也可能被误删，需要 `@pragma` |
| obfuscate 是加密 | 只是重命名符号；不能保护密钥和业务逻辑 |
| Debug 性能可以代表线上 | 不能；断言、检查、JIT 预热都会干扰，必须用 Profile/Release |
| 所有平台都用同一套 AOT | Web 用 dart2js/dart2wasm；Android/iOS 的 AOT 产物格式也不同 |

# 十、15 道高频面试题

**Q1：Flutter 是 JIT 还是 AOT？**

取决于构建模式。Debug 使用 JIT，支持 Hot Reload；Profile 和 Release 在移动端使用 AOT。Flutter 引擎的 C++ 部分始终是预编译的。

**Q2：Debug 和 Release 的产物有什么区别？**

Debug 包含 `kernel_blob.bin`（Dart Kernel），由设备上的 Dart VM JIT 执行；Release 包含 `libapp.so`（Android ELF）或 `App.framework/App`（iOS Mach-O），是 AOT 机器码，配合预编译运行时执行。

**Q3：为什么 Release 不能 Hot Reload？**

AOT 代码已经是目标平台机器码，没有 Kernel、没有 JIT 编译器、没有可替换的代码缓存。修改代码必须重新编译、签名、安装。

**Q4：Hot Reload 和 Hot Restart 的区别？**

Hot Reload 增量编译并替换代码，State 保留，`reassemble` 触发重建；Hot Restart 重启 Isolate、重新执行 `main()`，State 全部丢失。

**Q5：为什么 iOS 上架必须 AOT？**

iOS 的代码签名和 W^X 限制不允许 App Store 应用在运行时生成可执行代码。JIT 只能在开发调试（带调试器/entitlement）时使用；上架版本必须 AOT。

**Q6：AOT 还有 Dart VM 吗？**

有。AOT 只是没有 JIT 编译器，Dart VM 的 GC、Isolate、异常、类型系统、FFI 仍然存在，运行的是预编译运行时。

**Q7：JIT 和 AOT 的性能怎么比较？**

JIT 启动有预热，但能利用运行时类型反馈做投机优化；AOT 启动快、性能稳定、内存可控、没有反优化抖动。Flutter 生产选 AOT，主要看重启动、稳定性和 iOS 合规，而不是单纯的峰值性能。

**Q8：Kernel / dill 是什么？**

Dart 的中间表示，由 CFE/frontend_server 生成，包含类型信息和函数体。Debug 用它做 JIT 和 Hot Reload；AOT 用它作为 gen_snapshot 的输入。

**Q9：AOT 的 Tree Shaking 会删什么？**

从入口出发标记可达代码，删除不可达的类、函数、字段。反射、动态调用、原生回调、`Isolate.spawn` 入口等可能被误删，需要用 `@pragma('vm:entry-point')` 标记。

**Q10：`@pragma('vm:entry-point')` 有什么用？**

告诉 AOT 编译器「这个函数是入口，不能删」。常用于 FFI 回调、平台通道入口、Isolate 入口、动态调用的函数。

**Q11：AOT 下能用反射和 eval 吗？**

`dart:mirrors` 在 Flutter AOT 中不可用，`eval` 也不可用。依赖反射的序列化/依赖注入需要代码生成或显式注册。

**Q12：如何减小 Release 包体积？**

`--split-per-abi` / App Bundle、`--split-debug-info`、`--obfuscate`、`--tree-shake-icons`、压缩图片/字体、移除不用的 SDK、`--analyze-size` 定位大头。

**Q13：线上 Dart 崩溃栈怎么还原？**

构建时 `--split-debug-info=... --obfuscate` 保留符号文件；用 `flutter symbolize -i crash.txt -d symbols` 还原。符号文件必须与线上包版本严格对应。

**Q14：Profile 模式和 Release 有什么区别？**

两者都是 AOT、关闭断言；Profile 保留 Timeline/DevTools 等性能追踪能力，Release 面向生产、做完整优化和混淆。性能分析用 Profile，发布用 Release。

**Q15：为什么 Debug 性能不能代表线上？**

Debug 开启断言、调试检查、服务扩展，使用 JIT 且有预热，包体和内存开销也不同。性能结论必须来自 Profile/Release 真机数据。

# 十一、速查表

## 11.1 构建模式

```text
Debug    JIT    assert 开   Hot Reload 开   kernel_blob.bin   开发调试
Profile  AOT    assert 关   Hot Reload 关   libapp.so/App     性能分析
Release  AOT    assert 关   Hot Reload 关   libapp.so/App     生产发布
```

## 11.2 编译链路

```text
.dart → CFE/frontend_server → .dill (Kernel)
        ├─ Debug: kernel_blob.bin → Dart VM JIT
        └─ Profile/Release: gen_snapshot → libapp.so / App.framework
```

## 11.3 发布命令

```bash
# Android
flutter build appbundle --release \
  --split-debug-info=build/symbols \
  --obfuscate

# iOS
flutter build ipa --release \
  --split-debug-info=build/symbols \
  --obfuscate

# 体积分析
flutter build apk --release --analyze-size

# 崩溃符号化
flutter symbolize -i crash.txt -d build/symbols
```

## 11.4 需要 `@pragma('vm:entry-point')` 的场景

```text
□ Isolate.spawn / Isolate.run 的顶层/静态入口
□ FFI NativeCallable / Pointer.fromFunction 回调
□ 平台通道调用的 Dart 入口
□ 通过 Function.apply / 反射式框架动态调用的函数
□ 插件注册、原生回调
```

---

JIT 和 AOT 不是「新旧」或「好坏」的关系，而是**开发效率与运行确定性**的取舍：

- **Debug 用 JIT**：换来 Hot Reload 和快速迭代
- **Profile/Release 用 AOT**：换来启动速度、稳定性能、较低内存、iOS 合规和可优化的包体积

理解这条编译链路，才能真正解释 Flutter 的构建模式、Hot Reload 的边界、Tree Shaking 的坑，以及线上崩溃为什么要符号文件。**知道代码在什么时候变成机器码，才知道它在运行时能做什么、不能做什么。**
