秒杀系统的面试题有个特点：**谁都能说几句「限流、缓存、削峰」，但一追问「Redis 扣了库存、数据库订单创建失败怎么办」，大部分人就开始含糊。**

因为它不是一个「加缓存」的问题，而是一个在**瞬时洪峰**下同时保证四件事的工程问题：

1. **不超卖**：100 件库存，绝不能卖出 101 件
2. **不少卖**：扣了库存但订单没创建，库存要还回去
3. **不被刷**：脚本、黄牛、重复请求要挡在核心链路之外
4. **不被打垮**：数据库、Redis、下游服务都不能被流量冲垮

这四件事互相冲突：要快就要缓存，要准就要数据库，要高可用就要接受最终一致。秒杀架构的本质，是**在漏斗的每一层丢掉一部分流量，同时把「库存」这个唯一不能错的东西保护到最后一刻**。

![秒杀系统分层漏斗：CDN 与静态化挡住绝大部分流量，网关限流与风控再筛一层，服务层用 Redis 原子扣减和消息队列削峰，数据库只承担最终落单](/images/blog/seckill-system/seckill-architecture.svg)

# 一、先算清楚问题，再谈架构

## 1.1 量级估算

面试时最容易被忽略、也最能体现工程思维的一步：**先估算，再设计。**

假设：

- 活动商品 1 万件，预约人数 100 万
- 开抢瞬间 10 万 QPS 打到网关
- 单机服务能处理 2000 QPS
- 数据库单实例写入约 3000 TPS（保守）

那么：

| 层 | 需要承接 | 结论 |
| --- | --- | --- |
| 页面访问 | 100 万 PV / 几秒 | 必须静态化 + CDN，不能碰后端 |
| 下单请求 | 10 万 QPS | 需要几十台无状态服务 + 网关限流 |
| Redis 扣减 | 10 万 QPS | 单 key 约 5–8 万 QPS，需要分段/集群 |
| 数据库写 | 1 万件商品最多 1 万单 | **远低于数据库能力**——只要前面挡住无效流量 |

**关键洞察：真正需要落库的请求只有「成功买到」的那部分，数量等于库存。** 秒杀架构做的所有事情，就是让 10 万 QPS 在到达数据库之前，变成 1 万次有效写入，其余的全部在前面的漏斗里被挡掉、排队或降级。

## 1.2 四个目标与它们的技术手段

| 目标 | 核心手段 | 代价 |
| --- | --- | --- |
| 不超卖 | Redis Lua 原子扣减 + 数据库 `WHERE stock >= 1` 双保险 | Redis 成为关键路径 |
| 不少卖 | 消息队列可靠投递 + 本地消息表 + 对账补偿 | 最终一致，存在短暂少卖 |
| 不被刷 | 令牌、验证码、签名、限购、风控、黑名单 | 用户体验与误杀 |
| 不被打垮 | CDN、限流、熔断、降级、异步、热点隔离 | 部分用户被拒绝，需要产品兜底 |

## 1.3 一致性怎么选

秒杀里有两类数据，一致性要求完全不同：

| 数据 | 一致性要求 | 方案 |
| --- | --- | --- |
| **库存** | 强一致（不能超卖） | Redis 单点原子操作 + DB 条件更新 |
| **订单状态、通知、积分** | 最终一致 | MQ + 重试 + 对账 |

不要试图给整条链路做强一致（分布式事务），那会把吞吐打回数据库水平。**正确的做法是：把强一致收敛到「库存扣减」这一个原子操作上，其余全部异步化、最终一致。**

# 二、整体架构

## 2.1 分层职责

| 层 | 职责 | 关键技术 | 拦截比例（经验值） |
| --- | --- | --- | --- |
| 前端 / CDN | 静态资源、页面兜底、防重复点击 | 静态化、CDN、倒计时校正 | 90%+ 的页面请求 |
| 接入层 | 限流、黑名单、签名、风控 | Nginx / OpenResty、API Gateway | 剩余请求的 50%–80% |
| 服务层 | 资格校验、令牌、幂等、编排 | 无状态服务、Redis、MQ | 剩余请求的 90% |
| 缓存层 | 库存扣减、限购、热点隔离 | Redis + Lua、分段库存 | 只放行库存数量的请求 |
| 消息层 | 削峰、异步落单、延迟取消 | Kafka / RocketMQ / RabbitMQ | 按消费能力匀速放行 |
| 数据库 | 库存最终一致性、订单持久化 | 条件更新、唯一索引、分库分表 | 与库存同量级 |

## 2.2 五条设计原则

1. **层层过滤**：能在前端做的不要到网关，能在网关做的不要到服务，能在 Redis 做的不要到数据库。
2. **异步削峰**：同步链路只做「占库存」，落单、通知、积分全部异步。
3. **热点隔离**：秒杀商品单独的服务集群、Redis 集群、数据库/表，避免影响常规业务。
4. **限流降级**：每一层都有配额和熔断，宁可拒绝一部分，也不能整体雪崩。
5. **幂等补偿**：任何异步环节都可能重复或丢失，必须能重试、能对账、能回滚。

# 三、前端：把流量挡在离用户最近的地方

## 3.1 静态化与 CDN

秒杀页面在活动期间是**读多写少、内容固定**的。正确的做法：

- 页面 HTML 静态化，推送到 CDN
- 商品图、JS、CSS 全部走 CDN，设置长缓存 + 版本号
- 动态数据（库存、倒计时、用户资格）通过少量轻量接口获取，或直接内嵌在页面里
- 活动开始前预热 CDN，避免回源风暴

**倒计时不要用本地时间**。用户改系统时间就能「提前开抢」，更常见的是手机时间不准导致体验问题。正确做法是页面加载时从服务端拿一次时间，计算 `offset = serverTime - Date.now()`，之后所有倒计时都用 `Date.now() + offset`。

