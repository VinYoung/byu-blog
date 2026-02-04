#!/usr/bin/env node
/**
 * Local-only web importer for Markdown -> Hexo post with optional R2 uploads.
 *
 * Start:
 *   yarn import:web
 *
 * Env (set in `.env.local` or process env):
 *   R2_ENDPOINT
 *   R2_BUCKET
 *   R2_ACCESS_KEY_ID
 *   R2_SECRET_ACCESS_KEY
 *   R2_PUBLIC_BASE_URL   (e.g. https://storage-blog.byu-young.top)
 */

import path from 'node:path';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import express from 'express';
import multer from 'multer';
import dotenv from 'dotenv';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');

dotenv.config({ path: path.join(repoRoot, '.env.local') });
// Convenience: reuse the same R2 config stored in the Next.js shell project.
dotenv.config({ path: path.resolve(repoRoot, '..', 'byu', '.env.local') });
dotenv.config();

const postsDir = path.join(repoRoot, 'source', '_posts');

function requiredEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

function nowString() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function slugify(input) {
  const s = String(input ?? '').trim();
  if (!s) return 'post';
  return (
    s
      .normalize('NFKC')
      .replace(/\s+/g, '-')
      .replace(/[^\p{Script=Han}a-zA-Z0-9_-]+/gu, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 120) || 'post'
  );
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

function isRemoteUrl(v) {
  return /^(https?:)?\/\//i.test(v);
}

function normalizeRef(raw) {
  let v = String(raw ?? '').trim();
  if (!v) return '';
  if ((v.startsWith('<') && v.endsWith('>')) || (v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1).trim();
  }
  if (!v) return '';
  v = v.replace(/\\/g, '/');
  if (v.startsWith('file://')) {
    v = v.replace(/^file:\/+/, '/');
  }
  try {
    v = decodeURI(v);
  } catch {
    // ignore
  }
  return v;
}

function findLocalRefs(md) {
  const found = [];
  const push = (raw) => {
    const original = String(raw ?? '');
    const norm = normalizeRef(original);
    if (!norm) return;
    if (isRemoteUrl(norm)) return;
    if (norm.startsWith('data:')) return;
    found.push({ original: normalizeRef(original), norm });
  };

  // Markdown image: ![](path) and ![](<path with spaces>)
  for (const m of md.matchAll(/!\[[^\]]*]\(\s*([^)\s]+?)(?:\s+\"[^\"]*\")?\s*\)/g)) push(m[1]);
  for (const m of md.matchAll(/!\[[^\]]*]\(\s*<([^>]+)>\s*(?:\"[^\"]*\")?\s*\)/g)) push(m[1]);

  // Obsidian embeds: ![[image.png]] or ![[image.png|alt]]
  for (const m of md.matchAll(/!\[\[([^\]]+?)\]\]/g)) {
    const inner = String(m[1] ?? '').split('|')[0].split('#')[0].trim();
    push(inner);
  }

  // HTML tags
  for (const m of md.matchAll(/<img[^>]*\s+src=["']([^"']+)["'][^>]*>/gi)) push(m[1]);
  for (const m of md.matchAll(/<iframe[^>]*\s+src=["']([^"']+)["'][^>]*>/gi)) push(m[1]);
  for (const m of md.matchAll(/<(video|audio)[^>]*\s+src=["']([^"']+)["'][^>]*>/gi)) push(m[2]);
  for (const m of md.matchAll(/<source[^>]*\s+src=["']([^"']+)["'][^>]*>/gi)) push(m[1]);

  // de-dupe by original string to keep replacement deterministic
  const seen = new Set();
  const out = [];
  for (const item of found) {
    const key = item.original;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function sha8(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex').slice(0, 8);
}

function sanitizeFileName(name) {
  const base = path.basename(name);
  const ext = path.extname(base);
  const stem = base.slice(0, base.length - ext.length);
  const cleanStem = slugify(stem) || 'asset';
  const cleanExt = ext && ext.length <= 16 ? ext : '';
  return `${cleanStem}${cleanExt}`;
}

function joinUrl(base, p) {
  const b = base.endsWith('/') ? base.slice(0, -1) : base;
  const pp = p.startsWith('/') ? p : `/${p}`;
  return `${b}${pp}`;
}

function buildS3Client() {
  const endpoint = requiredEnv('R2_ENDPOINT');
  const accessKeyId = requiredEnv('R2_ACCESS_KEY_ID');
  const secretAccessKey = requiredEnv('R2_SECRET_ACCESS_KEY');
  return new S3Client({
    region: 'auto',
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: true,
  });
}

function contentTypeFromExt(ext) {
  const e = ext.toLowerCase();
  if (e === '.png') return 'image/png';
  if (e === '.jpg' || e === '.jpeg') return 'image/jpeg';
  if (e === '.gif') return 'image/gif';
  if (e === '.webp') return 'image/webp';
  if (e === '.svg') return 'image/svg+xml';
  if (e === '.mp4') return 'video/mp4';
  if (e === '.mov') return 'video/quicktime';
  if (e === '.pdf') return 'application/pdf';
  return 'application/octet-stream';
}

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

function getAssetBasename(p) {
  const v = normalizeRef(p);
  if (!v) return '';
  const cleaned = v.split('?')[0].split('#')[0];
  return path.posix.basename(cleaned);
}

function stripLeadingDotSegments(p) {
  let v = normalizeRef(p);
  if (!v) return '';
  // Browser directory uploads are rooted at the selected folder.
  // For matching purposes, treat leading ./ and ../ as optional.
  while (v.startsWith('./') || v.startsWith('../')) {
    v = v.replace(/^\.\.?\//, '');
  }
  return v;
}

function pickAssetForRef(refNorm, assets) {
  const n0 = normalizeRef(refNorm);
  const n = stripLeadingDotSegments(n0);
  const candidatesExact = [];
  for (const a of assets) {
    const o = normalizeRef(a.originalname || '');
    if (!o) continue;
    if (o === n0 || o === n) candidatesExact.push(a);
  }
  if (candidatesExact.length === 1) return { asset: candidatesExact[0], matchedBy: 'path' };
  if (candidatesExact.length > 1) return { asset: null, matchedBy: 'ambiguous-path' };

  const candidatesSuffix = [];
  for (const a of assets) {
    const o = normalizeRef(a.originalname || '');
    if (!o) continue;
    if (o.endsWith(`/${n0}`) || o.endsWith(`/${n}`)) candidatesSuffix.push(a);
  }
  if (candidatesSuffix.length === 1) return { asset: candidatesSuffix[0], matchedBy: 'suffix' };
  if (candidatesSuffix.length > 1) return { asset: null, matchedBy: 'ambiguous-suffix' };

  const base = getAssetBasename(n);
  if (!base) return { asset: null, matchedBy: 'none' };

  const candidatesBase = [];
  for (const a of assets) {
    const o = normalizeRef(a.originalname || '');
    if (!o) continue;
    if (path.posix.basename(o) === base) candidatesBase.push(a);
  }
  if (candidatesBase.length === 1) return { asset: candidatesBase[0], matchedBy: 'basename' };
  if (candidatesBase.length > 1) return { asset: null, matchedBy: 'ambiguous-basename' };

  return { asset: null, matchedBy: 'none' };
}

app.get('/', async (_req, res) => {
  const htmlPath = path.join(repoRoot, 'tools', 'importer', 'public', 'index.html');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(await fsp.readFile(htmlPath, 'utf8'));
});

app.post(
  '/api/import',
  upload.fields([
    { name: 'md', maxCount: 1 },
    { name: 'assets', maxCount: 200 },
  ]),
  async (req, res) => {
    try {
      const mdFile = req.files?.md?.[0];
      if (!mdFile) return res.status(400).json({ ok: false, error: 'Missing md file' });

      const titleArg = String(req.body.title || '');
      const categoryArg = String(req.body.category || '');
      const tagsArg = String(req.body.tags || '');
      const coverArg = String(req.body.cover || '');
      const topImgArg = String(req.body.topImg || '');
      const dateArg = String(req.body.date || '');
      const force = String(req.body.force || '') === 'true';
      const uploadR2 = String(req.body.uploadR2 || '') === 'true';

      const raw = mdFile.buffer.toString('utf8');
      const { frontMatter, body } = splitFrontMatter(raw);

      const baseName = path.basename(mdFile.originalname || 'import.md', path.extname(mdFile.originalname || 'import.md'));
      const title = titleArg || guessTitleFromBody(body, baseName);
      const date = dateArg || nowString();
      const category = categoryArg || '';
      const tags = uniqNonEmpty(tagsArg.split(','));
      const slug = slugify(title || baseName);

      const outFile = path.join(postsDir, `${slug}.md`);
      await fsp.mkdir(postsDir, { recursive: true });
      if (!force && fs.existsSync(outFile)) {
        return res.status(409).json({ ok: false, error: `Post exists: ${path.relative(repoRoot, outFile)}` });
      }

      let nextBody = body;
      const refs = findLocalRefs(nextBody);

      const assets = req.files?.assets || [];

      const replaced = [];
      const skipped = [];
      if (uploadR2 && refs.length) {
        const bucket = requiredEnv('R2_BUCKET');
        const publicBase = requiredEnv('R2_PUBLIC_BASE_URL');
        const s3 = buildS3Client();

        for (const { original, norm } of refs) {
          const picked = pickAssetForRef(norm, assets);
          if (!picked.asset) {
            skipped.push({ ref: original, reason: picked.matchedBy });
            continue;
          }
          const match = picked.asset;

          const ext = path.extname(getAssetBasename(norm));
          const baseFile = sanitizeFileName(getAssetBasename(norm) || norm);
          const hash = sha8(match.buffer);
          const fileName = baseFile.replace(ext, '') + `-${hash}` + ext;
          const key = `img/uploads/${slug}/${fileName}`;

          await s3.send(
            new PutObjectCommand({
              Bucket: bucket,
              Key: key,
              Body: match.buffer,
              ContentType: contentTypeFromExt(ext),
            })
          );

          const url = joinUrl(publicBase, `/${key}`);
          // replace exact occurrences
          nextBody = nextBody.split(original).join(url);
          replaced.push({ from: original, to: url, matchedBy: picked.matchedBy });
        }
      }

      const fm = frontMatter
        ? ['---', frontMatter.trimEnd(), '---'].join('\n')
        : toFrontMatterYaml({
            title,
            date,
            category,
            tags,
            cover: coverArg || '',
            topImg: topImgArg || '',
          });

      const out = `${fm}\n\n${nextBody.trimStart()}`;
      await fsp.writeFile(outFile, out, 'utf8');

      return res.json({
        ok: true,
        post: path.relative(repoRoot, outFile),
        slug,
        replaced,
        missingAssets: refs.map((r) => r.original).filter((r) => !replaced.some((x) => x.from === r)),
        skipped,
      });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  }
);

const port = Number(process.env.IMPORTER_PORT || 4010);
app.listen(port, () => {
  console.log(`byu-blog importer: http://localhost:${port}`);
});
