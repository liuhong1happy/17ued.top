云原生（Cloud Native）这个词经常被简化成"把应用塞进容器"，但它真正描述的是一套**让系统在高并发、高可用、高性能三个方向上持续演进的方法论**：容器提供一致的交付单元，Kubernetes 提供声明式的编排与自愈，微服务与可观测性把系统拆成可独立扩展、可独立定位的部分。CNCF 的定义里，容器、服务网格、微服务、不可变基础设施、声明式 API 是技术手段，而 DevOps、持续交付、可观测性是工程手段，两者缺一不可。

Kubernetes 在这套体系里的位置，更像一台**分布式的操作系统**：它把一堆机器抽象成一台逻辑机器，统一提供调度、网络、存储、配置与自愈能力。但有一点必须提前说清楚——**K8s 不会自动给你三高**。它给的是一组原语（ReplicaSet、Probe、HPA、PDB、Service、拓扑约束……），怎么组合这些原语、架构上做什么取舍，决定了你的系统是能扛住十倍流量，还是会在第一次大促就雪崩。

这篇文章只讲一件事：**如何用 Kubernetes 这批原语，把高并发、高可用、高性能落到具体的 YAML 与架构决策上**。

![Kubernetes 云原生分层架构：流量经入口层进入无状态工作负载，控制面负责调度、自愈与弹性，数据面负责服务发现、网络与存储，底座是可观测性与 GitOps](/images/blog/k8s-cloud-native/cloud-native-overview.svg)

# 一、先把三个目标拆开

三高经常被混在一起谈，但它们各自解决的是不同层面的问题，**优化手段甚至会互相冲突**：

| 目标 | 核心问题 | 关键手段 | 冲突点 |
| --- | --- | --- | --- |
| 高并发 | 同一时刻能处理多少请求 | 无状态化、水平扩展、异步削峰、限流 | 扩副本会放大下游压力，也会增加成本 |
| 高可用 | 出故障时服务是否还在 | 冗余、探针、PDB、多可用区、容灾 | 强一致与高可用天然对立（CAP） |
| 高性能 | 单个请求多快、资源多省 | 网络旁路、内核调优、绑核、拓扑感知 | 极致性能往往牺牲弹性与可移植性 |

一个常见的误区是：**用高性能的手段去解高并发的问题**。单机优化到极限，QPS 从 3000 提到 4000，是 33% 的提升；而无状态化之后从 4 个副本扩到 40 个副本，是 10 倍的提升。**先解决能不能水平扩展（Scale Out），再解决单机效率（Scale Up）**——这是所有三高工作的顺序。

# 二、高并发：把请求水平摊开

高并发的本质是把压力和状态从"单点"变成"可复制的面"。K8s 提供了复制的能力，但**前提是你的应用允许被复制**。

## 2.1 无状态化是所有弹性的前提

一个有状态的 Pod，副本数只能等于 1；一个把 Session 存在本地内存的 Pod，扩到 3 个副本就会出现用户随机掉线。所以扩副本之前，先回答三个问题：

1. **会话状态存哪里？** 外置到 Redis / 数据库，或者干脆用 JWT 把状态交给客户端（签名校验，服务端无状态）
2. **本地文件写哪里？** 上传文件、临时任务产物走对象存储（S3/MinIO），不要写容器本地路径——容器重建即丢失
3. **定时任务谁来跑？** 多副本下 `@Scheduled` 会在每个 Pod 里同时触发，必须改成 `CronJob`（K8s 保证单实例）或基于分布式锁选主

把这三件事解决掉，Deployment 的 `replicas` 才真正有意义。

## 2.2 水平扩缩容：HPA 与 KEDA

最基础的弹性是 HPA（Horizontal Pod Autoscaler）。它周期性拉取指标，按公式 `期望副本数 = ceil(当前副本数 × 当前指标值 / 目标值)` 调整副本数。基于 CPU 的 HPA 门槛最低：

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: api-gateway
  namespace: prod
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: api-gateway
  minReplicas: 4
  maxReplicas: 60
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 60
  behavior:
    scaleUp:
      stabilizationWindowSeconds: 0          # 扩容要快，不做窗口平滑
      policies:
        - type: Percent
          value: 100
          periodSeconds: 30
        - type: Pods
          value: 8
          periodSeconds: 30
      selectPolicy: Max
    scaleDown:
      stabilizationWindowSeconds: 300        # 缩容要慢，避免抖动
      policies:
        - type: Percent
          value: 10
          periodSeconds: 60