```javascript
// 服务端返回 { serverTime: 1760000000000, startTime: 1760000060000 }
let offset = 0;

async function syncTime() {
  const t0 = Date.now();
  const { serverTime } = await fetch("/api/time").then(r => r.json());
  const t1 = Date.now();
  offset = serverTime - Math.round((t0 + t1) / 2);   // 粗略抵消网络往返
}

function remainMs(startTime) {
  return startTime - (Date.now() + offset);
}
```

## 3.2 防重复提交

前端能做三件事，但**都只是体验优化，不能当作安全边界**：

```javascript
const btn = document.querySelector("#buy");
let submitting = false;

btn.addEventListener("click", async () => {
  if (submitting) return;
  submitting = true;
  btn.disabled = true;

  try {
    const res = await fetch("/api/seckill", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ activityId, itemId, requestId: crypto.randomUUID() }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message ?? "请求失败");
    location.href = `#/result?requestId=${data.requestId}`;   // 成功：离开当前页
  } catch (err) {
    // 只有失败才恢复按钮；成功已跳转，避免用户返回后再点
    submitting = false;
    btn.disabled = false;
    alert(err.message);
  }
});
```

- `disabled` 防连点
- `requestId`（UUID）用于服务端幂等
- 成功后跳转结果页，**不要停留在原页面**

## 3.3 错峰与防脚本

| 手段 | 作用 | 注意 |
| --- | --- | --- |
| 验证码 / 滑块 | 提高脚本成本 | 活动开始前就要验证，不能开抢瞬间才弹 |
| 答题 | 拉长请求时间、错开峰值 | 题目不能太难，否则真实用户流失 |
| 预约 / 资格码 | 只有预约用户能抢 | 把 100 万流量缩到 10 万 |
| 随机延迟 | 客户端在 0–300ms 内随机发起 | 只是打散，不解决根本问题 |
| 设备指纹 | 识别模拟器、群控 | 涉及隐私合规，需评估 |

## 3.4 结果页与轮询

秒杀请求不应该同步等待「下单成功」。推荐：

1. 请求返回 `queued` + `requestId`
2. 结果页轮询 `/api/result?requestId=...`（1 秒一次，带退避）
3. 或者用 WebSocket / SSE 推送结果
4. 轮询也要限流，避免结果页变成第二波洪峰

## 3.5 降级页面

活动开始前准备好**静态兜底页**：网络错误、接口超时、服务降级时展示「当前人数过多，请稍后再试」，而不是白屏或一直转圈。这是产品体验的底线。

# 四、接入层：限流、风控、防重放

## 4.1 Nginx / OpenResty 限流

```nginx
# 按 IP 限流：10 请求/秒，突发 20
limit_req_zone $binary_remote_addr zone=seckill_ip:20m rate=10r/s;

# 按用户限流（需先解析 token / cookie）
limit_req_zone $cookie_uid zone=seckill_uid:20m rate=2r/s;

server {
    location /api/seckill {
        limit_req zone=seckill_ip burst=20 nodelay;
        limit_req zone=seckill_uid burst=5 nodelay;
        limit_req_status 429;

        # 连接数限制，防止慢连接占满 worker
        limit_conn perip 10;

        proxy_pass http://seckill_backend;
        proxy_connect_timeout 1s;
        proxy_read_timeout 3s;
    }
}
```

`burst` 是允许的突发量，`nodelay` 表示突发请求立即处理而不是排队。**限流阈值要结合压测结果设置**，拍脑袋的阈值要么误杀，要么没效果。

## 4.2 限流算法对比

| 算法 | 原理 | 取舍 | 适用 |
| --- | --- | --- | --- |
| 固定窗口计数 | 每分钟计数，超限拒绝 | 实现最简单，但**临界突刺**：两个窗口交界处可能放过 2 倍流量 | 粗粒度保护 |
| 滑动窗口日志 | 记录每次请求时间戳 | 精确，但内存随请求量增长 | 小流量精确限流 |
| 滑动窗口计数 | 当前窗口 + 上一窗口加权 | 较精确、内存小，但仍是近似 | 通用 |
| 漏桶 | 请求入桶，恒定速率流出 | 输出绝对平滑，但无法应对合理突发 | 保护下游 |
| **令牌桶** | 匀速发令牌，有令牌才能过 | **允许突发**、实现简单，需要调桶容量 | 秒杀入口最常用 |

Redis 实现令牌桶（Lua 保证原子）：

```lua
-- KEYS[1] = 桶 key
-- ARGV[1] = 速率（个/秒） ARGV[2] = 容量 ARGV[3] = 当前时间（毫秒） ARGV[4] = 请求量
local key = KEYS[1]
local rate = tonumber(ARGV[1])
local capacity = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local requested = tonumber(ARGV[4])

local bucket = redis.call('HMGET', key, 'tokens', 'last')
local tokens = tonumber(bucket[1]) or capacity
local last = tonumber(bucket[2]) or now

-- 按时间补充令牌
local delta = math.max(0, now - last)
tokens = math.min(capacity, tokens + delta * rate / 1000)

if tokens < requested then
  redis.call('HMSET', key, 'tokens', tokens, 'last', now)
  redis.call('PEXPIRE', key, 60000)
  return 0
end

