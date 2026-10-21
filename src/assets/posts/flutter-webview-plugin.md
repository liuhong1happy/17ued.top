Flutter 里加载网页，大多数人第一反应是 `webview_flutter`。它成熟、维护活跃，绝大多数场景够用。但总有需要自己写插件的时候：

- 需要暴露官方插件没提供的能力，比如自定义 Cookie 同步、文件下载、支付回调、JS 桥接协议
- 需要复用公司已有的原生 WebView 容器（登录态、埋点、离线包、安全策略）
- 需要在 WebView 外面包一层原生 UI，或者和原生页面/ Fragment 深度联动
- 想搞清楚 PlatformView 到底是怎么把原生 View 塞进 Flutter 的

这篇文章从零实现一个**简易但完整**的 WebView 插件：Dart 侧提供 `SimpleWebView` 组件和 `SimpleWebViewController`，Android 侧用 `WebView`，iOS 侧用 `WKWebView`，两边都通过 **PlatformView + MethodChannel** 与 Dart 通信。

它不会覆盖文件上传、Cookie 管理、离线包、JS 注入框架这些生产级能力，但会把**最小闭环**讲清楚：视图怎么创建、消息怎么传、事件怎么回、资源怎么释放。把这套骨架跑通，再往上加能力就是体力活了。

![Flutter WebView 插件架构：Dart 侧的 Widget 与 Controller 通过每个 View 独立的 MethodChannel，与 Android 的 PlatformView/WebView 或 iOS 的 FlutterPlatformView/WKWebView 双向通信](/images/blog/flutter-webview-plugin/architecture.svg)

# 一、先明确边界：插件负责什么

一个 WebView 插件至少有三层职责：

| 层 | 职责 | 不该做的事 |
| --- | --- | --- |
| Dart 层 | 提供 Widget、Controller、事件流；参数校验；生命周期编排 | 直接操作原生对象、拼接平台相关逻辑 |
| 平台视图层 | 创建/销毁原生 View，处理尺寸、手势、渲染 | 承载业务逻辑 |
| 原生 WebView 层 | 加载 URL、导航、JS 执行、页面事件 | 直接和业务页面耦合 |

MethodChannel 只负责**消息**，PlatformView 只负责**视图**。两者职责分开，插件才不会变成一坨。

## 1.1 PlatformView 与 MethodChannel 的分工

| 能力 | PlatformView | MethodChannel |
| --- | --- | --- |
| 把原生 WebView 显示在 Flutter 界面上 | ✓ | ✗ |
| 传递 URL、执行 JS、前进后退 | ✗ | ✓ |
| 原生页面事件回调给 Dart | ✗ | ✓ |
| 处理触摸、滚动、键盘 | ✓（原生 View 自己处理） | ✗ |
| 生命周期创建/销毁 | ✓（`create` / `dispose`） | 辅助通知 |

一句话：**PlatformView 解决「看得见」，MethodChannel 解决「说得上话」。**

## 1.2 为什么不直接用 `webview_flutter`

| 维度 | 自己写 | `webview_flutter` |
| --- | --- | --- |
| 可控性 | 完全可控 | 受插件 API 限制 |
| 维护成本 | 高（双端、系统版本、安全） | 官方/社区维护 |
| 功能完整度 | 需要自己补 | 文件上传、Cookie、JS Channel 等较全 |
| 学习价值 | 高 | 低 |
| 适合 | 有明确定制需求 | 绝大多数业务 |

**结论：业务项目优先用成熟插件；需要深度定制或学习原理时，自己写。** 自己写出来的插件，长期要跟着 Flutter、Android WebView、iOS WKWebView 的版本演进维护，这是隐性成本。

# 二、整体设计

## 2.1 三层结构

```text
┌─────────────────────────────────────────────┐
│ Dart                                        │
│  SimpleWebView (Widget)                     │
│    └── SimpleWebViewController              │
│          └── MethodChannel("simple_webview/$id") │
└──────────────────┬──────────────────────────┘
                   │ PlatformView 创建 / 消息
┌──────────────────▼──────────────────────────┐
│ Android                          iOS        │
│  SimpleWebViewPlugin             Plugin     │
│  SimpleWebViewFactory            Factory    │
│  SimpleWebViewPlatformView       PlatformView│
│    ├── WebView                   ├── WKWebView│
│    └── MethodChannel             └── MethodChannel│
└─────────────────────────────────────────────┘
```

## 2.2 每个 View 一个 Channel

Channel 名字建议带 viewId：

```text
simple_webview/0
simple_webview/1
simple_webview/2
```

原因：

- 一个页面可能同时存在多个 WebView（比如商品详情 + 客服）
- 每个 View 的加载状态、前进后退历史、JS 执行结果都是独立的
- 共用一个 Channel 需要额外维护 `viewId` 参数和路由表，容易出错
- 销毁时可以只清掉对应 Channel 的 handler，不影响其他 View

代价是 Channel 数量随 View 增加，但 MethodChannel 很轻，几十个以内没有压力。

## 2.3 插件目录

```text
flutter_simple_webview/
├── lib/
│   ├── flutter_simple_webview.dart        # 导出
│   └── src/
│       ├── simple_webview.dart            # Widget
│       ├── simple_webview_controller.dart # Controller + 事件
│       └── simple_webview_event.dart      # 事件模型
├── android/
│   └── src/main/kotlin/.../
│       ├── SimpleWebViewPlugin.kt
│       ├── SimpleWebViewFactory.kt
│       └── SimpleWebViewPlatformView.kt
├── ios/
│   └── Classes/
│       ├── SimpleWebViewPlugin.swift
│       ├── SimpleWebViewFactory.swift
│       └── SimpleWebViewPlatformView.swift
├── example/
│   └── lib/main.dart
├── pubspec.yaml
└── README.md
```

