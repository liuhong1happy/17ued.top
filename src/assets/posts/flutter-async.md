Flutter 的异步经常被误解成「多线程」：`async/await` 一写，好像任务就跑到后台去了。实际上，**Dart 代码默认运行在单线程的 Isolate 里，靠事件循环（Event Loop）在任务之间切换**。一个耗时的同步计算，即使包在 `async` 函数里，也照样会卡住 UI。

理解 Flutter 异步，要回答四个问题：

1. **代码在哪个线程/Isolate 上跑？**
2. **一个异步任务完成后，回调什么时候执行？**
3. **什么时候该用 `Future`，什么时候该用 `Stream`，什么时候必须开 `Isolate`？**
4. **异步和 Widget 生命周期怎么配合，才不会 `setState after dispose`？**

这篇文章按「事件循环 → Future → Stream → Isolate → Flutter 实战」的顺序讲，最后给出常见误区和面试题。

![Dart Isolate 的事件循环：微任务队列优先于事件队列清空，异步回调、Timer、I/O 事件都在事件队列中排队；Flutter 的 UI、Raster、IO 线程与 Dart Isolate 分工不同](/images/blog/flutter-async/event-loop.svg)

# 一、Dart 的并发模型：单线程事件循环

## 1.1 Isolate 才是「线程」

Dart 没有传统意义上的共享内存线程。它用 **Isolate** 做并发隔离：

- 每个 Isolate 有**独立的内存堆**，不能直接共享对象
- Isolate 之间通过 `SendPort` / `ReceivePort` 传消息（默认是拷贝，部分类型可转移）
- 每个 Isolate 内部是**单线程**的，靠事件循环调度
- Flutter 的主 Isolate 负责 Dart 代码和 UI 逻辑

所以 `async/await` 不会创建新线程，它只是**把后续代码注册成回调**，让出当前执行权，等事件循环再次调度。

## 1.2 两个队列：微任务与事件

每个 Isolate 内部有两个队列：

| 队列 | 内容 | 调度优先级 |
| --- | --- | --- |
| **Microtask Queue** | `scheduleMicrotask`、`Future` 回调、`await` 之后的续体 | 高：当前事件处理完后立即清空 |
| **Event Queue** | Timer、I/O、用户输入、Isolate 消息、`Future.delayed` | 低：微任务清空后才取下一个 |

执行顺序可以概括为：

```text
取一个事件 → 执行 → 清空所有微任务 → 取下一个事件 → …
```

这意味着：

```dart
void main() {
  print('1');

  Future(() => print('2'));           // 事件（event）
  Future.microtask(() => print('3')); // 微任务
  scheduleMicrotask(() => print('4'));

  print('5');
}
```

输出是：

```text
1
5
3
4
2
```

因为 `Future(...)` 把任务放进事件队列，而 `Future.microtask` 和 `scheduleMicrotask` 放进微任务队列；当前同步代码（`1`、`5`）先跑完，再清空微任务（`3`、`4`），最后处理事件（`2`）。

**微任务饥饿**是实际会遇到的坑：如果不断在微任务里再排微任务，事件队列永远轮不到，UI 就不会刷新、输入也得不到处理。长时间的计算应该让出事件循环（`await Future.delayed(Duration.zero)`），或者干脆放到 Isolate。

## 1.3 Flutter 的线程分工

Flutter 引擎并不是只有一个线程：

| 线程 | 职责 |
| --- | --- |
| **UI / Platform（Dart）** | 执行 Dart 代码、构建 Widget 树、布局、绘制指令 |
| **Raster** | 把绘制指令光栅化成 GPU 纹理 |
| **IO** | 图片解码、文件 I/O 等部分后台任务 |
| **Platform（原生主线程）** | Android/iOS 的 UI 线程，处理 MethodChannel、原生 View |

你在 Dart 里写的 `build`、`setState`、事件回调，默认都在 UI 线程对应的 Isolate 上。**Dart 层的耗时同步代码会直接拖慢 UI 线程**，这是 Flutter 卡顿最常见的原因之一。

# 二、Future：一次性的异步结果

## 2.1 Future 的状态

`Future<T>` 表示一个「未来会完成」的值，只有三种状态：