tokens = tokens - requested
redis.call('HMSET', key, 'tokens', tokens, 'last', now)
redis.call('PEXPIRE', key, 60000)
return 1
```

## 4.3 多维度限流

只按 IP 限流不够：黄牛可以用代理池；只按用户限流也不够：脚本可以批量注册。实战中要叠加多个维度：

| 维度 | 目的 | 阈值示例 |
| --- | --- | --- |
| IP | 挡单机脚本 | 10 QPS |
| 用户 ID | 挡单账号刷 | 1 次/活动 |
| 设备指纹 | 挡多账号同设备 | 3 个账号/设备 |
| 接口 | 保护特定下游 | 全站 5 万 QPS |
| 商品 | 保护热点 key | 单商品 2 万 QPS |

## 4.4 风控与黑名单

- **前置黑名单**：历史黄牛设备、异常 IP、代理池，在网关直接拒绝
- **行为风控**：请求间隔过于规律、无页面停留、UA 异常、无鼠标轨迹
- **资格校验**：实名、会员等级、预约记录、地域限制
- **签名防重放**：`sign = HMAC(secret, timestamp + nonce + params)`，服务端校验时间窗（如 5 分钟）和 nonce 唯一性

**风控的原则是「宁可错杀一部分，也不能让脚本穿透」**，但要有申诉和人工兜底，避免误伤真实用户。

## 4.5 熔断与降级

- 网关对下游设置**超时 + 熔断**：下游错误率超过阈值，直接快速失败，不把线程池拖死
- 秒杀接口与常规业务**隔离**：独立线程池、独立连接池、独立集群
- 降级顺序：非核心功能（推荐、评论、积分）先关，核心下单链路最后保
- 返回统一的「排队中 / 稍后再试」，不要让用户看到 500

# 五、服务端：从资格校验到异步落单

## 5.1 请求处理顺序

一个秒杀请求进来，按「**从便宜到昂贵、从粗到细**」的顺序校验：

```text
① 活动是否存在、是否在时间窗口        → 本地缓存 / Redis
② 用户是否登录、是否有资格            → 缓存
③ 是否已抢过（限购）                  → Redis Set
④ 是否重复请求（requestId 幂等）      → Redis / 唯一索引
⑤ 秒杀令牌是否有效                    → Redis
⑥ 库存是否充足                        → Redis Lua
⑦ 扣减库存 + 记录用户                 → Redis Lua（原子）
⑧ 发送下单消息                        → MQ
⑨ 返回排队中 / 成功                   → 立即返回
```

**任何一步失败都要快速返回**，不要继续往下走。尤其是限购和幂等，必须放在扣库存之前——否则库存被无效请求扣光，真实用户买不到。

## 5.2 秒杀令牌：把无效流量挡在库存之外

令牌（token）的本质是**预分配资格**：

1. 活动开始前，按库存数量（或略多，如 1.2 倍）生成令牌，放入 Redis
2. 用户先调 `/api/token` 获取令牌，拿到令牌才有资格下单
3. 下单时校验并消费令牌

好处：

- 令牌数量 = 库存上限，天然限制进入核心链路的请求量
- 获取令牌的接口可以做更严格的风控和限流
- 令牌可以绑定用户，防止转让

**令牌不是必须的**，但它能把「10 万 QPS 抢 1 万库存」变成「1.2 万 QPS 进入下单链路」，效果非常直接。

## 5.3 Redis Lua 原子扣减

这是整个系统最核心的一段代码。必须把「查库存 → 判断 → 扣减 → 记录限购」放在**一个 Lua 脚本**里，利用 Redis 单线程执行保证原子性。

```lua
-- KEYS[1] = 库存 key，例如 seckill:{1001}:stock
-- KEYS[2] = 已购用户 Set，例如 seckill:{1001}:users
-- ARGV[1] = userId
-- ARGV[2] = 购买数量
-- 返回：>=0 剩余库存；-1 库存不足；-2 重复购买

local stockKey = KEYS[1]
local userKey  = KEYS[2]
local userId   = ARGV[1]
local qty      = tonumber(ARGV[2])

-- 限购：一个用户只能买一次
if redis.call('SISMEMBER', userKey, userId) == 1 then
  return -2
end

local stock = tonumber(redis.call('GET', stockKey))
if stock == nil then
  return -3                      -- 活动未初始化 / 已结束
end

if stock < qty then
  return -1
end

redis.call('DECRBY', stockKey, qty)
redis.call('SADD', userKey, userId)
return stock - qty
```

Java 调用：

```java
private static final RedisScript<Long> SECKILL_SCRIPT =
    new DefaultRedisScript<>(SECKILL_LUA, Long.class);