用 `flutter create --template=plugin --platforms=android,ios flutter_simple_webview` 生成骨架，再按上面的结构拆文件。

# 三、Dart 侧：Widget + Controller

## 3.1 pubspec 声明

```yaml
name: flutter_simple_webview
description: A minimal WebView plugin built with PlatformView and MethodChannel.
version: 0.1.0
environment:
  sdk: ">=3.3.0 <4.0.0"
  flutter: ">=3.22.0"

dependencies:
  flutter:
    sdk: flutter

flutter:
  plugin:
    platforms:
      android:
        package: com.example.simple_webview
        pluginClass: SimpleWebViewPlugin
      ios:
        pluginClass: SimpleWebViewPlugin
```

## 3.2 事件模型

```dart
sealed class SimpleWebViewEvent {
  const SimpleWebViewEvent();
}

class PageStarted extends SimpleWebViewEvent {
  const PageStarted(this.url);
  final String url;
}

class PageFinished extends SimpleWebViewEvent {
  const PageFinished(this.url);
  final String url;
}

class PageProgress extends SimpleWebViewEvent {
  const PageProgress(this.progress);
  final int progress; // 0-100
}

class PageTitle extends SimpleWebViewEvent {
  const PageTitle(this.title);
  final String title;
}

class PageError extends SimpleWebViewEvent {
  const PageError(this.code, this.message, this.url);
  final int code;
  final String message;
  final String? url;
}
```

用 `sealed class` 而不是一个带 `type` 字段的大对象，Dart 侧可以用 `switch` 做穷尽匹配，少写一堆 `if`。

## 3.3 Controller

```dart
import 'dart:async';
import 'package:flutter/services.dart';

class SimpleWebViewController {
  SimpleWebViewController(int viewId)
      : _channel = MethodChannel('simple_webview/$viewId') {
    _channel.setMethodCallHandler(_onNativeCall);
  }

  final MethodChannel _channel;
  final _events = StreamController<SimpleWebViewEvent>.broadcast();
  bool _disposed = false;

  Stream<SimpleWebViewEvent> get events => _events.stream;

  Future<void> loadUrl(String url) {
    _ensureAlive();
    return _channel.invokeMethod<void>('loadUrl', {'url': url});
  }

  Future<void> reload() {
    _ensureAlive();
    return _channel.invokeMethod<void>('reload');
  }

  Future<bool> canGoBack() async {
    _ensureAlive();
    return await _channel.invokeMethod<bool>('canGoBack') ?? false;
  }

  Future<void> goBack() {
    _ensureAlive();
    return _channel.invokeMethod<void>('goBack');
  }

  Future<void> goForward() {
    _ensureAlive();
    return _channel.invokeMethod<void>('goForward');
  }

  Future<String?> evaluateJavascript(String script) {
    _ensureAlive();
    return _channel.invokeMethod<String>(
      'evaluateJavascript',
      {'script': script},
    );
  }

  Future<void> clearCache() {
    _ensureAlive();
    return _channel.invokeMethod<void>('clearCache');
  }

  Future<void> _onNativeCall(MethodCall call) async {
    if (_disposed) return;
    switch (call.method) {
      case 'onPageStarted':
        _events.add(PageStarted(_stringArg(call, 'url')));
      case 'onPageFinished':
        _events.add(PageFinished(_stringArg(call, 'url')));
      case 'onProgress':
        _events.add(PageProgress(_intArg(call, 'progress')));
      case 'onTitle':
        _events.add(PageTitle(_stringArg(call, 'title')));
      case 'onError':
        _events.add(PageError(
          _intArg(call, 'code'),
          _stringArg(call, 'message'),
          _stringArgOrNull(call, 'url'),
        ));
    }
  }

  String _stringArg(MethodCall call, String key) {
    final args = call.arguments;
    if (args is Map && args[key] is String) return args[key] as String;
    return '';
  }

  String? _stringArgOrNull(MethodCall call, String key) {
    final args = call.arguments;
    if (args is Map && args[key] is String) return args[key] as String;
    return null;
  }

  int _intArg(MethodCall call, String key) {
    final args = call.arguments;
    if (args is Map && args[key] is num) return (args[key] as num).toInt();
    return 0;
  }

  void _ensureAlive() {
    if (_disposed) {
      throw StateError('SimpleWebViewController has been disposed');
    }
  }

  Future<void> dispose() async {
    if (_disposed) return;
    _disposed = true;
    _channel.setMethodCallHandler(null);
    await _events.close();
    // 通知原生提前停止加载；PlatformView.dispose 仍会做最终清理
    try {
      await _channel.invokeMethod<void>('dispose');
    } on MissingPluginException {
      // 视图可能已经被 Flutter 销毁，忽略
    }
  }
}
```

几个细节：

- **构造函数里立刻设置 handler**，不要等到页面加载后才设置，否则可能错过早期事件
- `_disposed` 守卫防止 Channel 关闭后仍往 Stream 里写
- `dispose` 里先清 handler，再关 Stream，最后通知原生；顺序反过来会出现「原生回调已到、Stream 已关闭」的异常
- 不要吞掉所有异常，只处理可预期的 `MissingPluginException`

## 3.4 Widget

