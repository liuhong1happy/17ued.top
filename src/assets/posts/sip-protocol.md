SIP（Session Initiation Protocol）是 IETF 在 1999 年用 RFC 2543 定稿、2002 年用 RFC 3261 重写的一套**信令协议**。它解决的问题非常具体：**在 IP 网络上建立、修改、结束一次会话**。会话可以是语音通话、视频通话、即时消息，也可以是一次会议邀请。

关于 SIP 最常见的误解，是把它当成"网络电话协议"。**SIP 本身不传语音**——语音走 RTP，SIP 只负责回答四个问题：谁找谁、用什么地址收发媒体、用什么编解码、这次会话什么时候结束。把这条分工线记住，后面所有看起来莫名其妙的现象（注册明明成功却没声音、信令全通媒体不通、挂了电话对方还在响）都能顺着它解释。

这篇文章按协议骨架 → 呼叫流程 → NAT 穿越 → 开源选型 → 互操作与安全 → 排障的顺序展开。如果你关心的是国内安防视频联网（GB/T 28181），那套协议是在 SIP 之上做的扩展，建议先读这篇建立基础，再读《GB/T 28181 国标协议详解》。

![SIP 的三层分工：信令层 SIP 负责建立与拆除会话，会话描述层 SDP 负责协商媒体，媒体层 RTP/RTCP 负责真正传输语音](/images/blog/sip-protocol/sip-stack.svg)

# 一、SIP 在 VoIP 体系里的位置

## 1.1 三层分工

一次 IP 通话被拆成三层，每层解决一个独立的问题：

| 层 | 协议 | 解决的问题 | 不解决的问题 |
| --- | --- | --- | --- |
| 信令层 | **SIP** | 找人在哪、发起/修改/结束会话、能力协商的"信封" | 媒体怎么编码、怎么传 |
| 会话描述层 | **SDP** | 用什么编解码、收发的 IP/端口是什么、方向是单向还是双向 | 怎么找到对方 |
| 媒体层 | **RTP / RTCP** | 音视频分组的封装、时间戳、序列号、丢包统计 | 会话什么时候开始、什么时候结束 |

**这三层是正交的**，所以会出现这些组合：SIP 明文 + RTP 明文（传统电话）、SIP over TLS + SRTP（安全通话）、SIP over WebSocket + DTLS-SRTP（WebRTC）、SIP + MSRP（即时消息）、SIP 只走信令而媒体走 WebRTC。

也正因为正交，**排障时必须先分层定位**：信令通不通看 SIP 报文，媒体通不通看 RTP 有没有到、包数是不是在涨。混在一起猜，是最容易浪费时间的方式。

## 1.2 SIP 的血缘：像 HTTP，但多了状态

SIP 在设计上大量借鉴 HTTP：

- **文本协议**，人类可读，抓包能直接看懂
- **请求 / 响应模型**，方法（INVITE、BYE）配响应码（200 OK、404 Not Found）
- **URL 寻址**，`sip:alice@example.com`
- **头域（Header）+ 消息体（Body）**的分离结构，消息体里塞 SDP

但有一个关键差别，也是 SIP 复杂度的全部来源：**HTTP 是无状态的，SIP 是有状态的**。

| 维度 | HTTP | SIP |
| --- | --- | --- |
| 状态 | 无状态（Cookie/Session 是外挂） | 有状态：**事务**与**对话**是协议内建概念 |
| 传输 | 基本只跑 TCP | UDP、TCP、TLS、WebSocket、SCTP 都可以 |
| 可靠性 | 靠 TCP | UDP 下**协议自己实现重传**（Timer A/E/G/H） |
| 寻址 | 直接连目标服务器 | 请求要经过任意多个**代理（Proxy）**转发 |
| 会话变更 | 每次请求独立 | 会话中途可以 re-INVITE 改媒体 |

**SIP 的坑几乎全在"状态"这两个字上**：重传、乱序、分支（forking）、ACK 与 200 OK 的关系、事务超时。把状态机搞清楚，SIP 就不再神秘。

## 1.3 与 H.323 的关系

| 维度 | SIP | H.323 |
| --- | --- | --- |
| 制定方 | IETF | ITU-T |
| 编码 | 文本 | 二进制，ASN.1 PER |
| 设计起点 | 互联网（Web 思维） | 传统电信网 |
| 复杂度 | 相对简单，扩展灵活 | 体系庞大，互通成本高 |
| 现状 | VoIP、IMS、WebRTC 网关的主流 | 存量视频会议系统 |