```text
pending  →  completed(value)
         →  completedError(error)
```

创建 Future 的常见方式：

```dart
Future.value(42);                       // 已完成
Future.error(Exception('boom'));        // 已完成（错误）
Future(() => 42);                       // 事件队列中执行
Future.microtask(() => 42);             // 微任务队列中执行
Future.delayed(const Duration(seconds: 1), () => 42);
Future.sync(() => 42);                  // 立即执行，异常转成 Future.error
```

## 2.2 async / await 的本质

```dart
Future<int> loadCount() async {
  final data = await fetchFromServer(); // 让出执行权，等 Future 完成
  return data.count;
}
```

编译器会把它改写成状态机：

- 遇到 `await`，注册续体（continuation），返回一个 pending Future
- 被 await 的 Future 完成时，续体被调度为**微任务**
- 续体继续执行，直到下一个 `await` 或函数结束
- 函数结束时完成返回的 Future

所以：

- `await` 不会阻塞线程，只会**挂起当前函数**
- `await` 之后的代码不是「立即」执行，而是等 Future 完成后由事件循环调度
- 在 `await` 前后，其他事件/微任务可能插进来执行

## 2.3 错误处理

```dart
Future<void> load() async {
  try {
    final data = await fetch();
    print(data);
  } catch (e, st) {
    // 捕获 await 的 Future 抛出的错误
    print('failed: $e\n$st');
  } finally {
    // 无论成功失败都执行
  }
}
```

几个容易错的点：

| 写法 | 问题 |
| --- | --- |
| `fetch().then(...)` 不处理错误 | 未捕获的 Future 错误会冒泡到 Zone，可能只打印日志 |
| `try { fetch(); } catch` | 没有 `await`，`fetch` 返回的 Future 错误不会被 catch 捕获 |
| `async` 函数里同步 `throw` | 会被包成 Future.error，调用方 `await` 时才能捕获 |
| `Future.wait` 不加 `eagerError` | 默认等所有 Future 完成；其中一个失败不会立即中断 |
| `catchError` 返回类型不对 | `catchError` 必须返回与 Future 同类型的值，否则运行时报错 |

```dart
// 错误：没有 await，catch 捕不到
try {
  fetchData();          // 返回 Future，异常在 Future 里
} catch (e) {
  // 不会执行
}

// 正确
try {
  await fetchData();
} catch (e) {
  // 能捕获
}
```

## 2.4 并发组合

```dart
// 并发执行，按顺序返回结果；任何一个失败，整体失败
final results = await Future.wait([fetchUser(), fetchOrders(), fetchCoupons()]);

// 并发执行，第一个完成就返回（其余仍会继续执行）
final fastest = await Future.any([mirrorA(), mirrorB()]);

// 顺序执行（一个完成再下一个），适合有依赖或需要限流的场景
for (final url in urls) {
  await load(url);
}

// 并发执行但限制并发数
final pool = <Future<void>>[];
for (final url in urls) {
  final future = load(url);
  pool.add(future);
  if (pool.length >= 5) {
    await Future.wait(pool);
    pool.clear();
  }
}
await Future.wait(pool);
```

**`Future.wait` 默认不是「快速失败」**：即使第一个 Future 已经报错，它也会等其他 Future 完成。需要快速失败时传 `eagerError: true`，但要注意其余 Future 的错误仍可能变成未处理错误。

## 2.5 不要忘记 await

```dart
// 反例：fire-and-forget，异常无人处理
void save() {
  repository.save(); // 返回 Future，被丢弃
}

// 正例：显式等待，或者显式忽略
Future<void> save() async {
  await repository.save();
}

// 确实不关心结果时，用 unawaited 明确表达意图
import 'dart:async';
void save() {
  unawaited(repository.save());
}
```

`unawaited` 来自 `dart:async`，它不会改变行为，只是告诉读代码的人「这里是故意不等的」，同时让 lint 安静。

# 三、Stream：连续的事件序列

## 3.1 Future 与 Stream 的区别

| 维度 | Future | Stream |
| --- | --- | --- |
| 结果数量 | 1 个（或错误） | 0 到 N 个 |
| 典型场景 | 网络请求、文件读取 | WebSocket、传感器、用户输入、日志 |
| 订阅 | `then` / `await` | `listen` / `await for` |
| 取消 | 依赖底层实现 | `StreamSubscription.cancel()` |
| 背压 | 无 | 支持 `pause` / `resume` |