```dart
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

class SimpleWebView extends StatefulWidget {
  const SimpleWebView({
    super.key,
    required this.initialUrl,
    this.javaScriptEnabled = true,
    this.onCreated,
    this.onEvent,
  });

  final String initialUrl;
  final bool javaScriptEnabled;
  final ValueChanged<SimpleWebViewController>? onCreated;
  final ValueChanged<SimpleWebViewEvent>? onEvent;

  @override
  State<SimpleWebView> createState() => _SimpleWebViewState();
}

class _SimpleWebViewState extends State<SimpleWebView> {
  SimpleWebViewController? _controller;
  StreamSubscription<SimpleWebViewEvent>? _subscription;

  Map<String, dynamic> get _creationParams => {
        'initialUrl': widget.initialUrl,
        'javaScriptEnabled': widget.javaScriptEnabled,
      };

  void _onPlatformViewCreated(int id) {
    final controller = SimpleWebViewController(id);
    _controller = controller;
    _subscription = controller.events.listen(widget.onEvent);
    widget.onCreated?.call(controller);
  }

  @override
  Widget build(BuildContext context) {
    if (defaultTargetPlatform == TargetPlatform.android) {
      return AndroidView(
        viewType: 'simple_webview',
        creationParams: _creationParams,
        creationParamsCodec: const StandardMessageCodec(),
        onPlatformViewCreated: _onPlatformViewCreated,
      );
    }
    if (defaultTargetPlatform == TargetPlatform.iOS) {
      return UiKitView(
        viewType: 'simple_webview',
        creationParams: _creationParams,
        creationParamsCodec: const StandardMessageCodec(),
        onPlatformViewCreated: _onPlatformViewCreated,
      );
    }
    return const Center(child: Text('SimpleWebView 仅支持 Android / iOS'));
  }

  @override
  void dispose() {
    _subscription?.cancel();
    _controller?.dispose();
    super.dispose();
  }
}
```

## 3.5 使用

```dart
class WebPage extends StatefulWidget {
  const WebPage({super.key});

  @override
  State<WebPage> createState() => _WebPageState();
}

class _WebPageState extends State<WebPage> {
  SimpleWebViewController? _controller;
  int _progress = 0;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('简易 WebView'),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: () => _controller?.reload(),
          ),
        ],
      ),
      body: Column(
        children: [
          if (_progress < 100)
            LinearProgressIndicator(value: _progress / 100),
          Expanded(
            child: SimpleWebView(
              initialUrl: 'https://flutter.dev',
              onCreated: (controller) => _controller = controller,
              onEvent: (event) => switch (event) {
                PageProgress(:final progress) =>
                  setState(() => _progress = progress),
                PageError(:final message) =>
                  ScaffoldMessenger.of(context).showSnackBar(
                    SnackBar(content: Text('加载失败：$message')),
                  ),
                _ => null,
              },
            ),
          ),
        ],
      ),
    );
  }
}
```

**注意不要在原生构造函数里自动加载 URL**。View 创建和 Dart 设置 Channel handler 之间存在时间差，如果原生在构造函数里立刻 `loadUrl`，早期的 `onPageStarted` 可能没人接收。正确做法是：原生只保存参数，Dart 在 `onPlatformViewCreated` 之后主动调用 `loadUrl`。

# 四、Android：PlatformView + WebView

## 4.1 注册插件与 ViewFactory

```kotlin
package com.example.simple_webview

import io.flutter.embedding.engine.plugins.FlutterPlugin
import io.flutter.plugin.common.StandardMessageCodec

class SimpleWebViewPlugin : FlutterPlugin {
    override fun onAttachedToEngine(binding: FlutterPlugin.FlutterPluginBinding) {
        binding.platformViewRegistry.registerViewFactory(
            "simple_webview",
            SimpleWebViewFactory(binding.binaryMessenger),
        )
    }

    override fun onDetachedFromEngine(binding: FlutterPlugin.FlutterPluginBinding) {
        // 插件级资源清理；View 的生命周期由 PlatformView.dispose 负责
    }
}
```

`viewType` 必须和 Dart 侧 `AndroidView(viewType: 'simple_webview')` 完全一致。

## 4.2 Factory

```kotlin
package com.example.simple_webview

import android.content.Context
import io.flutter.plugin.common.BinaryMessenger
import io.flutter.plugin.common.StandardMessageCodec
import io.flutter.plugin.platform.PlatformView
import io.flutter.plugin.platform.PlatformViewFactory

class SimpleWebViewFactory(
    private val messenger: BinaryMessenger,
) : PlatformViewFactory(StandardMessageCodec.INSTANCE) {

    override fun create(
        context: Context,
        viewId: Int,
        args: Any?,
    ): PlatformView {
        @Suppress("UNCHECKED_CAST")
        val params = (args as? Map<String, Any?>) ?: emptyMap()
        return SimpleWebViewPlatformView(context, messenger, viewId, params)
    }
}
```

## 4.3 PlatformView 主体

