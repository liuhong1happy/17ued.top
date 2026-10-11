import opentcsVda5050 from "../assets/posts/opentcs-vda5050.md?raw";
import agentProgramming from "../assets/posts/agent-programming.md?raw";
import serverOps from "../assets/posts/server-ops.md?raw";
import livekit from "../assets/posts/livekit.md?raw";
import bulletPhysics from "../assets/posts/bullet-physics.md?raw";
import multimodalLlmNotes from "../assets/posts/multimodal-llm-notes.md?raw";
import k8sInstall from "../assets/posts/k8s-install.md?raw";
import isaacsimLikeSimulator from "../assets/posts/isaacsim-like-simulator.md?raw";
import urdfKnowledge from "../assets/posts/urdf-knowledge.md?raw";
import collaborativeEditingWopi from "../assets/posts/collaborative-editing-wopi.md?raw";
import k8sGpu from "../assets/posts/k8s-gpu.md?raw";
import rk3588BuildGuide from "../assets/posts/rk3588-build-guide.md?raw";
import productionManagementSystem from "../assets/posts/production-management-system.md?raw";
import vectorDatabase from "../assets/posts/vector-database.md?raw";
import agentDesign from "../assets/posts/agent-design.md?raw";
import k8sCloudNative from "../assets/posts/k8s-cloud-native.md?raw";
import aiEngineeringKnowledgeMap from "../assets/posts/ai-engineering-knowledge-map.md?raw";
import sqlMysqlPostgresql from "../assets/posts/sql-mysql-postgresql.md?raw";
import videoGenerationDigitalHuman from "../assets/posts/video-generation-digital-human.md?raw";
import opensourceTtsAsr from "../assets/posts/opensource-tts-asr.md?raw";
import forwardDeployedEngineer from "../assets/posts/forward-deployed-engineer.md?raw";

export interface Post {
  slug: string;
  title: string;
  date: string;
  readTime: string;
  excerpt: string;
  tags: string[];
}

