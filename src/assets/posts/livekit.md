
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

| 组件 | 定位 | 解决的问题 |
| --- | --- | --- |
| LiveKit Server | 媒体服务端（SFU） | 多用户实时音视频与数据通信 |
| Agents | 可编程的后端参与者 | 把 AI 接进房间，实现实时语音交互 |
| Egress | 媒体输出 | 录制房间内容、多平台推流 |
| Ingress | 媒体输入 | 从 RTMP、WHIP、HLS、OBS 等外部源拉流 |
| 客户端 SDK | 多语言前端 SDK | 各端接入房间 |
| 服务端 SDK | 令牌生成、接口调用、Webhook | 后端集成 |
| CLI / Docker / Helm | 运维工具 | 部署、压测、本地调试 |

## 智能代理（Agents）

### 它解决什么问题

前文讲的是「怎么把一屋子人连起来」，Agents 解决的是「**怎么让一个 AI 也坐进这间屋子**」。它让一个后端程序作为参与者加入房间，接收音频、调用模型、把合成语音推回房间——也就是把 STT、LLM、TTS 三个模型，编排成一次可用的实时对话。

**为什么需要专门的编排层？** 因为"把三个模型串起来"这句话背后，藏着一堆不写代码想不到的问题：用户什么时候说完了、AI 说话时用户插话怎么办、多个房间并发时模型怎么复用、网络抖动时音频怎么补。这些都不是模型能力问题，而是**会话编排问题**——Agents 存在的价值就在这里。

### 核心概念

| 概念 | 作用 |
| --- | --- |
| `AgentServer` | 进程入口，负责生命周期与任务分发 |
| `entrypoint` | 会话入口函数，每个房间会话触发一次 |
| `prewarm` | 进程预热：把 VAD 这类重模型**按进程加载一次**，而不是每次会话都加载 |
| `Agent` | 定义这个 AI 是谁：指令、工具、能力边界 |
| `AgentSession` | 编排 STT / LLM / TTS / VAD / 轮次检测的会话对象 |
| `JobContext` | 当前会话的上下文：房间、参与者、日志字段 |

其中 **`prewarm` 是最容易被忽略、但影响最大的一个概念**。VAD 模型加载要几百毫秒到数秒，如果每个会话都重新加载，用户接进来第一句话必然卡。把它提到进程级预加载，是 LiveKit 官方快速开始里反复强调的优化。

### 语音流水线

```text
用户说话 → VAD（检测语音端点）→ STT（转文字）
        → 轮次检测（判断是否说完）→ LLM（生成回复）
        → TTS（合成语音）→ 推流回房间
```

**轮次检测（turn detection）在这里的地位被严重低估**。单纯靠静音时长判断"说完了没有"会频繁误判——用户思考时的停顿、语气词之间的间隙，都会被当成说完了。LiveKit 支持接入语义轮次检测模型，用语义判断句子是否完整，这是对话体感自然度的主要来源。

**打断（interruption）处理**同样关键：用户插话时，要立刻停止当前 TTS 播放、取消正在生成的 LLM 回复、把上下文切换回"听"。这套状态机不做好，AI 就会自说自话。

### 最小示例

```python
from livekit.agents import Agent, AgentServer, AgentSession, JobContext, JobProcess, cli
from livekit.plugins import silero

server = AgentServer()


def prewarm(proc: JobProcess):
    # 每个进程只加载一次，避免每会话重复加载造成首句卡顿
    proc.userdata["vad"] = silero.VAD.load()


server.setup_fnc = prewarm


@server.rtc_session()
async def entrypoint(ctx: JobContext):
    session = AgentSession(
        vad=ctx.proc.userdata["vad"],   # 复用预热好的 VAD
        stt=...,                        # 语音识别
        llm=...,                        # 大模型
        tts=...,                        # 语音合成
    )

    await session.start(
        room=ctx.room,
        agent=Agent(instructions="你是一个简洁、友好的中文语音助手。"),
    )
    await ctx.connect()


if __name__ == "__main__":
    cli.run_app(server)
```

**关于版本**：LiveKit Agents 的 API 演进很快，早期版本用的是 `WorkerOptions(entrypoint_fnc=..., prewarm_fnc=...)` 的写法，较新版本改成了上面这种 `AgentServer` + 装饰器的形式。**以你安装的 `livekit-agents` 版本对应的文档为准**，遇到不一致时先确认版本。

### 插件体系

模型接入是通过插件完成的，STT / LLM / TTS 三层各自独立：

| 层 | 常见接入方式 |
| --- | --- |
| STT | 各家云厂商插件、自建 ASR 服务 |
| LLM | 各家大模型插件、LangChain / LangGraph 适配器 |
| TTS | 各家云厂商插件、自建 TTS 服务 |

**对自己部署模型的团队来说，最省力的路径是"OpenAI 兼容接口"**：只要你的语音服务暴露一个 OpenAI 兼容的接口，就可以用 OpenAI 插件指向自建的 base URL，把任意一段换成自己的实现。

具体到国内开源模型（FunASR、CosyVoice 等）怎么接进来，见另一篇《国内开源语音技术全景：ASR、TTS 与端到端语音大模型》。

### 降级与自定义

两个生产环境必备的能力：

- **降级（FallbackAdapter）**：给 STT / LLM / TTS 各配一个备用提供方。主服务超时或报错时自动切换，避免"云厂商抖一下，整个语音助手不可用"。
- **自定义流程节点**：流水线的各个节点都可以覆写，用来做文本分块、发音纠正、音频后处理（变速、加效果）等定制逻辑。

### 更多形态

Agents 不只能做语音：

- **多模态**：可以处理视频帧，做视觉理解（比如用户举着摄像头问"这是什么"）
- **数字人**：结合头像驱动，让 AI 有形象
- **电话接入**：通过 SIP 接进传统电话网络，做智能客服外呼与接听
- **工具调用**：接 MCP 或自定义函数，让语音助手真的能"办事"

### 一句话总结

LiveKit 解决「连起来」，Agents 解决「让 AI 参与进来」。**模型决定上限，编排决定体感**——同样三个模型，会话编排做得好不好，用户体验差得很远。



