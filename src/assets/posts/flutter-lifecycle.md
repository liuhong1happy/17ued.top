Flutter 里的「生命周期」其实有两套，经常被混在一起问：

1. **应用生命周期**：App 从启动、前台、后台到销毁，由 `AppLifecycleState` 描述
2. **Widget / State 生命周期**：一个 `StatefulWidget` 从创建、构建、更新到销毁，由 `State` 的方法回调描述

它们回答的是不同层次的问题：

| 问题 | 用哪套 |
| --- | --- |
| App 切到后台，视频要不要暂停？ | 应用生命周期 |
| 页面第一次出现时拉数据？ | State 生命周期 |
| 从详情页返回，列表要不要刷新？ | 路由生命周期 / `RouteAware` |
| 屏幕旋转、深色模式切换？ | 应用/绑定回调 |
| 组件销毁时取消 Timer？ | State 生命周期 |

这篇文章把两套生命周期、它们和异步/路由的配合，以及最常见的坑一次讲清。

![Flutter 应用生命周期状态机：detached、resumed、inactive、hidden、paused 之间随前后台切换流转，Android 与 iOS 的系统回调映射到这些状态](/images/blog/flutter-lifecycle/app-lifecycle.svg)

# 一、Flutter 应用生命周期

## 1.1 从 runApp 到第一帧

一个 Flutter App 的启动大致是：

```text
原生进程启动
 → 创建 FlutterEngine
 → 执行 Dart 入口 main()
 → runApp(MyApp())
 → WidgetsBinding 初始化
 → attachRootWidget
 → 调度第一帧（build → layout → paint → raster）
 → 进入 resumed 状态
```

`runApp` 本身不是「启动完成」，它只是把根 Widget 挂上去并调度第一帧。真正的首帧渲染完成，可以监听：

```dart
WidgetsBinding.instance.addPostFrameCallback((_) {
  // 第一帧已经绘制完成
});
```

冷启动、热重载（hot reload）、热重启（hot restart）的区别：

| 方式 | 状态是否保留 | 生命周期 |
| --- | --- | --- |
| 冷启动 | 否 | 完整启动流程 |
| Hot Reload | State 保留 | 触发 `reassemble`，不重建 State |
| Hot Restart | 否 | 重新执行 `main()`，State 全部重建 |

## 1.2 AppLifecycleState 的五个状态

Flutter 3.13+ 定义了五个状态：

| 状态 | 含义 | 典型触发 |
| --- | --- | --- |
| `detached` | 引擎存在，但没有附着到任何宿主 View | 启动早期、引擎销毁后 |
| `resumed` | 可见、有焦点、可接收输入 | App 在前台 |
| `inactive` | 可见但无焦点，或处于过渡态 | 来电、下拉通知栏、多窗口失焦、切换 App 的瞬间 |
| `hidden` | 不可见，但尚未完全暂停 | 进入后台的过渡、桌面切换 |
| `paused` | 不可见、不接收输入，后台运行 | 用户按 Home、锁屏 |

注意几个容易误解的点：

- **`inactive` 不等于后台**：下拉通知栏、弹系统权限框、分屏失焦都可能进入 `inactive`，此时页面还可见
- **`hidden` 是过渡态**：Flutter 3.13 引入，用于在 `inactive` 和 `paused` 之间提供更细的粒度；某些平台会合成这个状态
- **`paused` 不保证进程存活**：系统可能在后台回收进程，不能把「保存数据」只放在 `paused`
- **`detached` 不是「App 退出」的可靠信号**：进程被杀时不一定有机会回调

## 1.3 状态流转

典型的 Android 前后台切换：

```text
resumed
  ↓ 按 Home / 切到后台
inactive
  ↓
hidden
  ↓
paused
  ↑ 回到前台
inactive
  ↑
resumed
```

iOS 类似，但系统回调的命名和时机不同：

```text
applicationDidBecomeActive        → resumed
applicationWillResignActive       → inactive
applicationDidEnterBackground     → paused（中间可能合成 hidden）
applicationWillEnterForeground    → inactive → resumed
```

**不要依赖精确的状态序列**。不同平台、不同系统版本、分屏/画中画/多窗口都可能跳过或合并某些状态。业务逻辑应该按「当前是否可见/可交互」来判断，而不是假设一定经过某个中间态。

## 1.4 监听应用生命周期

