// app/api/gh-upload/route.ts
import { NextRequest, NextResponse } from 'next/server';

const GH_TOKEN = process.env.GH_TOKEN || '';
const GH_REPO = process.env.GH_REPO || '';              // "OlegPavlichenko/auto3dm"
const GH_BRANCH = process.env.GH_BRANCH || 'main';
const [OWNER, REPO] = GH_REPO.includes('/') ? GH_REPO.split('/') : ['', ''];

function ghHeaders() {
  return {
    'Authorization': `token ${GH_TOKEN}`,
    'Accept': 'application/vnd.github+json',
    'Content-Type': 'application/json',
  };
}

function cdnUrl(path: string) {
  return `https://cdn.jsdelivr.net/gh/${GH_REPO}@${GH_BRANCH}/${path}`;
}

function badEnv() {
  return !GH_TOKEN || !GH_REPO || !OWNER || !REPO;
}

export async function GET(req: NextRequest) {
  try {
    if (badEnv()) {
      return NextResponse.json({ ok: false, error: 'Missing GH_TOKEN or GH_REPO env' }, { status: 500 });
    }
    const { searchParams } = new URL(req.url);
    if (searchParams.get('ping')) {
      const who = await fetch('https://api.github.com/user', { headers: ghHeaders() });
      const repo = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}`, { headers: ghHeaders() });
      return NextResponse.json({
        ok: who.ok && repo.ok,
        whoami: who.ok ? await who.json() : null,
        repo: repo.ok ? await repo.json() : null,
        status: { who: who.status, repo: repo.status },
        branch: GH_BRANCH,
      });
    }

    // list files under a prefix using Git Trees API (recursive)
    if (searchParams.get('list')) {
      const prefix = (searchParams.get('prefix') || '').replace(/^\/+/, '');
      const ref = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/git/trees/${encodeURIComponent(GH_BRANCH)}?recursive=1`, { headers: ghHeaders() });
      if (!ref.ok) {
        return NextResponse.json({ ok: false, error: `List failed: ${ref.status}` }, { status: 500 });
      }
      const data = await ref.json();
      const items = (data.tree || [])
        .filter((n: any) => n.type === 'blob' && (!prefix || String(n.path).startsWith(prefix + '/')))
        .map((n: any) => ({ path: n.path, size: n.size || 0, sha: n.sha, url: cdnUrl(n.path) }))
        // у нас имена включают timestamp — сортируем по убыванию
        .sort((a: any, b: any) => (a.path < b.path ? 1 : -1))
        .slice(0, 100);
      return NextResponse.json({ ok: true, repo: GH_REPO, branch: GH_BRANCH, items });
    }

    return NextResponse.json({ ok: true, message: 'Use POST to upload, GET ?list=1&prefix=models|images to list, DELETE to remove.' });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}

type UploadKind = 'model' | 'image';
function safeName(v: string) { return (v || '').replace(/[^a-zA-Z0-9_.-]/g, '_'); }
function slug(v: string) {
  try {
    return (v || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'x';
  } catch { return 'x'; }
}

export async function POST(req: NextRequest) {
  try {
    if (badEnv()) {
      return NextResponse.json({ ok: false, error: 'Missing GH_TOKEN or GH_REPO env' }, { status: 500 });
    }
    const form = await req.formData();
    const file = form.get('file') as File | null;
    const brand = String(form.get('brand') || 'brand');
    const model = String(form.get('model') || 'model');
    const kind = String(form.get('kind') || 'model') as UploadKind;

    if (!file) return NextResponse.json({ ok: false, error: 'No file' }, { status: 400 });

    const ext = (file.name || '').split('.').pop()?.toLowerCase() || '';
    if (kind === 'model' && ext !== 'glb') {
      return NextResponse.json({ ok: false, error: 'Only .glb allowed' }, { status: 400 });
    }
    if (kind === 'image' && !['png', 'jpg', 'jpeg', 'webp'].includes(ext)) {
      return NextResponse.json({ ok: false, error: 'Images only: png/jpg/webp' }, { status: 400 });
    }

    const base = kind === 'model' ? 'models' : 'images';
    const path = `${base}/${slug(brand)}/${slug(model)}/${Date.now()}-${safeName(file.name)}`;

    // read file → base64
    const buf = Buffer.from(await file.arrayBuffer());
    const content = buf.toString('base64');

    const res = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/contents/${encodeURIComponent(path)}`, {
      method: 'PUT',
      headers: ghHeaders(),
      body: JSON.stringify({
        message: `upload ${path}`,
        content,
        branch: GH_BRANCH,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      return NextResponse.json({ ok: false, error: `GitHub PUT ${res.status}: ${data?.message || 'unknown'}` }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      path,
      url: cdnUrl(path),
      repo: GH_REPO,
      branch: GH_BRANCH,
      sha: data?.content?.sha || null,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    if (badEnv()) {
      return NextResponse.json({ ok: false, error: 'Missing GH_TOKEN or GH_REPO env' }, { status: 500 });
    }
    const { path } = await req.json();
    if (!path || typeof path !== 'string') {
      return NextResponse.json({ ok: false, error: 'Path required' }, { status: 400 });
    }
    if (!/^models\/|^images\//.test(path)) {
      return NextResponse.json({ ok: false, error: 'Only models/ or images/ allowed' }, { status: 400 });
    }

    // get SHA for file
    const meta = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(GH_BRANCH)}`, {
      headers: ghHeaders(),
    });
    if (!meta.ok) {
      return NextResponse.json({ ok: false, error: `Meta ${meta.status}` }, { status: 404 });
    }
    const info = await meta.json();
    const sha = info?.sha;
    if (!sha) return NextResponse.json({ ok: false, error: 'SHA not found' }, { status: 500 });

    const del = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/contents/${encodeURIComponent(path)}`, {
      method: 'DELETE',
      headers: ghHeaders(),
      body: JSON.stringify({
        message: `delete ${path}`,
        sha,
        branch: GH_BRANCH,
      }),
    });
    const resj = await del.json();
    if (!del.ok) {
      return NextResponse.json({ ok: false, error: `GitHub DELETE ${del.status}: ${resj?.message || 'unknown'}` }, { status: 500 });
    }
    return NextResponse.json({ ok: true, deleted: path });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
