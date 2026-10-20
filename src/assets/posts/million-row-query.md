「百万数据查询怎么优化」是一道很典型的面试题，因为它同时考察三件事：**你知不知道数据库在干什么、你会不会按成本排序手段、你能不能判断什么时候该换架构。**

先说一个可能反直觉的结论：**一百万行对现代数据库不算大。** 一张行宽正常的表，主键查一行是毫秒级；全表扫描一百万行，通常在几十毫秒到几百毫秒之间。真正让查询变慢的，往往不是「数据有百万行」，而是下面这些事：

- 一次查询**扫了**百万行，却只返回 20 行
- 为了 20 行**回表**了十万次
- 对百万行做了**排序**或**临时表聚合**
- 用 `LIMIT 1000000, 20` 让数据库先数完一百万行再丢掉
- 在百万行上做 `LIKE '%关键词%'`、`ORDER BY RAND()`、多表无索引 JOIN
- 把百万行**全量取回应用层**再过滤

所以优化的正确顺序不是「上分库分表」，而是：

```text
先测量 → 再改 SQL → 再改索引 → 再改表结构 → 最后才改架构
```

越往后，成本越高、风险越大。**能用一条索引解决的，不要用分库分表解决。**

![百万数据查询优化路径：先用执行计划定位扫描行数、回表、排序和临时表，再按 SQL、索引、表结构、架构的成本顺序逐层优化](/images/blog/million-row-query/query-diagnosis.svg)

> 索引的底层结构、B+ 树、最左前缀、EXPLAIN 逐列读法，在《SQL 索引与执行计划》里已经详细讲过。这篇只讲**面对百万级数据时，具体怎么下手**。

# 一、先量清楚：慢在哪

## 1.1 只看三个数字

拿到一条慢查询，先别急着改。打开 `EXPLAIN`，只看三个东西：

| 指标 | 在哪里看 | 说明 |
| --- | --- | --- |
| **扫描行数** | `rows`（估算）/ `EXPLAIN ANALYZE` 的 actual rows | 数据库实际读了多少行 |
| **回表次数** | `Extra` 是否有 `Using index` | 没有覆盖索引就要回表 |
| **额外操作** | `Using filesort` / `Using temporary` | 排序、分组、去重是否走了磁盘 |

判断逻辑非常直接：

```text
扫描行数 ≈ 返回行数          → 索引基本合适，问题可能在网络或结果集
扫描行数 >> 返回行数         → 索引缺失、失效，或条件选择性差
扫描行数不大但很慢           → 回表多、排序、锁等待、函数计算
返回行数很大                 → 不该一次取这么多，分页/异步/导出
```

一个常见误区是只看「有没有走索引」。**走了索引也可能很慢**：如果索引扫描了 50 万行、回表 50 万次，还不如全表顺序扫描。优化目标是**减少实际访问的页数和行数**，不是让 `key` 列不为 `NULL`。

## 1.2 定位工具

**MySQL**：

```sql
-- 1. 慢查询日志
SET GLOBAL slow_query_log = ON;
SET GLOBAL long_query_time = 0.5;
SET GLOBAL log_queries_not_using_indexes = ON;

-- 2. performance_schema：按 SQL 指纹聚合，最适合找 Top SQL
SELECT digest_text,
       count_star,
       avg_timer_wait / 1e9 AS avg_ms,
       sum_rows_examined,
       sum_rows_sent
FROM performance_schema.events_statements_summary_by_digest
ORDER BY sum_timer_wait DESC
LIMIT 20;

-- 3. 看真实执行，而不只是估算
EXPLAIN ANALYZE SELECT ...;
```

**PostgreSQL**：

```sql
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

SELECT query, calls, mean_exec_time, total_exec_time, rows
FROM pg_stat_statements
ORDER BY total_exec_time DESC
LIMIT 20;

EXPLAIN (ANALYZE, BUFFERS) SELECT ...;
```

**关键是对比估算行数和实际行数**。如果 `rows=10` 而 `actual rows=500000`，说明统计信息严重失真，优化器一定选错计划，先 `ANALYZE` 再谈优化。

## 1.3 症状 → 根因 → 首选手段

