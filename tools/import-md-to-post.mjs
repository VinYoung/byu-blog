#!/usr/bin/env node
/**
 * Local-only helper: import an arbitrary Markdown file into Hexo `source/_posts`.
 *
 * Usage:
 *   node tools/import-md-to-post.mjs /abs/path/to/file.md
 *
 * Options:
 *   --title "Post Title"
 *   --date "YYYY-MM-DD HH:mm:ss"
 *   --category "分类"
 *   --tags "tag1,tag2"
 *   --cover "https://.../cover.jpg"
 *   --top-img "https://.../banner.jpg"
 *   --copy-assets            Copy referenced local images into `source/img/uploads/<slug>/`
 *   --force                  Overwrite target post file if exists
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

const cwd = process.cwd();
const postsDir = path.join(cwd, 'source', '_posts');
const uploadsBaseDir = path.join(cwd, 'source', 'img', 'uploads');

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

function nowString() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function slugify(input) {
  const s = String(input ?? '').trim();
  if (!s) return 'post';
  // Keep chinese, letters, digits, dash/underscore; replace others with dash.
  return s
    .normalize('NFKC')
    .replace(/\s+/g, '-')
    .replace(/[^\p{Script=Han}a-zA-Z0-9_-]+/gu, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 120) || 'post';
}

function parseArgs(argv) {
  const args = {
    input: '',
    title: '',
    date: '',
    category: '',
    tags: '',
    cover: '',
    topImg: '',
    copyAssets: false,
    force: false,
  };

  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--title') args.title = argv[++i] ?? '';
    else if (a === '--date') args.date = argv[++i] ?? '';
    else if (a === '--category') args.category = argv[++i] ?? '';
    else if (a === '--tags') args.tags = argv[++i] ?? '';
    else if (a === '--cover') args.cover = argv[++i] ?? '';
    else if (a === '--top-img') args.topImg = argv[++i] ?? '';
    else if (a === '--copy-assets') args.copyAssets = true;
    else if (a === '--force') args.force = true;
    else if (a === '-h' || a === '--help') {
      console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(0, 32).join('\n'));
      process.exit(0);
    } else {
      rest.push(a);
    }
  }

  args.input = rest[0] ?? '';
  return args;
}

function splitFrontMatter(md) {
  const trimmed = md.replace(/^\uFEFF/, '');
  if (!trimmed.startsWith('---\n') && !trimmed.startsWith('---\r\n')) return { frontMatter: '', body: md };
  const m = trimmed.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { frontMatter: '', body: md };
  return { frontMatter: m[1], body: trimmed.slice(m[0].length) };
}

function guessTitleFromBody(body, fallback) {
  const lines = body.split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/^#\s+(.+?)\s*$/);
    if (m) return m[1].trim();
  }
  return fallback;
}

function uniqNonEmpty(items) {
  const seen = new Set();
  const out = [];
  for (const raw of items) {
    const v = String(raw ?? '').trim();
    if (!v) continue;
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

function toFrontMatterYaml({ title, date, category, tags, cover, topImg }) {
  const lines = [];
  lines.push('---');
  lines.push(`title: ${title}`);
  lines.push(`date: ${date}`);
  if (category) {
    lines.push('categories:');
    lines.push(`  - ${category}`);
  }
  if (tags.length) {
    lines.push('tags:');
    for (const t of tags) lines.push(`  - ${t}`);
  }
  if (topImg) lines.push(`top_img: ${topImg}`);
  if (cover) lines.push(`cover: ${cover}`);
  lines.push('---');
  return lines.join('\n');
}

function findLocalImageRefs(md) {
  const refs = new Set();

  // ![alt](path)
  for (const m of md.matchAll(/!\[[^\]]*]\(([^)\s]+)(?:\s+\"[^\"]*\")?\)/g)) {
    refs.add(m[1]);
  }
  // <img src="...">
  for (const m of md.matchAll(/<img[^>]*\s+src=["']([^"']+)["'][^>]*>/gi)) {
    refs.add(m[1]);
  }

  const results = [];
  for (const href of refs) {
    if (!href) continue;
    const v = href.trim();
    if (!v) continue;
    if (/^(https?:)?\/\//i.test(v)) continue;
    if (v.startsWith('data:')) continue;
    if (v.startsWith('/')) continue; // treat as already site-root
    results.push(v);
  }
  return results;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.input) {
    fail('Usage: node scripts/import-md-to-post.mjs /path/to/file.md [--copy-assets] [--title ...] [--category ...]');
  }

  const inputPath = path.resolve(args.input);
  if (!fs.existsSync(inputPath)) fail(`Input not found: ${inputPath}`);
  if (!inputPath.toLowerCase().endsWith('.md')) fail('Input must be a .md file');

  await fsp.mkdir(postsDir, { recursive: true });
  const src = await fsp.readFile(inputPath, 'utf8');
  const { frontMatter, body } = splitFrontMatter(src);

  const baseName = path.basename(inputPath, path.extname(inputPath));
  const title = args.title || guessTitleFromBody(body, baseName);
  const date = args.date || nowString();
  const category = args.category || '';
  const tags = uniqNonEmpty((args.tags || '').split(','));
  const cover = args.cover || '';
  const topImg = args.topImg || '';

  const slug = slugify(baseName || title);
  const outFile = path.join(postsDir, `${slug}.md`);

  if (!args.force && fs.existsSync(outFile)) {
    fail(`Target exists: ${outFile}\nUse --force to overwrite.`);
  }

  let nextBody = body;

  if (args.copyAssets) {
    const inputDir = path.dirname(inputPath);
    const rels = findLocalImageRefs(nextBody);
    if (rels.length) {
      const destDir = path.join(uploadsBaseDir, slug);
      await fsp.mkdir(destDir, { recursive: true });

      for (const rel of rels) {
        const abs = path.resolve(inputDir, rel);
        if (!fs.existsSync(abs)) continue;
        const stat = await fsp.stat(abs);
        if (!stat.isFile()) continue;
        const ext = path.extname(abs);
        const name = slugify(path.basename(abs, ext));
        const fileName = `${name || 'asset'}${ext || ''}`;
        const dest = path.join(destDir, fileName);
        await fsp.copyFile(abs, dest);

        const publicPath = `/img/uploads/${slug}/${fileName}`;
        // Replace only exact occurrences of the original ref to avoid surprises.
        nextBody = nextBody.split(rel).join(publicPath);
      }
    }
  }

  const fm = frontMatter
    ? // If source file already has front matter, keep it as-is (local edits) and only ensure it is wrapped.
      ['---', frontMatter.trimEnd(), '---'].join('\n')
    : toFrontMatterYaml({ title, date, category, tags, cover, topImg });

  const out = `${fm}\n\n${nextBody.trimStart()}`;
  await fsp.writeFile(outFile, out, 'utf8');

  console.log(`Imported: ${inputPath}`);
  console.log(` -> ${path.relative(cwd, outFile)}`);
  if (args.copyAssets) console.log(`Assets: ${path.relative(cwd, path.join(uploadsBaseDir, slug))}`);
}

main().catch((e) => fail(e?.stack || String(e)));