## 3.2 创建 Stream

```dart
// 单订阅 Stream
Stream<int> countTo(int n) async* {
  for (var i = 1; i <= n; i++) {
    await Future.delayed(const Duration(milliseconds: 100));
    yield i;
  }
}

// 广播 Stream：可以有多个监听者
final controller = StreamController<int>.broadcast();
controller.add(1);
controller.add(2);
await controller.close();

// 从 Future 转 Stream
Stream<int> fromFuture = Future.value(42).asStream();

// 周期事件
Stream<int>.periodic(const Duration(seconds: 1), (i) => i);
```

## 3.3 消费 Stream

```dart
final subscription = stream.listen(
  (data) => print('data: $data'),
  onError: (e, st) => print('error: $e'),
  onDone: () => print('done'),
  cancelOnError: false,
);

// 需要时暂停/恢复/取消
subscription.pause();
subscription.resume();
await subscription.cancel();
```

`await for` 是语法糖：

```dart
await for (final event in stream) {
  print(event);
  if (event == 3) break; // 自动取消订阅
}
```

## 3.4 单订阅 vs 广播

| 类型 | 监听者数量 | 事件缓存 | 适用 |
| --- | --- | --- | --- |
| 单订阅（默认） | 1 | 订阅前的事件会缓存，订阅后补发 | 一次性数据流 |
| 广播（broadcast） | N | 不缓存，订阅前的事件收不到 | 事件总线、全局通知 |

**常见坑**：把单订阅 Stream 给 `StreamBuilder` 用，父组件重建导致重复 `listen`，会抛 `Bad state: Stream has already been listened to`。要么用 `broadcast`，要么把 Stream 缓存在 State 里只创建一次。

## 3.5 Stream 的变换

```dart
stream
    .where((e) => e.isValid)
    .map((e) => e.toJson())
    .distinct()
    .debounceTime(const Duration(milliseconds: 300)) // 需要 rxdart
    .listen(handle);
```

Dart 原生提供 `where`、`map`、`expand`、`take`、`skip`、`distinct`、`handleError` 等；防抖、节流、组合流通常用 `rxdart`。

## 3.6 背压

当消费者处理速度慢于生产者时：

- `pause()` 会让上游暂停（如果上游支持）
- `StreamController` 的 `onPause` / `onResume` 可以感知
- 无界缓冲会导致内存增长，必要时丢弃、采样或限流

# 四、Isolate：真正的并行

## 4.1 什么时候必须用 Isolate

以下任务会阻塞 UI 线程，应该放到 Isolate：

- 大 JSON 解析（几 MB 以上）
- 图片解码/缩放/滤镜
- 加密、压缩、哈希
- 大量文本处理、搜索、排序
- 复杂计算（物理、路径规划、数据分析）

判断标准很简单：**这个同步任务是否可能超过一帧（16ms）？** 是，就考虑 Isolate。

## 4.2 Isolate.run（推荐）

Dart 2.19+ 提供 `Isolate.run`，最简单：

```dart
import 'dart:isolate';

Future<List<Order>> parseOrders(String json) {
  return Isolate.run(() => parseOrdersSync(json));
}

// 顶层或静态函数，不能捕获不可发送的对象
List<Order> parseOrdersSync(String json) {
  // 大量 CPU 计算
  return ...;
}
```

`Isolate.run` 会创建 Isolate、执行闭包、返回结果、自动销毁。闭包及其捕获的变量必须可跨 Isolate 传递。

## 4.3 compute（Flutter 封装）

```dart
import 'package:flutter/foundation.dart';

final result = await compute(parseOrdersSync, json);
```

`compute` 是 Flutter 对 Isolate 的简单封装，限制更严格：回调必须是**顶层函数或静态方法**，参数和返回值必须可发送。Web 平台上 `compute` 会退化为在当前线程执行（浏览器没有 Isolate），需要接受这个差异。

## 4.4 Isolate.spawn + 双向通信

需要长期运行的 Isolate（比如持续处理任务）时：

