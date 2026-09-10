
LiveKit 是一款开源项目，基于 WebRTC 提供可扩展的多用户会议能力，能够为你的应用搭建实时音视频、数据通信能力提供所需的全套能力。

LiveKit 服务端基于 Go 语言开发，采用了优秀的 [Pion WebRTC](https://github.com/pion/webrtc) 实现方案。

⭐GitHub 星标数 16000\+｜Slack 社区成员 10000\+加入社区｜关注 @livekit｜技术问答 DeepWiki｜最新版本 v1\.9\.9｜构建验证通过｜开源协议：Apache\-2\.0

## 核心特性

- 可扩展的分布式 WebRTC 选择性转发单元（SFU）

- 现代化、功能完善的客户端 SDK

- 面向生产环境打造，支持 JWT 身份认证

- 稳定的网络连接能力，兼容 UDP/TCP/TURN 协议

- 部署便捷：单二进制文件、Docker 容器或 Kubernetes 集群均可部署

- 丰富的高级功能：说话人检测、分层编码、端到端优化、选择性订阅、审核接口、端到端加密、SVC 编解码器（VP9、AV1）、网络钩子、分布式多区域部署

## 文档与指南

[https://docs\.livekit\.io](https://docs.livekit.io)

## 在线演示

- LiveKit 会议（附源码）

- 空间音频（附源码）

- 基于 OBS 工作室的直播推流（附源码）

- 基于 ChatGPT 的 AI 语音助手（附源码）

## 生态体系

### 核心组件

- 智能代理（Agents）：通过可编程的后端参与者，构建实时多模态 AI 应用

- 媒体输出（Egress）：录制房间内容、多平台推流，支持单独导出音视频轨道

- 媒体输入（Ingress）：支持从 RTMP、WHIP、HLS、OBS 工作室等外部源拉流

### 开发工具与 SDK

#### 客户端 SDK

客户端 SDK 可让前端实现交互式多用户体验，各语言支持如下：

表格

#### 服务端 SDK

服务端 SDK 支持后端生成访问令牌、调用服务端接口、接收网络钩子；其中 Go 语言 SDK 还包含客户端能力，可开发模拟终端用户行为的自动化程序。

表格

### 配套工具

- 命令行工具（CLI）：提供命令行交互能力，支持压力测试

- Docker 镜像

- Helm 图表

## 安装方法

💡 建议将 LiveKit 命令行工具与服务端一同安装，可用于调用服务端接口、生成令牌、生成测试流量。

以下为 LiveKit 媒体服务端的安装步骤：

### 苹果系统（MacOS）

bash

运行

```Plain Text
brew install livekit
```

### Linux 系统

bash

运行

```Plain Text
curl -sSL https://get.livekit.io | bash
```

### 视窗系统（Windows）

从[最新版本页面](https://github.com/livekit/livekit/releases)下载安装包

## 快速开始

### 启动 LiveKit 服务

执行以下命令以开发模式启动 LiveKit，将使用默认的 API 密钥 / 密钥对：

bash

运行

```Plain Text
livekit-server --dev
```

默认密钥信息：API 密钥：devkeyAPI 密钥密码：secret

若需为生产环境自定义配置，请参考[部署文档](https://docs.livekit.io/deploy/)

### 生成访问令牌

用户连接 LiveKit 房间时需携带访问令牌，该令牌（JWT 格式）会对用户身份及房间操作权限进行加密编码。可通过命令行工具生成令牌：

bash

运行

```Plain Text
lk token create \
    --api-key devkey --api-secret secret \--join --room my-first-room --identity user1 \
    --valid-for 24h
```

### 基于示例应用测试

打开[官方示例应用](https://example.livekit.io/)，输入生成的令牌即可连接到本地 LiveKit 服务端。该示例应用基于 LiveKit React SDK 开发。

成功连接后，你的音视频将推流至新建的 LiveKit 实例中！

### 模拟测试推流端

执行以下命令，向指定房间推送循环演示视频流：

bash

运行

```Plain Text
lk room join \--url ws://localhost:7880 \
    --api-key devkey --api-secret secret \--identity bot-user1 \
    --publish-demo \
    my-first-room
```

**说明**：由于演示视频的编码特性（每 3 秒一个关键帧），浏览器需要一定时间获取足够数据后才能开始渲染画面，此为测试模拟的正常现象，非服务端问题。

## 部署方式

### 采用 LiveKit 云服务

LiveKit Cloud 是运行 LiveKit 最快捷、最可靠的方式，所有项目均享有每月免费的带宽和转码额度，步骤如下：前往 LiveKit Cloud 完成注册即可使用。

### 自建部署

更多细节请参考[官方部署文档](https://docs.livekit.io/deploy/)。

### 从源码构建

#### 前置条件

1. 已安装 Go 1\.23 及以上版本

2. GOPATH/bin 已配置到系统环境变量 PATH 中

#### 构建步骤

bash

运行

```Plain Text
git clone https://github.com/livekit/livekit
cd livekit
./bootstrap.sh
mage
```

## 贡献指南

我们欢迎所有开发者为 LiveKit 的优化贡献力量！如需提交想法或代码 PR，建议先到 Slack 社区进行讨论。

## 开源协议

LiveKit 服务端基于 **Apache License v2\.0** 协议开源。

## LiveKit 完整生态一览

表格



