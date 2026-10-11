关系型数据库是后端工程师的基本盘，但"会用 SQL"和"懂数据库"之间隔着一段不太好跳过的距离：一段 B+ 树的索引结构、一套 MVCC 的可见性规则、一条从 redo log 到 binlog 的两阶段提交链路。平时写业务代码感觉不到它们，一旦遇到慢查询、死锁、主从延迟、线上数据"莫名消失"，就全靠这些底层知识定位。

这篇文章把三块内容串成一条线：

1. **SQL 语言**：关系模型是怎么变成语句的，语句又是按什么顺序被执行的
2. **原理与机制**：索引、事务与 MVCC、存储与日志——MySQL 和 PostgreSQL 在这三件事上做法不同，差异直接决定了你写出来的代码能不能跑对
3. **工程与调优**：慢 SQL 定位、参数调优、主从复制、分库分表

每节尽量给出**结论 + 原理 + 易错点**，不停在名词解释。全文很长，可以按目录挑着看。

![关系型数据库全景：语言层定义语义，执行层把语句变成执行计划，存储层里 MySQL 与 PostgreSQL 在进程模型、存储引擎、日志与并发控制上分道扬镳](/images/blog/sql-mysql-postgresql/db-landscape.svg)

# 一、先建立坐标系

## 1.1 SQL 是接口，引擎才是本体

SQL 是一门**声明式**语言：你描述"要什么"，不描述"怎么拿"。这个抽象是数据库最有价值的设计，也是最容易被误读的地方——**同一句 SQL，在不同引擎下的执行路径可能完全不同**。

```sql
SELECT * FROM orders WHERE user_id = 1007 AND created_at > '2026-01-01';
```

在 InnoDB 里，它可能走 `idx_user_created` 联合索引，回表取整行；也可能因为优化器估算回表次数太多，干脆走全表扫描。语句没变，代价差几个数量级。所以"这条 SQL 快不快"这个问题本身是不成立的，正确的问法是"**这条 SQL 在这份数据、这个统计信息下，优化器选了哪条路径**"。

这决定了我们看数据库要分三层：

| 层次 | 关注点 | 出问题的表现 |
| --- | --- | --- |
| 语言层 | 语义、写法、方言差异 | 语句报错、结果不对 |
| 执行层 | 解析、优化、执行计划 | 慢查询、索引没走对 |
| 存储层 | 索引结构、事务、锁、日志 | 死锁、数据不一致、崩溃丢数据 |

## 1.2 SQL 的五个分类

按功能分，SQL 语句分五类。这张表值得记住，因为**它们的事务行为不一样**：

| 类别 | 全称 | 代表语句 | MySQL 的隐式提交 | PostgreSQL 的隐式提交 |
| --- | --- | --- | --- | --- |
| DDL | 数据定义 | `CREATE` `ALTER` `DROP` `TRUNCATE` | 有，不可回滚 | 无，DDL 可回滚 |
| DML | 数据操纵 | `INSERT` `UPDATE` `DELETE` `MERGE` | 无 | 无 |
| DQL | 数据查询 | `SELECT` | 无 | 无 |
| DCL | 数据控制 | `GRANT` `REVOKE` | 有 | 无 |
| TCL | 事务控制 | `BEGIN` `COMMIT` `ROLLBACK` `SAVEPOINT` | — | — |

**第一个实用的差异在这里**：在 PostgreSQL 里，`BEGIN; DROP TABLE t; ROLLBACK;` 之后表还在；在 MySQL 里，`DROP TABLE` 会隐式提交，回滚不回来。同样，PostgreSQL 的 `TRUNCATE` 在事务里可以回滚，MySQL 的不能。

这个差异意味着：**在 MySQL 上做结构变更必须当成不可逆操作来对待**（先备份、先评审、用 gh-ost / pt-online-schema-change 这类工具），而 PostgreSQL 给了你一个"试错窗口"。

# 二、SQL 语言：从关系模型到可执行语句

## 2.1 逻辑执行顺序不等于书写顺序

这是理解 SQL 最重要的一条。

你写 SQL 的顺序大致是 `SELECT ... FROM ... WHERE ... GROUP BY ... HAVING ... ORDER BY ... LIMIT`，但数据库的**逻辑执行顺序**完全不是这个次序：

![SQL 书写顺序与逻辑执行顺序对照：FROM/JOIN → WHERE → GROUP BY → HAVING → 窗口函数 → SELECT → DISTINCT → ORDER BY → LIMIT](/images/blog/sql-mysql-postgresql/query-order.svg)

```text
① FROM / JOIN / ON      定位数据源并连接，生成初始行集
② WHERE                 过滤行（此时还没有聚合）
③ GROUP BY              分组
④ HAVING                过滤组
⑤ 窗口函数              在结果集上开窗，不折叠行
⑥ SELECT                计算表达式、确定别名
⑦ DISTINCT              去重
⑧ ORDER BY              排序
⑨ LIMIT / OFFSET        截断
```

这张图能解释一大半"为什么这条 SQL 报错"和"为什么它不快"：

- **WHERE 里不能写聚合函数**——因为 WHERE 执行时分组还没发生。`WHERE COUNT(*) > 1` 是语法错误，得用 `HAVING`。
- **WHERE 里不能引用 SELECT 定义的别名**——别名在步骤 ⑥ 才产生。MySQL 出于便利允许在 `GROUP BY` / `HAVING` / `ORDER BY` 里使用别名，但标准 SQL 和 PostgreSQL 不允许（PostgreSQL 只允许在 `ORDER BY` 里用别名）。
- **`LIMIT` 在 `ORDER BY` 之后**——所以深分页必须先排序再丢弃，代价随 OFFSET 线性增长（后面 7.4 节专门讲）。
- **HAVING 不能替代 WHERE**——`WHERE` 先执行能减少参与分组的数据量，能用 `WHERE` 就别用 `HAVING`。

## 2.2 JOIN 全解

JOIN 的本质是**两个行集按条件做笛卡尔积再筛选**（逻辑上如此，物理上当然有各种算法优化）。

| 类型 | 语义 | MySQL | PostgreSQL |
| --- | --- | --- | --- |
| `INNER JOIN` | 只保留匹配的行 | ✓ | ✓ |
| `LEFT JOIN` | 保留左表全部，右表无匹配补 NULL | ✓ | ✓ |
| `RIGHT JOIN` | 保留右表全部 | ✓ | ✓ |
| `FULL OUTER JOIN` | 保留两侧全部 | ✗ 需用 `LEFT UNION RIGHT` 模拟 | ✓ |
| `CROSS JOIN` | 笛卡尔积，无 ON 条件 | ✓ | ✓ |
| 自连接 | 表与自身连接 | ✓ | ✓ |
| `LATERAL` | 右侧子查询可引用左侧的行 | 8.0.14+ 支持 | ✓（原生） |

**最经典的坑：`ON` 和 `WHERE` 在 LEFT JOIN 里的区别。**

```sql
-- 写法 A：条件在 ON 里 —— 左表的行全部保留，右表不匹配的补 NULL
SELECT u.id, o.amount
FROM users u
LEFT JOIN orders o ON o.user_id = u.id AND o.status = 'paid';

-- 写法 B：条件在 WHERE 里 —— LEFT JOIN 退化成 INNER JOIN
SELECT u.id, o.amount
FROM users u
LEFT JOIN orders o ON o.user_id = u.id
WHERE o.status = 'paid';
```

写法 B 里，右表没有匹配的行时 `o.status` 是 `NULL`，而 `NULL = 'paid'` 的结果是 `UNKNOWN`，会被 `WHERE` 过滤掉——**没下过单的用户全部消失了**。LEFT JOIN 就这么被写成了 INNER JOIN。

这是"想查所有用户及其已支付订单，没支付的要显示为 0"这类需求最常见的 bug。

## 2.3 聚合与 GROUP BY

分组后的规则很简单：**SELECT 列表里只能出现 GROUP BY 的列和聚合函数**。

```sql
SELECT user_id, COUNT(*) AS cnt, SUM(amount) AS total
FROM orders
WHERE created_at >= '2026-01-01'
GROUP BY user_id
HAVING SUM(amount) > 1000
ORDER BY total DESC;
```

- MySQL 5.7+ 默认开启 `ONLY_FULL_GROUP_BY`，查非分组列会直接报错（这是好事，5.6 时代那种"随便返回组内某一行"的行为是数据事故来源）。
- `HAVING` 过滤的是**组**，`WHERE` 过滤的是**行**。能放进 `WHERE` 的条件不要放进 `HAVING`。
- **聚合函数忽略 NULL**：`COUNT(col)` 只数非 NULL 值，`COUNT(*)` 数所有行。`SUM()` 在全是 NULL 时返回 `NULL` 而不是 0，需要 `COALESCE(SUM(x), 0)`。
- 分组结果是无序的。`GROUP BY` 不保证顺序，要顺序必须显式 `ORDER BY`——MySQL 5.7 曾依赖"隐式排序"，8.0 移除后大量旧代码因此出错。

## 2.4 窗口函数

窗口函数和 `GROUP BY` 的核心区别：**它不折叠行**。`GROUP BY` 把 N 行压成 1 行，窗口函数给每行算一个值，行数不变。

```sql
-- 每个用户的订单按金额排名，取前 3 名（分组 Top-N 的经典写法）
SELECT *
FROM (
  SELECT
    user_id,
    order_no,
    amount,
    ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY amount DESC) AS rn
  FROM orders
) t
WHERE rn <= 3;
```

