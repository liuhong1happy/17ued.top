索引和执行计划是后端面试里最能拉开差距的一块。语法谁都会写，但同一个需求，有人写出来走覆盖索引扫 3 行，有人写出来全表扫 300 万行——差别不在「会不会 SQL」，而在**是否知道数据库会怎么执行这条 SQL**。

这篇文章把两件事绑在一起讲：

1. **索引**：为什么是 B+ 树、聚簇索引与二级索引如何协作、联合索引的最左前缀到底怎么算、索引又为什么会失效
2. **执行计划**：`EXPLAIN` 每一列在说什么、`type` 的等级、优化器凭什么选错索引、怎么读懂一次真实的执行

最后给出 **30 道高频面试题**，按「数据结构 → 索引设计 → 失效场景 → 执行计划 → 实战优化」分组，每题都是「结论 + 原因」，可以直接拿去对照自己的回答。

> 文中以 MySQL InnoDB 为主，关键处对照 PostgreSQL。示例表结构统一为：
>
> ```sql
> CREATE TABLE orders (
>   id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
>   user_id     BIGINT UNSIGNED NOT NULL,
>   status      TINYINT NOT NULL DEFAULT 0,
>   amount      DECIMAL(10,2) NOT NULL,
>   created_at  DATETIME NOT NULL,
>   KEY idx_user_created (user_id, created_at),
>   KEY idx_status (status)
> ) ENGINE=InnoDB;
> ```

![B+ 树索引结构：非叶节点只存键，叶子节点存数据并连成有序链表；二级索引查到主键后需要回表再查一次聚簇索引](/images/blog/sql-index-explain/btree-clustered.svg)

# 一、索引的本质：用空间和写入换查询

## 1.1 索引到底解决了什么

没有索引时，一张表就是一堆 16KB 的页，查一行只能从第一页翻到最后一页，这叫**全表扫描**。索引做的事情只有一句话：

> **额外维护一份按某个字段排好序的数据结构，让「找到目标行」从 O(N) 次页读取变成 O(log N) 次。**

注意这里的关键不是「排序」，而是**减少磁盘 I/O 次数**。内存里的二分查找再快，也救不了每次都去磁盘捞一页的开销。所以索引结构的评价标准只有两条：

- **树要矮**：一次查询碰到的页越少越好
- **一页要能装更多键**：扇出（fan-out）越大，树越矮

## 1.2 为什么是 B+ 树

先把常见候选结构放在一起对比：

| 结构 | 查找 / 范围 | 写入 | 为什么不选 / 用在哪 |
| --- | --- | --- | --- |
| 有序数组 | O(log N) 二分 / 好 | O(N) 搬移，代价高 | 只读场景；插入太慢 |
| 红黑树 / AVL | O(log N) / 中（中序遍历） | O(log N)，但树高约 25 层 | 二叉树每个节点只存一个键，3000 万行要 25 次随机 I/O |
| 哈希表 | O(1) 等值 / **不支持范围** | O(1) | 只支持等值；不支持范围、排序、最左前缀 |
| 跳表 | O(log N) 期望 / 好 | O(log N) | 内存结构；Redis ZSET、LevelDB MemTable 用它，不适合页式磁盘 |
| LSM Tree | O(log N) / 好（多路归并） | **极好**（顺序写） | 写多读少场景（RocksDB、HBase、Cassandra）；读放大与压缩成本高 |
| **B+ 树** | O(log N) / **好**（叶子链表） | O(log N) | InnoDB、PostgreSQL 默认索引 |

B+ 树胜出的四个原因，面试时要能张口就来：

1. **矮胖**：非叶节点只存键和页指针，不存数据。一个 16KB 页能放上千个键，扇出极大。以 `BIGINT` 主键（8 字节）+ 6 字节页指针计算，一页约能放 `16384 / 14 ≈ 1170` 个键；三层 B+ 树可以索引 `1170 × 1170 × 16 ≈ 2190 万` 行（叶子页按每页 16 行估算）。也就是说，**2000 万行的表，查一行最多 3 次页读取**，而且根节点和热点非叶节点大概率在 Buffer Pool 里，实际磁盘 I/O 往往只有 1 次。
2. **范围查询天然友好**：所有数据都在叶子节点，且叶子之间用双向链表连起来。`WHERE id BETWEEN 100 AND 200` 只要定位到 100，然后顺着链表往后扫，不需要回到上层。
3. **查询性能稳定**：任何一次查找都走到叶子，路径长度一致，不像 B 树可能在非叶节点就命中，导致性能波动。
4. **页利用率高**：非叶节点不存行数据，同样的页能容纳更多索引项，减少树高与 I/O。

**B 树和 B+ 树的区别**一句话说清：B 树的每个节点都存数据，范围查询需要中序遍历、频繁跳层；B+ 树只在叶子存数据，非叶节点纯做导航，叶子成链。前者扇出小、范围查询差，后者正好相反。

## 1.3 聚簇索引与二级索引

InnoDB 是**索引组织表**（index-organized table）：表数据本身就挂在主键 B+ 树的叶子节点上，这棵树叫**聚簇索引**（clustered index）。

- 有主键 → 主键就是聚簇索引
- 没有主键 → 选第一个 `NOT NULL` 的唯一索引
- 都没有 → 生成一个 6 字节的隐藏 `row_id`

其余索引都叫**二级索引**（secondary index，也叫辅助索引）。二级索引的叶子节点存的**不是行位址，而是主键值**。所以通过二级索引查非索引列时，需要：

```text
二级索引树查找 → 得到主键 → 拿主键再去聚簇索引树查找 → 得到整行
```

这一步叫**回表**。一次查询的代价从「一棵树」变成「两棵树」，而且第二棵树的查找是**随机 I/O**——这就是为什么 `SELECT *` 往往比覆盖索引慢一个量级。

对照 PostgreSQL：默认是**堆表**（heap），所有索引（包括主键）都是二级索引，索引项指向 `ctid`（页号 + 页内偏移），不存在「聚簇索引」这个概念。PostgreSQL 的 `CLUSTER` 命令只是按某个索引重排一次物理顺序，之后的插入并不会维持顺序。

## 1.4 覆盖索引：消灭回表

如果一条查询需要的所有列都在索引里，引擎就不必回表，这叫**覆盖索引**。`EXPLAIN` 的 `Extra` 会显示 `Using index`。