```

这里有两个容易踩的坑：

- **扩容快、缩容慢**是刻意的。扩容慢一拍，请求已经在排队了；缩容快一拍，流量抖动会让副本数来回震荡（thrashing）。`behavior` 字段就是用来表达这个不对称的。
- **CPU 不是好指标**。CPU 利用率属于滞后指标——等它涨上来，用户已经在超时了；而且很多服务是 IO 密集型的，CPU 打满之前连接池早就耗尽了。

更贴近业务的做法是**用请求量、队列深度这类领先指标**。业务指标需要 Prometheus Adapter 把它注册成自定义指标：

```yaml
  metrics:
    - type: Pods
      pods:
        metric:
          name: http_requests_per_second
        target:
          type: AverageValue
          averageValue: "800"     # 每个 Pod 稳定处理 800 QPS
```

如果负载来自消息队列，用 KEDA 更直接——它能按 Kafka lag、RabbitMQ 队列长度甚至 Redis List 长度直接伸缩，缩到 0 也支持：

```yaml
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: order-consumer
spec:
  scaleTargetRef:
    name: order-consumer
  minReplicaCount: 2
  maxReplicaCount: 100
  cooldownPeriod: 120
  triggers:
    - type: kafka
      metadata:
        bootstrapServers: kafka.prod.svc:9092
        consumerGroup: order-consumer
        topic: order.created
        lagThreshold: "1000"    # 积压超过 1000 条就开始扩容
```

![HPA 扩缩容闭环：指标采集（Metrics Server / Prometheus Adapter）→ 期望副本计算 → Deployment 副本调整 → 新 Pod 就绪并分担流量，扩容快、缩容慢](/images/blog/k8s-cloud-native/hpa-loop.svg)

## 2.3 削峰填谷：异步化与限流

**扩副本解决不了瞬时脉冲**。HPA 从指标上涨到新 Pod Ready，通常需要 30 秒到数分钟（拉镜像、启动、探针通过）；而秒杀场景的峰值可能只持续几秒。这时候正确的做法不是扩容，而是**把同步调用变成异步**：

1. 入口层快速校验（库存是否售罄、用户是否重复提交），通过则写入消息队列并立刻返回"排队中"
2. 消费端按自身处理能力匀速消费，队列扮演缓冲池
3. 峰值过后队列追平，系统恢复常态

队列的代价是**一致性从强变最终**，前端需要轮询或推送来告知结果。这是有意的设计取舍，不是缺陷。

对于超出承载能力的流量，还需要**主动放弃一部分**。限流应该分层做：

| 层次 | 手段 | 特点 |
| --- | --- | --- |
| 接入层 | Ingress 限流、WAF、CDN 频控 | 成本最低，在流量进入集群前拦截 |
| 服务层 | 令牌桶 / 漏桶、Sentinel、Envoy 局部限流 | 能按接口、按用户、按租户精细控制 |
| 依赖层 | 连接池上限、熔断器、舱壁隔离 | 保护下游，避免级联故障 |

在 Ingress 层做基础限流，一行注解就够：

```yaml
metadata:
  annotations:
    nginx.ingress.kubernetes.io/limit-rps: "200"              # 每秒 200 请求
    nginx.ingress.kubernetes.io/limit-burst-multiplier: "3"   # 允许 3 倍突发
    nginx.ingress.kubernetes.io/limit-connections: "50"       # 单 IP 并发连接