| 症状 | 最可能的根因 | 首选手段 |
| --- | --- | --- |
| 扫描行数远大于返回行数 | 没索引 / 索引失效 / 区分度低 | 补索引、改写条件 |
| 扫描行数不大但响应慢 | 回表多、随机 I/O | 覆盖索引 |
| `Using filesort` | 排序字段不在索引顺序里 | 调整联合索引或 SQL |
| `Using temporary` | 分组/去重无索引 | 让 `GROUP BY` 利用索引，或预聚合 |
| 查询本身很快，偶发很慢 | 锁等待、Buffer Pool 污染、慢 SQL 争抢 | 看锁、隔离事务、限流 |
| 返回行数太大 | 一次取全量 | 分页、游标、异步导出 |
| 单条 SQL 优化到极限仍慢 | 数据量/访问模式超出单库能力 | 冷热分离、分区、分表、ES/OLAP |

# 二、SQL 层：不扫不需要的行

SQL 层是成本最低、收益最快的一层。下面这些改法，大多数不需要改表结构。

## 2.1 不要 `SELECT *`

`SELECT *` 有三个代价：

1. **破坏覆盖索引**：本来索引里有 `id, user_id, created_at`，你多查一个 `content`，就必须回表
2. **增加网络传输**：百万行结果集里多一个大字段，可能多传几百 MB
3. **增加内存和 GC 压力**：应用层反序列化、对象拷贝都要成本

```sql
-- 慢：amount、remark 不在索引里，必须回表
SELECT * FROM orders WHERE user_id = 1007 ORDER BY created_at DESC LIMIT 20;

-- 快：只取列表页需要的列
SELECT id, status, amount, created_at
FROM orders
WHERE user_id = 1007
ORDER BY created_at DESC
LIMIT 20;
```

如果列表页确实需要详情字段，正确做法是**列表只查索引列，详情按 id 再查一次**（批量 `IN`），而不是在主查询里 `SELECT *`。

## 2.2 让 WHERE 真正用上索引

这几类写法要重点检查：

| 写法 | 问题 | 改法 |
| --- | --- | --- |
| `WHERE YEAR(created_at) = 2026` | 对索引列做函数 | 改成 `>= '2026-01-01' AND < '2027-01-01'` |
| `WHERE phone = 13800138000`（phone 是 VARCHAR） | 隐式类型转换，列被转成数字 | 参数加引号，类型与列一致 |
| `WHERE name LIKE '%张%'` | 前缀不确定，无法走 B+ 树 | 前缀匹配、全文索引或 ES |
| `WHERE status != 0` | 选择性低，优化器可能放弃索引 | 改成枚举范围，或建联合索引 |
| `WHERE a = 1 OR b = 2` | 一侧无索引就退化成全表扫描 | 两侧都建索引，或改 `UNION ALL` |
| `WHERE id IN (1000 个值)` | 解析和优化成本高 | 分批 500–1000 个，或临时表 JOIN |
| `WHERE deleted_at IS NULL` | 若大部分行都满足，全扫更便宜 | 用状态位 + 联合索引，或部分索引 |

## 2.3 深分页：`LIMIT 1000000, 20` 为什么慢

`LIMIT offset, size` 的语义是「先取出 offset+size 行，再丢弃前 offset 行」。所以翻到第 5 万页时，数据库要**扫描并丢弃 100 万行**，越往后越慢。

![OFFSET 分页与游标分页：OFFSET 需要扫描并丢弃前面所有行，游标分页用上一页最后一条记录的排序键直接定位起点](/images/blog/million-row-query/pagination.svg)

三种优化方式，按适用场景选：

**① 游标分页（seek method）—— 最优，但有前提**

```sql
-- 上一页最后一条：created_at = '2026-10-01 12:00:00', id = 500123
SELECT id, status, amount, created_at
FROM orders
WHERE (created_at, id) < ('2026-10-01 12:00:00', 500123)
ORDER BY created_at DESC, id DESC
LIMIT 20;
```

只要 `(created_at, id)` 上有联合索引，数据库就能直接定位到起点，**代价与页码无关**。限制是不能跳页，只能「下一页」；排序键必须稳定且唯一（用 `id` 兜底）。

**② 延迟关联（deferred join）—— 适合必须跳页的后台**

```sql
SELECT o.id, o.status, o.amount, o.created_at
FROM orders o
JOIN (
  SELECT id
  FROM orders
  WHERE user_id = 1007
  ORDER BY created_at DESC
  LIMIT 1000000, 20
) t ON t.id = o.id;
```