今天新做的系统基本不会选 H.323。但在企业视频会议里你会遇到它——SIP/H.323 双模终端和网关（如 Cisco、Polycom 的设备）仍然常见。

另外要区分的一族是 **MGCP / Megaco（H.248）**：它们不是端到端信令，而是**主从式的媒体网关控制协议**，由软交换机控制一个"哑"的媒体网关。运营商网络里大量存在，但那是网关内部控制面的问题，跟终端接入不是一回事。

# 二、协议骨架

## 2.1 消息结构

SIP 消息分请求和响应两类，结构都是：**起始行 + 头域 + 空行 + 消息体**。

请求的起始行是"方法 URI 版本"，响应的起始行是"版本 响应码 原因短语"。

下面是一条真实的 INVITE 请求（为了可读性省略了部分头域）：

```
INVITE sip:bob@biloxi.example.com SIP/2.0
Via: SIP/2.0/UDP pc33.atlanta.example.com;branch=z9hG4bK776asdhds
Max-Forwards: 70
To: Bob <sip:bob@biloxi.example.com>
From: Alice <sip:alice@atlanta.example.com>;tag=1928301774
Call-ID: a84b4c76e66710
CSeq: 314159 INVITE
Contact: <sip:alice@pc33.atlanta.example.com>
Content-Type: application/sdp
Content-Length: 142

v=0
o=alice 2890844526 2890844526 IN IP4 pc33.atlanta.example.com
s=Session SDP
c=IN IP4 pc33.atlanta.example.com
t=0 0
m=audio 49172 RTP/AVP 0 8 101
a=rtpmap:0 PCMU/8000
a=rtpmap:8 PCMA/8000
a=rtpmap:101 telephone-event/8000
```

对应的响应：

```
SIP/2.0 200 OK
Via: SIP/2.0/UDP pc33.atlanta.example.com;branch=z9hG4bK776asdhds;received=192.0.2.1
To: Bob <sip:bob@biloxi.example.com>;tag=a6c85cf
From: Alice <sip:alice@atlanta.example.com>;tag=1928301774
Call-ID: a84b4c76e66710
CSeq: 314159 INVITE
Contact: <sip:bob@192.0.2.4>
Content-Type: application/sdp
Content-Length: 131
```

## 2.2 关键头域

| 头域 | 作用 | 容易踩的坑 |
| --- | --- | --- |
| **Via** | 记录请求走过的路径，也决定**响应原路返回** | `branch` 参数必须以 magic cookie `z9hG4bK` 开头，且**每个事务唯一**；不唯一会导致响应串线 |
| **From / To** | 逻辑上的发起方与接收方，**不随转发改变** | `To` 在请求里没有 tag，在响应里由 UAS 打上 tag——这就是"对话"的起点 |
| **Call-ID** | 标识一次呼叫（对话） | 同一对话内所有请求共用；分叉（forking）时多个分支共用一个 Call-ID |
| **CSeq** | 命令序列号，含序号 + 方法名 | **同一对话内必须严格递增**，乱序会被判为非法请求 |
| **Contact** | 直接可达的地址（真实 IP:端口） | NAT 环境下这里是私网地址，是"没声音"的第一嫌疑 |
| **Max-Forwards** | 跳数限制，防止环路 | 缺省 70，代理转发时减 1，减到 0 返回 483 |
| **Route / Record-Route** | 强制路由，让后续请求继续经过代理 | 处理不当会让 BYE 绕过代理，造成"话单丢一半" |
| **Authorization / WWW-Authenticate** | 摘要认证的挑战与应答 | 密码不能明文存储，必须存 HA1 |
| **Content-Type** | 消息体类型，通常是 `application/sdp` | 与 Content-Length 不一致会被直接丢弃 |

## 2.3 方法与扩展

RFC 3261 定义了 6 个基础方法，其余都是扩展：

| 方法 | 作用 | 备注 |
| --- | --- | --- |
| **INVITE** | 发起会话 | 唯一有"三次握手"（INVITE → 1xx → 200 → ACK）的请求 |
| **ACK** | 确认最终响应 | **仅对 INVITE 事务存在**，不是独立事务 |
| **BYE** | 结束已建立的会话 | 只能在已确认的对话里发 |
| **CANCEL** | 取消尚未完成的 INVITE | 只能取消还没收到最终响应的请求 |
| **REGISTER** | 注册位置信息 | 把 AOR（`sip:alice@example.com`）绑定到 Contact |
| **OPTIONS** | 能力查询 / 保活 | ping 对方是否在线，也常被用来做链路检测 |

常用扩展：