### 方式一：WidgetsBindingObserver

```dart
class _AppLifecycleWatcher extends State<AppLifecycleWatcher>
    with WidgetsBindingObserver {

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    super.didChangeAppLifecycleState(state);
    switch (state) {
      case AppLifecycleState.resumed:
        _onForeground();
      case AppLifecycleState.inactive:
        _onInactive();
      case AppLifecycleState.hidden:
        _onHidden();
      case AppLifecycleState.paused:
        _onBackground();
      case AppLifecycleState.detached:
        _onDetached();
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }
}
```

`WidgetsBindingObserver` 还能监听：

| 回调 | 触发时机 | 典型用途 |
| --- | --- | --- |
| `didChangeMetrics` | 屏幕尺寸/安全区变化 | 响应旋转、分屏、键盘弹出 |
| `didChangePlatformBrightness` | 深色/浅色模式切换 | 更新主题相关资源 |
| `didChangeLocales` | 系统语言变化 | 刷新本地化文案 |
| `didHaveMemoryPressure` | 系统内存紧张 | 清理图片/缓存 |
| `didChangeAccessibilityFeatures` | 无障碍设置变化 | 调整交互 |
| `didChangeTextScaleFactor` | 字体缩放变化（较新版本迁移到 MediaQuery） | 适配大字体 |

### 方式二：AppLifecycleListener（Flutter 3.13+）

`AppLifecycleListener` 把状态转换拆成独立回调，适合只关心某几个事件的场景：

```dart
late final AppLifecycleListener _listener;

@override
void initState() {
  super.initState();
  _listener = AppLifecycleListener(
    onResume: () => _onForeground(),
    onInactive: () => _onInactive(),
    onHide: () => _onHidden(),
    onPause: () => _onBackground(),
    onDetach: () => _onDetached(),
    onRestart: () => _onRestart(),
  );
}

@override
void dispose() {
  _listener.dispose();
  super.dispose();
}
```

它比 `WidgetsBindingObserver` 更细，也避免了在一个 `switch` 里处理所有状态。但如果你需要同时监听尺寸、亮度、内存等，`WidgetsBindingObserver` 仍然更集中。

## 1.5 每个状态该做什么

| 状态 | 适合做 | 不适合做 |
| --- | --- | --- |
| `resumed` | 恢复动画/视频、刷新可见数据、恢复传感器 | 假设一定有网络 |
| `inactive` | 暂停高耗互动、隐藏敏感信息（如应用切换器截图） | 当成退到后台 |
| `hidden` | 停止渲染相关任务、埋点「不可见」 | 长时间的清理 |
| `paused` | 暂停视频/音频、保存草稿、断开长连接 | 依赖它一定执行（进程可能被杀） |
| `detached` | 释放引擎级资源 | 依赖它做关键持久化 |

**实践原则**：

- **能提前保存就提前保存**：不要等 `paused`，用户输入后就应该落盘/上报
- **恢复要幂等**：`resumed` 可能连续触发，刷新逻辑要防重复
- **后台任务用系统能力**：Android WorkManager / Foreground Service，iOS BGTaskScheduler，不要指望 Dart 定时器在后台一直跑

## 1.6 路由生命周期不是应用生命周期

页面 A → 页面 B，A 并不会收到 `paused`，因为 App 仍在前台。要感知「页面是否可见」，用路由生命周期：

```dart
class _PageAState extends State<PageA> with RouteAware {
  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    routeObserver.subscribe(this, ModalRoute.of(context)!);
  }

  @override
  void didPush() {
    // 页面被 push 进来
  }

  @override
  void didPopNext() {
    // 从下级页面返回，当前页面重新可见
    _refresh();
  }

  @override
  void dispose() {
    routeObserver.unsubscribe(this);
    super.dispose();
  }
}
```

`RouteObserver` 需要在 `MaterialApp.navigatorObservers` 注册。**应用生命周期管前后台，路由生命周期管页面栈**，不要混用。

# 二、StatefulWidget 生命周期

## 2.1 Widget 与 State 的关系

- `Widget` 是**不可变的配置**，每次父组件重建都会创建新的 Widget 实例
- `State` 是**可变的持久对象**，在 Widget 生命周期内保持不变
- `createState()` 只在 State 第一次插入树时调用
- `build()` 可能被调用很多次，但 State 还是同一个