子查询只扫索引（覆盖索引），回表只有 20 次。但**子查询本身仍要扫 100 万条索引项**，只是比扫整行便宜。数据量再大，延迟关联也救不了。

**③ 业务限制 + 预计算**

绝大多数产品不需要让用户翻到第 100 万条。限制最大可翻页数、只提供「下一页」、或者用搜索/筛选代替深翻页，往往比任何 SQL 技巧都有效。

## 2.4 JOIN：先保证关联列有索引

JOIN 慢通常不是 JOIN 本身慢，而是：

- 被驱动表的关联列**没有索引**，导致每驱动一行就全表扫一次
- 驱动表选错，小表没驱动大表
- JOIN 后再排序/聚合，中间结果集巨大
- 关联列**类型或字符集不一致**，索引失效

```sql
-- 假设 o.user_id 有索引，u.id 是主键
SELECT o.id, o.amount, u.name
FROM users u
JOIN orders o ON o.user_id = u.id
WHERE u.city = '杭州'
  AND o.created_at >= '2026-01-01';
```

优化顺序：

1. 给 `orders.user_id` 建索引（被驱动表关联列必须可索引）
2. 让过滤后行数少的表做驱动表（MySQL 优化器通常会自己选，但统计信息不准时会选错）
3. 先在子查询里把 `orders` 缩小，再 JOIN，避免先连接再过滤
4. JOIN 的列类型、字符集、排序规则完全一致

**子查询 vs JOIN**：不要死记「JOIN 一定比子查询快」。MySQL 5.6+ 会把 `IN` 子查询做半连接（semi-join）优化，PostgreSQL 也会重写。真正要避免的是**相关子查询在循环里反复执行**，以及 `NOT IN` 遇到 `NULL` 导致的语义和性能问题。

```sql
-- 容易踩坑：子查询结果含 NULL 时，NOT IN 返回空集
SELECT * FROM users WHERE id NOT IN (SELECT user_id FROM orders);

-- 更稳：NOT EXISTS
SELECT * FROM users u
WHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.user_id = u.id);
```

## 2.5 聚合：避免对百万行做临时表

```sql
-- 慢：status 区分度低，GROUP BY 可能用临时表 + filesort
SELECT status, COUNT(*), SUM(amount)
FROM orders
WHERE created_at >= '2026-01-01'
GROUP BY status;
```

优化方向：

- 建 `(created_at, status)` 联合索引，让范围过滤和分组都走索引
- 如果只是固定维度的统计，用**汇总表**按小时/天预聚合，查询时直接读结果
- 大屏/报表不要实时扫明细，走 OLAP 或 T+1 离线表
- `COUNT(DISTINCT col)` 在大数据量上很贵，能预计算就预计算

## 2.6 批量与 N+1

```java
// 反例：N+1 查询，1000 个订单查 1001 次
for (Order o : orders) {
    User u = userMapper.selectById(o.getUserId());
    o.setUserName(u.getName());
}

// 正例：一次批量查，再在内存里拼装
Map<Long, User> userMap = userMapper.selectByIds(userIds).stream()
    .collect(Collectors.toMap(User::getId, u -> u));
orders.forEach(o -> o.setUserName(userMap.get(o.getUserId()).getName()));
```

批量 `IN` 也要控制大小：单次 500–1000 个比较稳妥，太大容易导致 SQL 解析慢、执行计划不稳定、网络包过大。超大集合可以写入临时表再 JOIN。

## 2.7 结果集：不要一次取回百万行

- 列表接口必须分页，并且限制 `pageSize` 上限（如 100）
- 导出走**异步任务**：提交任务 → 后台分批查询 → 生成文件 → 通知下载
- JDBC 流式读取：MySQL 设置 `useCursorFetch=true` + `fetchSize`，PostgreSQL 设置 `autoCommit=false` + `fetchSize`
- 不要在应用层 `selectList()` 后再 `stream().filter()`，过滤条件应该下推到 SQL

# 三、索引层：让每次查询只碰少量页

## 3.1 联合索引的顺序

一条高频查询：

```sql
SELECT id, amount FROM orders
WHERE user_id = ? AND status = ? AND created_at >= ?
ORDER BY created_at DESC
LIMIT 20;
```

推荐索引 `(user_id, status, created_at)`：