```sql
-- idx_user_created (user_id, created_at)
SELECT user_id, created_at FROM orders WHERE user_id = 1007;
-- Extra: Using index  —— 索引里已有 user_id 和 created_at，不回表

SELECT user_id, created_at, amount FROM orders WHERE user_id = 1007;
-- Extra: Using index condition 或 Using where —— amount 不在索引里，必须回表
```

两个容易忽略的点：

1. **InnoDB 的二级索引叶子天然带主键**。所以 `SELECT id FROM orders WHERE user_id = 1007` 也能覆盖，因为 `id` 就在二级索引的叶子里。
2. **覆盖索引不是免费的**。把 `amount` 加进联合索引确实能让这条查询不回表，但索引变宽、写入变慢、Buffer Pool 能缓存的索引页变少。**用覆盖索引的前提是这条查询足够高频**，不是所有查询都值得。

## 1.5 索引的代价

索引不是越多越好，每一条索引都要付三份成本：

| 成本 | 具体表现 |
| --- | --- |
| 空间 | 每个二级索引都是一棵独立的 B+ 树，大表上一个索引可能就是几 GB |
| 写入放大 | 每次 `INSERT` / `UPDATE` / `DELETE` 都要维护所有相关索引；更新索引列时是「删旧项 + 插新项」 |
| 优化器负担 | 索引越多，优化器要评估的访问路径越多，选错的机率也越大 |

一般建议**单表索引控制在 5 个以内**，并且定期用 `sys.schema_unused_indexes` 找出从未被使用的索引。

# 二、索引类型与设计

## 2.1 索引的分类

| 分类维度 | 类型 | 说明 |
| --- | --- | --- |
| 物理结构 | B+ 树、哈希、全文、空间（R-Tree） | InnoDB 默认 B+ 树；自适应哈希索引（AHI）是引擎内部行为，不可手动建立 |
| 列的数量 | 单列索引、联合索引（复合索引） | 联合索引才是实务主流 |
| 约束 | 主键索引、唯一索引、普通索引 | 唯一索引插入时必须检查冲突，写入成本更高 |
| 存储内容 | 聚簇索引、二级索引、覆盖索引 | 覆盖索引不是一种索引类型，而是一种「查询恰好被索引覆盖」的状态 |
| 特殊形式 | 前缀索引、函数索引、降序索引、部分索引 | PostgreSQL 还支持 GIN / GiST / BRIN、部分索引（partial index） |

## 2.2 联合索引与最左前缀

联合索引 `(a, b, c)` 的排序规则是：**先按 a 排，a 相同再按 b 排，b 相同再按 c 排**。这决定了它能支持哪些查询。

| 查询条件 | 能否用索引 | 用到哪些列 | 说明 |
| --- | --- | --- | --- |
| `a = 1` | ✓ | a | 最左前缀 |
| `a = 1 AND b = 2` | ✓ | a, b | |
| `a = 1 AND b = 2 AND c = 3` | ✓ | a, b, c | 全匹配 |
| `a = 1 AND c = 3` | ✓（部分） | a（c 由 ICP 过滤） | 中间缺 b，c 无法用于定位 |
| `b = 2` | ✗ | — | 缺少最左列 a |
| `b = 2 AND c = 3` | ✗ | — | 同上 |
| `a = 1 AND b > 2 AND c = 3` | ✓（部分） | a, b（c 由 ICP 过滤） | **范围列之后的列无法用于索引定位** |
| `a > 1 AND b = 2` | ✓（部分） | a | 同上 |
| `a = 1 ORDER BY b` | ✓ | a, b | 索引本身有序，可避免排序 |
| `a = 1 ORDER BY c` | ✗（排序） | a | c 的顺序被 b 打断 |

**为什么范围查询后面的列用不上？** 因为 B+ 树在 `b > 2` 这个范围内，`c` 并不是全域有序的——只有 `b` 相同时 `c` 才有序。引擎能沿着 `a = 1, b > 2` 定位到一段连续区间，但区间内 `c` 是乱的，无法再二分。MySQL 5.6 之后的**索引下推（ICP）** 会在存储引擎层用 `c = 3` 提前过滤，减少回表次数，但它依然不能改变「c 不能用于定位」这件事。

**联合索引的列顺序怎么定？** 三个原则，按优先级排：

1. **等值查询的列放前面，范围查询的列放后面**——范围列一出现，后面的列就失去定位能力
2. **区分度高的列放前面**——能更快把扫描范围缩小（但如果有等值查询，等值列优先于区分度）
3. **考虑排序和覆盖**——把 `ORDER BY` 的列接在等值列后面，可以消除 `filesort`；把高频查询的 `SELECT` 列加进去，可以覆盖

> 一个常见误区：教条地按「区分度从高到低」排。实际上如果三个列都是等值查询，顺序对**定位**的影响很小（都能精确命中），真正的差别在于**能否覆盖索引、能否避免排序**。顺序应该服务于查询模式，而不是服务于一条抽象规则。

## 2.3 索引下推（ICP）

没有 ICP 时，联合索引 `(a, b)` 遇到 `WHERE a = 1 AND b LIKE '%x%'`：

1. 引擎用 `a = 1` 找到所有行
2. **每一行都回表**，把整行返回给 Server 层
3. Server 层再用 `b LIKE '%x%'` 过滤

有了 ICP（MySQL 5.6+），第 2 步之前就先在索引里用 `b` 过滤——`b` 虽然不能定位，但它的值就在索引页里，读它不需要额外 I/O。回表次数可能从 10 万降到 100。

`EXPLAIN` 里对应 `Extra: Using index condition`。控制开关是 `optimizer_switch='index_condition_pushdown=on'`。

**ICP 和覆盖索引的区别**：ICP 依然要回表，只是回表前先过滤；覆盖索引根本不回表。两者不是一回事。

## 2.4 前缀索引

对于 `VARCHAR(255)` 的 URL、邮箱这类长字段，全列索引太宽。可以只索引前 N 个字符：

```sql
ALTER TABLE users ADD INDEX idx_email_prefix (email(12));
```

**N 怎么选**：让前缀的区分度接近全列的区分度。