常用函数：

| 函数 | 作用 |
| --- | --- |
| `ROW_NUMBER()` | 严格递增序号，同值不并列 |
| `RANK()` | 并列跳号（1,1,3） |
| `DENSE_RANK()` | 并列不跳号（1,1,2） |
| `LAG(col, n)` / `LEAD(col, n)` | 取前 / 后第 n 行的值，做同比环比 |
| `SUM() OVER (...)` | 累计求和 |
| `FIRST_VALUE` / `LAST_VALUE` | 窗口内首 / 末值 |
| `NTILE(n)` | 分成 n 桶 |

**帧（frame）是窗口函数最容易出错的部分**。带 `ORDER BY` 时默认帧是 `RANGE BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW`，这意味着"从分组第一行累积到当前行"——所以 `SUM() OVER (ORDER BY d)` 算的是累计和，不是总和；想要总和得写 `OVER (PARTITION BY ...)` 不带 `ORDER BY`，或显式指定 `ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING`。

还有一个反直觉的点：`LAST_VALUE` 用默认帧时返回的是**当前行**而不是分组最后一行，因为它只能看到"到当前行"的范围。这是新手常见错误。

MySQL 8.0+ 和 PostgreSQL 都完整支持窗口函数；MySQL 5.7 完全不支持，这是很多老项目升级的直接动因。

## 2.5 子查询与 CTE

```sql
-- 非相关子查询：可以独立执行一次
SELECT * FROM users WHERE id IN (SELECT user_id FROM vip_members);

-- 相关子查询：对外层每一行执行一次（N+1 的 SQL 版）
SELECT u.id,
       (SELECT COUNT(*) FROM orders o WHERE o.user_id = u.id) AS order_cnt
FROM users u;
```

相关子查询是性能陷阱。上面的写法在优化器不帮忙时会对每个用户执行一次子查询，改成 `LEFT JOIN + GROUP BY` 或窗口函数通常快得多。

**CTE（`WITH`）** 是提高可读性的主要工具，MySQL 8.0+ 才支持：

```sql
WITH monthly AS (
  SELECT user_id, DATE_TRUNC('month', created_at) AS mon, SUM(amount) AS total
  FROM orders
  GROUP BY user_id, DATE_TRUNC('month', created_at)
)
SELECT * FROM monthly WHERE total > 10000;
```

**递归 CTE** 用来查树形结构（组织架构、分类树、BOM 展开）：

```sql
WITH RECURSIVE org AS (
  SELECT id, name, parent_id, 1 AS depth
  FROM departments WHERE parent_id IS NULL
  UNION ALL
  SELECT d.id, d.name, d.parent_id, o.depth + 1
  FROM departments d JOIN org o ON d.parent_id = o.id
)
SELECT * FROM org ORDER BY depth, id;
```

一个 PostgreSQL 特有的坑：**PostgreSQL 12 之前，CTE 一律物化**（把结果算出来存成临时表），即使外层只用到几行也会全量计算。12 之后优化器可以内联，你也可以用 `MATERIALIZED` / `NOT MATERIALIZED` 显式控制。相比之下 MySQL 对派生表的合并策略（`derived_merge`）更像"默认内联"。

## 2.6 NULL：三值逻辑

NULL 不是 0，不是空字符串，它表示"**未知**"。这让 SQL 的比较变成了三值逻辑（TRUE / FALSE / UNKNOWN），而 `WHERE` 只保留 TRUE 的行。

```sql
SELECT * FROM users WHERE email = NULL;      -- ❌ 永远返回空
SELECT * FROM users WHERE email IS NULL;     -- ✅ 正确写法
```

必须记住的几条：

- **任何与 NULL 的比较（`=` `<` `>` `<>`）都返回 UNKNOWN**，包括 `NULL = NULL`。判断只能用 `IS NULL` / `IS NOT NULL`。
- **`NOT IN` 遇到 NULL 会返回空集**。`x NOT IN (1, 2, NULL)` 永远不成立，因为 `x <> NULL` 是 UNKNOWN。这是最隐蔽的 bug 之一——子查询结果里混进一个 NULL，整个查询就静默返回空。**用 `NOT EXISTS` 代替 `NOT IN` 更安全**。
- **聚合函数忽略 NULL**：`AVG(col)` 的分母是非 NULL 行的数量，不是总行数。这个差异经常导致统计口径对不上。
- **`COUNT(*)` 数行，`COUNT(col)` 数非 NULL 值**，`COUNT(DISTINCT col)` 数非 NULL 去重值。
- **唯一索引里的 NULL 可以重复**：MySQL 和 PostgreSQL 都是如此（唯一约束只约束非 NULL 值）。想要"最多一条 NULL"得用部分索引或应用层约束。
- **排序位置不同**：MySQL 把 NULL 当成最小值排在最前（`ORDER BY col ASC` 时）；PostgreSQL 默认相反，NULL 排在最后。PostgreSQL 可以用 `NULLS FIRST` / `NULLS LAST` 显式指定，MySQL 不支持这个语法，得用 `ORDER BY col IS NULL, col` 变通。

好用的两个函数：`COALESCE(a, b, c)` 返回第一个非 NULL 值；`NULLIF(a, b)` 相等时返回 NULL（常用于避免除零）。

## 2.7 方言差异速查表

从 MySQL 迁到 PostgreSQL（或反过来）时，这张表能省掉大量调试时间：

| 场景 | MySQL | PostgreSQL |
| --- | --- | --- |
| 字符串拼接 | `CONCAT(a, b)`（`\|\|` 默认是逻辑或） | `a \|\| b` |
| 标识符引用 | 反引号 `` `col` `` | 双引号 `"col"` |
| 标识符大小写 | 受 `lower_case_table_names` 影响 | 未加引号一律折叠为小写 |
| 分页 | `LIMIT n OFFSET m` | `LIMIT n OFFSET m`（也支持 `FETCH FIRST n ROWS`） |
| UPSERT | `INSERT ... ON DUPLICATE KEY UPDATE` | `INSERT ... ON CONFLICT DO UPDATE` |
| 返回写入结果 | 8.0 前只能 `LAST_INSERT_ID()` | 原生 `RETURNING *` |
| 自增主键 | `AUTO_INCREMENT` | `GENERATED ALWAYS AS IDENTITY`（旧写法 `serial`） |
| 布尔类型 | `TINYINT(1)` | `BOOLEAN` |
| 不定长字符串 | 必须写 `VARCHAR(n)` | `TEXT` 即可（与 `varchar` 无性能差异） |
| 当前时间 | `NOW()` | `NOW()` / `CURRENT_TIMESTAMP` |
| 日期格式化 | `DATE_FORMAT(d, '%Y-%m-%d')` | `to_char(d, 'YYYY-MM-DD')` |
| 字符串转日期 | `STR_TO_DATE` | `to_date` / `d::date` |
| 分组拼接 | `GROUP_CONCAT(col)` | `string_agg(col, ',')` |
| 空值替换 | `IFNULL(a, b)` | `COALESCE(a, b)` |
| 正则匹配 | `col REGEXP 'p'` | `col ~ 'p'` |
| JSON 提取 | `col->>'$.name'` | `col->>'name'` |
| 截断表 | `TRUNCATE TABLE`（隐式提交） | `TRUNCATE TABLE`（事务内可回滚） |
| DDL 回滚 | 不支持 | 支持 |

**迁移时最痛的三条**：`||` 的语义（MySQL 里是逻辑或，是静默的错误结果，不会报错）、标识符大小写规则、以及 `ON DUPLICATE KEY` 与 `ON CONFLICT` 的语法差异。

# 三、索引：从 B+ 树到执行计划

## 3.1 为什么是 B+ 树

索引的本质是**用额外的空间和写代价，换取读的定位效率**。可选的树很多，关系型数据库几乎一致选了 B+ 树：

| 结构 | 等值查询 | 范围查询 | 排序 | 写入代价 | 说明 |
| --- | --- | --- | --- | --- | --- |
| 哈希索引 | O(1) 极快 | ✗ 不支持 | ✗ | 低 | 只适合等值；MySQL 的 Memory 引擎、InnoDB 自适应哈希 |
| 有序数组 | O(log n) | ✓ 好 | ✓ | 高（插入要搬移） | 只适合静态数据 |
| 跳表 | O(log n) | ✓ 好 | ✓ | 中 | Redis 在用 |
| LSM-Tree | 好 | ✓ | ✓ | 极低（顺序写） | 读放大，需 compaction；RocksDB / HBase |
| **B+ 树** | O(log n) | ✓ 好 | ✓ | 中 | 读写均衡，磁盘友好 |

B+ 树的三个设计让它特别适合磁盘：

1. **非叶子节点只存键和指针，不存数据**——所以一个节点（一页）能装下更多键，树更矮。MySQL InnoDB 的页是 16KB。
2. **所有数据都在叶子节点，且叶子节点连成有序双向链表**——范围查询顺着链表扫即可，不用回到根节点。
3. **树是平衡的**——任何查询的 I/O 次数相同，性能可预测。

算一笔账：InnoDB 的页 16KB，主键是 `BIGINT`（8 字节），页内指针约 6 字节，一个非叶节点能放约 `16KB / 14B ≈ 1170` 个指针。两层非叶节点 + 叶子节点每页存约 16 行：

```text
1170 × 1170 × 16 ≈ 2190 万行 —— 只需要 3 次磁盘 I/O
```