- `user_id`、`status` 是等值条件，放前面
- `created_at` 是范围条件，放最后（范围列后面的列无法用于定位）
- `created_at` 的排序方向与 `ORDER BY` 一致，可以消除 `filesort`
- 如果 `amount` 也加进去，就变成覆盖索引，但索引会更宽，要权衡

**不要机械地按「区分度从高到低」排序**。三个列都是等值条件时，顺序对定位影响不大，真正决定顺序的是：等值列优先、范围列靠后、排序列跟上、覆盖列按需追加。

## 3.2 覆盖索引：消灭回表

```sql
-- idx_user_created (user_id, created_at)
SELECT id, user_id, created_at
FROM orders
WHERE user_id = 1007;
-- Extra: Using index
```

InnoDB 二级索引叶子自带主键，所以查主键也覆盖。**覆盖索引的收益在百万级数据上非常明显**：从「索引页 + 随机回表 10 万次」变成「只扫索引页」。

代价是索引变宽、写入变慢。只给**高频且收益明显**的查询加覆盖列，不要把所有列都塞进索引。

## 3.3 索引下推与索引合并

- **ICP（索引下推）**：`Extra: Using index condition`，在存储引擎层先用索引列过滤，再回表。能减少回表，但不能让范围列之后的列参与定位。
- **index merge**：`type: index_merge`，把多个索引的结果合并。它常常是「没有合适的联合索引」的信号，优先建联合索引，不要依赖 index merge。

## 3.4 统计信息与优化器

百万级表上，统计信息失真的后果比小表严重得多：

```sql
ANALYZE TABLE orders;          -- MySQL
VACUUM ANALYZE orders;         -- PostgreSQL
```

如果 `EXPLAIN` 的 `rows` 和 `EXPLAIN ANALYZE` 的 actual rows 差几个数量级，先更新统计信息；仍然偏差大，说明数据倾斜严重，考虑：

- 调整采样页数（MySQL `innodb_stats_persistent_sample_pages`）
- 使用多列统计（PostgreSQL `CREATE STATISTICS`）
- 改写 SQL，减少优化器的估算难度
- 最后才考虑 `FORCE INDEX` 或 hint

## 3.5 百万数据加索引

```sql
ALTER TABLE orders
  ADD INDEX idx_user_status_created (user_id, status, created_at),
  ALGORITHM=INPLACE, LOCK=NONE;
```

注意事项：

- MySQL 5.6+ Online DDL 不阻塞读写，但仍要**全表扫描 + 排序**，会消耗大量 I/O
- 在低峰期执行，监控主从延迟、磁盘空间、Buffer Pool
- 超大表用 gh-ost / pt-online-schema-change；PostgreSQL 用 `CREATE INDEX CONCURRENTLY`
- 加索引前先用 `EXPLAIN` 验证能命中，避免白加

## 3.6 清理冗余和未使用索引

```sql
SELECT * FROM sys.schema_redundant_indexes;
SELECT * FROM sys.schema_unused_indexes;
```

`(user_id)` 是 `(user_id, status)` 的最左前缀，属于冗余；从没被使用的索引只会拖慢写入。**百万级表的每个多余索引，都是实打实的写入成本和 Buffer Pool 占用。**

# 四、表和数据集：减少需要扫的数据

当 SQL 和索引都优化到极限，仍然慢，说明**要扫的数据本身太多了**。这时候要从「数据集」下手。

## 4.1 冷热分离与归档

订单、日志、消息这类表，通常 90% 的查询只关心最近 3–6 个月，但表里存了 5 年数据。

```sql
-- 热表：只保留最近 6 个月
CREATE TABLE orders_hot LIKE orders;
INSERT INTO orders_hot SELECT * FROM orders WHERE created_at >= '2026-04-01';

-- 冷表 / 归档库：历史数据
CREATE TABLE orders_archive LIKE orders;
INSERT INTO orders_archive SELECT * FROM orders WHERE created_at < '2026-04-01';
```

收益：

- 热表从 1 亿行降到 1000 万行，索引更小，Buffer Pool 命中率更高
- 备份、DDL、统计信息维护都更快
- 历史查询走归档库，互不影响

代价：跨热冷查询要应用层聚合；归档任务要保证一致性；删除历史数据要分批，避免大事务和主从延迟。