```dart
class Counter extends StatefulWidget {
  const Counter({super.key, required this.step});
  final int step;

  @override
  State<Counter> createState() => _CounterState();
}

class _CounterState extends State<Counter> {
  int _count = 0;

  @override
  Widget build(BuildContext context) {
    return Text('$_count / step=${widget.step}');
  }
}
```

`widget` 属性始终指向**当前**的 Widget 配置；父组件更新 `step` 时，State 不变，`widget` 换成新实例，并触发 `didUpdateWidget`。

## 2.2 完整生命周期顺序

![StatefulWidget 生命周期：createState → initState → didChangeDependencies → build，父组件更新触发 didUpdateWidget 和再次 build，移除时 deactivate，最终 dispose；热重载触发 reassemble](/images/blog/flutter-lifecycle/widget-lifecycle.svg)

```text
createState()
  ↓
initState()
  ↓
didChangeDependencies()
  ↓
build()
  ↓
（父组件重建 / setState）
  ↓
didUpdateWidget(oldWidget)
  ↓
build()
  ↓
（从树中移除）
  ↓
deactivate()
  ↓
dispose()
```

如果 State 被重新插入（`GlobalKey` 移动），还会经过：

```text
deactivate() → activate() → build()
```

热重载会调用 `reassemble()`，State 保留。

## 2.3 每个方法的职责与禁忌

### createState

```dart
@override
State<Counter> createState() => _CounterState();
```

- 必须返回一个新的 State 实例
- 不要在这里做业务初始化
- 不要试图访问 `context`（State 还没挂载）

### initState

```dart
@override
void initState() {
  super.initState();
  _controller = TextEditingController();
  _subscription = stream.listen(_onEvent);
  _load();
}
```

适合：

- 创建 Controller、AnimationController、Timer、StreamSubscription
- 注册监听器
- 发起只需要一次的异步加载
- 读取构造函数传入的初始参数

不适合：

- `await`（`initState` 不能是 async）
- 调用 `setState`（框架马上会 build，没必要）
- 依赖 `InheritedWidget`（此时依赖还没建立，应该在 `didChangeDependencies` 里做）
- 使用 `BuildContext` 做导航/弹窗（首帧还没完成）

**`initState` 里可以用 `context` 吗？** 可以访问，但**不能注册依赖**。`Theme.of(context)`、`MediaQuery.of(context)` 在 `initState` 里调用不会建立依赖关系，后续主题/尺寸变化不会触发重建；正确位置是 `didChangeDependencies`。

### didChangeDependencies

```dart
@override
void didChangeDependencies() {
  super.didChangeDependencies();
  final theme = Theme.of(context);
  final size = MediaQuery.sizeOf(context);
  _updateLayout(size);
}
```

调用时机：

1. `initState` 之后、第一次 `build` 之前
2. 依赖的 `InheritedWidget` 发生变化时（Theme、MediaQuery、Provider、Localizations 等）

适合：

- 读取 `InheritedWidget`
- 根据主题/尺寸/语言更新本地状态
- 初始化依赖上下文的资源

注意：它可能被多次调用，逻辑要幂等；不要在这里做昂贵操作。

### build

```dart
@override
Widget build(BuildContext context) {
  return Column(
    children: [
      Text('${widget.step}'),
      Text('$_count'),
    ],
  );
}
```

- 必须是**纯函数**：只根据 `widget` 和 `State` 生成 UI
- 不要在这里发请求、创建 Future、启动动画、调用 `setState`
- 不要做重计算；需要派生数据时缓存或使用 `memoization`
- `build` 可能非常频繁，任何副作用都会被放大

### didUpdateWidget

```dart
@override
void didUpdateWidget(covariant Counter oldWidget) {
  super.didUpdateWidget(oldWidget);
  if (oldWidget.step != widget.step) {
    _recalculate();
  }
  if (oldWidget.controller != widget.controller) {
    oldWidget.controller.removeListener(_onChanged);
    widget.controller.addListener(_onChanged);
  }
}
```

调用时机：父组件重建，且新旧 Widget 的 `runtimeType` 和 `key` 相同，State 被复用。

适合：

- 比较 `oldWidget` 和 `widget`，响应配置变化
- 更换监听器、Controller、订阅
- 根据新参数重新计算派生状态

注意：框架会在 `didUpdateWidget` 之后自动调用 `build`，**不要在这里再手动 `setState`**（除非确实需要额外的重建，通常不需要）。