| 扩展 | RFC | 用途 |
| --- | --- | --- |
| INFO | 6086 | 会话中期带内信息（DTMF、GB28181 的云台控制） |
| UPDATE | 3311 | 在最终响应前修改会话参数，比 re-INVITE 轻 |
| PRACK | 3262 | 对 1xx 可靠响应（100rel）做确认，保证振铃音可靠 |
| REFER | 3515 | 呼叫转接（盲转 / 咨询转） |
| SUBSCRIBE / NOTIFY | 6665 | 事件订阅，如"在线状态""话机消息指示灯" |
| MESSAGE | 3428 | 即时消息（SIP 版短消息） |
| PUBLISH | 3903 | 发布自身状态 |

**`Allow` 和 `Supported` 头域必须看**：它们声明了对端支持哪些方法和扩展。企业网关（尤其是国产话机和 SBC）对扩展的支持差异很大，很多"某个功能在 A 家能用、B 家不能用"的问题，答案都在这两个头域里。

## 2.4 响应码

| 分类 | 含义 | 谁发 | 常见码 |
| --- | --- | --- | --- |
| **1xx** | 临时响应，呼叫还在进行 | UAS / 代理 | 100 Trying、180 Ringing、183 Session Progress |
| **2xx** | 成功 | UAS | 200 OK、202 Accepted |
| **3xx** | 重定向 | 代理 / UAS | 301 Moved Permanently、302 Moved Temporarily |
| **4xx** | 客户端错误（**实际排障遇到最多的区间**） | UAS / 代理 | 400、401、403、404、407、408、480、481、486、487、488 |
| **5xx** | 服务端错误 | 代理 / UAS | 500、503、504 |
| **6xx** | 全局失败 | UAS | 600 Busy Everywhere、603 Decline、604 Does Not Exist Anywhere |

4xx 里几个必须能一眼分清的：

| 响应码 | 含义 | 典型原因 |
| --- | --- | --- |
| **401** / **407** | 需要用户 / 代理认证 | 正常的挑战-应答第一步，不是错误 |
| **403** | Forbidden | 号码策略拒绝、被风控拉黑 |
| **404** | Not Found | 号码没注册、路由表查不到 |
| **408** | Request Timeout | 请求超时，链路不通或对端不回 |
| **480** | Temporarily Unavailable | 对端在线但拒绝（不在服务时间、无可用终端） |
| **481** | Call/Transaction Does Not Exist | **对话/事务状态丢了**，常见于代理重启、ACK 没收到 |
| **486** | Busy Here | 占线。**注意它是对"最终响应"的回复**，与 CANCEL 无关 |
| **487** | Request Terminated | 呼叫被 CANCEL 或被更早的请求终止 |
| **488** | Not Acceptable Here | SDP 协商失败——**没有共同编解码**，或媒体地址不可接受 |

## 2.5 事务与对话：SIP 的难点都在这里

这是 SIP 与 HTTP 最大的区别，也是所有细节问题的根源。

| 概念 | 定义 | 生命周期 | 用哪些字段标识 |
| --- | --- | --- | --- |
| **事务（Transaction）** | 一次请求及其所有响应（+ ACK） | 请求发出到事务终止 | Via 的 `branch` + CSeq 方法 |
| **对话（Dialog）** | 两个 UA 之间的一段会话关系 | INVITE 的 1xx/2xx 到 BYE | Call-ID + 本地 tag + 远端 tag |

两者是嵌套关系：**一个对话里可能包含多个事务**（INVITE、re-INVITE、BYE 各是一个事务；CANCEL 属于原 INVITE 事务，不是新事务）。

几个必须记住的机制：

**（1）INVITE 事务是三次握手，非 INVITE 事务是两次。** INVITE 的最终响应（2xx 或 3xx-6xx）需要 ACK 确认。2xx 的 ACK **由 UAC 新起一个事务发送**（走对话内路由）；非 2xx 的 ACK **由事务层自动发送**（同一个事务内，路由同请求）。这个差异让 2xx 的 ACK 可能丢失，于是 UAS 收到重复 INVITE 时要重发 200 OK——**这不是 bug，是协议规定的幂等补偿**。

**（2）UDP 下的重传全靠定时器。** T1 缺省 500ms，重传间隔指数退避（T1、2×T1、4×T1……）。INVITE 事务总超时 Timer B = 64×T1 = **32 秒**；非 INVITE 事务 Timer F 同理。收到临时响应后进入 Timer H（也是 64×T1）。**所以"呼叫卡住 32 秒后失败"基本就是事务超时**，而不是网络完全不通。

