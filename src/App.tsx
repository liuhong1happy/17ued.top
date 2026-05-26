import { useState } from "react";
import "./index.css";
import gwab from "./assets/gwab.png";

// ─── Project Data ─────────────────────────────────────
interface Project {
  name: string;
  description: string;
  url: string;
  tags: string[];
  icon?: string;
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

// ─── ProjectCard Component ─────────────────────────────
function ProjectCard({ project }: { project: Project }) {
  const [isHovered, setIsHovered] = useState(false);

  return (
    <a
      href={project.url}
      target="_blank"
      rel="noopener noreferrer"
      className="project-card block no-underline"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Icon */}
      <div className="flex items-center gap-3 mb-3">
        <div
          className={`w-10 h-10 rounded-xl flex items-center justify-center text-lg font-bold transition-all duration-300 ${
            isHovered ? "scale-110" : ""
          }`}
          style={{
            background: "linear-gradient(135deg, #6366f1, #a78bfa)",
            color: "#fff",
          }}
        >
          {project.name.charAt(0)}
        </div>
        <h3
          className={`text-lg font-semibold text-white transition-all duration-300 ${
            isHovered ? "translate-x-1" : ""
          }`}
        >
          {project.name}
        </h3>
      </div>

      {/* Description */}
      <p className="text-sm text-gray-400 leading-relaxed mb-3">
        {project.description}
      </p>

      {/* Tags */}
      <div className="flex flex-wrap gap-2">
        {project.tags.map((tag) => (
          <span key={tag} className="tag">
            {tag}
          </span>
        ))}
      </div>
    </a>
  );
}

// ─── App Component ─────────────────────────────────────
function App() {
  return (
    <div className="min-h-screen flex flex-col">
      {/* ─── Navbar ─── */}
      <header className="glass sticky top-0 z-50 px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <a
            href="/"
            className="text-xl font-bold text-white tracking-tight no-underline"
          >
            17ued<span className="text-indigo-400">.top</span>
          </a>
          <nav className="flex items-center gap-6 text-sm">
            <a
              href="https://pub.dev/publishers/17ued.top/packages"
              target="_blank"
              rel="noopener noreferrer"
              className="footer-link no-underline"
            >
              Flutter 插件
            </a>
            <a
              href="https://github.com/liuhong1happy"
              target="_blank"
              rel="noopener noreferrer"
              className="footer-link no-underline"
            >
              GitHub
            </a>
            <a
              href="https://gitee.com/liuhong1happy"
              target="_blank"
              rel="noopener noreferrer"
              className="footer-link no-underline"
            >
              Gitee
            </a>
          </nav>
        </div>
      </header>

      {/* ─── Main Content ─── */}
      <main className="flex-1 px-6 py-12">
        <div className="max-w-5xl mx-auto">
          {/* Hero Section */}
          <div className="text-center mb-16">
            <h1 className="page-title mb-4">个人项目展示</h1>
            <p className="text-gray-400 text-lg max-w-lg mx-auto leading-relaxed">
              汇集我开发的 Flutter 插件、工具和开源项目。
              持续更新中 🚀
            </p>
          </div>

          {/* Project Grid */}
          <section>
            <h2 className="section-title mb-8">项目列表</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {PROJECTS.map((project) => (
                <ProjectCard key={project.name} project={project} />
              ))}
            </div>
          </section>
        </div>
      </main>

      {/* ─── Footer ─── */}
      <footer className="mt-auto px-6 py-8 border-t border-white/5">
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-gray-500">
          <p>&copy; {new Date().getFullYear()} 17ued.top</p>
          <div className="flex items-center gap-4">
            <a
              href="https://pub.dev/publishers/17ued.top/packages"
              target="_blank"
              rel="noopener noreferrer"
              className="footer-link no-underline"
            >
              Flutter 插件
            </a>
            <span className="text-gray-600">|</span>
            <a
              href="http://www.beian.gov.cn/portal/registerSystemInfo?recordcode=51152302000216"
              target="_blank"
              rel="noopener noreferrer"
              className="footer-link no-underline flex items-center gap-2"
            >
              <img src={gwab} alt="蜀ICP" className="w-4 h-4" />
              <span>川公网安备51152302000216号</span>
            </a>
            <span className="text-gray-600">|</span>
            <a
              href="https://beian.miit.gov.cn/#/Integrated/index"
              target="_blank"
              rel="noopener noreferrer"
              className="footer-link no-underline"
            >
              <span>蜀ICP备2026025785号-1</span>
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default App;