```sql
SELECT
  COUNT(DISTINCT LEFT(email, 8))  / COUNT(*) AS sel_8,
  COUNT(DISTINCT LEFT(email, 12)) / COUNT(*) AS sel_12,
  COUNT(DISTINCT email)           / COUNT(*) AS sel_full
FROM users;
```

当前缀区分度达到全列的 90% 以上就够了。

前缀索引的代价：

- **不能覆盖索引**——索引里只有前缀，没有完整值
- **不能用于 `ORDER BY` / `GROUP BY`**——前缀有序不代表全值有序
- **可能增加回表次数**——前缀相同的行都要回表确认

## 2.5 区分度、基数与统计信息

**区分度（selectivity）** = `COUNT(DISTINCT col) / COUNT(*)`，越接近 1 越好。

| 字段 | 区分度 | 适合建索引吗 |
| --- | --- | --- |
| 主键 / 手机号 / 订单号 | ≈1 | ✓ |
| 城市（几百个值） | 0.01 左右 | 视查询而定，通常作为联合索引的一部分 |
| 性别（2 个值） | ≈0.5 | ✗ 单独建索引没意义 |
| 状态（10 个值，且 95% 是同一状态） | 很低 | ✗ 除非查的是那个少数状态（可用部分索引） |

**基数（cardinality）** 是优化器对「不同值数量」的估算，来自统计信息。它不准会直接导致选错索引。更新统计信息：

```sql
ANALYZE TABLE orders;              -- MySQL
VACUUM ANALYZE orders;             -- PostgreSQL
```

MySQL 8.0 默认 `innodb_stats_persistent=ON`，统计信息落盘；但大表采样页数有限（`innodb_stats_transient_sample_pages` / `innodb_stats_persistent_sample_pages`），数据倾斜严重时估算会偏。PostgreSQL 用 `pg_statistic` 保存直方图，10+ 还支持多列统计（`CREATE STATISTICS`），对倾斜数据和列相关性的估算通常更准。

## 2.6 索引设计的三星原则

三星索引（Three-Star Index）是一个实用的检查清单：

| 星 | 含义 | 做法 |
| --- | --- | --- |
| ★ 第一星 | **等值条件列**都在索引最左侧 | `WHERE` 里的等值列放最前 |
| ★★ 第二星 | **排序 / 分组**的列顺序与索引一致 | `ORDER BY` 的列紧跟等值列，方向一致 |
| ★★★ 第三星 | **查询用到的列**都在索引里 | 覆盖索引，消灭回表 |

同时满足三星的索引最理想，但往往索引会很宽。实务上**先满足第一星消灭全表扫描，再按查询频率和效能收益决定要不要追求第二、第三星**。

## 2.7 冗余索引与未使用索引

```sql
-- 找出完全被其他索引覆盖的冗余索引
SELECT * FROM sys.schema_redundant_indexes;

-- 找出从未使用的索引（需开启 performance_schema / 至少运行一段时间）
SELECT * FROM sys.schema_unused_indexes;
```

`(a)` 是 `(a, b)` 的最左前缀，所以 `(a)` 冗余；`(a, b)` 和 `(b, a)` 不冗余，但通常只保留一个。冗余索引浪费空间、拖慢写入、干扰优化器，必须清理。

# 三、索引失效：完整清单

这一节是面试和实战的重合点。先把结论列成表，再逐条解释。

| # | 场景 | 是否失效 | 原因 / 解法 |
| --- | --- | --- | --- |
| 1 | 不满足最左前缀 | 失效 | 补齐最左列，或建新索引 |
| 2 | 索引列上做函数 / 运算 | 失效 | 改写成范围查询，或用函数索引 |
| 3 | 隐式类型转换（字符串列 = 数字） | 失效 | 参数类型与列一致 |
| 4 | `LIKE '%x'` / `'%x%'` | 失效 | 前缀匹配 `'x%'`，或全文索引 / 倒排索引 |
| 5 | `OR` 连接的列没有索引 | 失效 | 给每个列建索引，或改 `UNION ALL` |
| 6 | `!=` / `<>` / `NOT IN` | 常失效 | 选择性低时全扫更便宜；改 `NOT EXISTS` 或补索引 |
| 7 | 联合索引范围列之后的列 | 不能定位 | 调整索引顺序（范围列放最后） |
| 8 | 排序方向 / 顺序不匹配 | 产生 `filesort` | MySQL 8.0 降序索引，或调整索引列顺序 |
| 9 | 优化器基于成本放弃索引 | 「失效」 | 更新统计信息、`FORCE INDEX`（慎用）、改写 SQL |
| 10 | JOIN 两侧字符集 / 排序规则不一致 | 失效 | 统一字符集与 collation |
| 11 | `IS NULL` / `IS NOT NULL` | 视情况 | 可以走索引，但比例高时全扫更便宜 |
| 12 | 对索引列使用 `%` 之外的模糊匹配 / 正则 | 失效 | 全文索引、外部搜索引擎 |

## 3.1 隐式类型转换：最隐蔽的杀手

```sql
-- phone 是 VARCHAR(20)，有索引
SELECT * FROM users WHERE phone = 13800138000;   -- 失效！
```

MySQL 的比较规则是：**字符串与数字比较时，把字符串转成数字**。于是 `phone = 13800138000` 变成 `CAST(phone AS DOUBLE) = 13800138000`——对索引列做了函数，索引自然失效。

反过来：

```sql
-- id 是 BIGINT，有索引
SELECT * FROM users WHERE id = '1007';   -- 可以走索引
```

这里是把**常量** `'1007'` 转成数字，列本身没被改动，索引仍然可用。

**一条实用规则：参数类型永远与字段类型一致。** ORM 里把 ID 定义成 `String`、数据库里是 `BIGINT`，就是这类事故的高发区。

## 3.2 函数与表达式

```sql
-- 失效：对列做了 YEAR()
SELECT * FROM orders WHERE YEAR(created_at) = 2026;

-- 改写：变成范围查询，走 idx_user_created 或 created_at 索引
SELECT * FROM orders
WHERE created_at >= '2026-01-01' AND created_at < '2027-01-01';
```

函数索引（MySQL 8.0.13+）：

```sql
CREATE INDEX idx_created_year ON orders ((YEAR(created_at)));
```

PostgreSQL 更早支持表达式索引：

```sql
CREATE INDEX idx_lower_email ON users (LOWER(email));
SELECT * FROM users WHERE LOWER(email) = 'a@b.com';   -- 走索引
```