/** 文章源数据：新增文章**追加到末尾**即可，展示顺序交给下面的 POSTS */
const POSTS_BY_ADDED: Post[] = [
  {
    slug: "opentcs-vda5050",
    title: "基于 OpenTCS 的智慧园区调度系统实践",
    date: "2026-08-29",
    readTime: "约 10 分钟",
    excerpt:
      "OpenTCS 是一款可用于智慧园区（智能工厂）的调度系统。本文介绍我们基于它打造的解决方案：内核核心架构、对外接口、适配改造（平台）、核心对象以及落地应用场景。",
    tags: ["OpenTCS", "智慧园区", "智能工厂", "机器人调度", "MQTT"],
  },
  {
    slug: "agent-programming",
    title: "论 Agent 编程细节",
    date: "2026-08-29",
    readTime: "约 6 分钟",
    excerpt:
      "Agent 编程如何改变传统软件开发模式：从需求定义、产品设计、编码实现、测试部署到生产运维，梳理一套可落地的 Agent 编程思维。",
    tags: ["Agent 编程", "AI 编程", "软件工程", "CI/CD"],
  },
  {
    slug: "livekit",
    title: "LiveKit：为开发者打造的实时音视频与数据通信能力",
    date: "2026-09-10",
    readTime: "约 10 分钟",
    excerpt:
      "LiveKit 是基于 WebRTC 的开源实时音视频 SFU，介绍其核心特性、生态体系、安装部署与快速开始，并详解 Agents：如何把 STT/LLM/TTS 编排成一次可用的实时语音对话——AgentServer 与 prewarm、轮次检测与打断处理、插件体系、降级与自定义节点。",
    tags: ["LiveKit", "WebRTC", "实时音视频", "SFU", "Agents", "语音助手"],
  },
  {
    slug: "k8s-gpu",
    title: "在 Kubernetes 中使用 GPU",
    date: "2026-09-10",
    readTime: "约 15 分钟",
    excerpt:
      "K8s 集群中 GPU 调度、Device Plugin、cGPU/MPS/MIG 虚拟化与多卡联合的完整实践。",
    tags: ["Kubernetes", "GPU", "虚拟化", "MPS", "MIG"],
  },
  {
    slug: "k8s-install",
    title: "Kubernetes 集群安装文档",
    date: "2026-09-10",
    readTime: "约 30 分钟",
    excerpt:
      "Docker、CRI、kubeadm、CNI、Helm、Traefik、NFS、Harbor、MinIO、GPU 支持等 Kubernetes 集群全套安装部署记录。",
    tags: ["Kubernetes", "安装", "运维", "Docker"],
  },
  {
    slug: "collaborative-editing-wopi",
    title: "在线协作算法与 WOPI 协议",
    date: "2026-09-10",
    readTime: "约 12 分钟",
    excerpt:
      "详解协同编辑的 OT 与 CRDT 算法原理，以及在线 Office 集成背后的 WOPI 协议。",
    tags: ["协同编辑", "OT", "CRDT", "WOPI"],
  },
  {
    slug: "bullet-physics",
    title: "基于 Bullet 的物理仿真参数详解",
    date: "2026-09-10",
    readTime: "约 5 分钟",
    excerpt:
      "Bullet 物理仿真中刚体、关节及全局物理世界的核心参数设置与调优要点。",
    tags: ["物理仿真", "Bullet", "机器人"],
  },
  {
    slug: "isaacsim-like-simulator",
    title: "搭建类似 IsaacSim 的仿真平台实现步骤",
    date: "2026-09-10",
    readTime: "约 6 分钟",
    excerpt:
      "基于 three.js 与 ammo.js 构建类 IsaacSim 机器人仿真平台的实现步骤，含渲染、物理、URDF、传感器与通信接口。",
    tags: ["仿真平台", "three.js", "ammo.js", "机器人"],
  },
  {
    slug: "urdf-knowledge",
    title: "URDF 知识库",
    date: "2026-09-10",
    readTime: "约 1 分钟",
    excerpt:
      "URDF 加载器、机器人 3D 渲染与仿真的开源项目参考合集。",
    tags: ["URDF", "机器人", "3D"],
  },
  {
    slug: "multimodal-llm-notes",
    title: "多模态大模型学习笔记",
    date: "2026-09-10",
    readTime: "约 4 分钟",
    excerpt:
      "从 Seq2Seq 到 GPT-4、Stable Diffusion 的多模态大模型学习脉络梳理，含预训练、微调与应用落地。",
    tags: ["大模型", "多模态", "学习笔记"],
  },
  {
    slug: "server-ops",
    title: "服务器运维",
    date: "2026-09-10",
    readTime: "约 10 分钟",
    excerpt:
      "服务器日常运维速查：账号、磁盘扩容、Gitlab Runner、Docker、Nginx、证书续期、vLLM 安装等常用操作记录，以及 SSH 客户端 WindTerm 与数据库管理工具 Navicat 的介绍与选型对比。",
    tags: ["服务器运维", "Linux", "Docker", "vLLM", "WindTerm", "Navicat"],
  },
  {
    slug: "rk3588-build-guide",
    title: "Forlinx RK3588 Desktop 22.04 编译环境搭建与构建指南",
    date: "2026-09-10",
    readTime: "约 10 分钟",
    excerpt:
      "飞凌 OK3588-C 开发板基于 RK3588 的 Ubuntu 22.04 系统源码编译、构建、烧写全流程，含 defconfig、build.sh 指令与交叉编译。",
    tags: ["RK3588", "嵌入式", "编译构建", "Ubuntu"],
  },
  {
    slug: "production-management-system",
    title: "生产管理系统",
    date: "2026-09-10",
    readTime: "约 20 分钟",
    excerpt:
      "一套生产管理系统（MES）的整体设计方案：从线索到现金的经营主线出发，拆解财务、客户关系、供应链、产品、品质、仓储、生产制造、任务管理与异常处理各子系统的职责边界、核心单据与状态流转，含 MRP 净需求计算、AQL 抽样、NCR 闭环与数据权限等设计要点。",
    tags: ["MES", "生产管理", "系统设计", "MRP", "BOM", "品质管理", "供应链"],
  },
  {
    slug: "vector-database",
    title: "向量数据库",
    date: "2026-09-24",
    readTime: "约 18 分钟",
    excerpt:
      "面向 AI 应用的向量数据库：从 embedding 与相似性检索出发，梳理索引算法（随机投影、PQ、LSH、HNSW）、相似度度量、元数据过滤，以及分片副本、监控、访问控制等数据库能力与无服务器架构。",
    tags: ["向量数据库", "Embedding", "向量检索", "ANN", "RAG"],
  },
  {
    slug: "agent-design",
    title: "如何设计一个智能 Agent",
    date: "2026-10-11",
    readTime: "约 24 分钟",
    excerpt:
      "从「设计一个智能 Agent」这道高频面试题出发，拆解感知、记忆、规划推理、工具执行、输出五层架构、Skill 与 ReAct 工作流程，逐一给出幻觉、死循环、上下文溢出、工具调用与执行失败、重复执行、结论失效等难点的工程解法，并延伸到监控评估回放的闭环与 RSI 自我改进的边界。",
    tags: ["Agent", "架构设计", "ReAct", "工具调用", "记忆管理"],
  },
  {
    slug: "k8s-cloud-native",
    title: "Kubernetes 云原生实践：高并发、高可用、高性能",
    date: "2026-10-11",
    readTime: "约 25 分钟",
    excerpt:
      "Kubernetes 不会自动给你三高。本文只讲一件事：如何用 K8s 的原语把高并发、高可用、高性能落到实处——无状态化与 HPA/KEDA 弹性、削峰限流与熔断降级、探针与优雅停机、PDB 与跨可用区容灾、CNI/kube-proxy/eBPF 数据路径、CPU 绑核与内核调优，以及三者的取舍。",
    tags: ["Kubernetes", "云原生", "高并发", "高可用", "高性能", "HPA", "eBPF"],
  },
  {
    slug: "ai-engineering-knowledge-map",
    title: "AI 工程落地知识地图：从机器学习到大模型，再到合规治理",
    date: "2026-10-11",
    readTime: "约 40 分钟",
    excerpt:
      "强监管行业的 AI 落地，评价标准不是刷高指标，而是可解释、可监控、可回滚、可审计。本文把四块知识串成一张地图：传统机器学习与统计（LR、GBDT、IV/PSI、AUC/KS）、Transformer 与推理优化（RoPE、KV Cache、LoRA/QLoRA）、RAG 与 Agent 的完整链路、工程化与漂移监控，以及数据安全与审计设计。",
    tags: ["大模型", "RAG", "机器学习", "模型监控", "MLOps", "向量检索", "可解释性"],
  },
  {
    slug: "sql-mysql-postgresql",
    title: "关系型数据库详解：SQL、MySQL 与 PostgreSQL",
    date: "2026-10-11",
    readTime: "约 60 分钟",
    excerpt:
      "从关系模型与 SQL 语言出发，深入 B+ 树索引、MVCC 并发控制与预写日志，对比 MySQL InnoDB 与 PostgreSQL 在进程模型、存储引擎、复制机制上的架构差异，最后落到慢 SQL 定位、参数调优、主从复制与分库分表的工程实践。含逻辑执行顺序、索引失效清单、隔离级别对照与方言差异速查。",
    tags: ["SQL", "MySQL", "PostgreSQL", "InnoDB", "MVCC", "索引", "事务", "数据库"],
  },
  {
    slug: "video-generation-digital-human",
    title: "视频生成与数字人：MiniMax-H3、Sol-H3 与 SoulX 实时数字人",
    date: "2026-10-11",
    readTime: "约 22 分钟",
    excerpt:
      "视频生成的评价标准已经从画质换成质量、速度、交互性三者的取舍。本文串起三个样本：MiniMax-H3 如何用单流 Omni Transformer 把音视频放进同一条序列联合去噪，Sol-H3 如何用 Sol-Attn 稀疏注意力与 Sol-Engine 系统工程把 5 秒视频压进 1.653 秒，以及 SoulX 三件套如何用 Neighbor Forcing、ConvKV Memory 与双向蒸馏把数字人做到小时级稳定。含开源边界、许可证、显存与选型清单。",
    tags: ["视频生成", "数字人", "MiniMax-H3", "Sol-H3", "SoulX", "扩散模型", "推理加速"],
  },
  {
    slug: "opensource-tts-asr",
    title: "国内开源语音技术全景：ASR、TTS 与端到端语音大模型",
    date: "2026-10-11",
    readTime: "约 30 分钟",
    excerpt:
      "不追最新榜单，讲清这条链路的稳定结构：VAD、ASR、轮次检测、LLM、TTS 五个环节各自解决什么问题，级联式与端到端两条路线的取舍。工具链与模型两层分开看 FunASR、sherpa-onnx、WeNet、PaddleSpeech 与 Paraformer、SenseVoice、Fun-ASR-Nano；TTS 三个代际怎么看 CosyVoice、GPT-SoVITS、IndexTTS、Fish Speech；以及 PyTorch / ONNX / GGUF 三种部署形态、端侧落地与许可证注意事项。",
    tags: ["语音识别", "语音合成", "FunASR", "CosyVoice", "TTS", "ASR", "sherpa-onnx", "开源"],
  },
  {
    slug: "forward-deployed-engineer",
    title: "前沿部署工程师（FDE）：把 AI 送进客户现场的手艺",
    date: "2026-10-11",
    readTime: "约 24 分钟",
    excerpt:
      "FDE 是这两年 AI 行业涨得最快的岗位，也最容易被误读成售前、外包或实施。本文借开源电子书《FDE 入门到精通：八堂课》梳理这套方法论：从 Palantir 的起源、Echo/Delta 分工与 Ontology，到「平台成熟度 × 客户差异度」判断框架、Ramp 的单范围控制案例，再到五层能力与「现场铺碎石路、产品修高速公路」的价值闭环；并说清它和售前、外包、咨询的三条边界，以及国内市场滑向高级驻场外包的风险。",
    tags: ["FDE", "前沿部署工程师", "AI 落地", "Palantir", "解决方案", "组织治理", "职业发展"],
  },
];

