# byu-blog（Hexo）

本项目用于生成静态博客并发布（GitHub Pages / 自定义域名等）。

## 本地开发

```bash
yarn
yarn server -p 4003
```

## 本地小工具：导入 Markdown 为文章

该工具仅用于本机，不发布到线上。将任意 `.md` 文件导入到 `source/_posts/`，并可选复制本地图片资源到 `source/img/uploads/<slug>/`。

### 用法

```bash
# 基础导入
yarn import:md /abs/path/to/file.md

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
- `--copy-assets` 会扫描 `![...](relative/path)` 与 `<img src="relative/path">` 的本地相对路径并复制；不会处理远程 URL / 绝对路径 `/...` / `data:`。