```dart
Future<void> startWorker() async {
  final receivePort = ReceivePort();
  final isolate = await Isolate.spawn(workerMain, receivePort.sendPort);

  final sendPort = await receivePort.first as SendPort;
  sendPort.send('hello');

  receivePort.listen((message) {
    print('main received: $message');
  });
}

void workerMain(SendPort mainSendPort) {
  final port = ReceivePort();
  mainSendPort.send(port.sendPort);
  port.listen((message) {
    mainSendPort.send('echo: $message');
  });
}
```

注意事项：

- 消息默认是**拷贝**，大对象传输有成本；可以用 `TransferableTypedData` 转移字节缓冲区
- Isolate 之间不能共享可变对象；共享状态要靠消息同步
- Isolate 创建有成本（启动、内存），不要为每个小任务都新建
- 长期运行的 Isolate 要设计好退出、错误处理和重启

## 4.5 Isolate vs 平台线程

MethodChannel 调用原生方法时，原生侧可能在自己的线程执行（Android 主线程、iOS 主线程或后台队列），但 **Dart 侧仍然是非阻塞的 Future**。不要把「原生异步」和「Dart Isolate」混为一谈：

| 场景 | 机制 |
| --- | --- |
| 调原生 API | MethodChannel → 原生线程 → Future 回调 |
| 纯 Dart CPU 计算 | Isolate |
| 文件/网络 I/O | Dart IO 事件循环（底层线程池） |
| 图片解码 | Flutter 引擎 IO 线程 / `instantiateImageCodec` |

# 五、Flutter 中的异步实战

## 5.1 initState 不能 async

```dart
@override
void initState() {
  super.initState();
  _load(); // 不要 await，initState 不能是 async
}

Future<void> _load() async {
  final data = await repository.fetch();
  if (!mounted) return;   // await 之后组件可能已经销毁
  setState(() => _data = data);
}
```

为什么不能把 `initState` 写成 `async`？因为 `initState` 的返回类型是 `void`，`async` 会返回 `Future<void>`，框架不会等待它，而且 `super.initState()` 的调用时序会变得混乱。正确做法是同步启动，异步方法内部处理。

## 5.2 await 之后必须检查 mounted

```dart
Future<void> _submit() async {
  setState(() => _loading = true);
  try {
    await api.submit();
    if (!mounted) return;
    setState(() => _loading = false);
  } catch (e) {
    if (!mounted) return;
    setState(() => _error = e.toString());
  }
}
```

组件被 `dispose` 后调用 `setState` 会抛 `setState() called after dispose()`。`mounted` 在 `await` 之后可能已经变成 `false`。

## 5.3 BuildContext 跨异步边界

```dart
// 反例：await 之后直接用 context
Future<void> _open() async {
  await Navigator.of(context).push(...);
  ScaffoldMessenger.of(context).showSnackBar(...); // context 可能已失效
}

// 正例：await 前取好依赖，或检查 mounted
Future<void> _open() async {
  final messenger = ScaffoldMessenger.of(context);
  await Navigator.of(context).push(...);
  if (!mounted) return;
  messenger.showSnackBar(...);
}
```

Flutter 的 `use_build_context_synchronously` lint 会提示这个问题。

## 5.4 FutureBuilder / StreamBuilder

```dart
// 反例：每次 build 都创建新 Future，导致反复请求
FutureBuilder(
  future: repository.fetch(),
  builder: (context, snapshot) => ...,
)

// 正例：Future 缓存在 State 里
late final Future<Data> _future = repository.fetch();

FutureBuilder(
  future: _future,
  builder: (context, snapshot) {
    return switch (snapshot.connectionState) {
      ConnectionState.waiting => const CircularProgressIndicator(),
      ConnectionState.hasError => Text('${snapshot.error}'),
      _ => DataView(snapshot.data!),
    };
  },
)
```

`FutureBuilder` 不会自动取消 Future；组件销毁后 Future 仍会完成，只是回调不会再触发重建。需要在销毁时取消的，用 `CancelableOperation` 或底层 client 的 abort。

## 5.5 dispose 不能 await

```dart
@override
void dispose() {
  _subscription?.cancel();       // 返回 Future，但不 await
  _controller.dispose();         // 同步释放
  _timer?.cancel();
  super.dispose();
}
```