### deactivate

调用时机：State 从树中移除，但可能被重新插入（例如 `GlobalKey` 在树中移动）。

- 不要在这里释放资源，因为可能马上 `activate`
- 可以在这里做「暂时离开」的清理，如暂停动画
- 真正的释放放在 `dispose`

### activate

State 被重新插入树时调用，通常和 `deactivate` 成对出现。重新注册监听器、恢复资源。

### dispose

```dart
@override
void dispose() {
  _subscription?.cancel();
  _controller.dispose();
  _timer?.cancel();
  _focusNode.dispose();
  WidgetsBinding.instance.removeObserver(this);
  super.dispose();
}
```

必须释放：

- `TextEditingController`、`ScrollController`、`PageController`
- `AnimationController`、`Ticker`
- `StreamSubscription`、`ChangeNotifier` 监听
- `Timer`、`FocusNode`
- `WidgetsBindingObserver`、`RouteAware`
- 原生资源（通过插件）

注意：

- `dispose` 是同步的，不能 `await`
- `super.dispose()` 放在最后
- 调用 `super.dispose()` 之后不要再使用 `context`
- 不要在 `dispose` 里调用 `setState`

### reassemble

Hot Reload 时调用，用于重新初始化开发期资源。业务代码很少需要重写；如果重写了，记得调用 `super.reassemble()`。

## 2.4 didUpdateWidget 与 setState 的区别

| 触发源 | 方法 | State 是否复用 |
| --- | --- | --- |
| 父组件重建，配置变化 | `didUpdateWidget` | 是 |
| 自身调用 `setState` | `build` | 是 |
| 父组件重建，key/type 变化 | `dispose` + `createState` | 否 |

一个常见 bug：父组件传了新的 `initialValue`，子组件只在 `initState` 里读一次，之后父组件更新，子组件不跟着变。正确做法是在 `didUpdateWidget` 里比较并更新，或者把「初始值」改成受控属性。

## 2.5 Key 与状态复用

```dart
// key 不同 → 旧 State dispose，新 State createState
Column(
  children: [
    if (showA) const Child(key: ValueKey('a')),
    if (showB) const Child(key: ValueKey('b')),
  ],
)
```

| Key 类型 | 作用 |
| --- | --- |
| `ValueKey` | 按值比较，适合同类型列表项 |
| `ObjectKey` | 按对象身份比较 |
| `UniqueKey` | 每次都是新的，强制重建 |
| `GlobalKey` | 全局唯一，可在树中移动 State |

**列表里必须用稳定的 Key**：用 index 做 key，插入/删除会导致 State 错位（输入框内容跑到别的行）；用业务 id 做 key 才能正确复用。

`GlobalKey` 能让 State 跨位置移动而不销毁，但滥用会带来性能问题和「Duplicate GlobalKey」错误。只在确实需要跨树访问/移动状态时使用。

## 2.6 Hot Reload 与生命周期

| 操作 | 触发 |
| --- | --- |
| Hot Reload | `reassemble()`，State 保留，`build` 重新执行 |
| Hot Restart | `main()` 重新执行，所有 State 重建 |
| 代码修改涉及原生 | 需要重新 `flutter run` |

Hot Reload 不会重新执行 `initState`，所以如果初始化逻辑改了，必须 Hot Restart 才能验证。

# 三、生命周期与异步的配合

## 3.1 initState 里发起异步

```dart
@override
void initState() {
  super.initState();
  _load();
}

Future<void> _load() async {
  final data = await repository.fetch();
  if (!mounted) return;
  setState(() => _data = data);
}
```

不要在 `initState` 上写 `async`；同步启动，异步方法内部检查 `mounted`。

## 3.2 dispose 里取消异步

```dart
@override
void dispose() {
  _subscription?.cancel();
  _timer?.cancel();
  _debounce?.cancel();
  _controller.dispose();
  super.dispose();
}
```

Future 本身不能取消；如果请求必须取消，使用 `CancelableOperation`、HTTP client 的 abort，或者用「请求序号」丢弃过期结果。

## 3.3 前后台暂停/恢复