注意：函数索引要求查询里的表达式**与索引定义完全一致**，`LOWER(email)` 和 `lower(email)` 在 MySQL 里是两个东西（取决于是否规范化），写的时候要一致。

## 3.3 LIKE 与前缀匹配

| 写法 | 能否用索引 |
| --- | --- |
| `LIKE 'abc%'` | ✓ 前缀匹配，走范围扫描 |
| `LIKE '%abc'` | ✗ 无法确定起点 |
| `LIKE '%abc%'` | ✗ 同上 |
| `LIKE 'abc%def'` | ✓ 能用 `abc` 定位，`%def` 部分靠 ICP 过滤 |

`LIKE '%abc%'` 的优化方向：全文索引（MySQL `FULLTEXT`、PostgreSQL `tsvector` + GIN）、外部搜索引擎（Elasticsearch）、或者如果只是后缀匹配，可以反转字段再存一份（`REVERSE(url)`）做前缀匹配。

## 3.4 OR、不等于与 NOT IN

```sql
-- 假设 status 有索引，user_id 没有
SELECT * FROM orders WHERE status = 1 OR user_id = 1007;
-- 只要 OR 的一侧没有索引，整体就可能退化成全表扫描
```

原理：`OR` 要求两边都能高效定位，否则不如全扫一遍。MySQL 的 `index_merge` 在两列都有索引时可以合并结果，但 `index_merge` 本身有代价，且容易选错，不要过度依赖。

`!=` / `NOT IN` 的问题不是「一定失效」，而是**选择性通常太差**：如果 90% 的行都满足 `status != 0`，优化器会认为全扫比「走索引 + 大量回表」便宜。

## 3.5 优化器为什么「主动」放弃索引

这是最容易被误判为「索引失效」的情况。优化器是**基于成本**的：它估算走索引要读多少页、回表多少次，再和全表扫描比较。

```sql
-- idx_status (status)，但 95% 的行 status = 1
SELECT * FROM orders WHERE status = 1;
```

走二级索引要扫 95% 的索引页 + 对 95% 的行回表（随机 I/O），而全表扫描是顺序 I/O。**优化器选全扫是对的**，不是索引坏了。

应对方式：

1. 不要给低区分度字段单独建索引
2. 如果查的是少数值，用**部分索引**（PostgreSQL）或让查询带上更强的过滤条件
3. 更新统计信息，确认估算没有严重偏离
4. 真的需要强制时才用 `FORCE INDEX`，并且清楚自己在做什么

## 3.6 JOIN 的字符集陷阱

```sql
-- ua.charset = utf8mb4，ub.charset = utf8
SELECT * FROM user_a ua JOIN user_b ub ON ua.name = ub.name;
```

两侧字符集不同时，MySQL 需要转换后才能比较，**被转换一侧的索引失效**。这类问题在历史遗留系统里很常见，排查时看 `EXPLAIN` 的 `type` 突然变成 `ALL` 就要怀疑。统一字符集（全部 `utf8mb4`）是唯一的根治办法。

# 四、读懂执行计划

优化器不是「看到索引就用」，而是在多个候选路径里按成本挑一个。理解这一点，才不会把「优化器主动放弃索引」误判成「索引失效」。

![优化器生成执行计划的过程：解析重写后估算成本，比较索引扫描、全表扫描与连接顺序，最终选出计划；右下角是 EXPLAIN type 的等级与 Extra 的含义](/images/blog/sql-index-explain/optimizer-plan.svg)

## 4.1 MySQL EXPLAIN 的每一列

```sql
EXPLAIN SELECT * FROM orders
WHERE user_id = 1007 AND status = 1
ORDER BY created_at DESC
LIMIT 20;
```

| 列 | 含义 | 重点看什么 |
| --- | --- | --- |
| `id` | 查询序号 | 相同 id 自上而下执行；id 越大越先执行（子查询） |
| `select_type` | 查询类型 | `SIMPLE`、`PRIMARY`、`SUBQUERY`、`DERIVED`、`UNION` |
| `table` | 访问的表 | `derived2` 表示派生表 |
| `partitions` | 命中的分区 | 分区裁剪是否生效 |
| `type` | **访问类型** | 最重要的列，见 4.2 |
| `possible_keys` | 可能用的索引 | 有值但 `key` 为空 → 优化器放弃了 |
| `key` | 实际用的索引 | `NULL` 表示没走索引 |
| `key_len` | 索引使用的字节数 | 判断联合索引用到了几列 |
| `ref` | 索引比较的对象 | `const`、`func`、其他表的列 |
| `rows` | **估算扫描行数** | 越小越好；与实际差距大说明统计信息不准 |
| `filtered` | 过滤后剩余百分比 | `rows × filtered%` ≈ 最终参与后续操作的行数 |
| `Extra` | 附加信息 | `Using index` / `Using filesort` / `Using temporary` 是关键 |

## 4.2 type：访问类型等级

从好到坏：

| type | 含义 | 典型场景 |
| --- | --- | --- |
| `system` | 表只有一行 | 系统表 / 常量表 |
| `const` | 主键或唯一索引等值命中，最多一行 | `WHERE id = 1` |
| `eq_ref` | JOIN 时被驱动表用主键/唯一索引等值匹配 | 一对一关联 |
| `ref` | 非唯一索引等值匹配 | `WHERE user_id = 1007` |
| `fulltext` | 全文索引 | `MATCH ... AGAINST` |
| `ref_or_null` | `ref` + `IS NULL` | `WHERE col = 1 OR col IS NULL` |
| `index_merge` | 合并多个索引 | `OR` / 多条件 |
| `range` | 索引范围扫描 | `BETWEEN`、`>`、`IN`、`LIKE 'x%'` |
| `index` | **全索引扫描** | 扫整棵二级索引，比 `ALL` 略好（索引页小） |
| `ALL` | **全表扫描** | 没有可用索引 |

**实务底线：至少要达到 `range`，最好到 `ref`。** 出现 `index` 或 `ALL` 且表很大时，必须处理。

`const` / `eq_ref` / `ref` / `range` 的区别，本质是「一次能定位到多少行」：唯一索引等值 → 1 行（`const`）；JOIN 时唯一索引等值 → 1 行（`eq_ref`）；非唯一索引等值 → 一批（`ref`）；范围 → 一段（`range`）。