```kotlin
package com.example.simple_webview

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Bitmap
import android.os.Build
import android.view.View
import android.view.ViewGroup
import android.webkit.*
import io.flutter.plugin.common.BinaryMessenger
import io.flutter.plugin.common.MethodChannel
import io.flutter.plugin.platform.PlatformView

class SimpleWebViewPlatformView(
    context: Context,
    messenger: BinaryMessenger,
    private val viewId: Int,
    params: Map<String, Any?>,
) : PlatformView {

    private val webView = WebView(context)
    private val channel = MethodChannel(messenger, "simple_webview/$viewId")
    private var disposed = false

    init {
        configure(webView, params)
        channel.setMethodCallHandler { call, result ->
            when (call.method) {
                "loadUrl" -> {
                    val url = call.argument<String>("url")
                    if (url.isNullOrBlank()) {
                        result.error("invalid_args", "url is required", null)
                    } else {
                        webView.loadUrl(url)
                        result.success(null)
                    }
                }
                "reload" -> { webView.reload(); result.success(null) }
                "goBack" -> { webView.goBack(); result.success(null) }
                "goForward" -> { webView.goForward(); result.success(null) }
                "canGoBack" -> result.success(webView.canGoBack())
                "canGoForward" -> result.success(webView.canGoForward())
                "evaluateJavascript" -> {
                    val script = call.argument<String>("script")
                    if (script == null) {
                        result.error("invalid_args", "script is required", null)
                    } else {
                        webView.evaluateJavascript(script) { value ->
                            if (!disposed) result.success(value)
                        }
                    }
                }
                "clearCache" -> {
                    webView.clearCache(true)
                    result.success(null)
                }
                "dispose" -> {
                    destroyWebView()
                    result.success(null)
                }
                else -> result.notImplemented()
            }
        }
        // 不在这里 loadUrl，等 Dart 设置好 handler 后主动调用
    }

    override fun getView(): View = webView

    override fun dispose() {
        channel.setMethodCallHandler(null)
        destroyWebView()
    }

    private fun configure(webView: WebView, params: Map<String, Any?>) {
        webView.settings.apply {
            javaScriptEnabled = params["javaScriptEnabled"] as? Boolean ?: true
            domStorageEnabled = true
            databaseEnabled = true
            mediaPlaybackRequiresUserGesture = false
            mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
            allowFileAccess = false
            allowContentAccess = false
            cacheMode = WebSettings.LOAD_DEFAULT
        }

        if (isDebuggable(webView.context)) {
            WebView.setWebContentsDebuggingEnabled(true)
        }

        webView.webViewClient = object : WebViewClient() {
            override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
                emit("onPageStarted", mapOf("url" to url))
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                emit("onPageFinished", mapOf("url" to url))
            }

            override fun onReceivedError(
                view: WebView?,
                request: WebResourceRequest?,
                error: WebResourceError?,
            ) {
                // 只上报主文档错误，子资源失败不打断业务
                if (request?.isForMainFrame != true) return
                emit(
                    "onError",
                    mapOf(
                        "code" to (error?.errorCode ?: -1),
                        "message" to (error?.description?.toString() ?: "unknown"),
                        "url" to request.url?.toString(),
                    ),
                )
            }
        }

        webView.webChromeClient = object : WebChromeClient() {
            override fun onProgressChanged(view: WebView?, newProgress: Int) {
                emit("onProgress", mapOf("progress" to newProgress))
            }

            override fun onReceivedTitle(view: WebView?, title: String?) {
                emit("onTitle", mapOf("title" to title))
            }
        }
    }

    private fun emit(method: String, args: Map<String, Any?>) {
        if (disposed) return
        channel.invokeMethod(method, args)
    }

    private fun destroyWebView() {
        if (disposed) return
        disposed = true
        webView.stopLoading()
        webView.webChromeClient = null
        webView.webViewClient = WebViewClient()
        (webView.parent as? ViewGroup)?.removeView(webView)
        webView.removeAllViews()
        webView.clearHistory()
        webView.destroy()
    }

    private fun isDebuggable(context: Context): Boolean {
        return (context.applicationInfo.flags and
            android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0
    }
}
```

## 4.4 Android 侧要点

**线程**：WebView 的创建、加载、销毁都必须在主线程。MethodChannel 的 handler 默认在主线程执行，所以上面没有额外切线程。

**权限**：`INTERNET` 权限要声明在插件的 `AndroidManifest.xml` 里，打包时会合并进 App：

```xml
<uses-permission android:name="android.permission.INTERNET" />
```

**明文 HTTP**：Android 9+ 默认禁止明文流量。开发期如果加载 `http://`，需要在 App 的 `AndroidManifest.xml` 里配置 `usesCleartextTraffic` 或 network security config；生产环境应使用 HTTPS。

**错误回调**：`onReceivedError` 只处理 `request.isForMainFrame`，否则页面里一张图片 404 也会触发「网页加载失败」。

**销毁顺序**：先停加载、清回调、从父容器移除，再 `destroy()`。只调 `destroy()` 不摘父容器，某些 ROM 上会泄漏。

**不要在 `onDetachedFromWindow` 里直接 `destroy()`**：PlatformView 的 `dispose` 已经是明确的生命周期信号，两边都销毁会触发 `WebView.destroy() called on a destroyed WebView` 或空指针。

# 五、iOS：PlatformView + WKWebView

## 5.1 注册

```swift
import Flutter
import UIKit

public class SimpleWebViewPlugin: NSObject, FlutterPlugin {
  public static func register(with registrar: FlutterPluginRegistrar) {
    let factory = SimpleWebViewFactory(messenger: registrar.messenger())
    registrar.register(factory, withId: "simple_webview")
  }
}
```

## 5.2 Factory

```swift
import Flutter
import UIKit

class SimpleWebViewFactory: NSObject, FlutterPlatformViewFactory {
  private let messenger: FlutterBinaryMessenger

  init(messenger: FlutterBinaryMessenger) {
    self.messenger = messenger
    super.init()
  }

  func createArgsCodec() -> FlutterMessageCodec & NSObjectProtocol {
    return FlutterStandardMessageCodec.sharedInstance()
  }

  func create(
    withFrame frame: CGRect,
    viewIdentifier viewId: Int64,
    arguments args: Any?
  ) -> FlutterPlatformView {
    return SimpleWebViewPlatformView(
      frame: frame,
      viewId: viewId,
      args: args,
      messenger: messenger
    )
  }
}
```

## 5.3 PlatformView 主体

