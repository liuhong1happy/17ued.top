### 一、在线协作算法

#### 1、背景

协同编辑是指多个用户能够同时在一个共享文档中进行编辑，并且所有更改能够实时或近实时地反映到每个用户的界面上，于是就引出了`OT 和 CRDT`这类专门用于**处理协同文档**的方案。

#### 2、OT算法

（1）含义

OT 算法全称为 **Operational Transformation**，直接翻译就是**操作转换**，即包含两个过程**操作** \& **转换**。

（2）发展史

![OT 发展史](/images/blog/collaborative-editing-wopi/image-2.png)

> 开源方案
> 
> Quill —— 富文本编辑器（含数据模型）  
> 
> ShareDB —— 后端协同服务框架              
> 
> 

（3）概述

它通过**操作转换**来实现数据的一致性，在 OT 算法中，每个用户对数据的操作视为一个可转换的“操作指令”，都被记录下来，当本地和远程产生并发操作时，通过一个“转换函数”调整远程操作的参数，使其与本地已应用的操作兼容，转换完成后，通过网络发送到对应客户端，客户端合并操作，从而得到一致结果。

**1\.捕获操作（插入、更新、删除）——\>2\.入队操作队列——\>3\.冲突的检测和转换——\>4\.同步数据给其他客户端**

（4）核心原理

①基本概念

- 操作（Operation）：用户对文档的修改动作（插入、删除、更新）

- 转换函数（Transformation Function）：解决操作冲突的核心逻辑，本地与外部操作合并

- 操作队列（Operation History）：使用一个操作队列来存储未提交的操作

② 核心思想图解   典型的 **C\-S\-C（Client\-Server\-Client）模型**

![OT C-S-C 模型图解](/images/blog/collaborative-editing-wopi/image-1.png)

---

当多个用户同时编辑同一文档时，冲突是不可避免的，此时就需要OT算法来协调这些操作。

③代码示例

```TypeScript
TextOperation.transform = function (clientOp, serverOp) {
  // 最终要返回的两个新操作
  var op1 = clientOp.clone();
  var op2 = serverOp.clone();

  // 遍历别人的操作（serverOp）
  // 自动调整 clientOp 的位置
  for (var i = 0; i < op2.ops.length; i++) {
    var step = op2.ops[i];

    if (step.insert) {
      // 别人插入了文字 → 你的操作位置往后移
      op1.moveInsertPositionBack(step.index, step.insert.length);
    } else if (step.delete) {
      // 别人删除了文字 → 你的操作位置往前移
      op1.moveDeletePositionForward(step.index, step.delete);
    }
  }
  // 返回：[调整后的你的操作, 别人的操作]
  return [op1, op2];
};
```

① 别人在你前面插入文字

→ **你的操作位置 \+ 插入长度**

② 别人在你前面删除文字

→ **你的操作位置 \- 删除长度**

https://p1\-juejin\.byteimg\.com/tos\-cn\-i\-k3u1fbpfcp/8b425cefe5f842ddbcf8dc6364c31e3e\~tplv\-k3u1fbpfcp\-jj\-mark:3024:0:0:0:q75\.awebp\#?w=949\&h=567\&s=761672\&e=gif\&f=396\&b=f6f6f6

![OT 算法网络演示](/images/blog/collaborative-editing-wopi/image-4.png)

上面这个演示体现了**OT 算法对网络要求更高**的说法，Alice 先修改的文档，由于网络的原因 Bob 的请求先到的服务器，但 OT 算法的期望是得到**一致的结果** 

这也就意味着 **OT 算法对网络要求更高**，如果某个用户出现网络异常，导致一些操作缺失或延迟，那么服务端的转换就会出现问题。

#### 3、CRDT算法

（1）含义

CRDT 算法全称为 Conflict\-free Replicated Data Type，即**无冲突复制数据类型**，是一种基于数据结构的**无冲突复制**数据类型算法，它`通过数据结构的合并来实现数据的一致性`。

（2）发展史

- 2011 年，CRDT 算法提出，代表了一种新的协同编辑方案的出现

