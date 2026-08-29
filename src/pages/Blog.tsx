import { POSTS } from "../data/posts";

export default function Blog() {
  return (
    <div>
      {/* Hero */}
      <div className="text-center mb-16">
        <h1 className="page-title mb-4">技术博文</h1>
        <p className="text-gray-400 text-lg max-w-lg mx-auto leading-relaxed">
          记录技术选型、架构设计与落地实践中的思考。
          持续更新中 ✍️
        </p>
      </div>

      {/* Post List */}
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
            <h2 className="text-xl font-semibold text-white mb-3 transition-colors">
              {post.title}
            </h2>
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
    </div>
  );
}