```

**熔断与降级是限流的孪生兄弟**：限流是"我不接受更多请求"，熔断是"下游挂了，我先别调它"，降级是"拿不到完整数据，我用缓存或默认值先兜住"。三者合起来，系统才能在部分依赖失效时仍然对外提供降级但可用的服务——这正是高可用的核心思想。

## 2.4 调度视角下的高并发

集群规模上去之后，瓶颈往往从应用转移到调度器与节点：

- **资源碎片**：大量小 Pod 加上少量大 Pod，会让节点资源被切得很碎，出现"总量够但没有一个节点放得下"的情况。用 `requests` 精确描述真实需求，比事后加机器更有效。
- **调度吞吐**：单集群超过 5000 节点 / 15 万 Pod 时，默认调度器的打分阶段会成为瓶颈，需要开启调度器性能调优参数（`percentageOfNodesToScore`）或采用多调度器分片。
- **镜像分发**：几百个 Pod 同时拉同一个镜像会把镜像仓库打挂。用 P2P 分发（Dragonfly、Kraken）或预热镜像到节点，能让扩容速度提升数倍。

# 三、高可用：假设一切都会挂

高可用的思维模型只有一句话：**假设任何组件随时会挂——机器、磁盘、网络、可用区、乃至整个 Region——然后让系统在任何一个组件失效时仍然可用**。K8s 的自愈能力覆盖了其中一部分（Pod 挂了重建、节点失联驱逐），另一部分必须靠架构设计。

## 3.1 冗余要"真的冗余"

`replicas: 3` 不等于高可用。如果调度器把 3 个副本放在了同一台宿主机、同一个机架、同一个可用区，那台机器一挂就是全挂。真正有效的冗余需要**故障域隔离**：

```yaml
spec:
  template:
    spec:
      affinity:
        podAntiAffinity:
          # 硬约束：同一个节点上不能有两个本服务的 Pod
          requiredDuringSchedulingIgnoredDuringExecution:
            - labelSelector:
                matchLabels:
                  app: api-gateway
              topologyKey: kubernetes.io/hostname
      topologySpreadConstraints:
        # 软约束：优先按可用区均匀分布，最大倾斜 1
        - maxSkew: 1
          topologyKey: topology.kubernetes.io/zone
          whenUnsatisfiable: ScheduleAnyway
          labelSelector:
            matchLabels:
              app: api-gateway
```

- `podAntiAffinity` 的 **required** 约束能保证节点级隔离，但副本数超过节点数时会有一部分 Pod 永远 Pending——生产上通常用 `preferred` 或 `topologySpreadConstraints` 更稳妥。
- `topologySpreadConstraints` 是更现代的写法，它按 `zone` / `hostname` 等拓扑键做**均匀度控制**，`whenUnsatisfiable` 决定不满足时是拒绝调度（`DoNotSchedule`）还是退让（`ScheduleAnyway`）。

## 3.2 探针：写错的探针比不写更危险

探针是 K8s 判断 Pod 状态的唯一依据，三类探针职责完全不同：

| 探针 | 失败后果 | 什么时候用 |
| --- | --- | --- |
| `startupProbe` | 反复重启容器 | 启动慢的服务（JVM、大模型加载），成功后交给 liveness 接管 |
| `readinessProbe` | 从 Service Endpoints 摘除（不重启） | 判断"能否接流量"——依赖未就绪、预热未完成时应返回失败 |
| `livenessProbe` | **重启容器** | 判断"是否死锁/僵死"，应该少用、阈值放宽 |

几个真实事故的根因：

- **liveness 探针打到依赖上**。探针里查数据库，数据库抖了一下，所有 Pod 同时判定为"死了"并被批量重启——**一次依赖抖动被放大成全量重启**。liveness 只应该反映进程自身的健康。
- **探针超时比接口响应还短**。GC 停顿 2 秒就被判定失败，重启后又要重新预热。JVM 类服务 `timeoutSeconds` 建议 ≥ 3，`failureThreshold` ≥ 3。
- **没有 startupProbe，用 liveness 的 `initialDelaySeconds` 硬扛**。启动时间一旦波动就重启，重启后更慢，形成恶性循环。

```yaml
startupProbe:            # 最多容忍 30 × 2s = 60s 的启动时间
  httpGet: { path: /healthz, port: 8080 }
  failureThreshold: 30
  periodSeconds: 2
readinessProbe:          # 依赖异常就摘流量，但不重启
  httpGet: { path: /ready, port: 8080 }
  periodSeconds: 5
  timeoutSeconds: 3
  failureThreshold: 2
livenessProbe:           # 只反映进程自身
  httpGet: { path: /healthz, port: 8080 }
  periodSeconds: 10
  timeoutSeconds: 5
  failureThreshold: 6
