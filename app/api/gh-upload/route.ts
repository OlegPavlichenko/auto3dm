// app/api/gh-upload/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const GH_TOKEN  = process.env.GH_TOKEN || '';
const GH_REPO   = process.env.GH_REPO  || '';   // "owner/repo"
const GH_BRANCH = process.env.GH_BRANCH || 'main';
const REQUIRE_PR = (process.env.REQUIRE_PR || '') === '1';
const ALLOWED = String(process.env.ALLOWED_UPLOADERS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

const [OWNER, REPO] = GH_REPO.includes('/') ? GH_REPO.split('/') : ['', ''];

function ghHeaders() {
  return {
    'Authorization': `Bearer ${GH_TOKEN}`,
    'Accept': 'application/vnd.github+json',
    'Content-Type': 'application/json',
    'User-Agent': 'auto3dm',
  };
}

function cdnUrl(path: string) {
  return `https://cdn.jsdelivr.net/gh/${GH_REPO}@${GH_BRANCH}/${path}`;
}
function badEnv() { return !GH_TOKEN || !GH_REPO || !OWNER || !REPO; }

function safeName(v: string) { return (v || '').replace(/[^a-zA-Z0-9_.-]/g, '_'); }
function slug(v: string) {
  try {
    return (v || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'x';
  } catch { return 'x'; }
}

async function requireAuthAllowed() {
  const session = await getServerSession(authOptions);
  const login = (session as any)?.user?.login as string | null;
  const allowed = !!login && (ALLOWED.length === 0 || ALLOWED.includes(login));
  return { session, login, allowed };
}

// --- Git helpers: base sha, make branch, put/delete, PR ---
async function getHeadSha(branch: string) {
  const res = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/git/ref/heads/${encodeURIComponent(branch)}`, { headers: ghHeaders() });
  if (!res.ok) throw new Error(`getHeadSha ${res.status}`);
  const j = await res.json();
  return j.object.sha as string;
}
async function createBranch(fromSha: string, branch: string) {
  const res = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/git/refs`, {
    method: 'POST', headers: ghHeaders(),
    body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: fromSha }),
  });
  if (!res.ok) throw new Error(`createBranch ${res.status}: ${await res.text()}`);
}
async function createOrUpdateFile(path: string, contentB64: string, message: string, branch: string, sha?: string) {
  const url = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${encodeURIComponent(path)}`;
  const body: any = { message, content: contentB64, branch };
  if (sha) body.sha = sha;
  const res = await fetch(url, { method: 'PUT', headers: ghHeaders(), body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`PUT ${res.status}: ${await res.text()}`);
  return res.json();
}
async function deleteFile(path: string, message: string, branch: string, sha: string) {
  const url = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${encodeURIComponent(path)}`;
  const res = await fetch(url, { method: 'DELETE', headers: ghHeaders(), body: JSON.stringify({ message, branch, sha }) });
  if (!res.ok) throw new Error(`DELETE ${res.status}: ${await res.text()}`);
  return res.json();
}
async function getFileSha(path: string, branch: string) {
  const url = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(branch)}`;
  const res = await fetch(url, { headers: ghHeaders() });
  if (!res.ok) throw new Error(`meta ${res.status}: ${await res.text()}`);
  const j = await res.json();
  return j.sha as string;
}
async function openPr(from: string, to: string, title: string) {
  const url = `https://api.github.com/repos/${OWNER}/${REPO}/pulls`;
  const res = await fetch(url, { method: 'POST', headers: ghHeaders(), body: JSON.stringify({ title, head: from, base: to }) });
  if (!res.ok) throw new Error(`PR ${res.status}: ${await res.text()}`);
  const j = await res.json();
  return { number: j.number, html_url: j.html_url as string };
}

// ---------------------- GET ----------------------
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    if (badEnv()) {
      return NextResponse.json({ ok: false, error: 'Missing GH_TOKEN or GH_REPO env' }, { status: 500 });
    }

    // ping (не требует сессии)
    if (searchParams.get('ping')) {
      const who = await fetch('https://api.github.com/user', { headers: ghHeaders() });
      const repo = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}`, { headers: ghHeaders() });
      return NextResponse.json({
        ok: who.ok && repo.ok,
        status: { who: who.status, repo: repo.status },
        branch: GH_BRANCH,
      });
    }

    // list (только для allowlist)
    if (searchParams.get('list')) {
      const { allowed } = await requireAuthAllowed();
      if (!allowed) return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 });

      const prefix = (searchParams.get('prefix') || '').replace(/^\/+/, '');
      const tree = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/git/trees/${encodeURIComponent(GH_BRANCH)}?recursive=1`, { headers: ghHeaders() });
      if (!tree.ok) return NextResponse.json({ ok: false, error: `List failed: ${tree.status}` }, { status: 500 });
      const data = await tree.json();
      const items = (data.tree || [])
        .filter((n: any) => n.type === 'blob' && (!prefix || String(n.path).startsWith(prefix + '/')))
        .map((n: any) => ({ path: n.path, size: n.size || 0, sha: n.sha, url: cdnUrl(n.path) }))
        .sort((a: any, b: any) => (a.path < b.path ? 1 : -1))
        .slice(0, 200);

      return NextResponse.json({ ok: true, repo: GH_REPO, branch: GH_BRANCH, items });
    }

    return NextResponse.json({ ok: true, message: 'Use POST to upload, GET ?list=1 to list, DELETE to remove.' });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}