```dart
@override
void didChangeAppLifecycleState(AppLifecycleState state) {
  switch (state) {
    case AppLifecycleState.resumed:
      _videoPlayer.play();
      _startPolling();
    case AppLifecycleState.paused:
      _videoPlayer.pause();
      _stopPolling();
      _saveDraft();
    case AppLifecycleState.inactive:
      _hideSensitiveContent();
    case AppLifecycleState.hidden:
    case AppLifecycleState.detached:
      break;
  }
}
```

注意：

- 音频/视频在 `paused` 暂停，但「后台播放」是产品需求，需要原生音频会话配置，不要一刀切
- 轮询/WebSocket 在后台要降频或断开，避免耗电和被系统限制
- `inactive` 适合隐藏敏感信息（比如金额、聊天内容），因为它也会在应用切换器/多任务界面触发

## 3.4 内存压力

```dart
@override
void didHaveMemoryPressure() {
  imageCache.clear();
  imageCache.clearLiveImages();
  _localCache.clear();
}
```

`didHaveMemoryPressure` 是系统内存紧张的信号，适合清理可重建的缓存，不要清理用户未保存的数据。

# 四、常见坑

| 坑 | 现象 | 正确做法 |
| --- | --- | --- |
| `initState` 写成 `async` | 初始化时序错乱、`super.initState` 位置不对 | 同步启动异步方法 |
| `await` 后直接 `setState` | `setState() called after dispose()` | 检查 `mounted` |
| `dispose` 忘记取消 Timer/订阅 | 内存泄漏、销毁后回调 | 在 `dispose` 中全部取消 |
| `didUpdateWidget` 里再 `setState` | 多余重建，甚至死循环 | 框架会自动 build，直接更新字段 |
| `dispose` 后使用 `context` | `Looking up a deactivated widget's ancestor is unsafe` | `super.dispose()` 后不再使用 context |
| 用 index 做列表 key | 删除/插入后输入框内容错位 | 用业务 id 做 Key |
| 单订阅 Stream 在 build 里 listen | `Stream has already been listened to` | 缓存在 State，或用 broadcast |
| `FutureBuilder` 的 future 在 build 里创建 | 每次重建都重新请求 | future 存在 State 字段 |
| 只监听 `paused` 保存数据 | 进程被杀时丢数据 | 输入后及时保存，`paused` 只是兜底 |
| 把 `inactive` 当后台 | 权限弹窗/通知栏触发误暂停 | 用 `paused` 判断真正后台 |
| 路由返回不刷新 | 以为 App 生命周期会触发 | 用 `RouteAware.didPopNext` |
| `GlobalKey` 滥用 | Duplicate GlobalKey、性能下降 | 只在跨树移动/访问时使用 |

# 五、15 道高频面试题

**Q1：Flutter 应用生命周期有哪些状态？**

`detached`、`resumed`、`inactive`、`hidden`、`paused`。`resumed` 是前台可交互，`inactive` 是可见但无焦点，`hidden` 是不可见过渡，`paused` 是后台，`detached` 是引擎未附着/销毁。

**Q2：`inactive` 和 `paused` 有什么区别？**

`inactive` 页面仍可能可见，只是失去焦点（来电、通知栏、权限弹窗、分屏失焦）；`paused` 页面不可见、不接收输入，是真正的后台。暂停视频/轮询应该在 `paused`，隐藏敏感信息可以在 `inactive`。

**Q3：Android/iOS 的系统回调怎么映射到 AppLifecycleState？**

Android：`onResume` → resumed，`onPause` → inactive，`onStop` → paused（3.13+ 可能先 hidden），`onDestroy` → detached。iOS：`applicationDidBecomeActive` → resumed，`willResignActive` → inactive，`didEnterBackground` → paused。不同版本可能合成或跳过状态，不要依赖精确序列。

**Q4：如何监听应用前后台切换？**

实现 `WidgetsBindingObserver`，`addObserver` 后重写 `didChangeAppLifecycleState`，`dispose` 里 `removeObserver`；Flutter 3.13+ 也可以用 `AppLifecycleListener` 的 `onResume` / `onPause` 等回调。

**Q5：StatefulWidget 的生命周期顺序？**

`createState` → `initState` → `didChangeDependencies` → `build`；父组件更新触发 `didUpdateWidget` → `build`；移除时 `deactivate` → `dispose`；`GlobalKey` 重新插入会经过 `activate`；热重载触发 `reassemble`。

**Q6：`initState` 和 `didChangeDependencies` 的区别？**