## 4.3 key_len 怎么算

`key_len` 是**索引实际使用的字节数**，用来判断联合索引命中了几列。

以 `idx_user_created (user_id BIGINT NOT NULL, created_at DATETIME NOT NULL)` 为例：

- `user_id`：8 字节
- `created_at`：MySQL 5.6+ 的 `DATETIME` 为 5 字节（不含小数秒）
- 可为 NULL 的列额外 +1 字节
- `VARCHAR(n)` 在 `utf8mb4` 下为 `4n + 2`（2 字节长度），可为 NULL 再 +1

| 查询 | key_len | 用到的列 |
| --- | --- | --- |
| `WHERE user_id = 1007` | 8 | user_id |
| `WHERE user_id = 1007 AND created_at > '2026-01-01'` | 13 | user_id + created_at |
| `WHERE created_at > '2026-01-01'` | — | 不满足最左前缀，key 为 NULL |

## 4.4 Extra：真正决定性能的细节

| Extra | 含义 | 该怎么做 |
| --- | --- | --- |
| `Using index` | **覆盖索引**，不回表 | 理想状态 |
| `Using where` | Server 层还需要过滤 | 结合 `rows` 判断过滤量；过大说明索引不够精准 |
| `Using index condition` | **索引下推（ICP）** | 正常，说明在引擎层提前过滤 |
| `Using filesort` | 需要额外排序，无法利用索引顺序 | 调整索引或 `ORDER BY`；`rows` 大时必须处理 |
| `Using temporary` | 用了临时表（`GROUP BY` / `DISTINCT` / `UNION`） | 让分组/去重利用索引顺序，或减少数据量 |
| `Using join buffer` | JOIN 没有可用索引，用了连接缓冲区 | 给被驱动表的关联列建索引 |
| `Using MRR` | 多范围读，把随机 I/O 合并为顺序 I/O | 通常是好事，但依赖 `optimizer_switch` |
| `Using index for group-by` | 利用索引完成分组，无临时表 | 理想状态 |

**`Using filesort` 不一定是磁盘排序**，它只是「没有用索引顺序」的标志，可能在内存 `sort_buffer` 里完成。但当 `rows` 很大、排序字段很宽时，会溢出到磁盘，性能急剧下降。

## 4.5 EXPLAIN ANALYZE：看真实执行

`EXPLAIN` 是**估算**，`EXPLAIN ANALYZE`（MySQL 8.0.18+）会真正执行并给出实际耗时：

```sql
EXPLAIN ANALYZE
SELECT * FROM orders WHERE user_id = 1007 ORDER BY created_at DESC LIMIT 20;
```

```text
-> Limit: 20 row(s)  (cost=1.05 rows=20) (actual time=0.081..0.092 rows=20 loops=1)
    -> Index lookup on orders using idx_user_created (user_id=1007)
       (cost=1.05 rows=10) (actual time=0.078..0.085 rows=20 loops=1)
```

重点对比 **estimated rows** 和 **actual rows**：

- 两者接近 → 统计信息可信
- 相差几个数量级 → 统计信息过期 / 数据倾斜 / 条件相关性被忽略，优化器必然选错

也可以打开 `optimizer_trace` 看优化器每一步的成本计算：

```sql
SET optimizer_trace = 'enabled=on';
SELECT ...;
SELECT * FROM information_schema.OPTIMIZER_TRACE\G
SET optimizer_trace = 'enabled=off';
```

## 4.6 PostgreSQL 的 EXPLAIN

```sql
EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
SELECT * FROM orders WHERE user_id = 1007 ORDER BY created_at DESC LIMIT 20;
```

```text
Limit  (cost=0.43..8.12 rows=20 width=64) (actual time=0.032..0.045 rows=20 loops=1)
  Buffers: shared hit=7
  ->  Index Scan Backward using idx_user_created on orders
        (cost=0.43..384.20 rows=1000 width=64) (actual time=0.030..0.041 rows=20 loops=1)
        Index Cond: (user_id = 1007)
        Buffers: shared hit=7
Planning Time: 0.120 ms
Execution Time: 0.070 ms
```

几个关键差异：

| 概念 | MySQL | PostgreSQL |
| --- | --- | --- |
| 成本单位 | 页读取次数（可调参数） | 抽象单位，`seq_page_cost=1.0`、`random_page_cost=4.0` |
| 扫描方式 | `type` 列 | `Seq Scan`、`Index Scan`、`Index Only Scan`、`Bitmap Heap Scan` |
| 连接方式 | Nested Loop、Hash Join（8.0.18+） | Nested Loop、Hash Join、Merge Join |
| 覆盖索引 | `Using index` | `Index Only Scan`（依赖 visibility map，需 `VACUUM`） |
| 统计信息 | `ANALYZE TABLE` + 采样 | `ANALYZE` + 直方图 + 多列统计（`CREATE STATISTICS`） |
| 只看估算 | `EXPLAIN` | `EXPLAIN` |
| 实际执行 | `EXPLAIN ANALYZE` | `EXPLAIN ANALYZE` + `BUFFERS` |

**PostgreSQL 特别注意 `Bitmap Heap Scan`**：当匹配行较多、且物理顺序与索引顺序相关性差时，优化器会先扫索引建位图，再按页号顺序读堆表，把随机 I/O 变成近似顺序 I/O。它出现在 `EXPLAIN` 里不代表有问题，反而常常是正确选择。

## 4.7 一个完整的读计划案例

```sql
SELECT o.id, o.amount, u.name
FROM orders o
JOIN users u ON u.id = o.user_id
WHERE o.status = 1
  AND o.created_at >= '2026-10-01'
ORDER BY o.created_at DESC
LIMIT 20;
```

假设 `orders` 有 500 万行，`users` 有 100 万行，`orders.status = 1` 占 80%。

```text
+----+-------------+-------+------+------------------+------------------+---------+--------------------+--------+-------------+
| id | select_type | table | type | possible_keys    | key              | key_len | ref                | rows   | Extra       |
+----+-------------+-------+------+------------------+------------------+---------+--------------------+--------+-------------+
|  1 | SIMPLE      | o     | ALL  | idx_status,idx_..| NULL             | NULL    | NULL               | 4987210| Using where; Using filesort |
|  1 | SIMPLE      | u     | ref  | PRIMARY          | PRIMARY          | 8       | o.user_id          |      1 | NULL        |
+----+-------------+-------+------+------------------+------------------+---------+--------------------+--------+-------------+
```