而且根节点几乎总在 Buffer Pool 里，实际往往只要 2 次。这就是"矮胖树"的威力：**用增加每页的扇出（fan-out），把树高压到 3~4 层**。

## 3.2 聚簇索引与二级索引

这是 MySQL 和 PostgreSQL 差异最大的地方之一。

**InnoDB 是索引组织表（IOT）**：

- 主键就是聚簇索引，**叶子节点直接存整行数据**
- 二级索引（普通索引）的叶子存的是**索引列 + 主键值**，要取其他列必须拿主键再查一次聚簇索引——这就是**回表**
- 如果没有主键，InnoDB 选第一个非空唯一索引当聚簇键；都没有就创建一个 6 字节的隐藏 `ROW_ID`

**PostgreSQL 是堆表**：

- 数据行存在堆（heap）里，无序
- **所有索引都是二级索引**，叶子存的是 `ctid`（页号 + 槽位号），指向堆中的物理位置
- 所以 PostgreSQL 的"回表"是必然的一步，不存在 MySQL 那种"主键查询直接拿到整行"的优化

![B+ 树结构与回表过程：非叶节点只存键，叶子节点存数据并连成有序链表；二级索引查到主键后需回表再查一次聚簇索引](/images/blog/sql-mysql-postgresql/btree-index.svg)

**这个差异的实践含义**：

- MySQL 里**主键查询是最快的路径**，且主键值会被复制到每个二级索引里，所以**主键要短**（用 `BIGINT` 而不是 `VARCHAR(36)` 的 UUID，后者会让每个二级索引都膨胀）。
- 更严重的：**随机主键（如 UUID v4）会造成页分裂**。新插入的行主键随机，可能落在任何一页，页满了就要分裂、搬移，写的性能断崖式下降，还会产生碎片。如果必须用 UUID，用**有序的 UUID v7 / ULID**，或者用 `UUID_TO_BIN(uuid, 1)` 把时间位重排到高位。
- PostgreSQL 的 `ctid` 会随 `UPDATE` 变化（新版本写新位置），所以**不能用 ctid 做长期标识**。

## 3.3 联合索引与最左前缀

联合索引 `(a, b, c)` 的排序规则是：**先按 a 排，a 相同按 b 排，b 相同按 c 排**。这决定了它能支持哪些查询：

```sql
CREATE INDEX idx_a_b_c ON t (a, b, c);
```

| 查询条件 | 能否用索引 | 用到几列 |
| --- | --- | --- |
| `WHERE a = 1` | ✓ | a |
| `WHERE a = 1 AND b = 2` | ✓ | a, b |
| `WHERE a = 1 AND b = 2 AND c = 3` | ✓ | a, b, c |
| `WHERE a = 1 AND c = 3` | ✓（部分） | 只用到 a，c 用不上定位 |
| `WHERE b = 2` | ✗ | 缺少最左列 a |
| `WHERE a = 1 AND b > 2 AND c = 3` | ✓（部分） | a、b 用于定位，**c 无法用于定位** |

**最后一行是关键**：一旦某列用了范围条件，它右边的列就无法再用于索引定位（因为范围扫描的区间内，右侧列不是有序的）。不过 MySQL 5.6+ 的**索引下推（ICP）** 仍然可以在索引层过滤 `c = 3`，减少回表次数——`EXPLAIN` 的 `Extra` 会显示 `Using index condition`。

**排序也遵循最左前缀**：

```sql
-- 索引 (a, b, c)
ORDER BY a, b          -- ✓ 能用索引排序
ORDER BY a, b, c       -- ✓
ORDER BY b, c          -- ✗ 需要 filesort
ORDER BY a, c          -- ✗ 中间断了，需要 filesort
ORDER BY a DESC, b ASC -- 8.0 前 ✗；8.0+ 支持降序索引
```

**设计联合索引的两条原则**：

1. **等值条件列在前，范围条件列在后**——这样范围列右边的等值条件至少还能靠 ICP 过滤。
2. **把区分度高的列放在前面**，但不要教条化：如果业务查询永远是 `WHERE tenant_id = ? AND order_no = ?`，那 `(tenant_id, order_no)` 就是对的，哪怕 `order_no` 区分度更高。索引是为**查询模式**服务的，不是为"理论最优"服务的。

## 3.4 索引失效的常见场景

排查慢 SQL 时，先对照这张清单：

| 场景 | 例子 | 原因 |
| --- | --- | --- |
| 对索引列做函数运算 | `WHERE YEAR(created_at) = 2026` | 索引存的是原始值，函数值不在索引里 |
| 隐式类型转换 | `WHERE phone = 13800000000`（phone 是 varchar） | MySQL 把**列**转成数字，索引失效 |
| 前导模糊匹配 | `WHERE name LIKE '%张'` | 无法确定扫描起点 |
| `OR` 连接非索引列 | `WHERE a = 1 OR b = 2`（b 无索引） | 优化器可能直接放弃索引 |
| 不满足最左前缀 | `WHERE b = 2`，索引是 `(a, b)` | 见 3.3 |
| `!=` / `NOT IN` | `WHERE status != 'done'` | 选择性太低时优化器放弃索引 |
| 使用 `SELECT *` | 取不到覆盖索引 | 必须回表，回表代价高时改走全表 |
| 统计信息过期 | 数据批量变更后 | 优化器估算错误 |
| 排序字段混用升降序 | `ORDER BY a ASC, b DESC`（8.0 前） | 索引是单向有序的 |

**优化写法**：

```sql
-- ❌ 函数包住列
SELECT * FROM orders WHERE YEAR(created_at) = 2026;
-- ✅ 改成范围条件
SELECT * FROM orders WHERE created_at >= '2026-01-01' AND created_at < '2027-01-01';

-- ❌ 隐式转换（phone 是 varchar）
SELECT * FROM users WHERE phone = 13800000000;
-- ✅ 加引号
SELECT * FROM users WHERE phone = '13800000000';
```

**PostgreSQL 的差异**：

- PostgreSQL **不会把列隐式转成数字**，`WHERE int_col = 'abc'` 会直接报错，`WHERE varchar_col = 123` 也会报错。这比 MySQL 的"静默全表扫"友好，但迁移时会暴露出大量类型不一致的代码。
- 想用函数就必须建**表达式索引**：`CREATE INDEX ON t (lower(email))`，之后查询也必须写 `lower(email) = ?` 才能命中。
- 支持**部分索引（partial index）**：`CREATE INDEX ON orders (created_at) WHERE status = 'pending'`，只索引未完成订单。针对"热数据占少数"的场景非常高效，这是 MySQL 没有的能力。

## 3.5 读懂执行计划

**不看执行计划的优化都是猜。** 这是全文最重要的一句话。

### MySQL：EXPLAIN

```sql
EXPLAIN FORMAT=TREE
SELECT u.name, COUNT(*)
FROM users u JOIN orders o ON o.user_id = u.id
WHERE u.city = 'Beijing' AND o.created_at > '2026-01-01'
GROUP BY u.name;
```

关键列：

| 列 | 看什么 |
| --- | --- |
| `type` | 访问类型，**最重要的列** |
| `key` | 实际使用的索引 |
| `key_len` | 用到了联合索引的几列 |
| `rows` | 预估扫描行数 |
| `filtered` | 过滤后剩余行数百分比 |
| `Extra` | 额外的执行细节，坑最多 |

`type` 从好到坏：`system` > `const` > `eq_ref` > `ref` > `range` > `index` > `ALL`。

- `const` / `eq_ref`：主键或唯一索引等值，最好
- `ref`：普通索引等值，正常
- `range`：范围扫描，可接受
- `index`：**扫描整棵索引树**，比全表好一点但通常说明索引没用好
- `ALL`：全表扫描，**看到就要警惕**

`Extra` 里要认识的信号：

| 值 | 含义 | 好坏 |
| --- | --- | --- |
| `Using index` | 覆盖索引，不需要回表 | ✅ 最好 |
| `Using index condition` | 索引下推（ICP），减少了回表 | ✅ 好 |
| `Using where` | 在server 层过滤 | ⚠️ 中性 |
| `Using filesort` | 需要额外排序，无法用索引顺序 | ❌ 差 |
| `Using temporary` | 用了临时表（常见于 `GROUP BY` / `DISTINCT`） | ❌ 差 |
| `Using join buffer` | 被驱动表没走索引，用了 join buffer | ❌ 差 |

MySQL 8.0.18+ 的 `EXPLAIN ANALYZE` 会**真正执行**并给出实际耗时和行数，比纯 `EXPLAIN` 的估算可靠得多（注意它会执行 DML，只读查询才安全）。

### PostgreSQL：EXPLAIN (ANALYZE, BUFFERS)

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT u.name, COUNT(*)
FROM users u JOIN orders o ON o.user_id = u.id
WHERE u.city = 'Beijing' AND o.created_at > '2026-01-01'
GROUP BY u.name;
```

输出是**自底向上的执行树**，每个节点形如：

```text
HashAggregate  (cost=1250.30..1260.50 rows=1020 width=40) (actual time=45.2..45.8 rows=980 loops=1)
  Buffers: shared hit=850 read=120
  ->  Hash Join  (cost=520.10..1180.20 rows=5200 width=36) (actual time=8.1..38.4 rows=5100 loops=1)
        Hash Cond: (o.user_id = u.id)
        ->  Seq Scan on orders o  (cost=0.00..420.00 rows=5200 width=16) (actual time=0.02..15.3 rows=5100 loops=1)
              Filter: (created_at > '2026-01-01'::timestamp)
