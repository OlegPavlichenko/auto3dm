// app/api/gh-upload/route.ts
export const runtime = 'nodejs';

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

function slug(v: string) {
  try {
    return (v || '')
      .toString()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase();
  } catch { return 'x'; }
}
function safeFileName(name: string) {
  return (name || 'file.bin').replace(/[^a-zA-Z0-9_.-]/g, '_');
}
function joinPathEncoded(p: string) {
  return p.split('/').map(encodeURIComponent).join('/'); // кодируем сегменты, не слэши
}

async function putToGithub(opts: {
  repo: string; branch: string; token: string;
  path: string; contentBase64: string; message: string;
}) {
  const url = `https://api.github.com/repos/${opts.repo}/contents/${joinPathEncoded(opts.path)}`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${opts.token}`,
      'Content-Type': 'application/json',
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: JSON.stringify({
      message: opts.message,
      content: opts.contentBase64,
      branch: opts.branch,
    }),
    cache: 'no-store',
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`GitHub PUT ${res.status}: ${text}`);
  }
  return res.json();
}

export async function POST(req: NextRequest) {
  try {
    const token  = process.env.GH_TOKEN  || '';
    const repo   = process.env.GH_REPO   || '';
    const branch = process.env.GH_BRANCH || 'main';
    if (!token || !repo) {
      return NextResponse.json({ error: 'Server not configured. Set GH_TOKEN, GH_REPO, GH_BRANCH' }, { status: 500 });
    }

    const form = await req.formData();
    const brand = slug(String(form.get('brand') || 'brand'));
    const model = slug(String(form.get('model') || 'model'));
    const baseDir = `${brand}/${model}/${Date.now()}`;

    const file  = form.get('file')  as File | null; // основной файл (GLB/STL/ZIP/…)
    const image = form.get('image') as File | null; // превью (PNG/JPG/WEBP)

    let fileCdnUrl: string | undefined;
    let imageCdnUrl: string | undefined;

    async function fileToBase64(f: File) {
      const buf = Buffer.from(await f.arrayBuffer());
      const max = 75 * 1024 * 1024; // мягкий лимит (GitHub ~100MB)
      if (buf.length > max) throw new Error(`File ${f.name} is too large (${(buf.length/1024/1024).toFixed(1)} MB)`);
      return buf.toString('base64');
    }

    if (file) {
      const b64 = await fileToBase64(file);
      const rel = `${baseDir}/${safeFileName(file.name || 'model.bin')}`;
      const resp = await putToGithub({ repo, branch, token, path: rel, contentBase64: b64, message: `Upload ${rel}` });
      const sha = resp?.commit?.sha || '';
      fileCdnUrl = sha
        ? `https://cdn.jsdelivr.net/gh/${repo}@${sha}/${rel}`
        : `https://cdn.jsdelivr.net/gh/${repo}@${branch}/${rel}`;
    }

    if (image) {
      const b64 = await fileToBase64(image);
      const rel = `${baseDir}/${safeFileName(image.name || 'preview.png')}`;
      const resp = await putToGithub({ repo, branch, token, path: rel, contentBase64: b64, message: `Upload ${rel}` });
      const sha = resp?.commit?.sha || '';
      imageCdnUrl = sha
        ? `https://cdn.jsdelivr.net/gh/${repo}@${sha}/${rel}`
        : `https://cdn.jsdelivr.net/gh/${repo}@${branch}/${rel}`;
    }

    return NextResponse.json({ ok: true, url: fileCdnUrl, imageUrl: imageCdnUrl });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 400 });
  }
}