问题一目了然：

1. `o` 走全表扫描（`type=ALL`），扫 498 万行
2. `Using filesort`：排序无法利用索引
3. 虽然 `users` 用主键关联（`ref`），但驱动表太大，整体还是慢

**优化思路**：建立 `(status, created_at)` 联合索引。这样：

- `status = 1` 等值 + `created_at >= ...` 范围 → 走 `range`
- 索引顺序刚好是 `status, created_at`，`ORDER BY created_at DESC` 可以利用索引（需注意方向）
- 如果 `SELECT` 只需要 `id, created_at`，还能覆盖

```sql
ALTER TABLE orders ADD INDEX idx_status_created (status, created_at);
```

优化后 `type=range`，`rows` 大幅下降，`Using filesort` 消失。

**但这里有个取舍**：`status = 1` 占 80%，即使走索引也可能要回表 80% 的行，优化器可能仍然选全扫。更彻底的做法是**只查最近几天的数据**，或者用部分索引/分区把历史数据剥离，让「最近数据」的扫描范围变小。

# 五、慢 SQL 定位与优化实战

## 5.1 定位慢 SQL

**MySQL**：

```sql
-- 开启慢查询日志
SET GLOBAL slow_query_log = ON;
SET GLOBAL long_query_time = 1;          -- 超过 1 秒记录
SET GLOBAL log_queries_not_using_indexes = ON;

-- performance_schema 统计（推荐，比日志更即时）
SELECT digest_text, count_star, avg_timer_wait / 1e9 AS avg_ms,
       sum_rows_examined, sum_rows_sent
FROM performance_schema.events_statements_summary_by_digest
ORDER BY sum_timer_wait DESC LIMIT 20;
```

**PostgreSQL**：

```sql
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

SELECT query, calls, mean_exec_time, total_exec_time, rows
FROM pg_stat_statements
ORDER BY total_exec_time DESC LIMIT 20;
```

## 5.2 优化流程

```text
① 从慢日志 / pg_stat_statements 找出 Top SQL
② EXPLAIN [ANALYZE] 看计划
③ 判断瓶颈类型：
   - 扫描行数多   → 索引缺失 / 索引失效 / 区分度差
   - 回表多       → 覆盖索引
   - 排序 / 临时表 → 调整索引顺序或改写
   - JOIN 顺序错  → 统计信息 / 驱动表选择
④ 改 SQL → 改索引 → 改表结构（分区 / 分表 / 归档）
⑤ 用 EXPLAIN ANALYZE 验证，并在压测环境回归
```

**不要一上来就加索引。** 先问三个问题：这条 SQL 的业务语义是什么？能不能减少数据量（时间范围、分页、归档）？能不能改写成更高效的形态？加索引是最后手段，而且每加一个都要付写入成本。

## 5.3 深分页

```sql
-- 慢：需要先扫 100020 行，再丢弃前 100000 行
SELECT * FROM orders ORDER BY id LIMIT 100000, 20;
```

三种优化方式：

**① 延迟关联（deferred join）**：先在索引上分页取主键，再回表取整行。

```sql
SELECT o.*
FROM orders o
JOIN (SELECT id FROM orders ORDER BY id LIMIT 100000, 20) t ON t.id = o.id;
```

子查询只扫索引（覆盖），回表只有 20 次。**但子查询本身还是要扫 10 万行索引项**，只是比扫整行便宜。

**② 游标分页（seek method）**：记住上一页最后一条的 `id`。

```sql
SELECT * FROM orders WHERE id > 100000 ORDER BY id LIMIT 20;
```

这是**唯一能让深分页保持 O(1)** 的方法，但只支持「下一页」，不支持跳页。

**③ 业务上限制可翻页数**：大多数产品根本不需要让用户翻到第 5000 页。直接限制最大页码，比任何技术优化都有效。

## 5.4 COUNT 的真相

```sql
SELECT COUNT(*) FROM orders;
```

- InnoDB **不保存行数**，必须实时统计（MVCC 下不同事务看到的行数不同）
- 优化器会选**最小的二级索引**来扫，而不是主键索引，因为索引页更小
- `COUNT(*)` 和 `COUNT(1)` 在 MySQL 里性能相同，`COUNT(列)` 会排除 `NULL`，且需要读该列的值
- MyISAM 保存了行数，但带 `WHERE` 时依然要扫

大表上的精确 `COUNT` 本身就是重操作。替代方案：缓存值（允许延迟）、`SHOW TABLE STATUS` 的估算值（不准）、或者用计数表 + 增量维护。

## 5.5 ORDER BY 与 filesort

排序能否用索引，取决于三个条件同时满足：

1. `ORDER BY` 的列是索引的最左前缀（或等值条件 + 排序列）
2. 所有列的排序方向一致（MySQL 8.0 之前）
3. `WHERE` 条件不会打断索引顺序

```sql
-- idx_status_created (status, created_at)
SELECT * FROM orders WHERE status = 1 ORDER BY created_at DESC;  -- 可避免 filesort
SELECT * FROM orders WHERE status > 1 ORDER BY created_at DESC;  -- 范围查询，排序用不上索引
```

MySQL 8.0 支持**降序索引**，可以处理混合方向：

```sql
CREATE INDEX idx_mixed ON orders (status ASC, created_at DESC);
```

## 5.6 大表加索引 / 改表

| 操作 | MySQL | PostgreSQL |
| --- | --- | --- |
| 加二级索引 | 5.6+ Online DDL，`ALGORITHM=INPLACE, LOCK=NONE`，但仍需扫表 + 排序 | `CREATE INDEX CONCURRENTLY`，不阻塞写入，但耗时更长、失败会留下 invalid index |
| 加可空列 | 8.0.12+ `ALGORITHM=INSTANT` | `ALTER TABLE ... ADD COLUMN` 默认快速（仅改 catalog） |
| 改列类型 | 通常需要重建表 | 多数需要重写表 |
| 超大表 | gh-ost / pt-online-schema-change | pg_repack |

```sql
-- MySQL Online DDL
ALTER TABLE orders ADD INDEX idx_status_created (status, created_at),
  ALGORITHM=INPLACE, LOCK=NONE;
```