```

## 3.3 发布不出事：滚动更新与优雅停机

高可用最容易被打破的时刻，是**发布**。默认滚动更新会先停旧 Pod 再起新 Pod，如果应用没有优雅停机，正在处理的请求会被直接切断：

```yaml
spec:
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 25%           # 先多起 25%，保证总容量不降
      maxUnavailable: 0       # 关键服务绝不允许容量下降
  template:
    spec:
      terminationGracePeriodSeconds: 45
      containers:
        - name: api
          lifecycle:
            preStop:
              exec:
                # 先休眠，等 kube-proxy/Ingress 把本 Pod 从转发规则里摘干净
                command: ["/bin/sh", "-c", "sleep 10"]
```

顺序很关键：**Pod 被标记 Terminating → 从 Service Endpoints 摘除 → preStop 执行 → SIGTERM → 应用停止接收新请求、处理完存量请求 → 超时后 SIGKILL**。`preStop` 的 `sleep` 不是偷懒，而是补上"Endpoints 摘除到各节点转发规则生效"之间的时间差——这段窗口里流量仍可能打到即将退出的 Pod 上。

灰度发布则更进一步，把"新版本"和"线上流量"之间加一道闸门：

| 策略 | 做法 | 回滚速度 |
| --- | --- | --- |
| 滚动更新 | 分批替换，新旧共存 | 分钟级 |
| 蓝绿 | 新版本全量部署，切流量 | 秒级（切回即可） |
| 金丝雀 | 导 1% → 5% → 50% 流量，看指标放量 | 秒级 |
| 影子流量 | 复制生产流量到新版本，不返回结果 | 不影响线上 |

K8s 原生只到滚动更新，金丝雀 / 蓝绿需要用 Argo Rollouts、Flagger 之类的 CRD 来补，核心是**把"发布"变成一个可以按指标自动暂停和回滚的状态机**。

## 3.4 有状态服务的高可用

数据库、消息队列这类有状态服务，K8s 只能帮到一半。用 StatefulSet 可以保证：

- **稳定的网络标识**：`mysql-0`、`mysql-1` 的 DNS 名固定，主从复制配置不用改
- **稳定的存储**：通过 `volumeClaimTemplates` 让每个 Pod 绑定自己的 PVC，Pod 重建后数据不丢
- **有序的启停**：默认按序号顺序创建、逆序销毁，符合多数集群选主逻辑

但**选主、数据同步、故障切换**这些仍然要靠 Operator（MySQL Operator、Redis Operator、Kafka 的 Strimzi）或应用自身实现。目前生产上更务实的做法是：**核心数据库走托管服务或独立部署，K8s 只跑无状态应用与可容忍重建的中间件**。

存储本身也是单点。作为 PV 后端，NFS 在高并发下 IO 会明显劣化——NFSv4.1 引入 pNFS 后才有所缓解：

```yaml
apiVersion: v1
kind: PersistentVolume
metadata:
  name: nfs-pv
spec:
  capacity:
    storage: 20Gi
  accessModes: ["ReadWriteOnce"]
  persistentVolumeReclaimPolicy: Retain
  mountOptions:
    - nfsvers=4.1
    - noatime          # 不更新访问时间，减少元数据写入
    - rsize=1048576
    - wsize=1048576
    - hard
    - intr
  nfs:
    server: 10.0.0.10
    path: /data