## 4.2 分区表

```sql
-- PostgreSQL 声明式分区
CREATE TABLE orders (
  id BIGINT,
  created_at DATE NOT NULL,
  amount NUMERIC
) PARTITION BY RANGE (created_at);

CREATE TABLE orders_2026_09 PARTITION OF orders
  FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');
```

MySQL 也支持 `PARTITION BY RANGE`，但限制更多（唯一键必须包含分区键、外键限制等）。

**分区不是分表**：数据还在一个实例里，只是物理上分文件。它的价值是**分区裁剪**和**按分区归档/删除**：

```sql
-- 只扫 2026-10 分区
SELECT * FROM orders WHERE created_at >= '2026-10-01';
```

如果查询条件不带分区键，会扫描所有分区，反而更慢。**分区表适合「按时间范围查询 + 定期归档」的场景，不适合解决任意条件的查询性能。**

## 4.3 垂直拆分

把不常用的大字段拆到扩展表：

```sql
CREATE TABLE order_detail (
  order_id BIGINT PRIMARY KEY,
  remark TEXT,
  extra JSON
);
```

主表变窄后，每页能放更多行，全表扫描和索引扫描的 I/O 都更少。代价是查详情要多一次 JOIN；如果每次列表都要详情，反而可能更慢。

## 4.4 水平拆分（分库分表）

**什么时候考虑分表**：单表数据量超过千万到亿级，且经过索引、归档、分区后仍无法满足写入或查询性能；或者单库连接数/I/O 已经成为瓶颈。

**分片键选择**：

| 分片键 | 优点 | 缺点 | 适用 |
| --- | --- | --- | --- |
| `user_id` | 同一用户数据聚在一起，查「我的订单」高效 | 运营按时间/状态查要广播 | C 端业务 |
| `order_id` | 分布均匀，按 id 查快 | 按用户查要额外索引表 | 订单详情 |
| `created_at` | 便于按时间归档 | 热点集中在最新分片 | 日志、流水 |
| 一致性哈希 | 扩容迁移少 | 范围查询差 | 缓存、均匀分布 |

**分表后的新问题**：

- 跨分片 JOIN、排序、分页、聚合都要应用层或中间件处理
- 分布式事务（尽量避免，用最终一致）
- 全局唯一 ID（雪花算法、号段）
- 扩容迁移（成倍扩容 + 双写迁移，或一致性哈希）
- 跨分片查询：建立映射表、冗余宽表、或同步到 ES

**分表是最后手段**。百万级数据通常根本不需要，千万级也常常可以通过归档和索引解决。面试时先答 SQL/索引/归档，再答分表，才是合理的优先级。

## 4.5 反范式与宽表

适度冗余可以减少 JOIN：

```sql
-- 订单表冗余用户名，避免列表页 JOIN 用户表
ALTER TABLE orders ADD COLUMN user_name VARCHAR(64);
```

代价是数据一致性：用户改名后要同步更新历史订单（或者接受历史快照语义）。**读多写少、容忍最终一致**的场景适合反范式；写多、强一致的场景要谨慎。

## 4.6 汇总表与物化视图

报表类查询不要每次扫明细：

```sql
CREATE TABLE order_daily_summary (
  stat_date DATE,
  status TINYINT,
  order_count BIGINT,
  total_amount DECIMAL(18,2),
  PRIMARY KEY (stat_date, status)
);

-- 定时任务按天聚合，查询直接读汇总表
```

PostgreSQL 原生支持物化视图；MySQL 没有原生物化视图，通常用汇总表 + 定时任务替代。**预聚合的本质是用写入时的计算换查询时的扫描**。

## 4.7 数据类型

- 能用 `INT` 就不用 `VARCHAR` 存数字；能用 `BIGINT` 就不用字符串存 ID
- 时间用 `DATETIME` / `TIMESTAMP`，不要用字符串
- 枚举用 `TINYINT`，不要用长字符串
- 大字段（TEXT/BLOB）拆到扩展表或对象存储
- 控制行宽：行越窄，每页装的行越多，扫描越快

# 五、架构层：把查询从数据库挪走

当单库优化到极限，下一步不是继续压数据库，而是**让数据库只承担它最擅长的部分**。

## 5.1 多级缓存

```text
浏览器缓存 → CDN → Nginx 本地缓存 → 应用本地缓存（Caffeine）→ Redis → DB
```

