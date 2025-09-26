// app/api/gh-upload/route.ts
export const runtime = 'nodejs';            // важно: не edge
export const dynamic = 'force-dynamic';     // чтобы не кешировалось

type Json = Record<string, any>;

const GH_TOKEN = process.env.GH_TOKEN || '';
const GH_REPO  = process.env.GH_REPO  || '';
const GH_BRANCH = process.env.GH_BRANCH || 'main';

const authScheme = GH_TOKEN.startsWith('github_pat_') ? 'Bearer' : 'token'; // fine-grained vs classic

function json(data: Json, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function b64(buf: ArrayBuffer) {
  // Node runtime гарантирован → Buffer доступен
  return Buffer.from(buf).toString('base64');
}

// ---- Diagnostics: GET /api/gh-upload/ping
export async function GET() {
  if (!GH_TOKEN || !GH_REPO) {
    return json(
      { ok: false, error: 'Missing GH_TOKEN or GH_REPO env' },
      500
    );
  }

  // 1) whoami
  const who = await fetch('https://api.github.com/user', {
    headers: { Authorization: `${authScheme} ${GH_TOKEN}` },
    cache: 'no-store',
  });

  // 2) repo info
  const repo = await fetch(`https://api.github.com/repos/${GH_REPO}`, {
    headers: { Authorization: `${authScheme} ${GH_TOKEN}` },
    cache: 'no-store',
  });

  let perm: any = null;
  try { perm = (await repo.json()).permissions || null; } catch {}

  return json({
    ok: who.status === 200 && repo.status === 200,
    env: { repo: GH_REPO, branch: GH_BRANCH },
    status: { who: who.status, repo: repo.status, perm },
  });
}

// ---- Upload: POST /api/gh-upload
// FormData: file, brand, model
export async function POST(req: Request) {
  if (!GH_TOKEN || !GH_REPO) {
    return json({ ok: false, error: 'Missing GH_TOKEN or GH_REPO env' }, 500);
  }

  try {
    const form = await req.formData();
    const file = form.get('file') as File | null;
    const brand = String(form.get('brand') || 'brand');
    const model = String(form.get('model') || 'model');

    if (!file) return json({ ok: false, error: 'No file' }, 400);

    const slug = (v: string) =>
      (v || '')
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .toLowerCase() || 'x';

    const safeName = (name: string) =>
      (name || 'file.glb').replace(/[^a-zA-Z0-9_.-]/g, '_');

    const path = `${slug(brand)}/${slug(model)}/${Date.now()}-${safeName(file.name)}`.replace(/^\/+/, '');

    // 1) узнаем latest sha ветки
    const refRes = await fetch(`https://api.github.com/repos/${GH_REPO}/git/refs/heads/${GH_BRANCH}`, {
      headers: { Authorization: `${authScheme} ${GH_TOKEN}` },
      cache: 'no-store',
    });
    if (!refRes.ok) {
      const text = await refRes.text();
      return json({ ok: false, error: `Cannot read branch ${GH_BRANCH}`, details: text }, 500);
    }
    const ref = await refRes.json();
    const baseSha = ref.object?.sha;

    // 2) создаём blob из файла
    const ab = await file.arrayBuffer();
    const blobRes = await fetch(`https://api.github.com/repos/${GH_REPO}/git/blobs`, {
      method: 'POST',
      headers: {
        Authorization: `${authScheme} ${GH_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ content: b64(ab), encoding: 'base64' }),
    });
    if (!blobRes.ok) {
      return json({ ok: false, error: 'blob create failed', details: await blobRes.text() }, 500);
    }
    const blob = await blobRes.json();

    // 3) получаем дерево текущего коммита
    const commitRes = await fetch(`https://api.github.com/repos/${GH_REPO}/git/commits/${baseSha}`, {
      headers: { Authorization: `${authScheme} ${GH_TOKEN}` },
    });
    if (!commitRes.ok) {
      return json({ ok: false, error: 'read base commit failed', details: await commitRes.text() }, 500);
    }
    const commit = await commitRes.json();

    // 4) создаём новое дерево с нашим файлом
    const treeRes = await fetch(`https://api.github.com/repos/${GH_REPO}/git/trees`, {
      method: 'POST',
      headers: {
        Authorization: `${authScheme} ${GH_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        base_tree: commit.tree.sha,
        tree: [{ path, mode: '100644', type: 'blob', sha: blob.sha }],
      }),
    });
    if (!treeRes.ok) {
      return json({ ok: false, error: 'tree create failed', details: await treeRes.text() }, 500);
    }
    const tree = await treeRes.json();

    // 5) коммит
    const newCommitRes = await fetch(`https://api.github.com/repos/${GH_REPO}/git/commits`, {
      method: 'POST',
      headers: {
        Authorization: `${authScheme} ${GH_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: `auto3d: add ${path}`,
        tree: tree.sha,
        parents: [baseSha],
      }),
    });
    if (!newCommitRes.ok) {
      return json({ ok: false, error: 'commit create failed', details: await newCommitRes.text() }, 500);
    }
    const newCommit = await newCommitRes.json();

    // 6) двигаем ветку на новый коммит
    const updateRefRes = await fetch(`https://api.github.com/repos/${GH_REPO}/git/refs/heads/${GH_BRANCH}`, {
      method: 'PATCH',
      headers: {
        Authorization: `${authScheme} ${GH_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ sha: newCommit.sha, force: false }),
    });
    if (!updateRefRes.ok) {
      return json({ ok: false, error: 'move ref failed', details: await updateRefRes.text() }, 500);
    }

    // CDN (jsDelivr)
    const cdn = `https://cdn.jsdelivr.net/gh/${GH_REPO}@${GH_BRANCH}/${encodeURI(path)}`;
    return json({ ok: true, url: cdn, path, branch: GH_BRANCH });
  } catch (e: any) {
    return json({ ok: false, error: e?.message || String(e) }, 500);
  }
}