```swift
import Flutter
import UIKit
import WebKit

class SimpleWebViewPlatformView: NSObject, FlutterPlatformView {
  private let webView: WKWebView
  private let channel: FlutterMethodChannel
  private var progressObservation: NSKeyValueObservation?
  private var disposed = false

  init(
    frame: CGRect,
    viewId: Int64,
    args: Any?,
    messenger: FlutterBinaryMessenger
  ) {
    let params = args as? [String: Any] ?? [:]
    let config = WKWebViewConfiguration()
    config.allowsInlineMediaPlayback = true

    let jsEnabled = params["javaScriptEnabled"] as? Bool ?? true
    if #available(iOS 14.0, *) {
      config.defaultWebpagePreferences.allowsContentJavaScript = jsEnabled
    } else {
      config.preferences.javaScriptEnabled = jsEnabled
    }

    webView = WKWebView(frame: frame, configuration: config)
    channel = FlutterMethodChannel(
      name: "simple_webview/\(viewId)",
      binaryMessenger: messenger
    )

    super.init()

    webView.navigationDelegate = self
    webView.uiDelegate = self
    channel.setMethodCallHandler { [weak self] call, result in
      self?.handle(call, result: result)
    }

    progressObservation = webView.observe(
      \.estimatedProgress,
      options: [.new]
    ) { [weak self] webView, _ in
      guard let self, !self.disposed else { return }
      self.channel.invokeMethod(
        "onProgress",
        arguments: ["progress": Int(webView.estimatedProgress * 100)]
      )
    }

    // 不在 init 里 load，等 Dart 主动调用
  }

  func view() -> UIView {
    return webView
  }

  private func handle(_ call: FlutterMethodCall, result: @escaping FlutterResult) {
    guard !disposed else {
      result(FlutterError(code: "disposed", message: "WebView already disposed", details: nil))
      return
    }

    let args = call.arguments as? [String: Any] ?? [:]

    switch call.method {
    case "loadUrl":
      guard let urlString = args["url"] as? String,
            let url = URL(string: urlString),
            ["http", "https"].contains(url.scheme?.lowercased() ?? "") else {
        result(FlutterError(code: "invalid_args", message: "invalid url", details: nil))
        return
      }
      webView.load(URLRequest(url: url))
      result(nil)

    case "reload":
      webView.reload()
      result(nil)

    case "goBack":
      if webView.canGoBack { webView.goBack() }
      result(nil)

    case "goForward":
      if webView.canGoForward { webView.goForward() }
      result(nil)

    case "canGoBack":
      result(webView.canGoBack)

    case "canGoForward":
      result(webView.canGoForward)

    case "evaluateJavascript":
      guard let script = args["script"] as? String else {
        result(FlutterError(code: "invalid_args", message: "script is required", details: nil))
        return
      }
      webView.evaluateJavaScript(script) { [weak self] value, error in
        guard let self, !self.disposed else { return }
        if let error {
          result(FlutterError(code: "js_error", message: error.localizedDescription, details: nil))
        } else {
          result(value)
        }
      }

    case "clearCache":
      WKWebsiteDataStore.default().removeData(
        ofTypes: WKWebsiteDataStore.allWebsiteDataTypes(),
        modifiedSince: Date(timeIntervalSince1970: 0)
      ) {
        result(nil)
      }

    case "dispose":
      destroy()
      result(nil)

    default:
      result(FlutterMethodNotImplemented)
    }
  }

  private func destroy() {
    guard !disposed else { return }
    disposed = true
    progressObservation?.invalidate()
    progressObservation = nil
    channel.setMethodCallHandler(nil)
    webView.stopLoading()
    webView.navigationDelegate = nil
    webView.uiDelegate = nil
    webView.removeFromSuperview()
  }

  deinit {
    destroy()
  }
}

extension SimpleWebViewPlatformView: WKNavigationDelegate {
  func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
    emit("onPageStarted", ["url": webView.url?.absoluteString ?? ""])
  }

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    emit("onPageFinished", ["url": webView.url?.absoluteString ?? ""])
  }

  func webView(
    _ webView: WKWebView,
    didFail navigation: WKNavigation!,
    withError error: Error
  ) {
    emitError(error)
  }

  func webView(
    _ webView: WKWebView,
    didFailProvisionalNavigation navigation: WKNavigation!,
    withError error: Error
  ) {
    emitError(error)
  }

  func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
    // WebContent 进程被系统回收，简单策略是重新加载
    emit("onError", [
      "code": -1,
      "message": "web content process terminated",
      "url": webView.url?.absoluteString ?? ""
    ])
    webView.reload()
  }

  private func emitError(_ error: Error) {
    let nsError = error as NSError
    emit("onError", [
      "code": nsError.code,
      "message": nsError.localizedDescription,
      "url": webView.url?.absoluteString ?? ""
    ])
  }

  private func emit(_ method: String, _ args: [String: Any]) {
    guard !disposed else { return }
    channel.invokeMethod(method, arguments: args)
  }
}

extension SimpleWebViewPlatformView: WKUIDelegate {
  // 不实现的话，页面里的 alert/confirm 会被静默忽略
  func webView(
    _ webView: WKWebView,
    runJavaScriptAlertPanelWithMessage message: String,
    initiatedByFrame frame: WKFrameInfo,
    completionHandler: @escaping () -> Void
  ) {
    guard let root = webView.window?.rootViewController else {
      completionHandler()
      return
    }
    let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
    alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in
      completionHandler()
    })
    root.present(alert, animated: true)
  }
}
```

## 5.4 iOS 侧要点

**主线程**：`WKWebView` 的创建和操作必须在主线程；PlatformView 的回调本身就在主线程。

**ATS**：iOS 默认禁止明文 HTTP。开发期在 example App 的 `Info.plist` 里加 `NSAppTransportSecurity`，生产必须 HTTPS：

```xml
<key>NSAppTransportSecurity</key>
<dict>
  <key>NSAllowsArbitraryLoads</key>
  <true/>
</dict>
```

**JS 弹窗**：不实现 `WKUIDelegate` 的 `runJavaScriptAlertPanelWithMessage`，页面里的 `alert` 不会显示，也不会阻塞。

**进程终止**：iOS 内存紧张时会回收 WebContent 进程，`webViewWebContentProcessDidTerminate` 里要决定是重载还是提示用户。

**KVO 释放**：`estimatedProgress` 的观察者要在销毁时 `invalidate()`，否则可能持有已释放的 WebView。