**Online DDL 不等于零成本**：加索引仍要全表扫描并排序，期间会占用大量 I/O 和临时空间，必须在低峰期做，并监控主从延迟。

## 5.7 删除数据后表为什么不变小

`DELETE` 只把行标记为可复用，页不会还给作业系统。大量删除后需要重建表：

```sql
-- MySQL
ALTER TABLE orders ENGINE=InnoDB;   -- 重建，期间需要额外空间
OPTIMIZE TABLE orders;              -- 本质也是重建

-- PostgreSQL
VACUUM FULL orders;                 -- 重写表，持有排他锁
```

# 六、30 道高频面试题

> 回答方式建议：**先给结论，再给原因，最后补一个实例**。面试官要的不是背诵，而是你能否把原理和场景连起来。

## 6.1 数据结构与索引原理

**Q1：为什么 MySQL 用 B+ 树，而不是 B 树？**

B+ 树非叶节点只存键和指针，扇出更大、树更矮，一次查询的页读取更少；所有数据在叶子且叶子成链，范围查询和排序只需顺序扫链表；每次查找都走到叶子，性能稳定。B 树每个节点都存数据，扇出小、范围查询需要跨层遍历。

**Q2：为什么不用红黑树或二叉搜索树？**

二叉树每个节点只有两个孩子，3000 万行数据树高约 25 层，意味着最多 25 次随机磁盘 I/O。B+ 树三层就能覆盖 2000 万行。磁盘按页读取，二叉树无法利用「一次读一页」的区域性。

**Q3：为什么不用哈希索引？**

哈希只支持等值查询，不支持范围、排序、最左前缀、`LIKE`。InnoDB 的自适应哈希索引（AHI）只是对热点页的内部加速，不能替代 B+ 树。PostgreSQL 的哈希索引也只用于等值场景。

**Q4：B+ 树三层能存多少数据？**

按 16KB 页、`BIGINT` 主键 8 字节 + 6 字节指针，非叶节点扇出约 1170；叶子页按每行 1KB 算约 16 行。三层约 `1170 × 1170 × 16 ≈ 2190 万` 行。这是数量级估算，实际取决于行宽和页填充率。

**Q5：聚簇索引和非聚簇索引的区别？**

InnoDB 的聚簇索引叶子存整行数据，表就是按主键组织的；二级索引叶子存主键值，查非索引列需要回表。PostgreSQL 是堆表，所有索引都存 `ctid`，没有聚簇索引（`CLUSTER` 只是一次性重排）。

**Q6：什么是回表？怎么减少回表？**

通过二级索引找到主键后，再回聚簇索引取整行的过程。减少方式：覆盖索引（把查询列加进索引）、只查索引列、避免 `SELECT *`、调整查询让二级索引直接满足需求。

**Q7：覆盖索引是什么？如何判断生效？**

查询所需列全部在索引中，无需回表。`EXPLAIN` 的 `Extra` 显示 `Using index`。注意 InnoDB 二级索引自带主键，所以查主键也算覆盖。

**Q8：为什么推荐自增主键？UUID 有什么问题？**

自增主键是顺序插入，B+ 树总是追加到最右侧叶子，页分裂少、缓冲池命中率高、索引紧凑。UUID 随机插入会导致页频繁分裂、页利用率低（可能只有 50%）、缓存局部性差、索引膨胀；二级索引里也要存 16 字节的 UUID，比 8 字节 `BIGINT` 大一倍。如果必须用 UUID，用有序 UUID（UUIDv7 / ULID）缓解。

**Q9：为什么主键不宜过长？**

二级索引的叶子要存主键值。主键越长，每个二级索引越大，所有索引的空间和 I/O 都跟着放大。一般用 `BIGINT`（8 字节）而不是 `CHAR(36)`。

**Q10：唯一索引和普通索引的区别？性能上有什么差异？**

唯一索引插入/更新时必须检查冲突，无法使用 **change buffer**（需要读取索引页确认唯一性），写多读少的场景下普通索引写入更快；查询时唯一索引等值命中可以提前停止（`const`），普通索引可能还要继续找下一条。整体差异不大，按业务约束选择。

## 6.2 索引设计

**Q11：最左前缀原则是什么？`(a,b,c)` 能支持哪些查询？**

联合索引按 a、b、c 依次排序。支持 `a`、`a,b`、`a,b,c`、`a,c`（c 靠 ICP 过滤）等以 a 开头的查询；不支持 `b`、`c`、`b,c`。范围查询会截断后续列：`a=1 AND b>2 AND c=3` 中 c 不能用于定位。

**Q12：`(a,b,c)` 索引，`WHERE b=1` 能用吗？为什么？**

不能。索引先按 a 排序，a 不同的情况下 b 是无序的，无法二分定位。MySQL 8.0.13 的 **skip scan** 在 a 的基数很低时可能跳着用，但这是特例，不能依赖。

**Q13：索引下推是什么？**

MySQL 5.6+ 把 `WHERE` 中能用索引列判断的条件下推到存储引擎，在回表前过滤，减少回表次数。`Extra: Using index condition`。它不能让范围列之后的列用于定位，只能减少回表。

**Q14：索引失效的常见场景？**

最左前缀缺失、索引列上用函数/运算、隐式类型转换、`LIKE '%x'`、`OR` 连非索引列、范围列之后的列、排序方向不一致、JOIN 字符集不一致、优化器基于成本放弃索引。

**Q15：为什么 `phone = 13800138000` 会失效，而 `id = '1007'` 不会？**

MySQL 字符串与数字比较时把字符串转成数字。`phone` 是 `VARCHAR`，转换的是**列**，等于对列做函数，索引失效；`id` 是数字，转换的是**常量**，列不变，索引仍可用。

**Q16：`LIKE '%abc'` 为什么失效？怎么优化？**

B+ 树只能从前缀定位，通配符在开头无法确定起点，只能全扫。优化：改成 `'abc%'`、用全文索引、用 Elasticsearch、或对反向字符串建索引做后缀匹配。

**Q17：索引越多越好吗？**

不是。每个索引都有空间成本、写入放大（每次 DML 维护所有索引）、优化器选择成本。建议单表 5 个以内，定期清理冗余和未使用索引。

**Q18：区分度低的列要不要建索引？**

