// app/api/gh-upload/route.ts
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

function b64(buf: ArrayBuffer) {
  // browser-safe base64
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return Buffer.from(bin, 'binary').toString('base64');
}

function slug(v: string) {
  return (v || '').toString().replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();
}
function safeFileName(name: string) {
  return (name || 'model.glb').replace(/[^a-zA-Z0-9_.-]/g, '_');
}

export async function POST(req: Request) {
  const GH_TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  const GH_REPO  = process.env.GH_REPO;    // "user/repo"
  const GH_BRANCH = process.env.GH_BRANCH || 'main';

  if (!GH_TOKEN || !GH_REPO) {
    return NextResponse.json({ error: 'Server not configured (GH_TOKEN / GH_REPO)' }, { status: 500 });
  }

  const form = await req.formData();
  const file = form.get('file') as File | null;
  const brand = String(form.get('brand') || 'brand');
  const model = String(form.get('model') || 'model');
  let relPath = String(form.get('path') || '');
  if (!file) return NextResponse.json({ error: 'No file' }, { status: 400 });

  if (!relPath) {
    relPath = `${slug(brand)}/${slug(model)}/${Date.now()}-${safeFileName(file.name || 'model.glb')}`;
  }
  if (!/\.glb$/i.test(relPath)) relPath += '.glb';

  const contentB64 = b64(await file.arrayBuffer());

  const url = `https://api.github.com/repos/${GH_REPO}/contents/${encodeURI(relPath)}`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${GH_TOKEN}`,
      'Content-Type': 'application/json',
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: JSON.stringify({
      message: `auto3d: upload ${relPath}`,
      content: contentB64,
      branch: GH_BRANCH,
    }),
  });

  const text = await res.text();
  if (!res.ok) {
    return NextResponse.json({ error: 'GitHub API failed', detail: text.slice(0, 400) }, { status: res.status });
  }
  const data = JSON.parse(text);

  const commitSha = data?.commit?.sha || GH_BRANCH;
  const cdn = `https://cdn.jsdelivr.net/gh/${GH_REPO}@${commitSha}/${relPath}`;
  const raw = `https://rawcdn.githack.com/${GH_REPO}/${commitSha}/${relPath}`;

  return NextResponse.json({
    ok: true,
    path: relPath,
    repo: GH_REPO,
    branch: GH_BRANCH,
    cdn,
    raw,
    url: cdn, // по умолчанию отдаем jsDelivr
  });
}
