import { POSTS } from "../data/posts";
import { TechGraphBackground } from "../components/TechGraph";

// ─── Capability Data ──────────────────────────────────
interface Capability {
  icon: string;
  name: string;
  desc: string;
}

const CAPABILITIES: Capability[] = [
  { icon: "🤖", name: "AI Agent", desc: "Agent 驱动全流程开发，小智 / LiveKit Agent 落地" },
  { icon: "🎯", name: "AI 推理部署", desc: "vLLM 部署、流式 ASR/TTS、模型转换与量化" },
  { icon: "☁️", name: "云原生", desc: "Kubernetes、Docker、Traefik、CI/CD 全链路" },
  { icon: "🌐", name: "物联网", desc: "Mochi-MQTT、边缘设备接入、指令下发" },
  { icon: "🚗", name: "机器人调度", desc: "OpenTCS、VDA5050、ROS2 交叉编译" },
  { icon: "📱", name: "多端应用", desc: "Web、Flutter、Electron 全平台交付" },
];

// ─── Project Data ─────────────────────────────────────
interface Project {
  name: string;
  description: string;
  url: string;
  tags: string[];
}

const PROJECTS: Project[] = [
  {
    name: "Flutter 插件集合",
    description:
      "发布在 pub.dev 上的 Flutter 和 Dart 插件集合，包括 UI 组件、工具类等。",
    url: "https://pub.dev/publishers/17ued.top/packages",
    tags: ["Flutter", "Dart", "pub.dev"],
  },
  {
    name: "GitHub 个人仓库",
    description: "我的 GitHub 开源项目仓库，包含前端、Flutter 等各类项目。",
    url: "https://github.com/liuhong1happy",
    tags: ["GitHub", "开源"],
  },
  {
    name: "Gitee 个人仓库",
    description: "我的 Gitee 镜像仓库，同步开源项目代码。",
    url: "https://gitee.com/liuhong1happy",
    tags: ["Gitee", "开源"],
  },
];

// ─── Home Page ─────────────────────────────────────────
export default function Home() {
  return (
    <div className="relative">
      {/* 知识图谱背景（暗化处理） */}
      <div
        className="fixed inset-0 -z-10 pointer-events-none select-none"
        aria-hidden="true"
      >
        <div className="opacity-[0.0375] blur-[1px]">
          <TechGraphBackground />
        </div>
      </div>

      <div className="space-y-16">
      {/* Hero */}
      <div className="text-center mb-4">
        <h1 className="page-title mb-4">刘红</h1>
        <p className="text-gray-300 text-lg font-medium mb-2">
          云计算部门负责人
        </p>
        <p className="text-gray-400 text-base max-w-xl mx-auto leading-relaxed">
          具身智能 Agent 开发 / 团队管理 / 软件架构
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <a
            href="#/resume"
            className="inline-block px-6 py-3 rounded-full font-medium text-white bg-gradient-to-r from-indigo-500 to-violet-500 hover:opacity-90 transition-opacity no-underline"
          >
            查看个人介绍
          </a>
          <a
            href="#/blog"
            className="inline-block px-6 py-3 rounded-full font-medium text-gray-200 border border-white/15 hover:border-indigo-400/40 hover:text-white transition-colors no-underline"
          >
            阅读技术博文
          </a>
        </div>
      </div>

      {/* Capabilities */}
      <section>
        <h2 className="section-title mb-8">能力方向</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {CAPABILITIES.map((c) => (
            <div key={c.name} className="panel">
              <div className="flex items-center gap-3 mb-2">
                <span className="text-2xl leading-none">{c.icon}</span>
                <h3 className="text-base font-semibold text-white">{c.name}</h3>
              </div>
              <p className="text-sm text-gray-400 leading-relaxed">{c.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Recent Blog */}
      <section>
        <div className="flex items-center justify-between mb-8">
          <h2 className="section-title">技术博文</h2>
          <a href="#/blog" className="footer-link no-underline text-sm">
            查看全部 →
          </a>
        </div>
        <div className="space-y-6">
          {POSTS.map((post) => (
            <a
              key={post.slug}
              href={`#/blog/${post.slug}`}
              className="project-card block no-underline"
            >
              <div className="flex flex-wrap items-center gap-3 mb-3 text-xs text-gray-500">
                <time>{post.date}</time>
                <span className="text-gray-600">·</span>
                <span>{post.readTime}</span>
              </div>
              <h3 className="text-xl font-semibold text-white mb-3">
                {post.title}
              </h3>
              <p className="text-sm text-gray-400 leading-relaxed mb-4">
                {post.excerpt}
              </p>
              <div className="flex flex-wrap gap-2">
                {post.tags.map((tag) => (
                  <span key={tag} className="tag">
                    {tag}
                  </span>
                ))}
              </div>
            </a>
          ))}
        </div>
      </section>

      {/* Open Source Projects */}
      <section>
        <h2 className="section-title mb-8">开源项目</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {PROJECTS.map((project) => (
            <a
              key={project.name}
              href={project.url}
              target="_blank"
              rel="noopener noreferrer"
              className="project-card block no-underline"
            >
              <div className="flex items-center gap-3 mb-3">
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center text-lg font-bold"
                  style={{
                    background: "linear-gradient(135deg, #6366f1, #a78bfa)",
                    color: "#fff",
                  }}
                >
                  {project.name.charAt(0)}
                </div>
                <h3 className="text-lg font-semibold text-white">
                  {project.name}
                </h3>
              </div>
              <p className="text-sm text-gray-400 leading-relaxed mb-3">
                {project.description}
              </p>
              <div className="flex flex-wrap gap-2">
                {project.tags.map((tag) => (
                  <span key={tag} className="tag">
                    {tag}
                  </span>
                ))}
              </div>
            </a>
          ))}
        </div>
      </section>
      </div>
    </div>
  );
}
