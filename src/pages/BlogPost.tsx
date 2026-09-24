import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { POSTS, POST_CONTENT } from "../data/posts";

interface TocItem {
  id: string;
  text: string;
  level: number;
}

/** 由标题文本生成稳定 id，保留中文 */
function slugify(text: string): string {
  const slug = text
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\p{L}\p{N}-]/gu, "")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "section";
}

export default function BlogPost({ slug }: { slug: string }) {
  const post = POSTS.find((p) => p.slug === slug);
  const articleRef = useRef<HTMLDivElement>(null);
  const [toc, setToc] = useState<TocItem[]>([]);
  const [activeId, setActiveId] = useState("");
  // 用 window.innerWidth 而不是 CSS 媒体查询：媒体查询量的是扣掉滚动条后的视口宽度，
  // 长文章出现滚动条会凭空少十几像素，导致同一临界宽度上有的文章有目录、有的没有。
  const [wideEnough, setWideEnough] = useState(false);

  useEffect(() => {
    const check = () => setWideEnough(window.innerWidth >= 1600);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  // 从渲染后的 DOM 取标题：代码块里的 `# 注释` 天然被排除
  useEffect(() => {
    const root = articleRef.current;
    if (!root) {
      setToc([]);
      return;
    }
    const seen = new Map<string, number>();
    const items = Array.from(
      root.querySelectorAll("h1, h2, h3, h4"),
    ).map((el) => {
      const text = el.textContent?.trim() ?? "";
      const base = slugify(text);
      const dup = seen.get(base) ?? 0;
      seen.set(base, dup + 1);
      const id = dup === 0 ? base : `${base}-${dup}`;
      el.id = id;
      return { id, text, level: Number(el.tagName.slice(1)) };
    });
    setToc(items);
    setActiveId(items[0]?.id ?? "");
  }, [slug]);

  // 滚动高亮：取最后一个已越过分隔线的标题
  useEffect(() => {
    if (toc.length === 0) return;
    const onScroll = () => {
      let current = toc[0].id;
      for (const item of toc) {
        const el = document.getElementById(item.id);
        if (el && el.getBoundingClientRect().top <= 120) current = item.id;
      }
      setActiveId(current);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [toc]);

  // 用 button 而非 <a href="#id">：hash 路由会把 "#标题" 当成一次导航
  const jumpTo = useCallback((id: string) => {
    document
      .getElementById(id)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  if (!post) {
    return (
      <div className="text-center py-20">
        <h1 className="page-title mb-4">技术博文不存在</h1>
        <p className="text-gray-400 mb-8">没有找到对应的文章。</p>
        <a href="#/blog" className="footer-link no-underline">
          ← 返回技术博文列表
        </a>
      </div>
    );
  }

  const minLevel = toc.length > 0 ? Math.min(...toc.map((t) => t.level)) : 1;

  return (
    <div className="max-w-3xl mx-auto">
      {/* Back link */}
      <a
        href="#/blog"
        className="footer-link no-underline inline-flex items-center gap-2 mb-8 text-sm"
      >
        ← 返回技术博文列表
      </a>

      {/* Header */}
      <header className="mb-10">
        <h1 className="page-title mb-4" style={{ fontSize: "2.25rem" }}>
          {post.title}
        </h1>
        <div className="flex flex-wrap items-center gap-3 text-sm text-gray-500">
          <time>{post.date}</time>
          <span className="text-gray-600">·</span>
          <span>{post.readTime}</span>
        </div>
        <div className="flex flex-wrap gap-2 mt-4">
          {post.tags.map((tag) => (
            <span key={tag} className="tag">
              {tag}
            </span>
          ))}
        </div>
      </header>

      {/* Body */}
      <div className="panel prose" ref={articleRef}>
        <ReactMarkdown remarkPlugins={[remarkGfm]}>
          {POST_CONTENT[post.slug]}
        </ReactMarkdown>
      </div>

      {/* Table of contents —— 界面宽度 1600px 以上才出现 */}
      {wideEnough && toc.length > 0 && (
        <aside className="toc" aria-label="文章目录">
          <p className="toc-title">目录</p>
          <nav className="toc-list">
            {toc.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => jumpTo(item.id)}
                className={`toc-link${activeId === item.id ? " is-active" : ""}`}
                style={{
                  paddingLeft: `${(item.level - minLevel) * 0.75 + 0.75}rem`,
                }}
              >
                {item.text}
              </button>
            ))}
          </nav>
        </aside>
      )}
    </div>
  );
}