```

更稳妥的方案是分布式存储（Ceph RBD/CephFS、Longhorn）或云厂商的块存储 CSI，它们具备多副本、快照与在线扩容能力。

## 3.5 控制面与跨故障域容灾

**控制面是集群的单点**。生产集群必须：

- `kube-apiserver` 至少 3 个实例，前面挂 LB，并配置 `--max-requests-inflight` 防止大对象 List 打爆
- `etcd` 用 3 或 5 个节点（奇数，容忍 (n-1)/2 个故障），数据盘用独立 SSD，定期 `defrag`，配置 `--quota-backend-bytes`
- 开启 etcd 定时快照并**离线验证可恢复性**——没验证过的备份等于没有备份
- 控制面与业务负载分离，避免业务 Pod 抢占 apiserver 节点资源

跨故障域则是另一个层级的问题：

![跨可用区高可用拓扑：入口层多可用区 LB，控制面 etcd 3 节点跨 AZ，工作负载按 topologySpreadConstraints 均匀分布，存储与备份独立于故障域](/images/blog/k8s-cloud-native/ha-topology.svg)

- **单集群多可用区**：控制面节点分布在不同 AZ，工作负载用 `topologySpreadConstraints` 按 zone 打散。这是最常见的形态。
- **多集群**：用于跨 Region 容灾、合规隔离或超大集群拆分。用 GitOps（Argo CD / Flux）保证多集群配置一致，用 DNS/GSLB 或全局负载做流量切换，用 Velero 做跨集群备份恢复。
- **混沌工程**：高可用不能靠推理，必须靠演练。用 Chaos Mesh 定期注入 Pod Kill、网络延迟、节点宕机，验证"预案是否真的自动生效"。**没有演练过的高可用方案，只在 PPT 上成立。**

在定义一个"高可用"的服务之前，先明确两个指标：

- **RTO（恢复时间目标）**：故障发生后多久必须恢复服务
- **RPO（恢复点目标）**：最多能容忍丢失多长时间的数据

这两个数字决定了你需要的是"重启 Pod"还是"跨 Region 切换"，成本差两个数量级。

# 四、高性能：从内核到应用

高性能的优化有一条基本原则：**先测量，再优化；先找瓶颈，再动手**。盲目调参经常适得其反。下面按数据流经过的顺序，从下到上梳理。

## 4.1 网络数据路径

容器网络的性能差异几乎全部来自**数据包要经过多少层处理**：

| 方案 | 封装方式 | 性能 | 说明 |
| --- | --- | --- | --- |
| Overlay（Flannel VXLAN / Calico IPIP） | 封包解包 | 较低 | 无需改网络设备，跨网段开箱即用，MTU 要减去封装开销 |
| Underlay（Calico BGP / Macvlan） | 不封装，直接路由 | 高 | 依赖底层网络支持，可对接物理网络做 BGP 通告 |
| 云原生加速（Cilium eBPF） | 用 eBPF 替换 iptables/kube-proxy | 最高 | 内核态转发 + 可观测性 + 网络策略 |

其中 **kube-proxy 的工作模式对 Service 转发性能影响最大**：

| 模式 | 实现位置 | 查找复杂度 | 适用场景 |
| --- | --- | --- | --- |
| userspace | 用户态进程 | 高 | 已淘汰 |
| iptables | 内核 netfilter 规则链 | O(n) 线性匹配 | 默认模式；Service 上千后规则爆炸，更新延迟上升 |
| IPVS | 内核 LVS 哈希表 | O(1) | 大规模集群，支持 rr/wrr/lc 等调度算法 |
| eBPF（Cilium 替代 kube-proxy） | 内核 socket/XDP 层 | 哈希 + 短路 | 高性能 + 可观测性 + 策略下发即时生效 |

切换到 IPVS 只需要改一份 ConfigMap 并重启 kube-proxy：

```yaml
apiVersion: kubeproxy.config.k8s.io/v1alpha1
kind: KubeProxyConfiguration
mode: ipvs
ipvs:
  scheduler: rr        # 轮询；长连接场景可考虑 lc（最少连接）
  strictARP: true      # 配合 keepalived / 云 LB 使用