`dispose` 是同步的，不能 `await`。取消订阅、取消 Timer、关闭 StreamController 都是同步调用（或返回 Future 但不需要等）。如果必须在销毁时做异步清理，交给上层或使用 `unawaited` 并确保异常被处理。

## 5.6 防抖与节流

```dart
Timer? _debounce;

void onSearchChanged(String text) {
  _debounce?.cancel();
  _debounce = Timer(const Duration(milliseconds: 300), () {
    _search(text);
  });
}

@override
void dispose() {
  _debounce?.cancel();
  super.dispose();
}
```

搜索框、滚动监听、窗口 resize 都适合防抖/节流。用 `Timer` 时一定要在 `dispose` 里取消，否则回调可能在组件销毁后执行。

## 5.7 帧调度

```dart
WidgetsBinding.instance.addPostFrameCallback((_) {
  // 当前帧布局/绘制完成后执行，适合测量尺寸、滚动到位置
});
```

- `addPostFrameCallback`：当前帧结束后执行一次
- `scheduleFrameCallback`：申请下一帧回调
- 不要在 `build` 里直接调用 `setState` 或触发动画，会死循环
- 微任务太多会推迟帧；大计算会占用 UI 线程，直接掉帧

# 六、异步方案怎么选

![Flutter 异步方案选择：一次性结果用 Future，多次事件用 Stream，阻塞 UI 的 CPU 计算用 Isolate，原生能力用 MethodChannel](/images/blog/flutter-async/async-decision.svg)

| 需求 | 方案 | 备注 |
| --- | --- | --- |
| 一次网络请求 | `Future` + `async/await` | 配合超时、重试、取消 |
| 多次事件（WebSocket、传感器） | `Stream` | 单订阅/广播要选对 |
| 用户输入防抖 | `Timer` / `rxdart` | dispose 时取消 |
| 大 JSON 解析、图片处理 | `Isolate.run` / `compute` | 数据必须可跨 Isolate 传递 |
| 周期性后台任务 | `Timer.periodic` / Isolate | 注意生命周期和电量 |
| 调原生能力 | MethodChannel / Pigeon | 返回 Future，原生线程执行 |
| 顺序依赖任务 | `await` 链 | 不要并行化有依赖的步骤 |
| 无依赖批量任务 | `Future.wait` | 控制并发数，避免打爆下游 |

# 七、常见误区与坑

| 误区 | 后果 | 正确做法 |
| --- | --- | --- |
| 以为 `async` 会自动开线程 | 耗时计算仍卡 UI | CPU 密集任务用 Isolate |
| `async` 函数不 `await` | 异常丢失、时序错乱 | `await` 或 `unawaited` 显式表达 |
| `try/catch` 没包住 `await` | 捕获不到 Future 错误 | 在 `await` 外层 try |
| `Future.wait` 默认快速失败 | 一个失败仍等全部 | 需要时 `eagerError: true` |
| `FutureBuilder` 的 future 在 build 里创建 | 每次重建都重新请求 | 缓存在 State |
| `StreamBuilder` 用单订阅 Stream 重复 listen | `Stream has already been listened to` | 用 broadcast 或缓存 Stream |
| `await` 后直接 `setState` | disposed 异常 | 检查 `mounted` |
| `dispose` 里 `await` | 不允许，且可能泄漏 | 同步取消，异步清理交给上层 |
| 微任务里无限递归 | 事件队列饥饿，UI 不刷新 | 让出事件循环或拆分任务 |
| 在 UI 线程解析大 JSON | 掉帧、ANR | `compute` / `Isolate.run` |
| Timer 忘记取消 | 内存泄漏、销毁后回调 | dispose 里 `cancel()` |
| 并发数不限制 | 下游被打爆、内存暴涨 | 信号量/连接池/分批 |

# 八、15 道高频面试题

**Q1：Dart 是单线程还是多线程？**

Dart 代码在单个 Isolate 内是单线程的，靠事件循环调度；多个 Isolate 可以并行，但内存隔离、通过消息通信。Flutter 的 UI 线程是主 Isolate，Raster/IO 是引擎线程。

**Q2：`async/await` 会创建新线程吗？**