public long deduct(long activityId, long userId, int qty) {
    List<String> keys = List.of(
        "seckill:{" + activityId + "}:stock",
        "seckill:{" + activityId + "}:users"
    );
    Long result = redisTemplate.execute(
        SECKILL_SCRIPT, keys, String.valueOf(userId), String.valueOf(qty));
    return result == null ? -3 : result;
}
```

**为什么用 Lua 而不是 `GET` + `DECR`？** 两条命令之间可能被其他请求插入，导致「都查到有库存，都扣减」，最终超卖。`WATCH/MULTI` 也能实现，但冲突时需要重试，高并发下重试率极高。Lua 是单次原子执行，没有这个问题。

**Redis Cluster 注意**：Lua 脚本涉及的所有 key 必须在同一个 slot。用 `{activityId}` 作为 hash tag，确保库存 key 和用户 key 落在同一节点。

## 5.4 分段库存：解决热点 key

单个 Redis key 的写入能力有限（经验值 5–8 万 QPS，受网络和单核限制）。1 万件库存、10 万 QPS 场景下，单 key 可能成为瓶颈。

**分段库存**：把 1 万件拆成 10 段，每段 1000 件，分散到不同 key（甚至不同节点）。

```text
seckill:{1001}:stock:0  → 1000
seckill:{1001}:stock:1  → 1000
...
seckill:{1001}:stock:9  → 1000
```

请求按 `userId % 10` 或随机选段，Lua 在该段内扣减；某段扣完就换下一段。

| 方案 | 优点 | 缺点 |
| --- | --- | --- |
| 单 key | 简单、绝对准确 | 热点瓶颈 |
| 固定分段 | 分散压力 | 某段可能先空，需重试换段 |
| 动态分段 + 本地库存 | 极致性能 | 一致性复杂，可能少卖 |

**代价**：分段后「总库存」是各段之和，扣减失败要换段重试；极端情况下某些段剩余、某些段空，需要额外的汇总逻辑。**只有单 key 压测确实扛不住时才上分段**，不要一开始就复杂化。

## 5.5 本地库存：把 Redis 也省掉

在服务实例本地缓存一小部分库存（例如每台 100 件），请求先在本地 CAS 扣减，扣完再向 Redis 申请一批。这能把 Redis 的 QPS 降低一个数量级。

代价是**一致性更难**：实例宕机会丢失本地库存（少卖），需要把剩余库存归还；不同实例的库存不均衡。除非压测证明 Redis 是瓶颈，否则不建议。

## 5.6 异步下单

同步链路只做「Redis 扣库存 + 发消息」，真正创建订单交给消费者：

```java
@PostMapping("/api/seckill")
public Result<?> seckill(@RequestBody SeckillRequest req, @RequestHeader("uid") long userId) {
    // 1. 基础校验（活动时间、资格、令牌）略
    // 2. 幂等：同一 requestId 只处理一次
    if (!idempotent.tryLock(req.requestId())) {
        return Result.ok("处理中，请稍后查看");
    }
    // 3. 原子扣库存 + 限购
    long remain = stockService.deduct(req.activityId(), userId, req.qty());
    if (remain == -1) return Result.fail("已售罄");
    if (remain == -2) return Result.fail("每人限购一件");
    if (remain < 0)  return Result.fail("活动异常");

    // 4. 发送下单消息（本地消息表 / 事务消息保证可靠）
    orderMessageProducer.send(new OrderMessage(
        req.requestId(), req.activityId(), req.itemId(), userId, req.qty()));

    // 5. 立即返回，前端轮询结果
    return Result.ok("排队中", req.requestId());
}
```

**同步链路越短越好**：不要在这里查数据库、发短信、加积分。这些全部放到 MQ 消费端。

## 5.7 幂等：重复请求只生效一次

秒杀的重复来源很多：用户连点、网关重试、MQ 重投、补偿任务重复执行。幂等要做在**每一层**：

| 层 | 手段 |
| --- | --- |
| 接口 | `requestId` + Redis `SETNX`（带过期时间） |
| Redis 扣减 | 用户 Set 天然幂等（`SISMEMBER` 判断） |
| 消息消费 | 业务唯一键 + 数据库唯一索引 |
| 数据库订单 | `UNIQUE KEY uk_user_activity (user_id, activity_id)` |

**不要只依赖 Redis 幂等**：Redis 可能丢数据或过期。最终防线是数据库唯一索引——即使消息重复消费，第二次插入会被唯一索引挡住。

## 5.8 库存回滚

用户抢到资格但未支付，库存要还回去：

1. 下单时发送一条**延迟消息**（如 30 分钟）
2. 消费延迟消息时检查订单状态
3. 仍未支付 → 关闭订单 + 回滚库存（Redis `INCRBY` + DB `stock + 1`）+ 移除限购记录
4. 已支付 → 忽略

回滚也必须幂等：用订单状态机做条件更新（`WHERE status = 'PENDING'`），避免重复回滚。

# 六、Redis：库存的第一道防线

## 6.1 数据结构设计

| 数据 | 结构 | Key 示例 | 说明 |
| --- | --- | --- | --- |
| 库存 | String | `seckill:{1001}:stock` | 值为剩余数量 |
| 已购用户 | Set | `seckill:{1001}:users` | 限购，`SISMEMBER` O(1) |
| 秒杀令牌 | Set / String | `seckill:{1001}:tokens` | 令牌池 |
| 活动信息 | Hash | `seckill:activity:1001` | 时间、限购、状态 |
| 幂等 | String | `seckill:idem:{requestId}` | `SET NX EX 300` |
| 排队结果 | String / Hash | `seckill:result:{requestId}` | 轮询结果 |

**所有 key 都设过期时间**。活动结束后自动清理，避免内存泄漏；也防止「上一场活动的库存」被下一场误用。

## 6.2 缓存穿透、击穿、雪崩

| 问题 | 场景 | 方案 |
| --- | --- | --- |
| 穿透 | 查不存在的活动/商品，请求打到 DB | 空值缓存、布隆过滤器、参数校验 |
| 击穿 | 热点 key 过期瞬间大量请求打到 DB | 逻辑过期 + 互斥重建、永不过期 + 后台刷新 |
| 雪崩 | 大量 key 同时过期 / Redis 宕机 | 过期时间加随机、多级缓存、熔断降级 |

秒杀场景下最危险的是**击穿和雪崩**：活动开始瞬间，如果库存 key 不存在，所有请求都会去查数据库。所以：

- 活动开始前**必须预热**库存 key
- 预热后设置合理的过期时间（活动结束后一段时间）
- 库存 key 不存在时，Lua 直接返回 `-3`，**不要回源数据库**
- Redis 整体不可用时，降级为「排队页」或直接拒绝，不要放流量到 DB

## 6.3 Redis 宕机了怎么办

这是面试的高频追问。要分情况回答：

| 故障 | 影响 | 应对 |
| --- | --- | --- |
| 单节点宕机 | 该分片不可用 | 主从切换（哨兵 / Cluster），客户端重试 |
| 主从切换丢数据 | 已扣库存丢失 → **可能超卖** | DB 条件更新兜底 + 对账修正 |
| 整个 Redis 不可用 | 无法扣库存 | 降级：关闭秒杀入口 / 排队页；**绝不能让流量直接打到 DB** |
| 网络分区 | 部分请求超时 | 超时快速失败，幂等重试 |

**核心原则：Redis 是「加速器」，不是「唯一真相」。** 数据库的 `WHERE stock >= 1` 是最后一道防超卖防线；Redis 丢了，最多是少卖（用户抢到但没下单成功），可以补偿，不能超卖。

## 6.4 Redis 与数据库的一致性

![库存最终一致性：Redis 原子扣减后写本地消息表，经 MQ 异步落库；发送或消费失败走重试、死信与回滚，对账任务以数据库为准修正差异](/images/blog/seckill-system/stock-consistency.svg)

秒杀采用的是「**Redis 先扣、DB 后扣**」的异步链路：

```text
Redis 扣减成功 → 发 MQ → 消费者创建订单 + DB 扣库存
```

不一致的场景：

| 场景 | 结果 | 处理 |
| --- | --- | --- |
| Redis 扣成功，MQ 发送失败 | 少卖（库存占了但没订单） | 本地消息表 + 定时补偿；或同步重试 |
| MQ 发送成功，消费失败 | 少卖 | 消费重试 + 死信队列 + 人工/自动补偿 |
| DB 扣成功，订单创建失败 | 数据不一致 | 同一事务内完成；失败则回滚并归还 Redis 库存 |
| Redis 扣成功，用户超时未支付 | 少卖 | 延迟消息关单 + 回滚库存 |

**不要追求实时强一致**，而是保证：

1. **不超卖**：DB 条件更新 + Redis Lua 双重保护
2. **最终不少卖**：对账任务定期比对 Redis 剩余、DB 库存、订单数量，发现差异自动修正
3. **可观测**：每一次扣减、消息、落单都有日志和 traceId，能定位到具体请求

## 6.5 库存扣减方案对比

| 方案 | 正确性与性能 | 适用 |
| --- | --- | --- |
| `GET` + `DECR` | ✗ **超卖风险高**，但性能高 | 不可用 |
| `DECR` 后判断 < 0 再回补 | 判断与回补不原子，性能高 | 不推荐（回补期间可能被抢） |
| `WATCH` + `MULTI` | ✓ 乐观锁、冲突时重试，性能中 | 冲突少时可用 |
| 分布式锁 + 查改 | ✓ 但锁本身是瓶颈，性能低 | 不推荐 |
| **Lua 脚本** | ✓ 单次原子执行，性能高 | **推荐** |
| DB 条件更新 | ✓ 行锁 + 条件判断，性能低 | 最终兜底 |

# 七、数据库：最后一道防线

## 7.1 表设计

```sql
CREATE TABLE seckill_item (
  id           BIGINT UNSIGNED PRIMARY KEY,
  activity_id  BIGINT UNSIGNED NOT NULL,
  name         VARCHAR(128) NOT NULL,
  total_stock  INT NOT NULL,
  stock        INT NOT NULL,                 -- 剩余库存
  version      INT NOT NULL DEFAULT 0,       -- 乐观锁（可选）
  start_time   DATETIME NOT NULL,
  end_time     DATETIME NOT NULL,
  UNIQUE KEY uk_activity (activity_id)
) ENGINE=InnoDB;