| 层级 | 适合缓存 | 失效方式 |
| --- | --- | --- |
| 浏览器 / CDN | 静态资源、公开数据 | 版本号、Cache-Control、刷新 |
| Nginx | 热点接口响应 | `proxy_cache`、过期时间 |
| 本地缓存 | 极热、变化少的数据 | TTL、主动失效广播 |
| Redis | 会话、对象、列表、计数 | TTL、写后删除、binlog 订阅 |

缓存的三个经典问题：

- **穿透**：查不存在的数据 → 空值缓存、布隆过滤器、参数校验
- **击穿**：热点 key 过期瞬间打到 DB → 互斥重建、逻辑过期、永不过期 + 后台刷新
- **雪崩**：大量 key 同时过期或 Redis 宕机 → 过期时间加随机、多级缓存、熔断降级

**缓存一致性**：常用 Cache-Aside（读时回填、写后删除）。删除失败时用延迟双删或订阅 binlog 补偿。不要试图做强一致，接受短暂不一致，用 TTL 兜底。

## 5.2 读写分离

- 写走主库，读走从库
- 主从复制有延迟，**写后立即读**可能读不到 → 强制走主库，或等待位点
- 大查询、报表查询隔离到只读从库，避免影响核心业务
- 监控 `Seconds_Behind_Master` / `pg_stat_replication`，延迟超阈值告警

## 5.3 搜索引擎

`LIKE '%关键词%'`、多条件组合筛选、相关性排序，这些不是 B+ 树的强项。

| 需求 | 方案 |
| --- | --- |
| 前缀匹配 `abc%` | B+ 树索引 |
| 全文检索、分词、相关性排序 | Elasticsearch / OpenSearch |
| 多条件任意组合筛选 | ES 倒排索引 + filter |
| 海量日志检索 | ES / ClickHouse |

ES 的数据通过 CDC 同步（Canal、Debezium、DataX），采用「全量初始化 + 增量订阅」，消费端保证幂等。**ES 是最终一致**，刷新间隔默认 1 秒，不能当作强一致的数据库用。

## 5.4 OLAP

统计、报表、大屏这类「扫描大量行、只返回少量聚合」的查询，应该走列式分析引擎：

| 引擎 | 特点 | 适用 |
| --- | --- | --- |
| ClickHouse | 列式、向量化、MergeTree、聚合极快 | 日志、埋点、报表 |
| Apache Doris / StarRocks | MPP、支持 JOIN、易用 | 实时数仓、BI |
| TiDB | HTAP、兼容 MySQL | 需要事务 + 分析的混合场景 |
| 离线数仓 | Hive / Spark | T+1 报表、海量历史 |

**不要用 OLTP 库跑大报表**：一条 `GROUP BY` 可能扫几千万行，把 Buffer Pool 冲掉，拖慢所有在线业务。

## 5.5 选型矩阵

| 场景 | 首选 | 次选 |
| --- | --- | --- |
| 按主键/索引点查 | MySQL / PostgreSQL | Redis 缓存 |
| 列表分页 + 多条件等值过滤 | 联合索引 + 覆盖索引 | ES |
| 全文搜索 / 模糊匹配 | Elasticsearch | 全文索引 |
| 实时聚合报表 | ClickHouse / Doris | 汇总表 |
| 海量历史明细 | 数据湖 / 归档库 | 分区表 |
| 超高并发热点读 | 多级缓存 | 读写分离 |

# 六、五个真实场景

## 6.1 后台订单列表：多条件 + 分页

**问题**：运营按时间、状态、用户、金额区间组合筛选，百万级订单，翻页越来越慢。

**诊断**：条件组合太多，不可能为每种组合建索引；深分页扫描大量行。

**方案**：

1. 固定最高频的组合，建 2–3 个联合索引，例如 `(status, created_at)`、`(user_id, created_at)`
2. 强制带时间范围（默认最近 30 天），缩小数据集
3. 翻页改成游标分页，或限制最大页数
4. 列表只返回索引列，详情按 id 批量查
5. 条件非常灵活时，同步一份到 ES，用 ES 做筛选和分页

**结果**：从全表扫描 + filesort 降到索引范围扫描，P99 从秒级降到几十毫秒。

## 6.2 报表导出：百万行导出