**deinit**：不要在 `deinit` 里做异步操作；`destroy()` 只做同步清理。`channel.setMethodCallHandler(nil)` 是安全的。

**Cookie/缓存**：`WKWebsiteDataStore` 默认持久化；如果要无痕模式，用 `WKWebsiteDataStore.nonPersistent()`。清理缓存是异步的，`clearCache` 的结果在 completion 里返回。

# 六、消息协议

![一次 WebView 调用的完整时序：创建 PlatformView、设置 Channel handler、加载 URL、页面事件回调、执行 JS，最后销毁并清理资源](/images/blog/flutter-webview-plugin/sequence.svg)

## 6.1 方法表

| 方向 | 方法 | 参数 | 返回 |
| --- | --- | --- | --- |
| Dart → 原生 | `loadUrl` | `{url}` | `null` |
| Dart → 原生 | `reload` | — | `null` |
| Dart → 原生 | `goBack` / `goForward` | — | `null` |
| Dart → 原生 | `canGoBack` / `canGoForward` | — | `bool` |
| Dart → 原生 | `evaluateJavascript` | `{script}` | `String?`（平台差异见下） |
| Dart → 原生 | `clearCache` | — | `null` |
| Dart → 原生 | `dispose` | — | `null` |
| 原生 → Dart | `onPageStarted` | `{url}` | — |
| 原生 → Dart | `onPageFinished` | `{url}` | — |
| 原生 → Dart | `onProgress` | `{progress}` | — |
| 原生 → Dart | `onTitle` | `{title}` | — |
| 原生 → Dart | `onError` | `{code, message, url}` | — |

## 6.2 错误码

| 错误码 | 含义 | 处理 |
| --- | --- | --- |
| `invalid_args` | 参数缺失或格式错误 | Dart 侧先校验，原生兜底 |
| `js_error` | JS 执行异常 | 提示或降级 |
| `disposed` | View 已销毁仍收到调用 | 检查生命周期，忽略 |
| `not_implemented` | 未知方法 | 版本不匹配，检查插件版本 |

原生返回错误用 `result.error(code, message, details)` / `FlutterError`，不要直接抛异常。

## 6.3 `evaluateJavascript` 的平台差异

这是最容易踩坑的一处：

| 平台 | 返回值 |
| --- | --- |
| Android | `evaluateJavascript` 回调返回的是 **JSON 编码后的字符串**，例如 `"hello"`、`42`、`{"a":1}` |
| iOS | `evaluateJavaScript` 返回 `Any?`，字符串就是 `String`，数字是 `NSNumber`，对象是 `[String: Any]` |

如果 Dart 侧直接当字符串用，Android 会多出一对引号。两种处理方式：

1. 原生侧统一转成字符串：Android 收到 JSON 字符串就原样返回，iOS 用 `String(describing:)` 再返回，并在文档里写清楚
2. Dart 侧用 `jsonDecode` 统一解析，但要注意 `undefined` / 异常情况

简易插件建议采用第 1 种，并在 README 里注明「Android 返回值是 JSON 字符串」。要更严谨，可以定义 `evaluateJavascript<T>` 并在原生侧统一序列化。

# 七、PlatformView 渲染模式与坑

![Android PlatformView 三种渲染模式：Virtual Display 通过虚拟显示和纹理拷贝，Hybrid Composition 让原生 View 直接参与合成，Texture Layer HC 通过纹理层折中](/images/blog/flutter-webview-plugin/rendering-modes.svg)

Android 侧把原生 View 嵌进 Flutter，历史上有多套渲染模式：

| 模式 | 原理 | 优点 | 缺点 |
| --- | --- | --- | --- |
| Virtual Display | 原生 View 渲染到虚拟显示，再拷贝成纹理 | 实现简单、兼容老版本 | 输入/键盘问题多、额外拷贝、性能差 |
| Hybrid Composition | 原生 View 直接参与合成（SurfaceView/纹理） | 输入、滚动、键盘更自然 | 层级和裁剪更复杂 |
| Texture Layer Hybrid Composition | 原生 View 渲染到纹理层再合成 | 性能与兼容性折中 | 某些平台版本仍有差异 |

**实践建议**：

- 用 `AndroidView` / `UiKitView`，不要再用老式的 `PlatformView` 直接返回 View 的虚拟显示路径
- 需要显式控制时用 `PlatformViewLink` + `AndroidViewController`（`initSurfaceAndroidView` / `initExpensiveAndroidView`）
- WebView 属于重原生 View，优先 Hybrid Composition；Virtual Display 下输入框、软键盘、视频全屏经常出问题
- iOS 的 `UiKitView` 本身就是原生视图合成，不存在 Android 的虚拟显示问题

## 7.1 常见渲染问题

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| WebView 白屏但日志显示加载成功 | 渲染模式/层级问题 | 换 Hybrid Composition，检查父容器裁剪 |
| 输入框点不出键盘 | Virtual Display 的 IME 问题 | 用 Hybrid Composition |
| 滚动和 Flutter 手势冲突 | 原生 View 与 Flutter 手势竞技 | `gestureRecognizers`、`HitTestBehavior`、避免外层套可滚动组件 |
| 圆角/裁剪不生效 | PlatformView 在独立图层 | 用原生容器裁剪，或 `ClipRRect` 包原生 View |
| 多个 WebView 卡顿 | 每个 WebView 都是独立进程/渲染层 | 限制同时存在的数量，离屏销毁 |

## 7.2 尺寸与生命周期

- PlatformView 的尺寸由 Flutter 布局决定，原生 View 会收到 resize；WebView 会自动重排
- 页面不可见时不要只把 Widget 从树上摘掉，要确保 `dispose` 被调用，否则 WebView 可能继续加载/播放
- 列表里不要放 WebView；如果必须放，确保滑出屏幕后销毁并保留状态（URL、滚动位置）以便恢复
- 热重载不会重建 PlatformView；改原生代码要**热重启**或重新 `flutter run`