```

但要注意：**IPVS 模式下 kube-proxy 仍然依赖 iptables 做 SNAT、MASQUERADE 和部分策略**，并不是完全绕开 netfilter。真正彻底绕开的是 Cilium 的 eBPF 数据路径。

![Cilium eBPF 数据路径对比传统 kube-proxy：eBPF 在 socket 层和 XDP 层直接完成 Service 负载均衡与策略检查，跳过冗长的 iptables 规则链](/images/blog/k8s-cloud-native/network-datapath.svg)

与网络强相关的一组内核参数，往往是在压测中暴露出来的：

```yaml
# 节点级 sysctl（/etc/sysctl.d/99-k8s.conf）
net.core.somaxconn = 32768                    # accept 队列长度
net.core.netdev_max_backlog = 16384           # 网卡收包队列
net.ipv4.tcp_max_syn_backlog = 8192
net.ipv4.tcp_tw_reuse = 1                     # 复用 TIME_WAIT 连接
net.ipv4.ip_local_port_range = 10240 65535    # 客户端可用端口，影响可建立连接数
net.netfilter.nf_conntrack_max = 1048576      # conntrack 表容量上限
net.netfilter.nf_conntrack_tcp_timeout_established = 86400
```

**`conntrack` 表打满是高并发场景最隐蔽的故障之一**：表现为随机丢包、新建连接超时、DNS 解析莫名失败，但 CPU / 内存指标一切正常。排查方式：

```bash
# 当前 conntrack 使用量 vs 上限
cat /proc/sys/net/netfilter/nf_conntrack_count
cat /proc/sys/net/netfilter/nf_conntrack_max
# 是否发生过丢包
dmesg | grep -i "nf_conntrack: table full"
```

应用容器内也可以按需开启必要参数（出于安全考虑，只有部分 sysctl 是 namespaced 且被 kubelet 白名单允许的）：

```yaml
securityContext:
  sysctls:
    - name: net.core.somaxconn
      value: "32768"
    - name: net.ipv4.tcp_tw_reuse
      value: "1"
```

## 4.2 CPU 与内存

**CPU 是可压缩资源，内存不是。** 超出 CPU limit 时，进程被 throttle（限流），表现为响应时间 P99 抖动但服务不挂；超出内存 limit 时，容器直接被 OOMKilled。这个差异决定了两种资源的设置策略完全不同：

```yaml
resources:
  # 方案 A：Guaranteed —— requests == limits，最高优先级，最不容易被驱逐
  requests:
    cpu: "2"
    memory: "2Gi"
  limits:
    cpu: "2"
    memory: "2Gi"

  # 方案 B：Burstable —— 允许突发，但受节点整体水位影响
  requests:
    cpu: "500m"
    memory: "1Gi"
  limits:
    cpu: "2"
    memory: "2Gi"
```

三种 QoS 等级的区别：

| QoS | 条件 | 被驱逐优先级 | 适用 |
| --- | --- | --- | --- |
| Guaranteed | 所有容器的 requests == limits，且都设了 | 最低 | 核心在线服务、延迟敏感型 |
| Burstable | 至少一个容器设了 requests | 中 | 大多数业务服务 |
| BestEffort | 全都没设 requests/limits | 最高 | 批处理、可随时中断的任务 |

几个实战结论：

- **CPU limit 设置过低导致的 throttle 比你想的更普遍**。想确认是否被限流，看 `container_cpu_cfs_throttled_seconds_total`——如果这个指标持续增长，说明 CPU limit 是瓶颈，要么调高，要么干脆只设 `request` 不设 CPU `limit`（牺牲隔离性换取吞吐）。
- **Java 应用要显式设置 `-XX:MaxRAMPercentage`**。容器内 JVM 依据 cgroup limit 计算堆大小，堆 + 元空间 + 线程栈 + 直接内存的总和经常超过 limit，最终 OOMKilled。堆通常只占容器内存的 60%~75%。
- **延迟敏感型服务用 CPU Manager 的 static 策略绑核**，避免被其他容器抢走时间片：

```yaml
# kubelet 配置
cpuManagerPolicy: static              # Guaranteed Pod 且 CPU 为整数的容器获得独占核
topologyManagerPolicy: best-effort    # 尽量让 CPU/内存/设备来自同一 NUMA 节点
```

配合 `topologyManagerPolicy: single-numa-node`，可以把跨 NUMA 访存的延迟从 ~100ns 降到 ~70ns——对高频交易、实时推理这类场景是决定性差异。

## 4.3 存储与 IO

- **优先本地 SSD**：`local` PV 或 `hostPath`（需配合亲和性固定节点）性能最好，代价是节点故障时数据不可迁移。
- **网络存储看清 IOPS 上限**：云盘按规格限流，NFS 在高并发小文件读写下元数据成为瓶颈。顺序读写大文件用对象存储，随机 IO 用块存储。
- **区分读写模式**：`ReadWriteOnce`（单节点读写，块存储）vs `ReadWriteMany`（多节点读写，NFS/CephFS）。数据库必须用 RWO，否则多挂载会直接损坏数据。
- **批量任务避免小文件风暴**：合并写入、加大 buffer、用顺序写代替随机写，收益通常大于换硬件。

## 4.4 调度与拓扑感知

调度不仅决定"能不能起来"，也决定"跑得快不快"：

- **节点亲和性**：把 Pod 调度到有特定硬件（GPU、本地 SSD、高主频 CPU）的节点池上
- **Pod 亲和性**：把有频繁 RPC 调用的服务（网关与业务、缓存与应用）调度到同一 AZ，跨 AZ 调用的 RTT 通常是同 AZ 的 10 倍以上
- **拓扑感知路由**：Service 的 `trafficDistribution: PreferClose`（或旧的 `topology-aware-hints`）让流量优先落到同 AZ 的后端，可显著降低跨 AZ 流量成本与时延

```yaml
apiVersion: v1
kind: Service
metadata:
  name: cache-svc
