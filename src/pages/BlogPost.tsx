import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { POSTS, POST_CONTENT } from "../data/posts";

export default function BlogPost({ slug }: { slug: string }) {
  const post = POSTS.find((p) => p.slug === slug);

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
      <div className="panel prose">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>
          {POST_CONTENT[post.slug]}
        </ReactMarkdown>
      </div>
    </div>
  );
}
