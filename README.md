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


## md → Hexo 导入工具

导入工具已迁移到独立仓库：`VinYoung/blog-generate`（提供网页导入与 CLI 导入）。