CREATE TABLE seckill_order (
  id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  request_id   VARCHAR(64) NOT NULL,
  activity_id  BIGINT UNSIGNED NOT NULL,
  item_id      BIGINT UNSIGNED NOT NULL,
  user_id      BIGINT UNSIGNED NOT NULL,
  qty          INT NOT NULL,
  status       TINYINT NOT NULL DEFAULT 0,   -- 0待支付 1已支付 2已取消
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_request (request_id),        -- 接口幂等
  UNIQUE KEY uk_user_activity (user_id, activity_id),  -- 限购
  KEY idx_status_created (status, created_at)          -- 关单扫描
) ENGINE=InnoDB;
```

两个唯一索引是**幂等和限购的最终保证**，比任何 Redis 判断都可靠。

## 7.2 扣库存 SQL

```sql
UPDATE seckill_item
SET stock = stock - 1
WHERE id = ?
  AND stock >= 1;
```

判断影响行数：

```java
int affected = jdbcTemplate.update(SQL, itemId);
if (affected == 0) {
    throw new SoldOutException();   // 库存不足，事务回滚
}
```

**为什么不用 `SELECT stock` 再 `UPDATE`？** 两条语句之间可能被其他事务插入，导致超卖。`UPDATE ... WHERE stock >= 1` 利用 InnoDB 的行锁 + 条件判断，是原子的。

**乐观锁版本号**也可以：

```sql
UPDATE seckill_item
SET stock = stock - 1, version = version + 1
WHERE id = ? AND version = ? AND stock >= 1;
```

但秒杀场景下冲突率极高，乐观锁重试成本大，**条件更新更直接**。

## 7.3 事务边界

```java
@Transactional(rollbackFor = Exception.class)
public void createOrder(OrderMessage msg) {
    // 1. 扣库存（条件更新，失败抛异常）
    int affected = itemMapper.deductStock(msg.itemId(), msg.qty());
    if (affected == 0) throw new SoldOutException();

    // 2. 创建订单（唯一索引防重）
    try {
        orderMapper.insert(buildOrder(msg));
    } catch (DuplicateKeyException e) {
        // 重复消息：库存已经扣过，需要判断是否回滚
        // 更稳妥的做法是先用 requestId 查询订单
    }
}
```

**事务里不要做 RPC、发消息、写 Redis**。这些操作要么放在事务外，要么用本地消息表 / 事务消息保证一致性。

**重复消费的处理**：先按 `request_id` 查订单，存在则直接返回；不存在再插入。不要依赖捕获唯一键异常后回滚库存——那会把已经成功的订单的库存也回滚掉。

## 7.4 分库分表

秒杀订单量通常不大（等于库存），但**活动多、历史数据多**，单表仍可能很大。分片策略：

- 按 `activity_id` 分库分表：同一活动的订单落同一分片，便于统计和对账
- 按 `user_id` 分片：便于查「我的订单」
- 两者冲突时，用**基因法**（user_id 后缀编码 activity_id）或冗余表

分片键一旦选定，后续查询必须带上它，否则会广播到所有分片。**秒杀场景优先按 activity_id 分片**，因为运营查询和对账都围绕活动。

## 7.5 读写分离与主从延迟

- 写请求走主库，读请求走从库
- **下单成功后立即查订单**可能读到从库的旧数据 → 让这类查询走主库，或返回前端「处理中」
- 主从延迟监控：`Seconds_Behind_Master`，超过阈值告警
- 秒杀高峰避免大查询、批量导出打到从库

## 7.6 对账与补偿

定时任务（如每 5 分钟）：

```sql
-- 1. 检查 Redis 剩余库存与 DB 库存是否一致
-- 2. 检查已扣库存数量是否等于有效订单数量
-- 3. 检查「Redis 已扣但无订单」的请求，回滚或补单
-- 4. 检查「订单已取消但库存未回滚」的记录
```

对账要以**数据库为准**，Redis 为参考。发现差异时：

- 能自动修正的自动修正（如回滚多余扣减）
- 不能自动修正的（如金额、用户权益）进人工队列
- 所有修正操作记录审计日志，可追溯

# 八、消息队列：削峰与解耦

## 8.1 削峰

MQ 把「瞬时 10 万 QPS」变成「按消费能力匀速处理」：

```text
生产：10 万条/秒  →  MQ 堆积  →  消费：3000 条/秒
```

**MQ 的作用不是让请求变快，而是让系统不被冲垮**。用户感知是「排队中」，而不是「立即成功」。

## 8.2 可靠投递

| 环节 | 风险 | 方案 |
| --- | --- | --- |
| 生产者 → MQ | 发送失败 / 超时未知 | 本地消息表（outbox）、事务消息、发送确认 + 重试 |
| MQ 持久化 | Broker 宕机丢消息 | 持久化 + 副本（Kafka `acks=all`、RocketMQ 同步刷盘） |
| MQ → 消费者 | 消费失败 | 手动 ACK、重试队列、死信队列 |

**本地消息表**是最通用的方案：

```sql
CREATE TABLE local_message (
  id          BIGINT AUTO_INCREMENT PRIMARY KEY,
  request_id  VARCHAR(64) NOT NULL,
  payload     TEXT NOT NULL,
  status      TINYINT NOT NULL DEFAULT 0,  -- 0待发送 1已发送 2已消费
  retry_count INT NOT NULL DEFAULT 0,
  next_retry  DATETIME NOT NULL,
  UNIQUE KEY uk_request (request_id)
);
```

业务事务和消息记录在同一个本地事务里提交，然后由定时任务扫描待发送消息投递到 MQ。这样即使 MQ 不可用，消息也不会丢。

## 8.3 幂等消费

消费者必须假设**消息会重复**：

```java
@KafkaListener(topics = "seckill-order")
public void consume(OrderMessage msg) {
    // 1. 查订单是否已存在（request_id 唯一索引）
    if (orderMapper.existsByRequestId(msg.requestId())) {
        return;                             // 已处理，直接 ACK
    }
    // 2. 事务内扣库存 + 建订单
    transactionTemplate.execute(status -> {
        int affected = itemMapper.deductStock(msg.itemId(), msg.qty());
        if (affected == 0) {
            // 库存不足：说明 Redis 与 DB 不一致，记录异常并告警
            throw new InconsistentStockException(msg);
        }
        orderMapper.insert(buildOrder(msg));
        return null;
    });
}
```

## 8.4 延迟队列

用于「30 分钟未支付自动关单」：

| MQ | 实现 |
| --- | --- |
| RocketMQ | 延迟级别 / 任意时间延迟消息（5.0+） |
| RabbitMQ | TTL + 死信交换机（DLX） |
| Kafka | 不支持原生延迟，需自建时间轮 / 定时扫描 |
| Redis | ZSET + 定时轮询（简单场景可用） |

## 8.5 消息积压

高峰期 MQ 堆积是正常的，但要能恢复：

- 监控堆积量、消费延迟
- 消费端水平扩容（分区数要足够）
- 临时降级非核心消费（如积分、通知），优先处理下单
- 避免消费端做慢操作（RPC、大事务）
- 设置死信队列，处理反复失败的消息

# 九、一致性与兜底

## 9.1 超卖与少卖的边界

| 问题 | 根因 | 防线 |
| --- | --- | --- |
| 超卖 | Redis 扣减非原子 / Redis 丢数据 / DB 未兜底 | Lua 原子 + DB `WHERE stock >= 1` + 对账 |
| 少卖 | Redis 扣了但订单没建成 / 消息丢失 / 未支付未回滚 | 本地消息表 + 消费重试 + 延迟关单 + 对账回滚 |

**超卖是事故，少卖是体验问题。** 两者都要避免，但优先保证不超卖——所以数据库的条件更新永远不能省。

## 9.2 订单状态机

```text
INIT ──扣库存成功──> PENDING_PAY ──支付──> PAID ──发货──> SHIPPED ──确认──> DONE
                          │
                          ├──超时/用户取消──> CANCELLED ──回滚库存──> CLOSED
                          │
                          └──支付失败──> PAY_FAILED ──重试/取消──> CLOSED
