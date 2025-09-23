// app/api/gh-upload/route.ts
import { NextRequest, NextResponse } from 'next/server';

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

async function putToGithub(opts: {
  repo: string;            // "user/repo"
  branch: string;          // e.g. "main"
  token: string;           // GH_TOKEN
  path: string;            // path in repo
  contentBase64: string;   // base64 (no data: prefix)
  message: string;
}) {
  const url = `https://api.github.com/repos/${opts.repo}/contents/${encodeURIComponent(opts.path)}`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${opts.token}`,
      'Content-Type': 'application/json',
      'Accept': 'application/vnd.github+json',
    },
    body: JSON.stringify({
      message: opts.message,
      content: opts.contentBase64,
      branch: opts.branch,
    }),
    // no-cache to avoid stale
    cache: 'no-store',
  });
  if (!res.ok) {
    const text = await res.text().catch(()=> '');
    throw new Error(`GitHub PUT ${res.status}: ${text}`);
  }
  return res.json();
}

export async function POST(req: NextRequest) {
  try {
    const token  = process.env.GH_TOKEN || '';
    const repo   = process.env.GH_REPO  || '';   // "user/repo"
    const branch = process.env.GH_BRANCH || 'main';
    if (!token || !repo) {
      return NextResponse.json({ error: 'Server not configured. Set GH_TOKEN, GH_REPO, GH_BRANCH' }, { status: 500 });
    }

    const form = await req.formData();
    const brand = slug(String(form.get('brand') || 'brand'));
    const model = slug(String(form.get('model') || 'model'));
    const baseDir = `${brand}/${model}/${Date.now()}`;

    // read files
    const file = form.get('file') as File | null;   // optional (GLB/STL/ZIP…)
    const image = form.get('image') as File | null; // optional (PNG/JPG/WEBP)

    let glbCdnUrl: string | undefined;
    let imageCdnUrl: string | undefined;

    async function fileToBase64(f: File) {
      const buf = Buffer.from(await f.arrayBuffer());
      const max = 75 * 1024 * 1024; // ~75MB
      if (buf.length > max) throw new Error(`File ${f.name} is too large (${(buf.length/1024/1024).toFixed(1)} MB)`);
      return buf.toString('base64');
    }

    if (file) {
      const b64 = await fileToBase64(file);
      const rel = `${baseDir}/${safeFileName(file.name || 'model.bin')}`;
      const resp = await putToGithub({
        repo, branch, token,
        path: rel,
        contentBase64: b64,
        message: `Upload ${rel}`,
      });
      // Prefer immutable CDN by commit SHA:
      const sha = resp?.commit?.sha || '';
      // jsDelivr immutable URL by commit
      glbCdnUrl = sha
        ? `https://cdn.jsdelivr.net/gh/${repo}@${sha}/${rel}`
        : `https://cdn.jsdelivr.net/gh/${repo}@${branch}/${rel}`;
    }

    if (image) {
      const b64 = await fileToBase64(image);
      const rel = `${baseDir}/${safeFileName(image.name || 'preview.png')}`;
      const resp = await putToGithub({
        repo, branch, token,
        path: rel,
        contentBase64: b64,
        message: `Upload ${rel}`,
      });
      const sha = resp?.commit?.sha || '';
      imageCdnUrl = sha
        ? `https://cdn.jsdelivr.net/gh/${repo}@${sha}/${rel}`
        : `https://cdn.jsdelivr.net/gh/${repo}@${branch}/${rel}`;
    }

    return NextResponse.json({ ok: true, url: glbCdnUrl, imageUrl: imageCdnUrl });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 400 });
  }
}