- 2015 年，基于 CRDT 的协同编辑框架 [Yjs](https://link.juejin.cn/?target=https%3A%2F%2Fdocs.yjs.dev%2F) 开源，Yjs 是专门为在 web 上构建协同应用程序而设计的。

> CRDT 开源实现：Yjs
> 
> Yjs 是CRDT 数据层，可以独立于编辑器使用，也可以与前端编辑器结合
> 
> 

---

（3）概述

依赖于数学上可合并的数据结构。每个用户的修改都在本地即时生效，生成一个新的状态。当不同用户的状态同步时，系统会执行一个合并（Merge） 操作。由于数据结构被设计成无论以何种顺序合并，最终结果都相同，所以能够避免冲突。

- 两种实现类型：

    - 基于状态的CRDT \(CvRDT\)：同步时传输**整个数据状态**，设计简单但开销大。

    - 基于操作的CRDT \(CmRDT\)：只**传输更新操作**，效率高，但需要可靠的广播机制。

    **元素更新策略**

    ①默认增量更新（更新了的才传输），减少网络开销

    ②定时全量同步（全局统一更新），保证数据一致性

---

（4）核心原理

①数据结构层：每个元素的“身份证”

CRDT的根基是让每个元素携带足够的信息，使其能**独立决定自己在最终序列中的位置**。

```TypeScript
interface Element {
  // 全局唯一标识（核心）
  id: {
    // 方式一：分数定序（Treedoc）
    position: number;        // 如 3.5, 3.75...
    
    // 方式二：路径标识（Logoot/LSEQ）
    path: Array<{            // 如 [3, 2, 1]
      digit: number;         //整数序号  用于排序
      replicaId: string;    //设备标识  打破平局   避免不同设备产生相同的 digit 序列
    }>;
    
    // 公共部分
    replicaId: string;       // 设备/副本唯一标识
  };
  payload: string | object;
  // 删除标记
  tombstone: boolean;
}
```

**关键设计原则**：

- ID的**全序性**：任意两个ID都能比较大小（通过数字比较或字典序）

- ID的**稠密性**：任意两个ID之间总能插入新的ID（通过分数插值或路径扩展）

- ID的**唯一性**：通过包含`replicaId`确保并发插入不会产生相同ID

---

②冲突判断层：识别因果关系 vs 并发关系

当收到远程操作时，系统首先判断它和本地操作的关系。这依赖**向量时钟**或**版本向量**

**向量时钟机制**

每个副本维护一个向量: \[副本A的计数, 副本B的计数, 副本C的计数, \.\.\.\]

示例：
副本A初始: \[0, 0, 0\]
副本A本地插入: \[1, 0, 0\]  \(自己的分量\+1\)
副本A发送操作时，附带当前向量 \[1, 0, 0\]

副本B收到后：
1\. 合并向量: max\(\[0,1,0\], \[1,0,0\]\) = \[1,1,0\]
2\. 自己的分量\+1: \[1,2,0\]

**冲突判断规则**

假设有两个操作`op1`和`op2`，分别附带向量`V1`和`V2`：

|判断条件|关系|处理方式|
|---|---|---|
|`V1 ≤ V2`（逐元素≤）|因果关系：op1 → op2|op1必须先于op2应用|
|`V2 ≤ V1`（逐元素≤）|因果关系：op2 → op1|op2必须先于op1应用|
|无法比较（既不是≤也不是≥）|**并发关系**|需要基于ID全序合并|

**示例**：

- 操作A：向量 `[1,0,0]`

- 操作B：向量 `[0,1,0]`

- 判断：A不是≤B（因为0\<1? 不，A的第二分量0 \< B的1，但B的第一分量0 \< A的1，互相有大小关系）

    B也不是≤A → **并发关系**

---

③分情况处理

**情况1：因果关系明确（有依赖）**

严格按因果顺序应用操作

场景：
1\. 用户A在位置5插入"Hello"
2\. 用户A继续在位置10插入"World"（依赖前一个操作的结果）

处理：
\- 所有副本必须确保"Hello"先应用，"World"后应用
\- 如果"World"先到达但"Hello"还没到，暂存"World"，等待"Hello"到达后再应用

**情况2：并发操作（无因果关系）**

基于元素ID的全序关系确定最终顺序

场景：
用户A和B同时在文档开头插入字符：
\- A插入"X"，生成的ID为 \[0, replicaA\]
\- B插入"Y"，生成的ID为 \[0, replicaB\]（假设路径相同，最后用replicaId区分）

处理（规则固定，所有副本执行相同逻辑）：
1\. 比较ID：\[0, replicaA\] 和 \[0, replicaB\]
2\. 假设 replicaA \< replicaB（按字符串比较）
3\. 最终顺序：X在Y前面

无论哪个副本先收到谁的操作，最终结果都是 \[X, Y, 原文档\.\.\.\]

**情况3：删除操作（墓碑机制）**

删除不物理移除元素，而是打标记

```JavaScript
function deleteElement(elementId) {
  // 1. 标记为删除（本地立即生效）
  let element = findById(elementId);
  element.tombstone = true;
  
  // 2. 广播删除操作
  broadcast({ type: 'delete', id: elementId, vector: currentVector });
  
 // 注意：element本身仍然保留在数据结构中
  // 作用：
  // - 后续到达的并发插入可以相对它定位
  // - 如果并发操作试图修改/删除它，可以正确检测冲突
}
```

**墓碑清理（优化）**：

- 常规方案：保留墓碑，空间换正确性

- 优化方案：当确定所有副本都已看到删除后，通过**垃圾回收**机制物理移除

---

④CRDT 的实现

1\.每个客户端都具备一个符合的CRDT的数据结构，可以独立修改（P2P）

2\.冲突消除，使用CRDT算法消除冲突

3\.最终保证所有客户端达到最终一致性的状态

---

#### 4、对比及应用场景

|维度                |OT算法|CRDT算法|
|---|---|---|
|核心优势 <br>|1\. 无额外元数据，文档体积小<br>2\. 客户端计算压力小<br>3\. 行为符合直觉，易对齐用户预期<br>4\. 技术成熟，文本场景稳定<br>|1\. 去中心化 / P2P 友好，不依赖中心协调<br>2\. 天然支持离线编辑，网络弱网适应性极强<br>3\. 对延迟、乱序不敏感<br>4\. 复杂数据（富文本、矢量图）扩展性更好<br>5\. 服务端无转换压力，只做同步|
|核心缺点 |1\. 强依赖中心化服务器，服务端压力大        2\. 对网络延迟、乱序敏感，需严格保序       3\. 操作类型越多，转换函数越复杂难维护     4\. 不同数据模型要重写转换逻辑                5\. 性能下降或维护成本极高\(用户海量/分布广\)|1\. 需要存储大量元数据（唯一 ID、位置信息）<br>2\. 大文档下性能、内存开销更高<br>3\. 底层数据结构设计复杂，实现门槛高<br>4\. 元数据会随编辑永久增长，需额外垃圾回收机制优化|
|适用场景<br>|Google Docs（早期）、Etherpad<br>轻量文本、中心化工具仍有优势<br>纯文本协作、中心化架构、对文档体积敏感<br>|Notion、Figma、Yjs、Automerge<br>富文本、图形协作等复杂场景<br>CRDT因其灵活性逐渐成为主流<br>富文本 / 图形 / 复杂数据、离线编辑、P2P、高可用分布式|

### 二、WOPI协议

#### 1、背景

假设开发者在Host机器上部署某个业务Web服务，某天产品提到要在这个Web服务上展示和编辑Excel文件，这个需求解决方案目前主要有两种：

- 利用Javascript SDK，以纯前端方案打开该Excel文件，这类库包括LuckySheet、SpreadJS等

- 集成已有的在线office平台，比如微软提供了[Office Online App Server](https://link.juejin.cn?target=https%3A%2F%2Fdocs.microsoft.com%2Fen-us%2Fofficeonlineserver%2Foffice-online-server-overview)平台，允许第三方集成业务直接在网页中以Iframe方式嵌入Office页面，Office页面内部打开指定的Excel文档，展示效果如下图：

![Office 在线嵌入效果](/images/blog/collaborative-editing-wopi/image-5.png)

对前端开发者而言集成成本低，只需要通过Iframe嵌入到Host页面即可。那Office页面是如何知道去哪里打开获取到文档内容，文档信息是怎么告知给在线Office平台？这就是WOPI协议解决的问题。

#### 2、含义

WOPI协议约定了Office Online服务和集成业务侧之间的通信协议，协议约定了一组接口操作，该操作基于REST协议，这样对集成方而言只要提供了这些接口实现即可。使客户端能够访问和更改服务器存储的文件，这使得客户端能够进行渲染 并为服务器存储的文件提供文件编辑功能。

以官方文档提供的如下流程图来说明，它包括Browser、Server、Client三种角色：

![WOPI 流程图](/images/blog/collaborative-editing-wopi/image-3.png)

#### 3、核心理解

（1）认证阶段

核心目的：确保只有被授权的用户和 Client 才能访问文档，保护文件安全。

①Server 生成凭证
用户通过 Browser 访问 Server 提供的 Host 页面时，Server 内部生成

文档唯一 ID \(`fileId`\)

临时令牌 \(`access_token`\) 及其有效期 \(`access_token_ttl`\)

②通过 Browser 中转传递

Server 将 `access_token` 返回给 Browser

Browser 随后向 Client 发起的请求中带上这个 token

Client 在与 Server 的所有后续交互中，都会在请求参数里原样带上这个 token

③Server 校验
Server 收到任何请求时，都会先校验 `access_token` 是否合法。只有校验通过，才允许 Client 执行后续操作。

![WOPI 认证阶段](/images/blog/collaborative-editing-wopi/image.png)

（2）文档打开和编辑保存

①从文档生命周期来看，文档操作包括打开、查看/编辑和保存流程。

查看和编辑是Office平台能力，打开文档请求Server获取文档内容，编辑文档后关闭页面，通知Server保存文档最新内容。

②WOPI协议定义了文件操作接口，其中CheckFileInfo、GetFile、PutFile接口实现上述打开和保存文件功能， CheckFileInfo接口功能比较复杂，但是它决定Client端对文档的UI展示行为和后续允许的操作，这是由Server端提供属性信息决定，该接口返回包括：

- 文件基本信息：比如大小、文件展示名字等，

- 用户权限属性，常见属性包括： 

    - UserCanWrite：指示当前请求用户是否有权限更改文件，这决定Client后续是否允许调用PutFile接口

    - ReadOnly：文档是否只读

    - UserCanRename：文档是否允许重命名，为false时Client在UI展示时不会提供重命名按钮

- 指示Client，Server支持哪些功能属性

    - SupportsGetLock：为true说明Server支持GetLock操作

    - SupportsLocks：为true说明Server端支持Lock、Unlock等操作

    - SupportsRename：为true说明Server端支持对文档重命名操作

---

（3）锁机制

①核心目的：解决多人同时编辑同一个文档时的并发冲突问题。锁就像一把“编辑钥匙”，只有拿到钥匙的用户才能编辑。

②关键要素：

锁 ID（`lockId`）：由在线编辑器生成并管理，标识一次编辑会话。

锁的存储：Server 需要存储当前文档的 `lockId`，并负责校验。

- 加锁（Lock）

    在线编辑器在获取文档内容之前，先向 Server 发送 `Lock` 请求。

    `lockId` 放在请求头 `X-WOPI-Lock` 中。

    Server 检查该文档是否已被加锁：

    若无锁，则记录 `lockId`，加锁成功。

    若有锁，则校验请求中的 `lockId` 是否与已存储的匹配。匹配才允许继续。

- 解锁（Unlock）

    编辑完成并保存后，在线编辑器发送 `Unlock` 请求。

    Server 再次校验 `lockId`，匹配则释放锁。

#### 4、总结

WOPI 协议通过令牌认证 \+ 元数据与内容分离 \+ 锁机制，安全、可控地在业务网页中无缝嵌入文档的查看与编辑能力





