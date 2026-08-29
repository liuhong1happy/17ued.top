import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import "./index.css";
import gwab from "./assets/gwab.png";
import Home from "./pages/Home";
import Resume from "./pages/Resume";
import Blog from "./pages/Blog";
import BlogPost from "./pages/BlogPost";

// ─── Hash Router ───────────────────────────────────────
type Route =
  | { name: "home" }
  | { name: "resume" }
  | { name: "blog" }
  | { name: "post"; slug: string };

function parseHash(): Route {
  const parts = window.location.hash.replace(/^#/, "").split("/").filter(Boolean);
  if (parts[0] === "resume") return { name: "resume" };
  if (parts[0] === "blog") {
    if (parts[1]) return { name: "post", slug: parts[1] };
    return { name: "blog" };
  }
  return { name: "home" };
}

function useHashRoute(): Route {
  const [route, setRoute] = useState<Route>(parseHash);

  useEffect(() => {
    const onChange = () => {
      setRoute(parseHash());
      window.scrollTo({ top: 0 });
    };
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);

  return route;
}

// ─── Nav Link ──────────────────────────────────────────
function NavLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: ReactNode;
}) {
  return (
    <a
      href={href}
      className={`no-underline transition-colors ${
        active ? "text-indigo-300 font-medium" : "footer-link"
      }`}
    >
      {children}
    </a>
  );
}

// ─── App Component ─────────────────────────────────────
function App() {
  const route = useHashRoute();

  let content: ReactNode;
  switch (route.name) {
    case "resume":
      content = <Resume />;
      break;
    case "blog":
      content = <Blog />;
      break;
    case "post":
      content = <BlogPost slug={route.slug} />;
      break;
    default:
      content = <Home />;
  }

  return (
    <div className="min-h-screen flex flex-col">
      {/* ─── Navbar ─── */}
      <header className="glass sticky top-0 z-50 px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <a
            href="#/"
            className="text-xl font-bold text-white tracking-tight no-underline"
          >
            17ued<span className="text-indigo-400">.top</span>
          </a>
          <nav className="flex items-center gap-6 text-sm">
            <NavLink href="#/" active={route.name === "home"}>
              首页
            </NavLink>
            <NavLink href="#/resume" active={route.name === "resume"}>
              个人介绍
            </NavLink>
            <NavLink
              href="#/blog"
              active={route.name === "blog" || route.name === "post"}
            >
              技术博文
            </NavLink>
            <span className="text-gray-600">|</span>
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
        <div className="max-w-5xl mx-auto">{content}</div>
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