```

要看的三个东西：

1. **`cost=启动代价..总代价`** 是相对单位，只在比较同一查询的不同计划时有意义。
2. **`rows=` 估算 vs `actual rows=` 实际**——**偏差超过一个数量级就说明统计信息有问题**，优化器是在用错误的模型做决策。这时该 `ANALYZE` 表，或调大该列的统计目标 `ALTER TABLE t ALTER COLUMN c SET STATISTICS 500`。
3. **`Buffers: shared hit / read`**——`read` 是真实磁盘 I/O，`hit` 是内存命中。这是排查"到底慢在 I/O 还是 CPU"的直接证据。

要认识的核心算子：`Seq Scan`（全表）、`Index Scan`（走索引，可能回表）、`Index Only Scan`（覆盖索引，PG 的 `Using index`）、`Bitmap Heap Scan`（先扫索引位图再批量回表，适合中等选择性）、`Nested Loop` / `Hash Join` / `Merge Join`（三种连接算法）、`Sort` / `HashAggregate`。

PostgreSQL 还有个特别值得认识的索引类型 **BRIN（块范围索引）**：它不索引每一行，只记录每个数据块的 min/max。体积只有 B-tree 的几百分之一，适合**按时间顺序写入的大表**（日志、监控数据）做范围查询。

## 3.6 优化器为什么会"选错"索引

优化器是**基于代价（CBO）** 工作的：它枚举可能的访问路径，用统计信息估算每个路径的 I/O 和 CPU 代价，选最便宜的。它选错通常有四个原因：

1. **统计信息过期或不准确**：`rows` 估算离谱。MySQL 靠 `ANALYZE TABLE` 更新，8.0 支持直方图（`ANALYZE TABLE t UPDATE HISTOGRAM ON col`）来改善数据倾斜列的估算；PostgreSQL 靠 autovacuum 中的 autoanalyze 和手工 `ANALYZE`。
2. **估算模型不完美**：多列之间的相关性（比如 `city` 和 `postcode` 高度相关）默认被当成独立事件，导致选择性估算偏差。PostgreSQL 10+ 支持 `CREATE STATISTICS` 做多列统计。
3. **回表代价被低估或高估**：如果索引列的选择性看似很好，但实际每个值对应大量行，回表次数会爆炸，走全表反而更快。
4. **参数化查询的计划固化**：PostgreSQL 的 prepared statement 会先试 5 次 custom plan（按实际参数生成计划），之后如果 generic plan 的估算代价不差就固定用它——这在数据分布极不均匀时会导致"某些参数特别慢"。可以用 `plan_cache_mode = force_custom_plan` 强制每次都按参数生成计划。

**实践建议**：当优化器选错时，不要急着加 `FORCE INDEX`（MySQL）或调 `enable_seqscan = off`（PostgreSQL）——这些是治标。先更新统计信息，再考虑重构索引或改写 SQL。

# 四、事务与并发控制

## 4.1 ACID 分别由什么保证

| 特性 | 含义 | 实现手段 |
| --- | --- | --- |
| 原子性 Atomicity | 要么全做，要么全不做 | undo log（MySQL）/ 多版本元组（PG） |
| 一致性 Consistency | 约束不被破坏 | 由 A、I、D 共同保证 + 业务约束 |
| 隔离性 Isolation | 并发事务互不干扰 | 锁 + MVCC |
| 持久性 Durability | 提交后不丢 | redo log（MySQL）/ WAL（PG） |

注意"一致性"不是靠某个组件实现的，它是前三者的**结果**，加上你写的约束（外键、唯一索引、`CHECK`）。所以"用了事务就一定一致"是错的。

## 4.2 隔离级别与异常现象

| 隔离级别 | 脏读 | 不可重复读 | 幻读 |
| --- | --- | --- | --- |
| READ UNCOMMITTED | ✓ 可能 | ✓ 可能 | ✓ 可能 |
| READ COMMITTED | ✗ | ✓ 可能 | ✓ 可能 |
| REPEATABLE READ | ✗ | ✗ | ✓ 标准定义下可能 |
| SERIALIZABLE | ✗ | ✗ | ✗ |

术语解释：

- **脏读**：读到了别的事务未提交的数据
- **不可重复读**：同一事务内两次读同一行，结果不同（别人改了并提交）
- **幻读**：同一事务内两次执行同一范围查询，行数不同（别人插入了并提交）

**默认值不同，这是 MySQL 与 PostgreSQL 最重要的行为差异之一**：

| 数据库 | 默认隔离级别 |
| --- | --- |
| MySQL (InnoDB) | REPEATABLE READ |
| PostgreSQL | READ COMMITTED |
| Oracle | READ COMMITTED |
| SQL Server | READ COMMITTED |

为什么这个差异重要？因为它决定了**你的应用在默认配置下的并发行为**：

- 在 MySQL 默认 RR 下，一个事务里两次 `SELECT` 看到的是同一个快照，这在"查一次判断、再查一次执行"的逻辑里是安全的。
- 在 PostgreSQL 默认 RC 下，每次 `SELECT` 都拿新快照，同样的代码就可能出问题。

**"MySQL 的 RR 解决了幻读"这个说法要精确理解**：标准定义的 RR 允许幻读。InnoDB 在 RR 下通过 **Next-Key Lock（间隙锁）** 在**当前读**（`SELECT ... FOR UPDATE` / `UPDATE` / `DELETE`）时阻止了范围内插入，从而避免了幻读。但在**快照读**（普通 `SELECT`）下，RR 靠 MVCC 返回旧快照，也不会看到"幻影行"——所以从使用者角度看确实没有幻读，但机制上是两套东西在配合。

PostgreSQL 的 RR 实际是**快照隔离（Snapshot Isolation）**，同样不会有幻读。区别在于写冲突时的处理：PostgreSQL 的 RR 下，如果两个事务修改同一行，后提交的会报错：

```text
ERROR: could not serialize access due to concurrent update
```

**应用必须能重试事务**，这是 PostgreSQL（以及所有 SI 实现）的硬性要求。

### 丢失更新：RR 也挡不住

一个特别容易被忽略的问题：**即使 RR，也可能丢失更新**。

```sql
-- 事务 A 和 B 并发执行
BEGIN;
SELECT balance FROM accounts WHERE id = 1;   -- 都读到 100
-- 应用层计算 100 - 30 = 70
UPDATE accounts SET balance = 70 WHERE id = 1;
COMMIT;
-- 另一个事务也写 70，30 块的扣减丢了
```

快照读读到的旧值 + 应用层计算 + 写回，这个模式在 RC 和 RR 下都不安全。三种解法：

1. **原子更新**（最简单）：`UPDATE accounts SET balance = balance - 30 WHERE id = 1 AND balance >= 30`
2. **悲观锁**：`SELECT ... FOR UPDATE` 锁住行再算，代价是阻塞
3. **乐观锁**：加 `version` 字段，`UPDATE ... SET balance = ?, version = version + 1 WHERE id = ? AND version = ?`，检查影响行数

## 4.3 InnoDB 的 MVCC

MVCC（多版本并发控制）的目标是**让读不阻塞写、写不阻塞读**。InnoDB 的实现要点：

**每行数据有两个隐藏列**：

- `DB_TRX_ID`（6 字节）：最后一次修改这行的事务 ID
- `DB_ROLL_PTR`（7 字节）：指向 undo log 中的旧版本，构成**版本链**
- （没有主键时还有 `DB_ROW_ID`）

**undo log 版本链**：每次 `UPDATE` 都把旧值写进 undo log，`ROLL_PTR` 把各个版本串成链表，最新的在最前。

**ReadView：可见性判断的依据**。它记录了生成那一刻的四个信息：

| 字段 | 含义 |
| --- | --- |
| `m_ids` | 生成时所有**活跃**（未提交）事务的 ID 列表 |
| `min_trx_id` | `m_ids` 中的最小值 |
| `max_trx_id` | 下一个将要分配的事务 ID |
| `creator_trx_id` | 创建这个 ReadView 的事务自己的 ID |

判断规则（拿到版本链上某个版本的 `trx_id`）：

1. `trx_id < min_trx_id` → 事务早已提交，**可见**
2. `trx_id >= max_trx_id` → 是 ReadView 之后才开始的，**不可见**
3. `trx_id` 在 `m_ids` 里 → 生成时还活着，**不可见**
4. `trx_id` 不在 `m_ids` 里且在范围内 → **可见**

沿版本链从新到旧找，第一个可见的版本就是结果。

**RC 与 RR 的区别就在 ReadView 的生成时机**：

- **READ COMMITTED**：**每次 `SELECT` 都生成新的 ReadView** → 每次都能看到最新已提交的数据 → 不可重复读
- **REPEATABLE READ**：**事务内第一次 `SELECT` 生成一次，之后复用** → 整个事务看到同一快照 → 可重复读

这也解释了一个常见困惑："为什么我在事务里读不到别的事务刚提交的数据？"——因为你的 ReadView 是事务开始时建立的，它看不到之后提交的版本。

## 4.4 PostgreSQL 的 MVCC

PostgreSQL 走了完全不同的路线：**不原地更新，而是写新版本**。

每行头部有两个事务 ID：

- `xmin`：插入这一行的事务
- `xmax`：删除/更新这一行的事务（0 表示未被删除）

`UPDATE` 的语义是：**把旧版本的 `xmax` 标成当前事务，然后在堆里插入一个新版本**（`xmin` = 当前事务）。旧版本物理上还躺在那里，只是对之后开启的事务不可见。

**快照**由 `xmin` / `xmax` / `xip`（进行中的事务列表）组成，判断某个版本是否可见。

![MVCC 实现对比：MySQL InnoDB 用 undo log 版本链加 ReadView 判断可见性，PostgreSQL 用行头的 xmin/xmax 加快照，旧版本靠 VACUUM 回收](/images/blog/sql-mysql-postgresql/mvcc-compare.svg)

**代价是"表膨胀"（bloat）**：死亡元组不会自己消失，必须靠 `VACUUM` 回收。这带来几个 PostgreSQL 特有的运维问题：

- **autovacuum 必须正常工作**。它被关闭或跟不上写入速度，表就会持续膨胀，查询越来越慢。
- **长事务是万恶之源**。一个开了几小时的事务会把快照固定在那个时间点，导致 VACUUM 无法回收这期间产生的所有死亡元组。监控 `pg_stat_activity` 里 `state = 'idle in transaction'` 的连接是基本功。
- **XID 回卷（wraparound）风险**：事务 ID 是 32 位循环使用的，约 20 亿个。如果 VACUUM 长期不运行，老的事务 ID 会被"冻结"失败，数据库会为自我保护而停机。这是 PostgreSQL 生产环境最严重的故障模式之一。

作为补偿，PostgreSQL 有一个 MySQL 没有的优化：**HOT 更新（Heap-Only Tuple）**。如果 `UPDATE` 修改的列**没有被任何索引引用**，且新版本能放进同一个数据页，那么所有索引都不需要更新——这大幅降低了写放大。

**两者对比一句话**：MySQL 靠"原地修改 + 回头找旧版本"，回滚快但 undo 链要维护；PostgreSQL 靠"保留旧版本 + 让新事务看不见它"，写放大但回滚零成本。

## 4.5 锁

### InnoDB 的锁

**InnoDB 的行锁是加在索引上的**——这是理解一切 InnoDB 锁问题的前提。

> **如果 `UPDATE` 的 `WHERE` 条件没走索引，InnoDB 会锁住扫描到的所有行（实际上是锁全表的效果），并发度瞬间归零。**

三种行锁：

| 锁 | 锁什么 | 什么时候加 |
| --- | --- | --- |
| Record Lock | 索引记录本身 | 唯一索引等值命中时 |
| Gap Lock | 两条记录之间的间隙 | RR 下防止插入 |
| Next-Key Lock | 记录 + 前面的间隙 | RR 下范围查询的默认行为 |

- **RR 默认 Next-Key Lock**；**RC 只加 Record Lock**（间隙锁基本关闭，除了唯一键冲突检查和外键检查）。所以**把隔离级别降到 RC 是缓解锁争抢的常用手段**。
- 另有 `AUTO-INC` 锁（自增列）、MDL 元数据锁（`ALTER TABLE` 会拿 MDL 写锁，阻塞所有查询，这是"加个索引把线上搞挂"的元凶）、插入意向锁（Insert Intention Lock）。
- 锁等待超时由 `innodb_lock_wait_timeout` 控制，默认 50 秒。

### PostgreSQL 的锁

- **行锁不依赖索引**：PostgreSQL 的行锁是在行头的 `xmax` 上做标记，所以**即使 `WHERE` 没走索引，也不会升级成全表锁**（代价是没走索引时要扫描很多行，慢但不会锁住无关的行）。这是与 InnoDB 的重要区别。
- **没有间隙锁**：PostgreSQL 在 RC/RR 下都不加 gap lock，所以不会阻塞"相邻区间"的插入。代价是某些场景需要显式加锁来防止并发插入。
- **表级锁有 8 种模式**，从 `ACCESS SHARE`（普通 `SELECT`）到 `ACCESS EXCLUSIVE`（`ALTER TABLE`、`DROP`）。

> **PostgreSQL 的实用建议**：`ALTER TABLE` 要拿 `ACCESS EXCLUSIVE` 锁，会阻塞一切。给大表加列时先设 `lock_timeout`，避免长时间排队把整个数据库的查询堵死：
>
> ```sql
> SET lock_timeout = '3s';
> ALTER TABLE big_table ADD COLUMN new_col int;
> ```
>
> 或者用 `ALTER TABLE ... ADD COLUMN ... DEFAULT ...` 的元数据快速路径（PostgreSQL 11+ 对常量默认值是 O(1) 的）。

**显式行锁**：PostgreSQL 提供了更细的锁模式，MySQL 8.0 也支持 `SKIP LOCKED` / `NOWAIT`：

```sql
SELECT * FROM jobs WHERE status = 'pending'
ORDER BY id
LIMIT 1
FOR UPDATE SKIP LOCKED;   -- 队列消费的经典写法：跳过被别的 worker 锁住的行
```

`SKIP LOCKED` 是"数据库当队列"最实用的特性——多个 worker 并发取任务时不会互相阻塞。

## 4.6 死锁

死锁的成因永远是：**两个事务以相反的顺序获取锁**。

```sql
-- 事务 A                    -- 事务 B
BEGIN;                       BEGIN;
UPDATE t SET x=1 WHERE id=1; UPDATE t SET x=1 WHERE id=2;
UPDATE t SET x=1 WHERE id=2; -- 等 A 释放 id=2
-- 等 B 释放 id=1 → 死锁
```

**处理方式**：

- InnoDB 会自动检测，回滚"代价较小"的事务，报错 `ERROR 1213 (40001): Deadlock found`。
- PostgreSQL 也会检测，报 `deadlock detected`。
- **两者都会主动杀掉一方来打破死锁**，所以死锁本身不会让数据库挂掉，但会让应用收到错误——**必须捕获这类错误并重试**。

**排查**：

```sql
-- MySQL
SHOW ENGINE INNODB STATUS;   -- 看 LATEST DETECTED DEADLOCK 段
-- 或开 innodb_print_all_deadlocks 把死锁写进错误日志