**（3）分叉（Forking）会产生多个早期对话。** 一个 AOR 在多个终端注册（手机、桌面话机同时在线）时，代理会把 INVITE 分叉给所有终端，谁先接听谁赢。这意味着你**会看到同一个 Call-ID 有多组 tag，收到多个 200 OK，未获胜的分支收到 CANCEL/487**。这不是异常。

**（4）481 的本质是状态不一致。** 收到 481，说明对端找不到对应的事务或对话。典型场景：代理重启丢失状态、ACK 丢失导致 UAS 提前清了事务、INVITE 过期后对话被回收。

## 2.6 SDP：媒体协商就藏在这里

SDP（RFC 8866，早期 RFC 4566）是一段结构化文本，SIP 用它做媒体协商。关键行：

| 行 | 含义 | 例子 |
| --- | --- | --- |
| `v=` | 版本，固定 0 | `v=0` |
| `o=` | 会话发起者与版本号 | `o=alice 2890844526 2890844526 IN IP4 ...` |
| `c=` | **连接地址（媒体收发 IP）** | `c=IN IP4 192.168.1.100` |
| `t=` | 会话时间 | `t=0 0` |
| `m=` | **媒体行：类型 端口 协议 载荷类型列表** | `m=audio 49172 RTP/AVP 0 8 101` |
| `a=rtpmap` | 载荷类型到编解码的映射 | `a=rtpmap:0 PCMU/8000` |
| `a=fmtp` | 编解码的参数 | `a=fmtp:101 0-15` |
| `a=sendrecv` / `sendonly` / `recvonly` / `inactive` | 媒体方向，**hold 就是靠这个实现的** | `a=sendonly` |
| `a=rtcp-mux` | RTP 与 RTCP 复用同端口 | WebRTC 强制要求 |

协商用的是 **offer/answer 模型（RFC 3264）**：主叫在 INVITE 里给出 offer（我能用什么），被叫在 200 OK 里给出 answer（我选哪个）。answer 里的载荷类型**必须与 offer 中的列表对应**，不能引入 offer 里没有的编解码。

`m=` 行里的载荷类型（PCMU=0、PCMA=8、G.722=9、G.729=18、telephone-event=101）是静态分配或动态协商的，常用值：

| 编解码 | 载荷类型 | 带宽 | 场景 |
| --- | --- | --- | --- |
| G.711 PCMU / PCMA | 0 / 8 | 64 kbps | 电话网标准，互通性最好 |
| G.722 | 9 | 48–64 kbps | 宽频语音 |
| G.729 | 18 | 8 kbps | 窄带压缩，老设备常见 |
| Opus | 动态（常 111） | 6–510 kbps | WebRTC / 现代终端首选 |
| telephone-event | 101（常） | — | **DTMF 按键**，走 RTP 而不是带内音频 |

**DTMF 是"按了键对方没反应"这类问题的根源**：RFC 2833/4733 的 telephone-event 是带外方式，如果一方只支持 INFO（SIP INFO 方式的 DTMF）而另一方只发 RTP 事件，按键就丢了。协商时要显式确认这一点。

# 三、一次完整呼叫的信令流程

![一次典型呼叫的完整信令时序：注册与认证、INVITE 三次握手建立会话、RTP 媒体双向传输、BYE 拆除会话](/images/blog/sip-protocol/sip-call-flow.svg)

## 3.1 注册：让地址找得到人

`sip:alice@example.com` 是**逻辑地址（AOR）**，它本身不可达。注册做的事就是把这个逻辑地址绑定到一个**实际可路由的 Contact** 上。

第一次注册会经历认证挑战：

```
UA  → REGISTER sip:example.com            （无认证信息）
UA  ← 401 Unauthorized  WWW-Authenticate: Digest realm="example.com", nonce="..."
UA  → REGISTER ... Authorization: Digest username="alice", response="..."
UA  ← 200 OK            （注册成功，带上 Date 和 Contact 的 Expires）
```

摘要认证的要点：

- **服务端不应该存明文密码**，而应存 `HA1 = MD5(username:realm:password)`，用它参与后续校验
- `nonce` 必须一次性或带时间窗，否则可被重放
- `qop=auth` 启用后会有 `cnonce` 和 `nc`，安全性更好
- **刷新注册是 UAC 的责任**：Expires 到期前必须重新 REGISTER，否则位置绑定被清除，来电直接 404

Expires 怎么定？这是 NAT 环境下的实际取舍：