**问题**：一次性 `SELECT *` 百万行，内存溢出、接口超时、数据库 I/O 打满。

**方案**：

1. 改成异步任务：提交 → 返回 taskId → 后台分批查询 → 生成 CSV/Excel → 通知下载
2. 每批 1000–5000 行，按主键或时间游标推进，避免 OFFSET
3. 流式写入文件，不把全量结果放在内存
4. 导出走只读从库，限制并发导出任务数
5. 超过一定行数要求缩小时间范围，或走离线数仓

## 6.3 模糊搜索：`LIKE '%关键词%'`

**问题**：用户搜索商品名，B+ 树索引完全失效，百万行全扫。

**方案**：

- 如果只是前缀搜索：`name LIKE '关键词%'` + 索引
- 如果需要任意位置匹配：全文索引（MySQL `FULLTEXT`、PostgreSQL `tsvector` + GIN）
- 如果需要分词、拼音、纠错、相关性排序：Elasticsearch
- 数据同步用 CDC，索引设计成 `keyword` + `text` 多字段，避免聚合字段

## 6.4 深分页：第 10 万页

**问题**：`LIMIT 1000000, 20` 每次扫 100 万行。

**方案**：

- C 端改成游标分页（只能下一页）
- 后台必须跳页时用延迟关联，并限制最大页数
- 更彻底的做法是改成「筛选 + 搜索」，而不是无限翻页

## 6.5 大 IN 查询：一次传 10 万个 ID

**问题**：SQL 解析慢、执行计划不稳定、网络包大，甚至超过 `max_allowed_packet`。

**方案**：

1. 分批 500–1000 个，循环查询后在内存合并
2. ID 来自另一个查询时，直接用 JOIN 或子查询，避免应用层搬运
3. 超大集合写入临时表，再 JOIN
4. 如果 ID 集合本身很大，反思业务设计：是否应该按时间/用户分片查询

# 七、优化检查清单

```text
□ 用 EXPLAIN ANALYZE 看过实际扫描行数，而不是只看估算
□ 确认扫描行数、回表次数、filesort、temporary
□ 统计信息是否最新，估算行数与实际是否接近
□ 是否 SELECT *，能否改成只取必要列
□ WHERE 是否有函数、隐式转换、前导 %、OR 非索引列
□ 联合索引是否符合最左前缀，范围列是否在最后
□ 高频查询是否能覆盖索引
□ 深分页是否改成游标或延迟关联
□ 大 IN 是否分批，是否存在 N+1
□ JOIN 关联列是否有索引，类型/字符集是否一致
□ 大表是否做了冷热分离/归档
□ 时间范围查询是否能利用分区裁剪
□ 报表是否走了汇总表/OLAP，而不是扫明细
□ 热点数据是否有多级缓存
□ 模糊搜索是否该交给 ES
□ 是否真的需要分库分表（还是索引/归档就能解决）
```

# 八、20 道高频面试题

**Q1：百万数据分页查询很慢，怎么优化？**

先看执行计划，确认是扫描行数多、回表多还是排序。优化顺序：覆盖索引 → 延迟关联 → 游标分页 → 限制最大页数。`LIMIT 1000000,20` 的本质是扫描并丢弃 100 万行，索引再好也绕不开 OFFSET 的语义。

**Q2：为什么 `LIMIT offset, size` 越往后越慢？**

数据库必须先产生 offset+size 行，再丢弃前 offset 行。offset 越大，扫描和丢弃的行越多，代价线性增长。游标分页用排序键直接定位起点，代价与页码无关。

**Q3：百万数据表要不要分库分表？**

通常不要。先做索引优化、归档、冷热分离、分区、读写分离、缓存。只有当单表数据量或写入/连接数确实超过单库能力，且其他手段都无效时，才考虑分表。分表会带来跨分片查询、事务、扩容等新问题。

**Q4：`SELECT *` 为什么慢？**

破坏覆盖索引导致回表、增加网络传输、增加应用层内存和 GC。列表页应只查必要列，详情按 id 批量查。

**Q5：什么是覆盖索引？**

查询所需列全部在索引中，无需回表。`EXPLAIN` 的 `Extra` 显示 `Using index`。InnoDB 二级索引自带主键，所以查主键也能覆盖。

**Q6：联合索引的列顺序怎么定？**