-- PostgreSQL
SELECT * FROM pg_locks WHERE NOT granted;   -- 谁在等锁
SELECT pid, query, state, wait_event FROM pg_stat_activity;
```

**预防**：

1. **统一加锁顺序**——所有事务按相同顺序访问资源（按主键排序后处理）。
2. **缩短事务**——事务里不要做 RPC、不要等用户输入、不要跑长循环。
3. **用唯一索引替代 `SELECT + INSERT`**——先把"先查后插"的竞态交给唯一约束处理。
4. **减少间隙锁**——考虑降级到 RC，或确保 `WHERE` 走索引。
5. **批量操作分批提交**，避免一个事务锁住几万行。

# 五、存储与日志：数据怎么安全落盘

## 5.1 InnoDB 的架构

![存储架构对比：InnoDB 的 Buffer Pool、Change Buffer、自适应哈希、redo/undo/binlog，与 PostgreSQL 的 shared_buffers、WAL buffers 和堆表文件](/images/blog/sql-mysql-postgresql/storage-arch.svg)

**内存结构**：

- **Buffer Pool**：最核心的组件，缓存数据页和索引页。默认用 LRU 变体管理：
  - **midpoint insertion**：新读入的页插在 LRU 列表的 5/8 处而不是头部，防止一次全表扫描把所有热点页挤出去（全表扫描的页只会在 old 区被快速淘汰）
  - 分 **young / old** 两个区，old 区的页需要在一定时间内再次被访问才能晋升到 young 区
- **Change Buffer**：对**非唯一二级索引**的写操作，如果目标页不在内存中，先记在 Change Buffer 里，等页被读进来时再合并——把随机写变成批量写。唯一索引不能用（因为要校验唯一性，必须先读页）。
- **自适应哈希索引（AHI）**：对热点等值查询自动建立哈希索引，把 B+ 树的 O(log n) 降到 O(1)。
- **Log Buffer**：redo log 的暂存区。

**磁盘结构**：

- **表空间（.ibd）**：InnoDB 8.0 默认 `innodb_file_per_table=ON`，每张表一个文件。页大小 16KB。
- **redo log**：**循环写**的固定大小文件组，负责崩溃恢复。
- **undo 表空间**：回滚和 MVCC 版本链。
- **doublewrite buffer**：防止**页断裂**（partial page write）——16KB 的页写到一半断电，页就损坏了。写数据页前先顺序写到 doublewrite 区，恢复时用它修复损坏页。
- **binlog**：Server 层的日志，与 InnoDB 无关，用于复制和归档。

## 5.2 redo / undo / binlog 与两阶段提交

这是 MySQL 面试的绝对高频题，也是理解持久性的关键。

| 日志 | 层次 | 类型 | 作用 |
| --- | --- | --- | --- |
| redo log | InnoDB | 物理逻辑日志 | **崩溃恢复**（保证持久性） |
| undo log | InnoDB | 逻辑日志 | **回滚 + MVCC 版本链** |
| binlog | Server 层 | 逻辑日志 | **复制 + 归档恢复** |

**为什么需要两阶段提交？** 因为 redo log 和 binlog 是两个独立的日志，必须保证它们一致，否则主从数据会不一致。流程是：

```text
① 写 redo log，标记为 prepare 状态
② 写 binlog
③ 写 redo log，标记为 commit 状态
```

**崩溃恢复的判断规则**（这是精髓）：

- redo log 里是 **prepare** 状态，且 **binlog 完整** → **提交**（说明 binlog 已落盘）
- redo log 里是 **prepare** 状态，且 **binlog 不完整** → **回滚**

这样就保证了 redo 和 binlog 的原子一致。

**持久性与性能的旋钮**：

| 参数 | 值 | 行为 | 崩溃时可能丢 |
| --- | --- | --- | --- |
| `innodb_flush_log_at_trx_commit` | 1（默认） | 每次提交都刷盘（fsync） | 不丢 |
| | 2 | 每次提交写到 OS 缓存，每秒 fsync | 丢 1 秒 / 断电丢更多 |
| | 0 | 每秒写并 fsync | 丢 1 秒 |
| `sync_binlog` | 1（推荐） | 每次提交都刷 binlog | 不丢 |
| | 0 | 交给 OS | 可能丢 |

**金融级配置是 `innodb_flush_log_at_trx_commit=1` + `sync_binlog=1`**（俗称"双 1"）。对一致性要求不高的日志类业务，可以降到 `2` + `0` 换取吞吐——**但必须明确知道自己在丢什么**。

## 5.3 PostgreSQL 的 WAL

PostgreSQL 只有一份日志：**WAL（Write-Ahead Log）**。

核心规则是 **WAL 规则**：**修改数据页之前，必须先把对应的 WAL 记录刷到磁盘**。这条规则是所有"先写日志再写数据"机制的鼻祖。

| 组件 | 说明 |
| --- | --- |
| WAL 段文件 | 默认 16MB 一个，写满切换 |
| `full_page_writes` | 开启后，checkpoint 之后第一次修改某页时把**整页**写进 WAL，防止页断裂 |
| checkpoint | 把 shared_buffers 里的脏页刷进堆表，缩短崩溃恢复时间 |
| 崩溃恢复 | 从最近一次 checkpoint 开始重放 WAL |

对比 InnoDB 的 doublewrite：**PostgreSQL 用 `full_page_writes` 把整页写进 WAL 来解决同样的问题**（页断裂），而 InnoDB 用独立的 doublewrite buffer。这是同一问题的两种解法。

WAL 还有两个额外用途：

1. **物理流复制**：备库直接接收并重放 WAL，是**块级**的，所以延迟通常比 MySQL 的 binlog 复制小。
2. **逻辑解码**：把 WAL 解析成逻辑变更，用于逻辑复制、CDC（变更数据捕获）和审计。

**PITR（时间点恢复）** 依赖 WAL 归档：`archive_mode = on` 把 WAL 段持续归档，恢复时用基础备份 + 重放 WAL 到指定时间点。

## 5.4 持久性配置对照

| 要求 | MySQL | PostgreSQL |
| --- | --- | --- |
| 提交即持久 | `innodb_flush_log_at_trx_commit=1` + `sync_binlog=1` | `synchronous_commit = on`（默认） |
| 换取吞吐 | 上面两个降级 | `synchronous_commit = off`（丢最多 3 个 WAL buffer 周期） |
| 页断裂防护 | doublewrite buffer | `full_page_writes = on` |
| 崩溃恢复依据 | redo log | WAL |
| 时间点恢复 | binlog + 全量备份 | WAL 归档 + 基础备份 |

# 六、MySQL 与 PostgreSQL 的架构差异

## 6.1 进程模型：线程 vs 多进程

| | MySQL | PostgreSQL |
| --- | --- | --- |
| 模型 | 单进程 + 多线程 | 多进程（每连接 fork 一个 backend） |
| 连接成本 | 相对低（线程） | **高**（进程，共享内存映射） |
| 单连接故障 | 可能影响整个进程 | 只影响自己的 backend |
| 连接数建议 | 几百到几千 | **几百以内，必须用连接池** |
| 连接池 | 应用侧池足够 | **必须上 PgBouncer**（推荐 transaction 模式） |

**这是选型和运维上非常实际的一条差异**。PostgreSQL 每来一个连接就 fork 一个进程，`max_connections` 设成 2000 会让上下文切换和内存开销爆炸。正确做法是 `max_connections` 保持较小（如 200~500），前面挂 PgBouncer 做连接复用。

MySQL 虽然连接是线程、成本更低，但也不是可以无限开——每个连接都有独立的排序缓冲 `sort_buffer_size`、`join_buffer_size`，几千个连接的内存开销同样可观。

## 6.2 存储引擎

**MySQL 是插件式的**：InnoDB、MyISAM、Memory、Archive、CSV、NDB…… 但现实中 **InnoDB 是唯一值得用的选择**。历史上 MyISAM 因为不支持事务、只支持表锁，早已不适合 OLTP；它的残留主要是几个特性差异（比如 `COUNT(*)` 不带 `WHERE` 时 MyISAM 有优化，因为它是行数计数器）。

**PostgreSQL 是单一引擎**（堆表）。10 版本引入了**可插拔的 table access method API**，允许第三方实现新的存储方式，比如 Citus 的列存扩展（用于分析场景）。但默认就是那一套堆表 + MVCC。

这个差异的实际影响：MySQL 里讨论"用哪个引擎"是有意义的（虽然答案通常是 InnoDB），PostgreSQL 里这个问题不存在。

## 6.3 数据类型与能力对比

这是 PostgreSQL 明显占优的领域——它的类型系统丰富得多：

| 能力 | MySQL | PostgreSQL |
| --- | --- | --- |
| JSON | `JSON` 类型（二进制存储） | `JSONB`（二进制、可索引） / `JSON`（文本） |
| JSON 索引 | 8.0.17+ 多值索引 | **GIN 索引**（成熟） |
| 数组类型 | ✗（用 JSON 模拟） | ✓ 原生 `int[]`，可建 GIN |
| 范围类型 | ✗ | ✓ `int4range` / `tstzrange` + GiST 排他约束（防时段重叠，做预订系统极方便） |
| 全文检索 | `FULLTEXT`（InnoDB 5.6+） | `tsvector` + GIN，支持词干、权重、排名 |
| 地理空间 | 8.0 有 SRID + R-tree | **PostGIS**（行业标准） |
| 枚举 | `ENUM` 原生 | `enum` 类型 / 推荐用 `CHECK` 或查找表 |
| 自增 | `AUTO_INCREMENT` | `GENERATED ... AS IDENTITY` |
| 布尔 | `TINYINT(1)` | 真 `BOOLEAN` |
| `RETURNING` | ✗ | ✓ 原生 |
| 生成列 | 5.7+ 支持 | 12+ 支持 |
| UPSERT | `ON DUPLICATE KEY UPDATE` | `ON CONFLICT DO UPDATE` |
| 索引类型 | B+ 树 / 全文 / 空间 / 哈希 | B-tree / Hash / GiST / SP-GiST / **GIN** / **BRIN** |
| 部分索引 | ✗ | ✓ |
| 表达式索引 | 8.0 函数索引 | ✓ |
| 覆盖索引 `INCLUDE` | ✗ | 11+ |
| 并行查询 | 8.0.14+ 有限支持 | 9.6+ 成熟 |
| 声明式分区 | ✓（较早） | 10+ |

**选型提示**：如果你的业务重度依赖 JSON 查询、地理计算、复杂类型约束（如"同一会议室时段不能重叠"这种排他约束），PostgreSQL 有明显优势。如果只是常规的 CRUD，两者的类型能力都够用。

## 6.4 复制机制

| | MySQL | PostgreSQL |
| --- | --- | --- |
| 日志 | binlog（逻辑） | WAL（物理） |
| 物理复制 | ✗（binlog 是逻辑的） | ✓ 流复制（块级） |
| 逻辑复制 | ✓ binlog 本身 | ✓ 逻辑复制（发布/订阅） |
| 复制粒度 | 库 / 表（binlog 格式决定） | 物理：整实例；逻辑：表级 |
| 复制格式 | STATEMENT / ROW / MIXED（推荐 ROW） | 物理：块；逻辑：行 |
| 同步方式 | 异步 / 半同步 / 组复制 | 异步 / 同步（`synchronous_standby_names`） |
| 并行回放 | 5.7+ 基于组提交，8.0 基于 writeset | 物理复制天然并行度较高 |
| 级联复制 | ✓ | ✓ |
| 拓扑灵活性 | 逻辑复制可跨版本、可选中继 | 逻辑复制可跨版本；物理复制要求同版本同架构 |

**关键差异**：

- MySQL 的 binlog 是**逻辑日志**，备库需要一个 SQL 线程（或多线程）"重新执行"这些变更——所以对复杂语句、DDL 的处理更重，延迟也更容易累积。ROW 格式下记录的是每行的前后镜像，虽然安全但日志量大。
- PostgreSQL 的物理流复制是**块级**的，备库只是"重放字节"，简单且延迟低，但要求主备**版本和架构完全一致**，且备库只能整实例复制（不能只复制某张表）。
- PostgreSQL 的逻辑复制基于**发布/订阅**模型，可以只复制指定表，能跨主版本升级，很适合做"部分数据同步"或"跨版本迁移"。

**MySQL 的组复制（MGR）** 值得单独提：它基于 Paxos 变体，提供**多数派确认**，是 MySQL 原生的高可用方案，避免了传统主从的"脑裂"问题（配置 `group_replication_single_primary_mode`）。

## 6.5 优化器能力

| | MySQL | PostgreSQL |
| --- | --- | --- |
| 连接算法 | 8.0.18 前只有 Nested Loop；之后有 Hash Join | Nested Loop / Hash Join / Merge Join 齐全 |
| 子查询优化 | 较弱（历史上大量 `IN` 子查询物化） | 较强，能改写为半连接 / 反连接 |
| CTE | 8.0+ | ✓（12+ 可内联） |
| 窗口函数 | 8.0+ | ✓ |
| `LATERAL` | 8.0.14+ | ✓ 原生 |
| 并行查询 | 8.0.14+ 有限 | ✓ 成熟 |
| 统计信息 | 索引基数 + 8.0 直方图 | 更细，支持多列统计 |
| 执行计划 | `EXPLAIN` / `EXPLAIN ANALYZE` | `EXPLAIN (ANALYZE, BUFFERS)`，信息更全 |

**MySQL 8.0 是一个分水岭**：CTE、窗口函数、Hash Join、降序索引、直方图、`EXPLAIN ANALYZE` 都是这个版本补齐的。**5.7 和 8.0 之间在 SQL 能力上的差距，比 8.0 与 PostgreSQL 之间的差距大得多。** 如果还在用 5.7，复杂查询的写法会被迫退回子查询和临时表。

## 6.6 选型建议

抛开 benchmark，几条实用判断：

1. **团队熟悉度和运维生态优先**。MySQL 的 DBA 更多、云厂商支持更全、问题更容易搜到答案。团队不熟悉 PostgreSQL 时，它带来的性能优势远小于你踩坑的成本。
2. **查询复杂度**。大量多表 JOIN、窗口函数、CTE、递归查询、复杂聚合 → PostgreSQL 的优化器更可靠。
3. **数据模型**。JSON、数组、范围类型、GIS、全文检索 → PostgreSQL。
4. **高并发简单读写**。两者都能做，MySQL 在这一场景的生态和案例更多（分库分表中间件、连接池、监控）。
5. **信创/国产化**。PostgreSQL 系（openGauss、GaussDB、Vastbase、KingbaseES）在国内合规场景更常见；MySQL 系主要是 MariaDB 和各云的兼容版。
6. **不要为了"性能"选型**。在同等工程投入下，两者的差异远小于"团队是否熟悉"带来的差异。

# 七、工程实践：从慢 SQL 到线上稳定

## 7.1 慢 SQL 定位的标准流程

一套可以照着走的流程：

**第一步：打开慢查询日志**

```ini
# MySQL
slow_query_log = ON
long_query_time = 1              # 超过 1 秒记录，初始排查可以设成 0.5
log_queries_not_using_indexes = ON
```

```ini
# PostgreSQL
log_min_duration_statement = 1000   # 毫秒
log_lock_waits = on
```

**第二步：聚合分析，找出 TOP 消耗**

```bash
# MySQL
mysqldumpslow -s t -t 20 slow.log          # 按总耗时排序取前 20
pt-query-digest slow.log                     # Percona 工具，更有用，能按总耗时/次数聚合
```

```sql
-- PostgreSQL：pg_stat_statements 扩展，按总耗时排序
SELECT query, calls, total_exec_time, mean_exec_time, rows
FROM pg_stat_statements
ORDER BY total_exec_time DESC
LIMIT 20;
```

**注意"总耗时"和"单次耗时"的区别**：一条执行 5ms 但每秒调用 10000 次的 SQL，危害远大于一条偶尔执行 10 秒的报表 SQL。`pt-query-digest` 和 `pg_stat_statements` 都能按总耗时聚合，这是它们比原始慢日志更有用的地方。

**第三步：EXPLAIN 分析**

用 3.5 节的方法看执行计划，重点看：走了哪个索引、估算行数与实际行数是否吻合、有没有 `filesort` / `temporary` / `Seq Scan`。

**第四步：定位根因**。常见根因和对应处理：

| 症状 | 根因 | 处理 |
| --- | --- | --- |
| `type=ALL` | 没索引或没走对索引 | 加索引 / 改写法满足最左前缀 |
| `Using filesort` | 排序字段不在索引里 | 调整索引顺序让排序走索引 |
| `rows` 估算严重偏离 | 统计信息过期 | `ANALYZE TABLE` / `ANALYZE` |
| `Using temporary` | `GROUP BY` 无合适索引 | 建覆盖 `GROUP BY` 的索引 |
| 回表次数过多 | 索引选择性差 | 考虑覆盖索引或改变索引列顺序 |
| 锁等待 | 长事务 / 无索引更新 | 缩短事务 / 加索引 |

**第五步：验证**。用**真实数据量**压测。开发库上 1000 行的表全表扫也很快，上线后 5000 万行就是灾难——**索引决策必须在接近生产的数据量上验证**。

## 7.2 索引设计原则

1. **联合索引优先于多个单列索引**。`(a, b)` 能服务 `WHERE a = ?` 和 `WHERE a = ? AND b = ?`，而 `(a)` + `(b)` 两个索引只服务单列查询，还要多维护一份。
2. **等值列在前，范围列在后**（见 3.3）。
3. **争取覆盖索引**。高频查询如果只取少数几列，把这几列加进索引，消除回表，往往是收益最大的一次优化。
4. **不要迷信"区分度高的列在前"**。查询模式决定顺序，不是理论。
5. **控制索引数量**。每个索引都增加写放大和空间，一张表 5~7 个索引已经接近上限。上线新索引前先看有没有可以合并或删除的。
6. **避免在长字符串上建全列索引**。用前缀索引（`INDEX(name(20))`，MySQL）或表达式索引（`lower(email)`，PG）。MySQL 的 InnoDB 单列索引最大 3072 字节。
7. **主键要短、要递增**（见 3.2）。这是 InnoDB 特有的、影响最广的一条设计约束。
8. **注意 NULL 与低区分度列**。`status` 这种只有几个值的列单独建索引意义不大，但作为联合索引的一部分（`(status, created_at)`）可能很有用。

## 7.3 关键参数调优

**MySQL**：

| 参数 | 建议 | 说明 |
| --- | --- | --- |
| `innodb_buffer_pool_size` | 物理内存的 50%~75% | **最重要的参数**，缓存命中率决定一切 |
| `innodb_log_file_size` | 1~4 GB | 太小会频繁 checkpoint；8.0.30+ 用 `innodb_redo_log_capacity` |
| `innodb_flush_log_at_trx_commit` | 1 | 持久性优先 |
| `sync_binlog` | 1 | 配合上一项 |
| `innodb_flush_method` | `O_DIRECT` | 避免双重缓存（OS cache + buffer pool） |
| `max_connections` | 按连接池配置 | 不是越大越好，配合应用侧连接池 |
| `innodb_io_capacity` | SSD 设 2000~4000 | 影响刷脏页速度 |

**PostgreSQL**：

| 参数 | 建议 | 说明 |
| --- | --- | --- |
| `shared_buffers` | 物理内存的 25% | 与 MySQL 不同，PG 更依赖 OS page cache，所以不设太高 |
| `effective_cache_size` | 物理内存的 50%~75% | **不是分配内存**，只是告诉优化器"可用的缓存有多少" |
| `work_mem` | 谨慎 | **每个排序/哈希操作、每个连接**都独立分配，设大了很容易 OOM |
| `maintenance_work_mem` | 256MB~1GB | 影响 `VACUUM`、`CREATE INDEX` 速度 |
| `max_wal_size` | 几 GB | 影响 checkpoint 频率 |
| `random_page_cost` | SSD 设为 1.1 | 默认 4.0 是为机械盘设计的，SSD 上不调会让优化器低估索引扫描 |
| `effective_io_concurrency` | SSD 设 200 | 影响位图扫描的预读 |
| `max_connections` | 200~500 + PgBouncer | 见 6.1 |
| autovacuum 相关 | 按写入量调整 | 高写入表要调激进，否则表膨胀 |

**最容易忽略的两个**：MySQL 的 `innodb_buffer_pool_size` 用默认值（128MB）跑生产，和 PostgreSQL 的 `random_page_cost` 不调（导致优化器在 SSD 上仍以为随机读很贵）。

## 7.4 深分页的正确写法

```sql
-- ❌ OFFSET 越大越慢：数据库要先取出 1000020 行再丢掉前 1000000 行
SELECT * FROM orders ORDER BY id LIMIT 20 OFFSET 1000000;
```

三种解法：

**① 游标分页（最优，但要改接口）**

```sql
SELECT * FROM orders WHERE id > 1000000 ORDER BY id LIMIT 20;
```

记住上一页最后一条的 id，下一页从它之后取。缺点是不能跳页。

**② 延迟关联（保持跳页能力）**

```sql
SELECT o.*
FROM orders o
JOIN (SELECT id FROM orders ORDER BY id LIMIT 20 OFFSET 1000000) t
  ON o.id = t.id;