| 场景 | 建议 Expires | 原因 |
| --- | --- | --- |
| 公网直连终端 | 3600s | 减少信令量 |
| 终端在 NAT 后 | 60–120s | NAT 映射超时极短（常见 30–120s），长周期会让映射失效后"假装在线" |
| 移动网络 / 弱网 | 30–60s | 更快感知掉线 |

**"设备显示在线，但一打电话就 408"**，九成是 Expires 太长而 NAT 映射已经失效。

## 3.2 INVITE 建立通话

标准流程（主叫 UAC → 代理 → 被叫 UAS）：

| 步骤 | 报文 | 说明 |
| --- | --- | --- |
| 1 | `INVITE`（带 SDP offer） | 主叫发起，携带自己的媒体能力与地址 |
| 2 | `100 Trying` | 代理确认收到，**抑制主叫重传**，非端到端 |
| 3 | `180 Ringing` | 被叫开始振铃，主叫播放回铃音 |
| 4 | `183 Session Progress`（可选） | 需要早期媒体（彩铃、IVR 语音）时使用，通常要求 100rel（PRACK）保证可靠 |
| 5 | `200 OK`（带 SDP answer） | 被叫接听，**打上 To tag，对话在此确立** |
| 6 | `ACK` | 主叫确认。**2xx 的 ACK 是新事务**，走对话内路由 |
| 7 | 双向 RTP | 媒体开始（其实从 183 起早期媒体就可能已经跑了） |
| 8 | `BYE` | 任一方挂断 |
| 9 | `200 OK` | 对方确认，对话结束 |

几个容易搞错的点：

- **媒体不一定等到 200 OK 才开始**。有早期媒体（183 + SDP）时，被叫的语音在振铃阶段就已经在传了。这也是"彩铃"的实现方式。
- **SDP 的方向性决定谁能先说话**。IVR 场景常把被叫的 answer 设成 `sendrecv` 而主叫侧限制，如果方向设置错了，会出现"能听见但对方听不见"（单通）。
- **ACK 必须走对话内路由（Route 集合）**。如果 Record-Route 没被正确处理，ACK 会绕过代理直连，而在 NAT 环境下直连必然失败——表现为"振铃正常，一接就断"，因为被叫收不到 ACK，会按协议重传 200 OK 直到超时。

## 3.3 CANCEL 与 BYE：别搞混

这是新手最容易混淆的一对：

| | CANCEL | BYE |
| --- | --- | --- |
| 作用对象 | **尚未最终响应的 INVITE 事务** | **已建立的对话** |
| 发送时机 | 收到 1xx 之后、最终响应之前 | 200 OK + ACK 之后 |
| 收到方响应 | 200 OK（对 CANCEL 本身）+ 487（对被取消的 INVITE） | 200 OK |
| 之后还要 ACK 吗 | **要**，对 487 必须回 ACK | 不用（BYE 是非 INVITE 事务） |

流程上是：主叫发 `CANCEL` → 被叫回 `200 OK`（确认收到 CANCEL）→ 被叫对原 INVITE 回 `487 Request Terminated` → 主叫回 `ACK`。**少任何一个环节，事务都不会干净地结束**，会在设备上留下僵尸会话。

还有一个边界：**CANCEL 无法取消已经被 200 OK 应答的呼叫**。哪怕只差一毫秒，也只能发 BYE。这一点在自动外呼系统里很重要——"用户已经接了但我们想挂断"，唯一手段是 BYE。

## 3.4 会话中途的变更

- **re-INVITE**：改变媒体参数（加视频、换编解码、切换 hold）。它会在已有对话里新建一个 INVITE 事务，同样需要 ACK。**注意 re-INVITE 有竞态问题**（双方同时发），所以现代实现优先用 UPDATE。
- **UPDATE（RFC 3311）**：在最终响应之前修改会话参数，比 re-INVITE 轻量，没有 ACK 握手的开销，也不会建立新事务。
- **PRACK（RFC 3262）**：对可靠的 1xx（100rel）做确认。启用 100rel 后，UAS 发的 183 需要 UAC 回 PRACK，否则 UAS 要重传——这是"彩铃放一半突然断"的常见原因。
- **Hold**：把 SDP 方向改成 `a=sendonly`（我发不收）或 `a=inactive`（互不收发）。这里有个经典错误：**用 `c=0.0.0.0` 表示 hold 是老写法，与现代的 `a=inactive` 混用会造成互通问题**。
- **转接**：用 REFER（RFC 3515），被转方收到 `Refer-To` 后自己发起新的 INVITE。盲转与咨询转的区别就在于是否先建立咨询通话。