等值列在前、范围列在后、排序列紧跟等值列、按需追加覆盖列。不要机械按区分度排序；顺序要服务于查询模式。

**Q7：索引失效的常见原因？**

最左前缀缺失、索引列上做函数或运算、隐式类型转换、`LIKE '%x'`、`OR` 连非索引列、范围列之后的列、JOIN 字符集不一致、优化器基于成本放弃索引。

**Q8：`COUNT(*)` 在百万行上很慢，怎么办？**

InnoDB 不保存行数，`COUNT(*)` 会扫最小的二级索引。优化：缩小 WHERE 范围、加覆盖索引、用计数表/缓存、接受估算值、或异步统计。不要用 `COUNT(列)` 替代，它还要判断 NULL。

**Q9：大 IN 查询怎么优化？**

分批 500–1000 个；ID 来自数据库时用 JOIN/子查询；超大集合用临时表 JOIN；检查执行计划是否退化成全表扫描。

**Q10：模糊查询 `LIKE '%x%'` 怎么优化？**

B+ 树无法处理前导通配符。前缀匹配改 `'x%'`；全文检索用 `FULLTEXT` / PostgreSQL GIN；复杂搜索用 Elasticsearch。不要在大表上做 `LIKE '%x%'`。

**Q11：JOIN 很慢怎么排查？**

看被驱动表关联列是否有索引、关联列类型/字符集是否一致、驱动表是否选对、是否先 JOIN 再过滤导致中间结果过大。必要时先把大表过滤成小结果集再 JOIN。

**Q12：子查询和 JOIN 哪个快？**

没有绝对答案。现代优化器会做半连接、子查询展开。要避免的是相关子查询在循环中反复执行，以及 `NOT IN` 遇到 NULL 的语义陷阱，后者建议改 `NOT EXISTS`。

**Q13：分区表和分库分表有什么区别？**

分区表是单实例内的物理分文件，主要收益是分区裁剪和按分区归档；分库分表是跨实例的水平拆分，解决单库容量和写入瓶颈。分区表不能解决单机资源上限。

**Q14：分片键怎么选？**

看主要查询模式：C 端按 `user_id`，订单详情按 `order_id`，日志按时间。要保证分布均匀、大部分查询能带上分片键。避免选择会变化或区分度低的列。

**Q15：冷热分离怎么做？**

按时间或状态把热数据留在主表，历史数据迁移到归档表/归档库；查询按时间路由；归档任务分批执行，保证一致性；删除历史数据避免大事务。

**Q16：读写分离后读不到刚写的数据怎么办？**

主从复制有延迟。写后立即读强制走主库，或记录 binlog 位点等待从库追上；对一致性要求不高的列表页可以容忍延迟；监控复制延迟并告警。

**Q17：缓存和数据库怎么保持一致？**

Cache-Aside：读时回填、写后删除；删除失败用延迟双删或 binlog 订阅补偿；设置 TTL 兜底。接受最终一致，不要为了强一致引入分布式锁。

**Q18：什么时候该用 Elasticsearch？**

全文检索、分词、相关性排序、多条件任意组合筛选、海量日志检索。点查和强一致事务仍然用数据库；ES 通过 CDC 同步，天然最终一致。

**Q19：如何定位一条慢 SQL？**

慢查询日志 / performance_schema / pg_stat_statements 找到 Top SQL → `EXPLAIN ANALYZE` 看扫描行数、回表、排序、临时表 → 对比估算与实际 → 检查统计信息和锁 → 按 SQL、索引、表结构、架构的顺序优化。

**Q20：优化的优先级是什么？**

先测量，再改 SQL，再改索引，再改表结构（归档/分区/拆分），最后才改架构（缓存/读写分离/ES/OLAP/分库分表）。越往后成本越高、风险越大。能用索引解决的不要用架构解决。

# 九、结论

百万数据查询优化，真正要回答的不是「加什么中间件」，而是三个问题：

1. **这条查询到底扫了多少行？** —— 用执行计划说话，不靠猜
2. **这些行里有多少是不必要的？** —— 索引、覆盖、条件下推、分页
3. **这些数据是否本来就不该放在一张热表里？** —— 归档、分区、拆分、冷热分离

把这三层想清楚，大多数「百万数据慢查询」都不需要动架构。**数据库的大部分性能问题，不是数据太多，而是访问数据的方式不对。**