```

先在索引上完成分页（覆盖索引，不回表），再只对最终的 20 条回表。比原写法快一两个数量级。

**③ 业务降级**：限制最大页数（"最多翻到第 100 页"），或用近似值（"约 12345 条结果"）。大多数业务场景其实不需要精确的总数和任意跳页。

## 7.5 备份与恢复

**备份策略的三层**：

| 层次 | MySQL | PostgreSQL |
| --- | --- | --- |
| 逻辑备份 | `mysqldump` / `mysqlpump` | `pg_dump` / `pg_dumpall` |
| 物理备份 | **XtraBackup**（热备，不停机） | `pg_basebackup` / pgBackRest / Barman |
| 增量 / PITR | binlog | WAL 归档 |
| 一致性快照 | 部分云厂商支持 | 部分云厂商支持 |

**必须做到的四件事**：

1. **定期验证恢复**——备份文件能生成不等于能恢复。定期在隔离环境跑一次完整恢复演练。
2. **异地保存**——本地和备份在同一块盘或同一个机房，等于没有备份。
3. **明确 RPO 和 RTO**——能接受丢多少数据（决定是否需要 binlog/WAL 归档）、能接受停多久（决定恢复方案）。
4. **逻辑备份与物理备份并存**——物理备份恢复快但版本绑定；逻辑备份可跨版本、可单表恢复，但慢。

## 7.6 主从复制与读写分离

![主从复制与高可用拓扑：应用经代理层分流，写走主库、读走从库，复制链路可同步可异步，故障时由仲裁组件触发主从切换](/images/blog/sql-mysql-postgresql/replication-ha.svg)

**读写分离能扩读，但会引入"写后读不一致"**：

```text
用户下单 → 写主库 → 立即跳转订单详情页 → 读从库 → 复制还没同步 → 订单不存在
```

这是读写分离最经典的翻车场景。解法（按代价从低到高）：

1. **关键路径强制走主库**：下单后的详情页、支付后的状态查询，直接路由到主库。简单有效，覆盖大部分问题。
2. **半同步复制**：MySQL 的 `semi-sync` 要求至少一个从库确认收到 binlog 主库才认为提交成功。注意它保证的是"日志已送达"，不是"已回放"，所以仍有极小的不一致窗口。PostgreSQL 用 `synchronous_standby_names` 实现同步复制，可以配置成 `remote_apply` 级别（备库已应用），一致性更强但延迟更高。
3. **位置等待**：客户端记住写入的位点（MySQL 的 GTID、PostgreSQL 的 LSN），读从库时等待从库追上这个位点再返回。
4. **客户端粘性**：同一用户在短时间窗口内固定路由到同一个节点。

**复制延迟的监控**：

```sql
-- MySQL
SHOW REPLICA STATUS\G   -- 看 Seconds_Behind_Source（注意：这个值在网络中断时不可靠）
-- 更可靠：对比主库和从库的 GTID 集合差异

