# 17ued.top

个人项目展示网站，汇集 Flutter 插件、开源项目等。

🌐 **在线访问**: [https://17ued.top](https://17ued.top)

## 项目列表

- **[Flutter 插件集合](https://pub.dev/publishers/17ued.top/packages)** — 发布在 pub.dev 上的 Flutter 和 Dart 插件集合
- **[GitHub 个人仓库](https://github.com/liuhong1happy)** — 开源项目代码仓库
- **[Gitee 个人仓库](https://gitee.com/liuhong1happy)** — Gitee 镜像仓库

## 技术栈

- [Vite](https://vitejs.dev/) — 构建工具
- [React 19](https://react.dev/) — UI 框架
- [TypeScript](https://www.typescriptlang.org/) — 类型安全
- [Tailwind CSS](https://tailwindcss.com/) — 样式框架
- [Liquid Glass](https://liquid-glass.dev/) — 毛玻璃视觉效果

## 开发

```bash
# 安装依赖
pnpm install

# 启动开发服务器
pnpm dev

# 构建生产版本
pnpm build

# 预览构建结果
pnpm preview
```

## 部署

项目使用 Nginx 部署在云服务器上，通过 `deploy.sh` 脚本自动部署：

```bash
./deploy.sh
```

> 注意：部署时需输入服务器密码（存储在 `.password` 文件中，已加入 `.gitignore`）

## 备案

蜀ICP备2026025785号-1