/**
 * 对外暴露的文章列表：按日期倒序，最新的排在最前面。
 *
 * date 是 YYYY-MM-DD，字典序就是时间序，不必转成 Date 再比。
 * 同一天内用「后加入的在前」打破平局——新文章是追加到数组末尾的，不这样处理
 * 的话，今天再补一篇同一天的文章反而会排在当天旧文后面。
 * sort 本身是稳定的，这里的平局规则只是把「随后追加」这件事显式写出来。
 */
export const POSTS: Post[] = POSTS_BY_ADDED.map((post, added) => ({ post, added }))
  .sort((a, b) => b.post.date.localeCompare(a.post.date) || b.added - a.added)
  .map(({ post }) => post);

export const POST_CONTENT: Record<string, string> = {
  "opentcs-vda5050": opentcsVda5050,
  "agent-programming": agentProgramming,
  "livekit": livekit,
  "k8s-gpu": k8sGpu,
  "k8s-install": k8sInstall,
  "collaborative-editing-wopi": collaborativeEditingWopi,
  "bullet-physics": bulletPhysics,
  "isaacsim-like-simulator": isaacsimLikeSimulator,
  "urdf-knowledge": urdfKnowledge,
  "multimodal-llm-notes": multimodalLlmNotes,
  "server-ops": serverOps,
  "rk3588-build-guide": rk3588BuildGuide,
  "production-management-system": productionManagementSystem,
  "vector-database": vectorDatabase,
  "agent-design": agentDesign,
  "k8s-cloud-native": k8sCloudNative,
  "ai-engineering-knowledge-map": aiEngineeringKnowledgeMap,
  "sql-mysql-postgresql": sqlMysqlPostgresql,
  "video-generation-digital-human": videoGenerationDigitalHuman,
  "opensource-tts-asr": opensourceTtsAsr,
  "forward-deployed-engineer": forwardDeployedEngineer,
};
