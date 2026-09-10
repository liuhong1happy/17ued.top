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

export interface Post {
  slug: string;
  title: string;
  date: string;
  readTime: string;
  excerpt: string;
  tags: string[];
}

export const POSTS: Post[] = [
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
    readTime: "约 6 分钟",
    excerpt:
      "LiveKit 是基于 WebRTC 的开源实时音视频 SFU，介绍其核心特性、生态体系、安装部署与快速开始。",
    tags: ["LiveKit", "WebRTC", "实时音视频", "SFU"],
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
    readTime: "约 5 分钟",
    excerpt:
      "服务器日常运维速查：账号、磁盘扩容、Gitlab Runner、Docker、Nginx、证书续期、vLLM 安装等常用操作记录。",
    tags: ["服务器运维", "Linux", "Docker", "vLLM"],
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
    readTime: "约 1 分钟",
    excerpt:
      "生产管理系统各子系统功能划分：财务、客户关系、供应链、产品、品质、仓储、生产制造、任务管理与异常处理。",
    tags: ["生产管理", "系统设计", "MES"],
  },
];

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
};