-- PostgreSQL
SELECT pg_last_wal_receive_lsn(), pg_last_wal_replay_lsn(),
       pg_wal_lsn_diff(pg_last_wal_receive_lsn(), pg_last_wal_replay_lsn()) AS lag_bytes;
```

`Seconds_Behind_Source` 在中继日志被追平时会变成 0，即使实际数据落后——**不要只信这个值**，要结合位点差异判断。

## 7.7 高可用架构

**MySQL 的常见方案**：

| 方案 | 原理 | 特点 |
| --- | --- | --- |
| 主从 + MHA | 外部工具监控并切换 | 老牌，已较少维护 |
| 主从 + Orchestrator | 拓扑管理与自动切换 | 灵活，支持复杂拓扑 |
| **MGR（组复制）** | Paxos 多数派 + 冲突检测 | 原生、防脑裂，写入延迟略高 |
| 云 RDS 多可用区 | 厂商托管 | 运维成本最低 |

**PostgreSQL 的常见方案**：

| 方案 | 原理 | 特点 |
| --- | --- | --- |
| **Patroni + etcd/Consul** | DCS 做领导者选举，Patroni 管理集群 | 当前主流 |
| repmgr | 轻量级主从管理与切换 | 简单场景够用 |
| pg_auto_failover | 基于监视节点的自动切换 | 部署简单 |
| 云 RDS 多可用区 | 厂商托管 | 同上 |

**无论哪种方案，都要处理这三个问题**：

1. **脑裂防护**：切换必须由仲裁（多数派 / 外部 DCS）决定，不能靠单点判断"主库好像挂了"。网络分区时，"以为主库挂了"而提升从库，会造成双主写、数据分叉。
2. **fencing**：旧主库必须被强制隔离（关机 / 撤销访问 / 断网），否则它恢复后会带着旧数据继续接受写入。
3. **切换后的连接收敛**：VIP 漂移、DNS 缓存、连接池里的旧连接——都要考虑。切换完成后应用能不能自动恢复，比切换本身更常出问题。

## 7.8 分库分表

**先说结论：分库分表是最后手段。** 在分片之前，按顺序尝试：加索引 → 优化 SQL → 加缓存 → 读扩展（从库）→ 归档冷数据 → 分区表。大多数"需要分库分表"的场景，其实卡在前面几步。

**什么时候才真的需要**：

- 单表数据量超过千万级且持续增长，索引优化后仍慢
- 单库写入 QPS 达到实例上限（通常几千到几万，取决于硬件和事务大小）
- 单机磁盘容量成为约束

**拆分方式**：

| 方式 | 做法 | 代价 |
| --- | --- | --- |
| 垂直拆库 | 按业务域拆（订单库、用户库） | 跨库 JOIN、分布式事务 |
| 垂直拆表 | 把大字段（`TEXT` / `BLOB`）拆到附表 | 需要额外查询 |
| 水平拆表 | 按分片键把行分散到多张同构表 | 路由、跨片查询、扩容 |

**分片键的选择**是水平拆分的核心决策：

- 要**均匀**：避免热点。用哈希（`user_id % 16`）比用时间更容易均匀。
- 要**让绝大多数查询落在单片**：分片键应该是查询条件里最常出现的过滤列。选了 `user_id` 分片，就不能高效地按 `order_no` 查——除非再建一张"路由表"或用基因法（把 `user_id` 的位编码进 `order_no`）。
- **要能扩容**：取模分片扩容时要搬迁大量数据。成倍扩容（16 → 32）只需要拆一半，是最省事的。一致性哈希或预分片（一开始就分成 1024 个逻辑片，再映射到物理库）能缓解。

**分片带来的四个必须解决的问题**：

1. **全局唯一 ID**：不能再用单库自增。方案有雪花算法（Snowflake，时间 + 机器 + 序列）、号段模式（数据库批量分配 ID 区间）、Redis `INCR`、有序 UUID（v7）。
2. **跨片查询**：`ORDER BY` + `LIMIT`、`COUNT`、聚合都要在中间件层做"各片查询 + 结果归并"。深度分页在分片下更痛。
3. **跨片 JOIN**：尽量避免。手段有冗余字段（把常用维度冗余进订单表）、广播表（小表在每个片都存一份）、应用层组装。
4. **分布式事务**：避免跨片事务。手段有本地消息表（最终一致）、Saga（补偿）、TCC（预留-确认-取消）。**XA 事务在性能和可用性上代价太高，通常不推荐**。

**中间件**：MySQL 生态有 ShardingSphere、Vitess（YouTube 出品，K8s 友好）；PostgreSQL 生态有 Citus（原生分布式扩展，把分片下沉到数据库内部，对应用更透明）。

# 八、把这篇文章收成几条原则

1. **SQL 是声明，执行计划是事实。** 不看 `EXPLAIN` 的优化都是猜。同一条 SQL 在不同数据分布下可能是两个世界。
2. **索引是给查询用的，不是给表用的。** 索引设计要从高频查询的 `WHERE` / `ORDER BY` / `SELECT` 列表反推，而不是从"哪些列重要"出发。
3. **默认隔离级别决定并发行为。** MySQL 的 RR 和 PostgreSQL 的 RC 不是同一个世界；迁移或换库时，这一条比语法差异更容易引发数据事故。
4. **日志决定持久性，持久性与性能永远在交换。** "双 1"、`synchronous_commit`、半同步——每一个开关背后都是明码标价的取舍。
5. **复制解决可用性，不解决一致性。** 读写分离一旦引入，写后读就必须显式处理，指望复制"够快"是赌博。
6. **MVCC 的实现方式决定了运维重点。** MySQL 盯长事务导致的 undo 膨胀，PostgreSQL 盯长事务导致的 VACUUM 阻塞和表膨胀——两者的病灶不同，监控指标也不同。
7. **分库分表是最后手段。** 先用索引、缓存、归档、分区、读扩展，穷尽之后才考虑分片。
8. **选型看团队和业务，不看 benchmark。** 团队熟悉度带来的收益，远大于两个数据库之间的原生性能差距。

数据库的知识有个特点：**上层是语法，下层是数据结构与并发控制，中间用执行计划和日志连接起来**。语法几天就能学会，下层的理解决定了你能不能在凌晨三点定位一个主从延迟引发的数据不一致。这篇把这条链路走了一遍，希望下一次遇到慢查询或死锁时，你能直接想到该看哪张图。

# 参考

- [MySQL 8.0 Reference Manual](https://dev.mysql.com/doc/refman/8.0/en/)
- [MySQL 8.0：InnoDB 存储引擎](https://dev.mysql.com/doc/refman/8.0/en/innodb-storage-engine.html)
- [PostgreSQL 官方文档](https://www.postgresql.org/docs/current/)
- [PostgreSQL：并发控制](https://www.postgresql.org/docs/current/mvcc.html)
- [Use The Index, Luke!（SQL 索引与性能）](https://use-the-index-luke.com/)
- [Percona Toolkit（pt-query-digest）](https://www.percona.com/software/database-tools/percona-toolkit)
- [Patroni 高可用方案](https://patroni.readthedocs.io/)
- [Apache ShardingSphere](https://shardingsphere.apache.org/)
- [Citus：PostgreSQL 分布式扩展](https://www.citusdata.com/)
