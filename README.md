# byu-blog（内容仓库）

此仓库仅用于存放博客文章内容（Markdown）。

- 生成与发布由另一个仓库负责：`VinYoung/blog-generate`
- `blog-generate` 会在 GitHub Actions 中拉取本仓库的 `posts/`，同步到生成器的 `source/_posts/` 后进行构建并发布到 GitHub Pages。

## 目录结构

- `posts/`：所有文章（`.md`）

## 给 blog-generate 配置只读拉取（可选）

如果本仓库是私有的：

1. 本仓库 `Settings` → `Deploy keys` → `Add deploy key`
   - 勾选 `Allow read access`
2. 把对应私钥配置到 `blog-generate` 仓库：
   - `Settings` → `Secrets and variables` → `Actions`
   - 新建 secret：`BYU_BLOG_DEPLOY_KEY`

