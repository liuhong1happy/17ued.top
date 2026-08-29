import TechGraph from "../components/TechGraph";

// ─── Resume Data ───────────────────────────────────────
interface BasicInfo {
  label: string;
  value: string;
  full?: boolean;
}

const BASIC_INFO: BasicInfo[] = [
  { label: "姓名", value: "刘红" },
  { label: "电话", value: "13648091632" },
  { label: "邮箱", value: "liuhong1.happy@163.com" },
  { label: "所在地", value: "四川·成都" },
  { label: "目前就职公司", value: "深圳子空间机器人有限公司" },
  { label: "职位", value: "云计算部门负责人" },
  { label: "求职意向", value: "具身智能 Agent 开发 / 团队管理 / 软件架构", full: true },
];

interface SkillItem {
  title: string;
  body: string;
}

const SKILLS: SkillItem[] = [
  {
    title: "AI Agent 编程能力体现",
    body: "熟练运用 AI Agent 完成软件全流程开发，覆盖需求定义、产品设计（业务流程、数据库、PRD、UI 界面、前后端与测试框架搭建）、编码实现、测试部署与生产运维等环节；通过多轮对话驱动 Agent 自动编码、调试与测试，并让 Agent 编写单元测试、集成测试与端到端测试，依托自动化测试架构逐版本收敛，避免带问题上线；借鉴敏捷开发思想按版本小批量推进，建立整体框架文件目录结构引导 Agent 收敛；接入 CI/CD 将代码提交转化为构建、发布成果，并借助 Agent 搭建线上运维工具快速定位问题。",
  },
  {
    title: "软件开发能力",
    body: "熟练使用 vLLM 部署大语言、TTS、ASR 模型，掌握推理服务优化、流式输出、并发调优；了解 3B 规模模型训练显存规划与参数配置；熟悉 GGUF、ONNX、Safetensors、TRT、RKNN 等模型格式转换、量化、KV-Cache 调优、时延与吞吐优化；具备智能 Agent（小智、LiveKit Agent）方案选型、架构评估与落地部署经验；初步接触机器人仿真环境搭建、算法仿真训练、三维场景模型生成相关工作；主导公司全套云计算服务的设计、开发、部署、运维、监控告警与故障应急处置工作；熟悉 K8s 下 GPU 资源分时、分片调度与多任务共享调用方案，可配置 GPU 切分、时间片隔离、显存管控，提升显卡复用率；Go、Java、Python 后端开发；前端应用覆盖 Web、Flutter 移动端 APP、Electron 桌面端；Docker 容器打包；K8s 部署、PVC 权限、CI/CD 流水线搭建与维护；采用 Traefik 作为边缘路由，实现动态反向代理、负载均衡、自动服务发现、SSL 证书管理、限流鉴权、中间件链路配置；基于 Mochi-MQTT 搭建轻量高性能消息服务，完成设备连接管理、主题订阅发布、QoS 策略配置、断线重连、消息持久化、设备指令与传感数据桥接至后端业务服务；了解 OpenTCS 开源机器人调度系统，熟悉地图建模、任务下发、路径规划、交通管控、VDA5050 协议对接、适配器二次开发；熟悉 ROS2 应用交叉编译、固件烧录流程；整体负责 CI/CD 流程建设，包含 ROS2 应用自动构建、ARM 交叉编译、版本归档、自动化测试、发布、回滚、部署；Redis 会话缓存；COS 对象存储、CDN、跨域配置；飞书 SMTP、开放 API 对接；故障排查、性能调优；独立开发 MES、IoT 两套独立软件系统，IoT 平台负责边缘设备接入、指令下发、状态上报、生产数据采集传输，MES 系统通过调用 IoT 开放接口完成工单下发、数据归集、生产追溯、报表统计、权限管理；开发 MES 配套烧录上位机程序，完成固件下发、芯片烧录、状态回传、工单记录、异常告警，适配多型号硬件，优化烧录节拍与良率，完成产线现场调试交付；了解 LiveKit 服务部署、音视频采集链路调试；了解 CosyVoice3 等 TTS 模型部署及声码器并发瓶颈优化；了解 RK3588、N100 工控机平台；了解 MIPI/USB 外设、声卡调试、Ubuntu 驱动、udev 规则配置。",
  },
  {
    title: "团队管理与技术选型",
    body: "担任云计算部门负责人，负责团队管理与技术方向把控；擅长方案选型、系统架构设计、接口解耦、成本评估与疑难问题定位；了解工业网络协议与系统排障；可独立完成从原型验证到量产可用的整套项目交付。",
  },
];

interface ProjectItem {
  title: string;
  points: string[];
}