# 四、NAT 与穿透：SIP 落地的第一道坎

## 4.1 问题从哪来

SIP 出现在 NAT 普及之前，协议里到处假设"我在报文里写的地址，对方能直接连上"。这在 NAT 下全都不成立：

| 问题 | 具体表现 |
| --- | --- |
| **Contact 不可达** | 终端把自己内网地址 `192.168.1.100` 写进 Contact，对端按这个地址发请求必然失败 |
| **SDP 里的媒体地址不可达** | `c=IN IP4 192.168.1.100` + 内网端口，媒体流发过去直接丢 |
| **NAT 映射未建立** | RTP 是 UDP 无连接，NAT 只允许"先出后进"。如果内网不先发包，外部来的 RTP 会被丢弃 |
| **端口映射不稳定** | 有些 NAT 为每个目标分配不同端口（对称 NAT），靠猜端口无法工作 |
| **映射超时** | 映射默认 30–120 秒就回收，长通话中途静音，注册也失效 |

## 4.2 逐层解法

| 手段 | RFC | 解决的问题 | 局限 |
| --- | --- | --- | --- |
| **rport** | 3581 | 让响应按**实际来源 IP/端口**回送，而不是 Via 里写的地址 | 只解决信令，不解决媒体 |
| **comedia（对称 RTP）** | — | 媒体发回"包从哪来"，不依赖 SDP 里的地址 | 要求终端主动先发，对某些设备不适用 |
| **STUN** | 5389 | 让终端**自己发现**在 NAT 后的公网映射 | 对称 NAT 下无效 |
| **TURN** | 5766 | 中继媒体，任何 NAT 都能过 | 增加延迟与带宽成本 |
| **ICE** | 5245 / 8445 | 枚举所有候选地址并连通性检查，择优 | WebRTC 标配，传统 SIP 支持有限 |
| **媒体代理 / rtpengine** | — | 由服务器中继并修正 SDP 中的媒体地址 | 带宽成本，需部署在媒体路径上 |
| **SBC** | 5853 | 综合以上，做信令与媒体的边界网关 | 成本与运维复杂度 |

**现实中的组合**：终端侧尽量用 rport + comedia（零成本，覆盖大部分场景）；跨网段、跨运营商、对接运营商 IMS 时，在边界上放 SBC 或 rtpengine 做媒体锚定。

## 4.3 为什么 SBC 绕不开

会话边界控制器（SBC）看起来只是"多加一台设备"，但它在真实网络里承担了四件事：

1. **NAT 穿越与媒体锚定**：把 SDP 改写为 SBC 自己的地址，媒体从 SBC 中转
2. **拓扑隐藏与安全**：内网地址不外泄，抵御扫描、畸形包、注册爆破
3. **协议修复与互通**：修正不合规的 SDP、编解码转换（G.729 ↔ Opus）、SIP 与 H.323 互转
4. **策略与计费**：路由策略、限呼、号码规整、话单

**判断标准很简单：如果你的 SIP 网络要和你不控制的网络对接（运营商、客户、第三方平台），就需要 SBC。** 纯内网、单点对接的场景，能省。

# 五、开源实现与选型

## 5.1 先分清代理与 B2BUA

这是 SIP 选型的**第一道分水岭**，比"哪个性能好"重要得多：

| | 代理（Proxy） | B2BUA（背靠背用户代理） |
| --- | --- | --- |
| 对会话的作用 | 只转发信令，**不终结会话** | **终结会话**，两侧各建一个独立对话 |
| 是否接触媒体 | 默认不接触 | 通常控制媒体 |
| 状态 | 只维护事务和对话状态 | 维护完整会话状态 |
| 代表 | Kamailio、OpenSIPS | FreeSWITCH、Asterisk |
| 优势 | 极高吞吐、低延迟、几乎无媒体成本 | 能做 IVR、录音、转码、会议、队列 |
| 劣势 | 做不了业务逻辑（要配脚本/模块） | 单机容量远低于代理，媒体带宽是瓶颈 |

**最常见的生产架构是两者组合**：Kamailio/OpenSIPS 做接入层（注册、鉴权、限流、路由、负载均衡），FreeSWITCH 集群在后面做业务与媒体。这样接入层能扛几十万注册和每秒数千并发，业务层按需扩容。

## 5.2 组件清单