# 八、进阶：JS 与 Flutter 互调

MethodChannel 解决的是 Flutter ↔ 原生，不解决网页 JS ↔ Flutter。如果页面里的 JS 需要调用 Flutter，需要再加一层桥。

## 8.1 Flutter 调 JS

```dart
final result = await controller.evaluateJavascript('''
  (function() {
    return JSON.stringify({
      title: document.title,
      url: location.href
    });
  })();
''');
```

注意：

- 脚本在页面上下文执行，受同源策略和 CSP 限制
- 返回值要可序列化（字符串、数字、布尔、对象）
- 不要在脚本里拼接未转义的用户输入，防止 XSS/JS 注入

## 8.2 JS 调 Flutter

**Android**：通过 `addJavascriptInterface` 注入对象：

```kotlin
webView.addJavascriptInterface(object {
    @JavascriptInterface
    fun postMessage(message: String) {
        // 切回主线程后通过 MethodChannel 发给 Dart
        webView.post {
            channel.invokeMethod("onJsMessage", mapOf("data" to message))
        }
    }
}, "SimpleWebViewBridge")
```

页面里：

```javascript
window.SimpleWebViewBridge.postMessage(JSON.stringify({ type: 'login', token: '...' }));
```

**iOS**：通过 `WKScriptMessageHandler`：

```swift
config.userContentController.add(self, name: "simpleWebView")
```

```javascript
window.webkit.messageHandlers.simpleWebView.postMessage({ type: 'login' });
```

**安全提醒**：

- `addJavascriptInterface` 只对可信页面使用；API 17+ 必须加 `@JavascriptInterface`
- 校验消息来源（`webView.url` 的 origin）、消息结构、字段类型
- 不要把文件系统、数据库、支付等敏感能力直接暴露给网页
- iOS 使用 `WKScriptMessageHandler` 时注意 retain cycle（`add(self, ...)` 会强引用），销毁时 `removeScriptMessageHandler(forName:)`
- 网页内容不可信时，禁用 JS 或只加载白名单域名

# 九、调试与测试

## 9.1 调试 WebView

| 平台 | 工具 | 说明 |
| --- | --- | --- |
| Android | `chrome://inspect` | 需要 `WebView.setWebContentsDebuggingEnabled(true)` |
| iOS | Safari → 开发 → 设备 | 需要在真机/模拟器开启 Web Inspector |
| 通用 | `flutter logs`、`adb logcat`、Xcode Console | 看原生日志和崩溃 |
| 通用 | Flutter DevTools | 看 Widget 树、性能、内存 |

建议在插件里加一个 debug 开关：

```dart
SimpleWebView(
  initialUrl: url,
  // 原生侧根据 App 的 debuggable 自动开启，生产不暴露
)
```

不要在生产包无条件开启 `setWebContentsDebuggingEnabled(true)`。

## 9.2 单元测试：Mock MethodChannel

PlatformView 本身很难在 widget test 里创建，但 Controller 可以单独测：

```dart
TestWidgetsFlutterBinding.ensureInitialized();

test('loadUrl sends method call', () async {
  const channel = MethodChannel('simple_webview/1');
  final calls = <MethodCall>[];

  TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
      .setMockMethodCallHandler(channel, (call) async {
    calls.add(call);
    return null;
  });

  final controller = SimpleWebViewController(1);
  await controller.loadUrl('https://example.com');

  expect(calls.single.method, 'loadUrl');
  expect(calls.single.arguments, {'url': 'https://example.com'});
});
```

事件回调用 `handlePlatformMessage` 模拟，或者直接测原生侧的单元测试（Android JUnit / iOS XCTest）。

## 9.3 集成测试

真正验证 PlatformView 需要设备/模拟器：

```dart
testWidgets('webview loads page', (tester) async {
  await tester.pumpWidget(const MaterialApp(home: WebPage()));
  await tester.pumpAndSettle();
  expect(find.byType(SimpleWebView), findsOneWidget);
});
```

再用 `integration_test` 在真机上跑，验证加载、前进后退、JS 执行和销毁。

# 十、常见问题排查

| 问题 | 排查方向 |
| --- | --- |
| `MissingPluginException` | 插件是否注册、`viewType`/Channel 名是否一致、是否在正确引擎上创建 |
| 白屏 | INTERNET 权限、HTTPS/ATS、URL 是否可达、渲染模式、WebView 是否 attached |
| 键盘不弹出 | Virtual Display 模式；换 Hybrid Composition |
| 事件收不到 | handler 设置太晚；原生在构造函数里提前 loadUrl；Channel 名不匹配 |
| `result already called` | 某个分支调用了两次 `result`；检查异常路径 |
| 销毁后崩溃 | `dispose` 后仍有回调；加 `disposed` 守卫，先清 handler |
| 内存泄漏 | WebView 未 destroy、delegate/JS handler 循环引用、KVO 未 invalidate |
| iOS 页面 alert 无反应 | 未实现 `WKUIDelegate` |
| Android 返回键直接退出 | App 层监听返回，先 `canGoBack()` 再 `goBack()` |
| HTTP 加载失败 | Android cleartext、iOS ATS；生产改 HTTPS |
| 多个 WebView 卡顿 | 限制实例数，离屏销毁，避免列表内嵌 |

## 10.1 返回键处理

```dart
PopScope(
  canPop: false,
  onPopInvokedWithResult: (didPop, result) async {
    if (didPop) return;
    final canGoBack = await controller.canGoBack();
    if (canGoBack) {
      await controller.goBack();
    } else if (context.mounted) {
      Navigator.of(context).pop();
    }
  },
  child: SimpleWebView(...),
)
```

