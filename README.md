# byu-blog（Hexo）

本项目用于生成静态博客并发布（GitHub Pages / 自定义域名等）。

## 本地开发

```bash
yarn
yarn server -p 4003
```

## GitHub Pages（blog.byu-young.top）

本项目通过 GitHub Actions 自动构建并发布到 GitHub Pages。

### 你需要手动做的事情

1. 在 GitHub 仓库 `VinYoung/byu-blog` → `Settings` → `Pages`
   - `Build and deployment` 选择 `Source: GitHub Actions`
2. 在同一页面设置 `Custom domain` 为 `blog.byu-young.top`
3. Cloudflare DNS（根域名已托管在 Cloudflare）
   - 新增 `CNAME` 记录：`blog` → `vinyoung.github.io`
   - 建议先设置为 `DNS only`（灰云），待 GitHub Pages 检测通过后再按需开启代理
4. 等待 GitHub Pages 证书签发后，在 `Pages` 页勾选 `Enforce HTTPS`

### 仓库内已做好的配置

- `source/CNAME` 已固定为 `blog.byu-young.top`（Hexo 会拷贝到 `public/CNAME`）
- `_config.yml` 的 `url` 已设置为 `https://blog.byu-young.top`
- 工作流：`.github/workflows/pages.yml`（push 到 `main` 自动发布）
  - 本地若是 `master` 分支也没关系，工作流同时监听 `master` / `main`

## 本地小工具：导入 Markdown 为文章

该工具仅用于本机，不发布到线上。将任意 `.md` 文件导入到 `source/_posts/`。

### 用法

```bash
# 基础导入
yarn import:md /abs/path/to/file.md

# 启动网页导入工具（推荐）
yarn import:web

# 指定元信息（分类/标签/封面等）
yarn import:md /abs/path/to/file.md \
  --title "标题" \
  --category "分类" \
  --tags "tag1,tag2" \
  --cover "https://example.com/cover.jpg" \
  --top-img "https://example.com/banner.jpg"

# 复制本地图片引用（把相对路径图片复制到 uploads，并替换 Markdown 引用）
yarn import:md /abs/path/to/file.md --copy-assets
```

### 说明

- 默认 `slug` 使用输入文件名（会自动做安全化处理）。
- 如果输入 Markdown 自带 front-matter（`--- ... ---`），会原样保留。
- `--copy-assets` 会扫描 `![...](relative/path)` 与 `<img src="relative/path">` 的本地相对路径并复制；不会处理远程 URL / `data:` 等。

## 网页导入工具 + R2（本地使用）

网页工具运行在本机 `http://localhost:4010`（可通过 `IMPORTER_PORT` 修改），支持：

- 选择任意 `.md` 文件导入为文章
- 选择一个“资源目录”（文件夹上传），匹配 Markdown 中的本地图片/资源引用（相对路径 / Obsidian `![[...]]` / `file://` / 绝对路径按文件名匹配）
- 上传到 Cloudflare R2，并替换为公开地址（推荐）

R2 配置可放在以下任意位置（不要提交）：

- `byu/.env.local`（推荐：与外层 React/Next 服务共用同一套 R2 配置值）
- `byu-blog/.env.local`

```bash
R2_ENDPOINT=...
R2_BUCKET=byu-blog
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_PUBLIC_BASE_URL=https://storage-blog.byu-young.top
```