const PROJECTS: ProjectItem[] = [
  {
    title: "项目 1：具身智能 Agent",
    points: [
      "智能 Agent 架构迭代：前期基于小智 Agent 搭建原型，评估能力与性能瓶颈后，迁移至 LiveKit Agent 完成整套系统落地；负责组件选型、服务编排、适配改造与联调。",
      "云端部署 LiveKit SFU 服务，负责音视频传输与实时数据回传；基于 vLLM 部署大模型、流式 ASR、TTS 推理服务，优化语音识别、语音合成的流式响应与并发能力，解决高并发下声码器性能瓶颈。",
      "使用 Traefik 承担集群入口网关，配置动态路由、负载均衡、HTTPS 终止、限流与鉴权中间件，实现微服务无感扩缩容，无需重载代理配置。",
      "部署 Mochi-MQTT 作为信令中枢，负责稳定指令传输与设备数据回传；边缘节点通过 MQTT 上报设备状态、接收平台控制指令，实现控制信令与音视频媒体流分离，保证控制链路低延迟、高可靠。",
      "配套开发 Web 管理端、Electron 桌面客户端、移动端 APP，实现多终端访问、控制与状态展示。",
      "配合边缘端开发工作，负责 ROS2 程序交叉编译、固件打包与烧录；了解外设硬件调试、VAD、音频回采链路相关方案。",
    ],
  },
  {
    title: "项目 2：MES 系统",
    points: [
      "独立设计开发 MES 系统，通过调用 IoT 平台开放 API 完成工单下发、生产数据获取、流程管控、生产追溯与报表统计、权限管理；配套交付 Web 管理后台、Electron 桌面客户端、移动端 APP 多形态应用。",
      "主要功能模块包括权限系统、供应链管理、生产制造、生产计划、产品管理、仓储管理、品质管理、财务管理、经营管理。",
      "开发 MES 配套烧录上位机应用程序，对接工厂 MES 接口；实现固件批量烧录、进度采集、生产数据上传、日志持久化、异常容错处理，已落地量产产线。",
      "调研 OpenTCS 开源调度平台与 VDA5050 协议，评估 MES 与移动机器人调度系统接口对接方案，涉及地图建模、任务下发、路径规划与交通管控。",
    ],
  },
  {
    title: "项目 3：IoT 平台",
    points: [
      "独立设计开发 IoT 平台，负责产线各类边缘设备接入、协议解析、数据采集、指令下发、状态上报，向 MES 等上层系统提供开放 API。",
      "整体规划落地 CI/CD 流水线，负责 ROS2 工程 ARM 交叉编译、固件打包、烧录、版本管理、远程分发流程自动化。",
      "基于 K8s 完成服务编排、持久化存储、CI-Runner 流水线配置；部署 Traefik Ingress 控制器统一管理集群入口流量、域名路由、证书自动签发；对接对象存储、CDN、Redis 缓存；排查容器权限、网络超时、微服务调用异常等问题，编写运维脚本与监控方案，提升整套系统稳定性。",
    ],
  },
];

const SELF_EVALUATION =
  "具备云计算平台开发运维、K8s GPU 分时分片调度、语音模型部署、智能 Agent（小智→LiveKit Agent）迭代落地、云原生网关（Traefik）、Mochi-MQTT 物联网信令、OpenTCS 机器人调度、后端、Web/Electron/APP 多端应用开发、独立 MES 与 IoT 系统开发及接口集成、ROS2 交叉编译与固件烧录、工业软件落地交付全链路工程实践经验；熟悉整套云服务部署运维、K8s GPU 资源共享调度、交叉编译、固件烧录流程；对机器人仿真、算法训练、场景生成有一定接触；对各类边缘硬件、外设调试、工业协议有相应了解；擅长方案选型、系统架构设计、接口解耦、疑难问题定位；可独立完成从原型验证到量产可用的整套项目交付；学习能力强，能够快速适配新型框架与硬件平台。";

// ─── Resume Page ───────────────────────────────────────
export default function Resume() {
  return (
    <div className="space-y-12">
      {/* Hero */}
      <div className="text-center mb-4">
        <h1 className="page-title mb-4">个人介绍</h1>
        <p className="text-gray-400 text-lg max-w-xl mx-auto leading-relaxed">
          具身智能 Agent 开发 / 团队管理 / 软件架构
        </p>
      </div>

      {/* Basic Info */}
      <section>
        <h2 className="section-title mb-6">基本信息</h2>
        <div className="panel grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-4">
          {BASIC_INFO.map((item) => (
            <div
              key={item.label}
              className={item.full ? "sm:col-span-2 lg:col-span-3" : ""}
            >
              <div className="field-label mb-1">{item.label}</div>
              <div className="field-value">{item.value}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Skills */}
      <section>
        <h2 className="section-title mb-6">专业技能</h2>
        <div className="space-y-4">
          {SKILLS.map((skill, i) => (
            <div key={skill.title} className="panel">
              <h3 className="text-lg font-semibold text-white mb-2">
                <span className="text-indigo-400 mr-2">{i + 1}.</span>
                {skill.title}
              </h3>
              <p className="text-sm text-gray-400 leading-relaxed">{skill.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Tech Graph */}
      <section>
        <h2 className="section-title mb-6">技术栈 & 能力</h2>
        <div className="panel">
          <TechGraph />
        </div>
      </section>

      {/* Projects */}
      <section>
        <h2 className="section-title mb-6">项目经历</h2>
        <div className="space-y-6">
          {PROJECTS.map((project) => (
            <div key={project.title} className="panel">
              <h3 className="text-lg font-semibold text-white mb-4">{project.title}</h3>
              <ul className="space-y-2">
                {project.points.map((point, i) => (
                  <li
                    key={i}
                    className="text-sm text-gray-400 leading-relaxed flex gap-3"
                  >
                    <span className="text-indigo-400 shrink-0 mt-0.5">•</span>
                    <span>{point}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* Self Evaluation */}
      <section>
        <h2 className="section-title mb-6">自我评价</h2>
        <div className="panel">
          <p className="text-sm text-gray-300 leading-loose">{SELF_EVALUATION}</p>
        </div>
      </section>
    </div>
  );
}