spec:
  selector:
    app: cache
  ports:
    - port: 6379
  trafficDistribution: PreferClose    # 优先就近转发
```

## 4.5 可观测性：性能优化的前提

**没有度量就没有优化**。可观测性的三支柱对应三类问题：

| 支柱 | 回答的问题 | 常用组件 |
| --- | --- | --- |
| Metrics | 系统整体是否正常？趋势如何？ | Prometheus + Grafana，容器层指标看 cAdvisor |
| Logs | 单个请求为什么失败？ | Loki / ELK，按 trace_id 串联 |
| Traces | 慢在哪一段？调用链是怎样的？ | OpenTelemetry + Jaeger / Tempo |

在 K8s 语境下，需要重点关注的几组指标：

- **黄金指标**：延迟（P50/P95/P99，平均值毫无意义）、流量、错误率、饱和度
- **资源类**：CPU throttling 秒数、内存 working set vs limit、容器重启次数、OOM 事件
- **K8s 特有**：Pod 调度延迟（`scheduler_e2e_scheduling_duration_seconds`）、Pending Pod 数、Endpoints 变更频率、apiserver 请求延迟与 429 比例
- **网络类**：conntrack 使用率、网卡丢包、跨 AZ 流量

压测是验证性能的唯一手段。用 k6 / wrk / Locust 构造真实流量模型，**逐步加压直到 P99 越过 SLA，此时的 QPS 就是系统的真实容量**——它同时也是 HPA 目标值的依据。压测要区分"单副本容量"和"集群容量"，因为副本数上去之后，共享的下游（数据库、缓存、网关）往往先成为瓶颈。

# 五、取舍：三高不是无代价的

把这个体系收敛成几条原则：

1. **高并发的根因是无状态，不是扩副本。** 状态不落地、不粘节点、不依赖本地文件，才有资格被水平复制。
2. **高可用的根因是隔离，不是冗余。** 冗余副本放在同一个故障域里，等于没有冗余。同时，可用性必须用 RTO/RPO 量化，并靠混沌演练证明。
3. **高性能的根因是数据路径，不是调参。** 先把数据包经过的层数、请求经过的组件数降下来，再谈内核参数与绑核。
4. **三者互相冲突时，按业务定权重。** 核心交易链路优先级是高可用 > 高性能 > 成本；离线计算任务则相反，可以 BestEffort、可以被抢占、可以跑在竞价实例上。
5. **一切优化都要能被度量。** 没有基线、没有压测、没有监控的"优化"，只是在赌。

# 小结

Kubernetes 把分布式系统的复杂度封装成了一套声明式 API，但它并没有消除复杂度——只是把它从"机器怎么管"转移到了"架构怎么设计"。真正的三高能力，来自对业务状态的清醒认识（哪些可以无状态化）、对故障域的严格划分（哪些必须隔离）、以及对数据路径的持续优化（哪些层可以省掉）。

K8s 提供原语，架构决定上限。

# 参考

- [Kubernetes 官方文档](https://kubernetes.io/zh-cn/docs/)
- [CNCF 云原生定义](https://github.com/cncf/toc/blob/main/DEFINITION.md)
- [Cilium 官方文档](https://docs.cilium.io/)
- [KEDA 文档](https://keda.sh/docs/)
- [Chaos Mesh](https://chaos-mesh.org/)
- [Velero 备份恢复](https://velero.io/)