```

状态流转必须用**条件更新**：

```sql
UPDATE seckill_order
SET status = 2
WHERE id = ? AND status = 0;     -- 只有待支付才能取消
```

影响行数为 0 说明状态已被其他操作改变，直接返回，避免重复回滚。

## 9.3 降级预案

| 场景 | 降级动作 |
| --- | --- |
| Redis 不可用 | 关闭秒杀入口 / 排队页，禁止流量直达 DB |
| MQ 不可用 | 本地消息表暂存，恢复后补发；或直接返回「稍后再试」 |
| DB 压力过大 | 关闭非核心查询、限流写入、读写分离 |
| 下游服务超时 | 熔断，返回兜底数据 |
| 流量超过预期 | 网关限流、令牌减半、只放行预约用户 |

**降级要提前演练**，不能等到出事才临时开关。

## 9.4 压测与监控

**压测**：

- 全链路压测，使用影子表 / 影子库，避免污染真实数据
- 梯度加压：1 万 → 5 万 → 10 万 QPS，观察拐点
- 关注 P99 延迟、错误率、Redis/DB CPU、连接数、MQ 堆积
- 验证限流、熔断、降级是否按预期生效

**监控指标**：

| 层 | 指标 |
| --- | --- |
| 网关 | QPS、4xx/5xx、限流拒绝数、P99 |
| 服务 | QPS、RT、错误率、线程池活跃数、GC |
| Redis | QPS、命中率、慢查询、内存、主从延迟、连接数 |
| MQ | 生产/消费 TPS、堆积量、消费延迟、死信数 |
| DB | QPS、TPS、慢查询、锁等待、连接数、主从延迟 |
| 业务 | 库存剩余、订单创建数、支付转化率、超卖/少卖告警 |

# 十、完整链路时序

![秒杀请求完整时序：前端拿到令牌后调用下单接口，服务端用 Lua 原子扣减库存并发送消息，消费者异步落单，超时未支付通过延迟消息回滚库存](/images/blog/seckill-system/seckill-flow.svg)

```text
用户          前端          网关          秒杀服务        Redis          MQ          订单服务        DB
 |             |             |              |              |             |              |             |
 |--点击抢购-->|             |              |              |             |              |             |
 |             |--获取令牌-->|--限流/签名-->|--校验资格--->|             |              |             |
 |             |<--令牌-------|<-------------|<--令牌--------|             |              |             |
 |             |--下单------>|--限流------->|--幂等检查--->|             |              |             |
 |             |             |              |--Lua扣库存-->|             |              |             |
 |             |             |              |<--剩余库存----|             |              |             |
 |             |             |              |--发送消息----------------->|              |             |
 |             |<--排队中-----|<-------------|              |             |--消费------->|--扣库存---->|
 |             |             |              |              |             |              |--建订单---->|
 |             |--轮询结果-->|-------------->|--查结果----->|             |              |             |
 |             |<--成功-------|<-------------|              |             |              |             |
 |             |             |              |              |             |              |             |
 |             |             |              |              |  30 分钟延迟消息 --------->|--未支付?---->|
 |             |             |              |              |<--回滚库存----|<-------------|--关单------>|