`initState` 只调用一次，用于创建 Controller、订阅、发起一次性加载；`didChangeDependencies` 在 `initState` 后和依赖的 `InheritedWidget` 变化时调用，适合读取 Theme/MediaQuery/Provider 等上下文依赖。

**Q7：为什么不能在 `initState` 里依赖 `InheritedWidget`？**

此时依赖关系还没建立，`Theme.of(context)` 等调用不会注册依赖，后续变化不会触发重建。应在 `didChangeDependencies` 里读取。

**Q8：`didUpdateWidget` 什么时候调用？**

父组件重建，且新旧 Widget 的 `runtimeType` 和 `key` 相同，State 被复用。可以在其中比较 `oldWidget` 和 `widget`，更新监听器或派生状态；框架随后会自动调用 `build`，通常不需要再 `setState`。

**Q9：`deactivate` 和 `dispose` 的区别？**

`deactivate` 是 State 从树中移除但可能重新插入（GlobalKey 移动）；`dispose` 是永久销毁。资源释放放在 `dispose`，`deactivate` 只做临时暂停/解绑。

**Q10：`dispose` 里能 `await` 吗？**

不能。`dispose` 是同步方法，取消订阅、Timer、Controller 都是同步调用；必须异步完成的清理交给上层或使用 `unawaited` 并处理异常。

**Q11：`setState` 之后发生了什么？**

标记 State 为 dirty，调度一帧；下一帧调用 `build`，然后 layout、paint、raster。`setState` 本身不立即重建。

**Q12：为什么 `await` 后要检查 `mounted`？**

等待期间组件可能被销毁，此时 `setState` 会抛异常，`context` 也可能失效。`mounted` 是 State 是否还在树上的标志。

**Q13：列表里为什么不能用 index 做 Key？**

插入/删除后，索引对应的 Widget 类型可能变化，State 会错位复用，导致输入框内容、滚动位置串行。应该用业务 id 做 `ValueKey`。

**Q14：GlobalKey 有什么用？有什么风险？**

它可以跨位置移动 State、访问子组件 State/Context；但全局唯一，滥用会导致 Duplicate GlobalKey、性能下降和难以调试的复用问题。只在确实需要跨树访问/移动时使用。

**Q15：从详情页返回，列表怎么刷新？**

用 `RouteAware` + `RouteObserver`，在 `didPopNext` 里刷新；或者用返回值 `Navigator.pop(result)` 让上一页处理。App 生命周期不会因为页面切换触发。

# 六、速查表

## 6.1 应用生命周期

```text
resumed   前台可交互
inactive  可见但失焦（来电/通知栏/权限弹窗/分屏）
hidden    不可见过渡
paused    后台，不可见
detached  引擎未附着/销毁

监听：WidgetsBindingObserver.didChangeAppLifecycleState
     AppLifecycleListener(onResume/onPause/...)
注册：initState → addObserver
注销：dispose → removeObserver
```

## 6.2 State 生命周期

```text
createState
  → initState               创建 Controller、订阅、一次性加载
  → didChangeDependencies   读取 InheritedWidget、主题、尺寸
  → build                   纯函数，无副作用
  → didUpdateWidget         父组件配置变化，比较 oldWidget
  → build
  → deactivate              从树移除（可能重新插入）
  → dispose                 取消订阅、释放 Controller、移除监听
```

## 6.3 该在哪里做什么

| 事情 | 位置 |
| --- | --- |
| 创建 TextEditingController | `initState` |
| 读取 Theme/MediaQuery | `didChangeDependencies` |
| 发起一次性请求 | `initState` 中调用异步方法 |
| 响应父组件参数变化 | `didUpdateWidget` |
| 取消 Timer/订阅 | `dispose` |
| 前后台暂停视频 | `didChangeAppLifecycleState` |
| 页面返回刷新 | `RouteAware.didPopNext` |
| 键盘/旋转适配 | `didChangeMetrics` / `LayoutBuilder` |
| 内存紧张清缓存 | `didHaveMemoryPressure` |

---

生命周期最容易出错的地方，不是记不住方法名，而是**在错误的时机做了正确的事**：在 `initState` 里依赖 `InheritedWidget`、在 `build` 里发请求、在 `dispose` 后碰 `context`、把 `inactive` 当后台。

记住两条线：**App 生命周期管「应用在不在前台」，State 生命周期管「这个组件还在不在树上」。** 两条线分开看，大部分问题都能定位。