// ---------------------- POST (upload) ----------------------
type UploadKind = 'model' | 'image';

export async function POST(req: NextRequest) {
  try {
    if (badEnv()) return NextResponse.json({ ok: false, error: 'Missing GH_TOKEN or GH_REPO env' }, { status: 500 });

    // нужна сессия + allowlist
    const { login, allowed } = await requireAuthAllowed();
    if (!allowed) return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 });

    const form = await req.formData();
    const file = form.get('file') as File | null;
    const brand = String(form.get('brand') || 'brand');
    const model = String(form.get('model') || 'model');
    const kind = String(form.get('kind') || 'model') as UploadKind;
    const forcePr = (String(form.get('pr') || '') === '1') || REQUIRE_PR;

    if (!file) return NextResponse.json({ ok: false, error: 'No file' }, { status: 400 });
    const ext = (file.name || '').split('.').pop()?.toLowerCase() || '';
    if (kind === 'model' && ext !== 'glb') return NextResponse.json({ ok: false, error: 'Only .glb allowed' }, { status: 400 });
    if (kind === 'image' && !['png', 'jpg', 'jpeg', 'webp'].includes(ext)) return NextResponse.json({ ok: false, error: 'Images only: png/jpg/webp' }, { status: 400 });

    const base = kind === 'model' ? 'models' : 'images';
    const path = `${base}/${slug(brand)}/${slug(model)}/${Date.now()}-${safeName(file.name)}`;
    const buf = Buffer.from(await file.arrayBuffer());
    const contentB64 = buf.toString('base64');
    const message = `[auto3dm] upload ${path} by @${login}`;

    if (!forcePr) {
      await createOrUpdateFile(path, contentB64, message, GH_BRANCH);
      return NextResponse.json({ ok: true, path, url: cdnUrl(path), repo: GH_REPO, branch: GH_BRANCH });
    }

    // PR-поток
    const baseSha = await getHeadSha(GH_BRANCH);
    const prBranch = `auto3dm/upload-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
    await createBranch(baseSha, prBranch);
    await createOrUpdateFile(path, contentB64, message, prBranch);
    const pr = await openPr(prBranch, GH_BRANCH, `[auto3dm] upload ${path}`);
    return NextResponse.json({ ok: true, path, url: cdnUrl(path), repo: GH_REPO, branch: GH_BRANCH, pr: pr.html_url });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}

// ---------------------- DELETE (remove) ----------------------
export async function DELETE(req: NextRequest) {
  try {
    if (badEnv()) return NextResponse.json({ ok: false, error: 'Missing GH_TOKEN or GH_REPO env' }, { status: 500 });
    const { login, allowed } = await requireAuthAllowed();
    if (!allowed) return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 });

    const { path } = await req.json();
    if (!path || typeof path !== 'string') return NextResponse.json({ ok: false, error: 'Path required' }, { status: 400 });
    if (!/^models\\/|^images\\//.test(path)) return NextResponse.json({ ok: false, error: 'Only models/ or images/ allowed' }, { status: 400 });

    const shaMain = await getFileSha(path, GH_BRANCH);
    const message = `[auto3dm] delete ${path} by @${login}`;

    if (!REQUIRE_PR) {
      await deleteFile(path, message, GH_BRANCH, shaMain);
      return NextResponse.json({ ok: true, deleted: path });
    }

    // PR на удаление
    const baseSha = await getHeadSha(GH_BRANCH);
    const prBranch = `auto3dm/delete-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
    await createBranch(baseSha, prBranch);
    const shaBranch = await getFileSha(path, prBranch); // на всякий
    await deleteFile(path, message, prBranch, shaBranch);
    const pr = await openPr(prBranch, GH_BRANCH, `[auto3dm] delete ${path}`);
    return NextResponse.json({ ok: true, deleted: path, pr: pr.html_url });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