不要在插件内部拦截 Android 物理返回键；由 App 决定导航语义。

# 十一、发布与维护

## 11.1 发布前检查

```text
□ Android minSdk / iOS 最低版本与 Flutter 版本匹配
□ INTERNET 权限、ATS/cleartext 配置有文档
□ 所有原生回调都在主线程
□ dispose 幂等，重复调用不崩溃
□ Channel handler 在销毁时清空
□ evaluateJavascript 的平台差异写进 README
□ 只允许 http/https，拦截 intent:// 等 scheme（或明确放行）
□ 生产关闭 WebView 调试开关
□ 示例 App 覆盖加载、前进后退、JS 执行、销毁
□ 在 Android 低版本、iOS 真机上回归
```

## 11.2 版本与兼容

- Flutter 升级可能改变 PlatformView 的渲染默认值，升级时要回归白屏、键盘、手势
- Android System WebView 由系统/应用商店更新，行为会随版本变化
- iOS WKWebView 跟随系统升级，注意新版本对 Cookie、ATS、JS 的限制
- 插件 API 尽量保持向后兼容；新增方法而不是改参数结构

## 11.3 什么时候该换成 Pigeon

MethodChannel 的字符串方法名和动态参数在插件变大后容易写错。官方 `webview_flutter` 已经迁移到 Pigeon 做类型安全通信。如果插件要长期维护、方法超过十几个，建议：

- 用 Pigeon 生成 Dart/Kotlin/Swift 的接口和数据结构
- 保留 PlatformView 部分不变
- 把事件改成 `EventChannel` 或 Pigeon 的流式 API

**简易插件用 MethodChannel 足够；生产级插件建议 Pigeon。**

# 十二、十道评审问题

**Q1：为什么每个 WebView 一个 MethodChannel？**

每个 View 的加载状态、历史栈、JS 执行结果彼此独立。独立 Channel 天然隔离，销毁时只清理自己的 handler；共用 Channel 需要维护 viewId 路由和生命周期，容易串消息。

**Q2：PlatformView 和 MethodChannel 分别负责什么？**

PlatformView 负责把原生 View 嵌入 Flutter 并处理布局、触摸、渲染；MethodChannel 负责 Dart 与原生之间的方法调用和事件回传。前者解决「显示」，后者解决「通信」。

**Q3：为什么不在原生构造函数里直接 loadUrl？**

View 创建和 Dart 设置 Channel handler 之间存在时间差，提前加载会丢失 `onPageStarted` 等早期事件。应由 Dart 在 `onPlatformViewCreated` 后主动调用 `loadUrl`，或者原生做事件队列缓冲。

**Q4：PlatformView 的 dispose 和 Dart Controller 的 dispose 有什么区别？**

`PlatformView.dispose` 是 Flutter 销毁原生视图时调用的，负责停加载、清回调、移除父容器、`destroy()`；Dart Controller 的 dispose 负责清 Channel handler、关闭事件流、可选地通知原生提前停止。两者都要幂等，避免重复销毁。

**Q5：Android 的 Virtual Display 和 Hybrid Composition 怎么选？**

WebView 这类重输入/重滚动的 View 优先 Hybrid Composition（`AndroidView` 默认路径）。Virtual Display 实现简单，但软键盘、触摸、视频全屏问题多，只适合非常简单的原生 View。

**Q6：`evaluateJavascript` 在 Android 和 iOS 上返回一致吗？**

不一致。Android 回调返回 JSON 编码字符串，iOS 返回原生类型（String/NSNumber/Dictionary）。插件应在原生侧统一序列化，或在 Dart 侧用 `jsonDecode` 并处理异常，且写进文档。

**Q7：如何避免 WebView 内存泄漏？**

销毁时停加载、清空 WebViewClient/WebChromeClient、从父容器移除、`destroy()`；iOS 清 delegate、移除 ScriptMessageHandler、invalidate KVO；避免 delegate 强引用 Controller；不要在 deinit 里做异步操作。

**Q8：如何让网页 JS 调用 Flutter？**

Android 用 `addJavascriptInterface` 注入对象，iOS 用 `WKScriptMessageHandler`，原生收到消息后通过 MethodChannel 转发给 Dart。必须校验来源和消息结构，只对可信页面开放，避免把敏感能力暴露给任意网页。

**Q9：WebView 白屏怎么排查？**

按「权限 → 网络 → URL → 渲染 → 生命周期」排查：INTERNET 权限、HTTPS/ATS/cleartext、URL 是否可达、渲染模式是否为 Hybrid Composition、View 是否 attached、加载回调是否触发。用 `chrome://inspect` / Safari 看页面实际状态。

**Q10：什么时候该用 `webview_flutter`，什么时候自己写？**

业务项目优先用 `webview_flutter`；需要深度定制（登录态、离线包、支付、原生容器复用、特殊 JS 桥）且能承担双端维护成本时，自己写。自己写的核心价值是可控，不是「更轻」——WebView 本身的复杂度不会消失。

# 十三、总结

这个简易插件只有三件事，但把 PlatformView 的核心链路走通了：

1. **视图**：Dart 的 `AndroidView` / `UiKitView` 通过 `viewType` 找到原生 Factory，创建 `WebView` / `WKWebView`，由 PlatformView 负责嵌入和销毁
2. **通信**：每个 View 一个 MethodChannel，Dart 调原生执行加载/导航/JS，原生回调页面事件
3. **生命周期**：创建后由 Dart 主动加载，销毁时两边都做幂等清理，避免回调和内存泄漏

把这三件事做对，再往上加 Cookie、文件上传、下载、离线包、JS 桥，都是在这个骨架上扩展。**插件不难写，难的是边界、生命周期和平台差异。**