| 项目 | 类型 | 语言 | 协议 | 定位 |
| --- | --- | --- | --- | --- |
| **Kamailio** | 代理 / 注册服务器 | C | GPLv2 | 运营商级接入层，脚本（cfg）驱动，模块生态最丰富 |
| **OpenSIPS** | 代理 / 注册服务器 | C | GPLv2 | 与 Kamailio 同源分叉，偏 B2BUA 与路由脚本能力 |
| **FreeSWITCH** | 软交换 / B2BUA | C | MPL 1.1 | 会议、IVR、录音、编解码转码、呼叫中心；`mod_sofia` 是 SIP 栈 |
| **Asterisk** | PBX / B2BUA | C | GPLv2 | 企业 PBX 与 IVR 事实标准，`chan_pjsip` 是新的 SIP 栈 |
| **PJSIP / pjproject** | SIP 协议栈库 | C | GPLv2 / 商业双许可 | 被大量终端和网关嵌入，也是 Asterisk 的协议栈 |
| **baresip** | SIP 客户端库 | C | BSD-3 | 轻量终端，适合嵌入设备 |
| **liblinphone / Linphone** | SIP 客户端 | C / 多端 | GPLv3 | 带完整 SDK，做音视频终端的最省事选择 |
| **Jitsi** | 会议 / 客户端 | Java | Apache-2.0 | 视频会议，含 SIP 网关（Jigasi） |
| **SIPp** | 压测 / 场景生成 | C++ | GPLv2 | 写 XML 场景做呼叫压测和回归测试 |
| **sngrep** | 抓包分析 | C | GPLv3 | **终端里的 SIP 版 tcpdump**，按对话聚合看信令流 |
| **rtpengine / RTPProxy** | 媒体中继 | C | GPLv3 / BSD | 配合 Kamailio 做 NAT 穿越与媒体处理 |

## 5.3 三种典型组合

**（1）中小规模 PBX**：Asterisk 或 FreeSWITCH 单机。几十到几百并发，配置简单，`extensions.conf` / `dialplan` 就能跑起来。

**（2）呼叫中心 / 大规模接入**：Kamailio（接入、鉴权、路由、限流）+ FreeSWITCH 集群（IVR、排队、录音、坐席）+ rtpengine（媒体中继）。接入层无状态化后可以横向扩展。

**（3）运营商 / IMS 对接**：SBC（商业设备居多）+ Kamailio 做路由。这里合规、计费、录音、信令跟踪的要求远高于技术指标。

# 六、WebRTC 与 SIP 的互通

浏览器里的 WebRTC 和传统 SIP 终端**不能直接通话**，原因是三处硬性差异：

| 维度 | 传统 SIP | WebRTC |
| --- | --- | --- |
| 信令传输 | UDP / TCP | **必须** WebSocket（RFC 7118，SIP over WebSocket） |
| 媒体加密 | RTP 明文，SRTP 可选 | **强制** DTLS-SRTP（RFC 5763/5764） |
| 地址协商 | SDP 里写 IP:端口 | ICE + STUN/TURN，SDP 里是候选地址与 ufrag/pwd |
| 复用 | RTP/RTCP 分端口 | 强制 `rtcp-mux`，常配 BUNDLE |
| 指纹 | 无 | `a=fingerprint` 做 DTLS 证书校验 |

因此互通需要网关来做三件事：**信令协议转换**（WebSocket ↔ UDP/TCP）、**媒体加密转换**（DTLS-SRTP ↔ RTP/SRTP）、**地址重写**（ICE 候选 ↔ 固定地址）。

常见做法：

- **FreeSWITCH + `mod_verto` 或 `mod_sofia` 的 WebSocket 支持**：浏览器通过 SIP over WebSocket 直接注册到 FreeSWITCH，由它做媒体转换
- **Kamailio + rtpengine**：信令走 Kamailio，媒体由 rtpengine 做 ICE 终止与加密转换
- **Janus / mediasoup 做网关**：它们原生支持 WebRTC，通过插件对接 SIP（Janus 的 SIP 插件）
- **前端库**：JsSIP、SIP.js（SIP over WebSocket），配合后端网关

**一个容易被忽略的坑**：浏览器 WebSocket 只能连 `wss://`（HTTPS 页面下），所以 SIP 接入层必须配置有效的 TLS 证书，自签证书会被浏览器拒绝。

# 七、安全

SIP 的安全问题分两个层面：**协议自身的设计缺陷**，以及**部署不当带来的风险**。