```

# 十一、面试追问

**Q1：如何防止超卖？**

三层防线：① Redis Lua 脚本把「查库存 + 判断 + 扣减 + 记录限购」做成原子操作；② 数据库 `UPDATE ... SET stock = stock - 1 WHERE stock >= 1`，用行锁和条件判断兜底；③ 对账任务定期校验 Redis、DB、订单数量。只靠 Redis 不够，因为主从切换可能丢数据；只靠 DB 扛不住高并发。

**Q2：Redis 扣了库存，但数据库订单创建失败怎么办？**

记录「扣减流水」（request_id、activity_id、user_id、qty、状态）。消费失败时重试；超过重试次数进入死信队列并告警；对账任务发现「Redis 已扣但无有效订单」时，回滚 Redis 库存并标记请求失败。关键是**每一步都可追踪、可补偿**。

**Q3：MQ 消息重复消费怎么办？**

消费者先用 `request_id` 查订单，存在则直接 ACK；数据库对 `request_id` 建唯一索引作为最终防线；扣库存用条件更新，重复消费时影响行数为 0 则视为已处理。不要在重复消费时再次扣库存或再次回滚。

**Q4：如何保证 Redis 和数据库的库存一致？**

不做实时强一致，做最终一致：Redis 先扣、MQ 异步落库；本地消息表保证消息不丢；消费失败重试 + 死信；定时对账以 DB 为准修正 Redis。允许短暂不一致（少卖），但绝不允许超卖。

**Q5：库存热点 key 怎么优化？**

先压测确认单 key 是否是瓶颈；如果是，用分段库存（按用户或随机分 N 段），每段独立扣减，某段空了换段；配合 Redis Cluster 分散到不同节点。更极致的是本地库存预分配，但一致性复杂，非必要不用。

**Q6：如何防止黄牛和脚本？**

多层：预约/资格门槛、验证码/答题、设备指纹、IP/用户/设备多维度限流、签名防重放、行为风控、黑名单。前端防重复只是体验，所有校验必须后端重做。风控要接受一定误杀，并提供申诉。

**Q7：秒杀令牌的作用是什么？**

按库存数量预生成令牌，只有拿到令牌的请求才能进入下单链路，把无效流量挡在 Redis 扣减之前；令牌可绑定用户，便于限购和风控；令牌数量本身就是一道库存上限。

**Q8：为什么用 Lua 而不是分布式锁？**

Lua 在 Redis 单线程中原子执行，没有锁竞争和重试开销，性能远高于分布式锁。分布式锁还要处理锁超时、续期、误删等问题，在高并发下本身就是瓶颈。只有在跨多个资源、需要较长临界区时才考虑分布式锁。

**Q9：Redis 集群模式下 Lua 有什么限制？**

脚本涉及的所有 key 必须落在同一个 slot。用 hash tag（如 `{activityId}`）把相关 key 绑定到同一节点；不要在脚本里访问未在 `KEYS` 中声明的 key；脚本要短小，避免长时间阻塞单线程。

**Q10：30 分钟未支付如何回滚库存？**

下单时发送延迟消息；消费时用订单状态机做条件更新（`WHERE status = PENDING`），成功则关单、`INCRBY` 回滚 Redis 库存、从限购 Set 移除用户；已支付则忽略。回滚操作本身要幂等，重复消息不会重复加库存。

**Q11：如何设计订单表？**

`request_id` 唯一索引做接口幂等，`(user_id, activity_id)` 唯一索引做限购，`status` + `created_at` 联合索引供关单扫描。订单表按 `activity_id` 分库分表，避免单表过大；历史订单归档。

**Q12：秒杀系统如何压测？**

全链路压测 + 影子表/影子库；梯度加压找拐点；覆盖正常、售罄、限流、Redis 故障、MQ 堆积等场景；观察 P99、错误率、资源水位；验证降级开关和预案。压测数据要清理，避免污染生产。

**Q13：如果 Redis 整个挂了怎么办？**

立即降级：关闭秒杀入口或切到排队页，禁止流量直接打到数据库；恢复后以 DB 库存为准重建 Redis；对账修正期间产生的差异。**绝不能把 Redis 故障变成数据库雪崩。**

**Q14：如何保证接口幂等？**

`requestId` + Redis `SET NX EX` 做第一层；数据库 `request_id` 唯一索引做最终层；状态机条件更新防止重复流转；消息消费先查后写。每一层都假设上一层可能失效。

**Q15：为什么不能直接让数据库扛？**

数据库连接数、行锁、WAL 写入都是瓶颈，瞬时 10 万 QPS 会打满连接池和 I/O，导致整个库不可用，影响所有业务。秒杀必须把绝大部分请求挡在数据库之前，DB 只处理与库存同量级的有效写入。

**Q16：库存分段后，如何保证总库存准确？**

总库存 = 各段剩余之和；扣减时记录流水，段空则换段；对账任务汇总各段与 DB 库存比对；活动结束后把各段剩余合并回主库存。分段会带来「某段空但其他段有货」的局部售罄，需要换段重试逻辑。

**Q17：如何设计秒杀系统的限流？**

多维度、分层限流：CDN/静态化挡页面流量；网关按 IP/用户/接口限流；服务层按商品和全局配额限流；Redis 层用令牌控制进入核心链路的请求；数据库层用连接池和小事务保护。限流阈值来自压测，不是拍脑袋。

**Q18：少卖怎么发现和修复？**

监控「Redis 扣减数 - 有效订单数」的差值；对账任务比对 Redis 剩余、DB 库存、订单数量；差值超过阈值告警。修复：能补单的补单，不能补单的回滚库存并记录；所有操作留审计日志。

**Q19：秒杀和普通下单有什么区别？**

普通下单追求一致性和用户体验，可以同步落库；秒杀追求吞吐和防超卖，必须异步化、层层过滤、强一致只保留在库存扣减。普通下单的库存扣减可以直接走 DB，秒杀必须先走 Redis。

**Q20：如果让你从零设计，你的步骤是什么？**

① 估算流量和库存量级；② 画漏斗，确定每层拦截策略；③ 设计 Redis 库存模型和 Lua 扣减；④ 设计异步下单和消息可靠性；⑤ 设计 DB 兜底、幂等、对账；⑥ 设计限流、降级、监控；⑦ 压测验证并调参；⑧ 演练故障预案。**先保证不超卖，再优化性能，最后完善体验。**

# 十二、落地检查清单

## 12.1 前端

```text
□ 页面静态化 + CDN，活动前预热
□ 倒计时使用服务器时间校正
□ 按钮防连点，requestId 幂等
□ 验证码/答题错峰，预约资格前置
□ 结果页轮询带退避，避免二次洪峰
□ 静态降级页兜底
□ 所有前端校验在后端重做
```

## 12.2 接入层

```text
□ IP / 用户 / 设备 / 接口多维度限流
□ 黑名单与风控规则前置
□ 签名 + 时间窗 + nonce 防重放
□ 超时、熔断、降级配置
□ 秒杀接口与常规业务隔离
```

## 12.3 服务与缓存

```text
□ 服务无状态，可水平扩容
□ 库存预热，key 设置过期
□ Lua 原子扣减 + 限购
□ 令牌削峰
□ 幂等（requestId + 唯一索引）
□ 热点 key 压测，必要时分段
□ Redis 故障降级预案
```

## 12.4 消息与数据库

```text
□ 本地消息表 / 事务消息保证不丢
□ 消费幂等 + 重试 + 死信
□ 延迟队列关单 + 库存回滚
□ DB 条件更新兜底，绝不超卖
□ 唯一索引防重与限购
□ 事务短小，不在事务内做 RPC
□ 分库分表与归档策略
□ 对账任务 + 差异告警
```

## 12.5 运维

```text
□ 全链路压测 + 影子库
□ 监控：QPS / RT / 错误率 / 库存 / 堆积 / 主从延迟
□ 降级开关可一键操作
□ 故障演练（Redis 宕机、MQ 堆积、DB 慢查询）
□ 活动复盘：超卖/少卖/拦截率/转化率
```

---

秒杀系统的难点从来不是某一个技术点，而是**在极端流量下同时守住「不超卖、不少卖、不被打垮」三条线**。Redis 解决性能，数据库守住正确性，MQ 解决削峰和解耦，前端和网关解决无效流量，对账解决所有异步链路的最后一致性。

如果只记一句话：**把强一致收敛到库存扣减的原子操作上，把其他一切都做成可重试、可补偿、可对账的异步流程。**