单独建通常没意义（如性别）。但如果查询总是针对某个少数值（如「待处理」订单只占 1%），可以用部分索引，或把它作为联合索引的后置列。

**Q19：NULL 值会走索引吗？**

InnoDB 的 B+ 树会索引 `NULL`，`IS NULL` 可以走索引。但是否真的走取决于优化器成本估算；`NULL` 比例高时全扫可能更便宜。设计上尽量用 `NOT NULL + 默认值`，减少三值逻辑带来的语义坑。

**Q20：什么是三星索引？**

等值列在最左（第一星）、排序列与索引顺序一致（第二星）、查询列被索引覆盖（第三星）。是设计联合索引的检查清单，不必强求三星全占。

## 6.3 执行计划

**Q21：EXPLAIN 的 type 有哪些？至少要到什么级别？**

从好到坏：`system > const > eq_ref > ref > fulltext > ref_or_null > index_merge > range > index > ALL`。实务底线是 `range`，最好 `ref`。出现 `ALL` 且表大就必须处理。

**Q22：`Using filesort` 和 `Using temporary` 说明什么？**

`Using filesort` 表示无法利用索引顺序，需要额外排序（可能在内存，也可能落磁盘）。`Using temporary` 表示用了临时表，常见于无索引的 `GROUP BY`、`DISTINCT`、`UNION`。两者都是性能红旗，尤其当 `rows` 很大时。

**Q23：key_len 有什么用？**

判断联合索引实际用到了几列。例如 `BIGINT` 是 8 字节，`DATETIME` 是 5 字节，可空列 +1。`key_len=13` 表示两列都命中了。

**Q24：优化器为什么会选错索引？怎么办？**

统计信息过期、数据倾斜、列相关性被忽略、采样不足、成本模型与实际硬体不符（如 SSD 上 `random_page_cost` 仍按机械盘算）。处理：`ANALYZE TABLE`、调整采样页数、用 `EXPLAIN ANALYZE` 对比估算与实际、必要时用 hint（`FORCE INDEX` / PostgreSQL `pg_hint_plan`），但优先改写 SQL 或调整索引。

**Q25：`rows` 和 `filtered` 怎么看？**

`rows` 是优化器估算的扫描行数，`filtered` 是这些行经过条件过滤后剩余的百分比。`rows × filtered%` 约等于参与下一步的行数。如果 `rows` 很大而 `filtered` 很低，说明索引选择性差，大量行被扫出来又丢掉。

**Q26：MySQL 和 PostgreSQL 的执行计划有什么主要差异？**

MySQL 用 `type` 描述访问方式，PostgreSQL 用节点名（`Seq Scan`、`Index Scan`、`Bitmap Heap Scan`）；PostgreSQL 默认用堆表 + `ctid`，覆盖索引叫 `Index Only Scan` 且依赖 visibility map；PostgreSQL 的成本参数更精细（`random_page_cost`、`effective_cache_size`），连接算法更丰富。

## 6.4 实战优化

**Q27：`LIMIT 100000, 20` 为什么慢？怎么优化？**

需要扫描并丢弃前 100000 行。优化：延迟关联（先在索引分页取主键再回表）、游标分页（`WHERE id > last_id`）、业务限制最大页码。

**Q28：`COUNT(*)`、`COUNT(1)`、`COUNT(列)` 的区别？**

`COUNT(*)` 和 `COUNT(1)` 都统计行数，性能相同；`COUNT(列)` 排除 `NULL` 且需读列值，稍慢。InnoDB 不保存总行数，`COUNT(*)` 会选最小的二级索引扫描。

**Q29：大表如何加索引或改表结构？**

MySQL 用 Online DDL（`ALGORITHM=INPLACE, LOCK=NONE`），超大表用 gh-ost / pt-osc；PostgreSQL 用 `CREATE INDEX CONCURRENTLY`。都要在低峰期做，监控主从延迟、磁盘和临时空间。

**Q30：一条 SQL 突然变慢，你的排查步骤？**

① 确认是单条还是整体（连接数、CPU、I/O、锁等待）；② 看执行计划是否变化（统计信息、索引变更、数据量增长）；③ 用 `EXPLAIN ANALYZE` 对比估算与实际；④ 检查锁与事务（`SHOW ENGINE INNODB STATUS`、`pg_stat_activity`）；⑤ 检查是否被其他慢 SQL 拖累（Buffer Pool 污染、I/O 打满）；⑥ 必要时限流、降级、回滚变更。

# 七、速查表

## 7.1 索引设计清单

```text
□ 高频查询的 WHERE / JOIN / ORDER BY / GROUP BY 列是否有索引
□ 联合索引是否符合最左前缀，等值列在前、范围列在后
□ 能否用覆盖索引消除回表（权衡索引宽度）
□ 参数类型与列类型是否一致（防隐式转换）
□ 索引列上是否套了函数 / 运算
□ LIKE 是否为前缀匹配
□ 是否有低区分度或冗余索引
□ 索引数量是否超过 5 个
□ 大表加索引是否走 Online DDL / CONCURRENTLY
```

## 7.2 EXPLAIN 快速判断

| 看到什么 | 说明 | 动作 |
| --- | --- | --- |
| `type=ALL` | 全表扫描 | 检查索引缺失/失效 |
| `type=index` | 全索引扫描 | 检查是否能改成 `range` / `ref` |
| `key=NULL` 但 `possible_keys` 有值 | 优化器放弃索引 | 看成本、更新统计信息 |
| `rows` 远大于实际返回 | 估算偏差 / 索引选择性差 | `ANALYZE`、调索引 |
| `Using filesort` | 额外排序 | 调整索引顺序或 SQL |
| `Using temporary` | 临时表 | 让分组/去重利用索引 |
| `Using index` | 覆盖索引 | 理想 |
| `Using index condition` | ICP | 正常 |

---

索引和执行计划的关系，可以概括成一句话：**索引决定「有哪些路可以走」，执行计划决定「这次走了哪条」**。面试里能背出 B+ 树的定义只是入门，能对着一条慢 SQL 说出「为什么没走索引、优化器在算什么、改了之后扫描行数降到多少」，才是真正的分水岭。

下一篇《常见设计模式》会换一个角度：同样是「用抽象隔离变化」，设计模式管的是程式码结构，索引管的是数据结构——但两者都有一个共同的前提：**先搞清楚变化点在哪里，再决定要不要抽象**。