| 风险 | 说明 | 防护 |
| --- | --- | --- |
| **信令窃听 / 篡改** | SIP 明文可被读取和修改 | SIP over TLS（`sips:`，RFC 5630） |
| **媒体窃听** | RTP 明文可被还原成语音 | SRTP（RFC 3711）+ 密钥协商（SDES 或 DTLS） |
| **注册劫持** | 攻击者冒充合法终端注册，窃取来电 | 强认证 + TLS + 源 IP 白名单 |
| **话费欺诈（Toll Fraud）** | 暴力猜密码后打国际长途，单日损失可达数万 | 强密码、失败锁定、号码白名单、余额上限、异常呼叫告警 |
| **扫描与爆破** | 大量 OPTIONS/REGISTER 探测 | fail2ban、限速、隐藏版本信息、非标准端口 |
| **信令放大攻击** | 伪造源地址，用响应放大流量 | 禁用 UDP 反射面，或强制认证后再响应 |

**最重要的一条实践是：摘要认证的密码必须存 HA1，而不是明文。** 一旦数据库泄露，明文密码会直接导致话费欺诈。同时 `realm` 不要用默认值，`nonce` 必须有时间窗。

对于 WebRTC 部分，还额外需要注意：DTLS 证书指纹校验、ICE 候选地址不要泄露内网拓扑（用 TURN 中继时尤其）、媒体权限的用户可见性。

# 八、排障

## 8.1 抓包是第一手段

排 SIP 问题，**先抓包，再猜**。工具链：

| 工具 | 用途 |
| --- | --- |
| **sngrep** | 终端里按对话聚合展示 SIP 报文，能直接看出信令流程断在哪一步，还带 RTP 统计 |
| **tcpdump** | `tcpdump -i any -n -s0 -w sip.pcap port 5060 or portrange 10000-20000` |
| **Wireshark** | Telephony → VoIP Calls 能重建完整呼叫流程与 RTP 质量分析（抖动、丢包、MOS） |
| **SIPp** | 构造可复现的场景，压测与回归 |

**注意 RTP 抓包位置**：在终端侧抓和在服务器侧抓，看到的媒体地址完全不同。判断"媒体到底有没有到"必须在服务器侧抓。

## 8.2 症状 → 病因对照表

| 症状 | 最可能的原因 |
| --- | --- |
| 注册成功，一打电话 408 / 无响应 | 注册的 Expires 太长，NAT 映射已失效；或防火墙只放行了 5060 未放行媒体端口 |
| 能接通，但双方都听不到声音 | SDP 里是私网地址；媒体端口未放行；编解码无交集 |
| 只有一方能听见（单通） | 媒体方向（`a=sendonly`/`inactive`）配错；或只放行了单向 UDP |
| 振铃正常，对方一接就断 | ACK 没送达（Record-Route 处理错误、NAT 阻挡），UAS 重传 200 OK 至超时 |
| 通话约 30 秒后自动挂断 | 事务超时（Timer B/H = 32 秒）；或媒体超时静音检测 |
| 通话约 30–120 秒后单方静音 | NAT 映射超时回收，中途没有保活包 |
| 呼叫卡在"正在连接"然后 480 | 对端在线但策略拒绝（工作时段、呼叫限制） |
| 挂断后设备显示仍占用 | CANCEL/BYE 事务未正确终结，缺 487 或 ACK |
| 按键无反应 | DTMF 方式不匹配（RTP telephone-event vs SIP INFO） |
| 随机出现 481 | 状态丢失：代理重启、ACK 丢失、对话被提前回收 |

## 8.3 一个实用的排查顺序

1. **确认注册状态**：`sip:user@domain` 是否绑定在预期 Contact 上，Expires 是否在正常刷新
2. **看信令是否走完**：用 sngrep 看 INVITE 到 200 OK 到 ACK 是否完整，断在哪一步
3. **看响应码**：4xx 里 403/404/480 是策略问题，408/481 是网络或状态问题，488 是 SDP 问题
4. **看媒体**：RTP 有没有到、包数是否在涨、方向是否双向
5. **看 SDP**：`c=` 行地址是否可达，`m=` 行端口是否与防火墙放行一致，编解码是否有交集

**这个顺序的价值在于每一步都能排除一大类原因**，比直接翻日志找关键字高效得多。

---

SIP 学到最后会发现，**真正难的不是记住有哪些方法和响应码，而是理解它的状态机如何在不可靠的网络上维持一致性**：事务如何重传、对话如何标识、ACK 与 200 OK 为什么必须配对、NAT 如何把"报文里写的地址"这个天真假设打破。

把这条主线抓住，再看 GB/T 28181 这类基于 SIP 的行业扩展，就会很轻松——它们做的事情，无非是在 SIP 的信封里塞进自己的 XML 消息体。下一篇就讲这个。