不会。它只是把函数改写成状态机，遇到 `await` 让出执行权，Future 完成后把续体作为微任务调度。真正的并行要用 Isolate。

**Q3：微任务和事件的区别？**

微任务（`scheduleMicrotask`、Future 回调、await 续体）优先级高，当前事件处理完后立即清空；事件（Timer、I/O、用户输入）在微任务清空后逐个处理。微任务饥饿会阻塞事件队列和 UI。

**Q4：`Future` 和 `Stream` 的区别？**

Future 表示一次异步结果；Stream 表示 0 到 N 个事件，支持暂停/恢复/取消和背压。一次性请求用 Future，持续事件用 Stream。

**Q5：单订阅和广播 Stream 的区别？**

单订阅只能被监听一次，订阅前的事件会缓存；广播可以被多个监听者订阅，不缓存订阅前的事件。UI 中重复订阅同一个单订阅 Stream 会报错。

**Q6：什么时候用 Isolate？**

纯 Dart 的 CPU 密集任务，且可能超过一帧（16ms）：大 JSON 解析、图片处理、加密、复杂计算。I/O 和网络不需要自己开 Isolate，Dart 运行时已经异步处理。

**Q7：`compute` 和 `Isolate.run` 的区别？**

`compute` 是 Flutter 的封装，回调必须是顶层/静态函数，Web 上退化为当前线程；`Isolate.run` 是 Dart 原生 API，支持闭包，能力更灵活。两者都适合一次性任务。

**Q8：Isolate 之间能共享内存吗？**

不能直接共享可变对象。通过 SendPort/ReceivePort 传消息，默认拷贝；`TransferableTypedData` 可以转移字节缓冲区。共享状态需要靠消息同步或外部存储。

**Q9：`await` 之后的代码在哪个线程执行？**

仍在同一个 Isolate 的事件循环里执行，不是新线程。它会在 Future 完成后作为微任务被调度，可能与其它事件交替执行。

**Q10：为什么 `initState` 不能是 `async`？**

框架同步调用 `initState`，不等待返回的 Future；写成 async 会改变初始化时序，且 `super.initState()` 的调用位置容易出错。正确做法是同步启动一个异步方法，并在内部检查 `mounted`。

**Q11：`await` 之后为什么要检查 `mounted`？**

等待期间组件可能被销毁，此时调用 `setState` 会抛异常，使用 `context` 也可能失效。检查 `mounted` 是最低成本的保护。

**Q12：如何取消一个异步请求？**

Future 本身不可取消。需要用 `CancelableOperation`、底层 HTTP client 的 abort、StreamSubscription.cancel，或者用版本号/标志位忽略过期结果。

**Q13：`Future.wait` 中一个失败会怎样？**

默认会等所有 Future 完成，然后抛出第一个错误；其他 Future 的错误可能变成未处理错误。需要快速失败用 `eagerError: true`，并处理其余错误。

**Q14：如何避免异步任务打爆下游？**

限制并发数（信号量/任务池）、批量合并、超时与重试预算、熔断、队列削峰。不要对无依赖任务无限 `Future.wait`。

**Q15：Flutter 卡顿和异步有什么关系？**

UI 线程上的同步计算、过多微任务、频繁 setState、在 build 里做重活都会掉帧。CPU 密集任务放 Isolate，I/O 用异步 API，减少不必要的重建。

# 九、速查表

```text
一次性结果              → Future + async/await
连续事件                → Stream（单订阅/广播按需）
CPU 密集、可能 >16ms    → Isolate.run / compute
原生能力                → MethodChannel / Pigeon
防抖/节流               → Timer / rxdart
顺序依赖                → await 串行
无依赖批量              → Future.wait（控制并发）
需要取消                → CancelableOperation / subscription.cancel
await 之后用 context    → 先检查 mounted
dispose                 → 同步取消 Timer/Subscription/Controller
```

---

Flutter 异步的核心不是记住几个 API，而是建立一个模型：**代码在哪个 Isolate 上跑、回调进哪个队列、什么时候让出执行权、什么任务根本不该留在 UI 线程。** 把这四件事想清楚，`Future`、`Stream`、`Isolate` 的选择就是自然的，而不是背出来的。
