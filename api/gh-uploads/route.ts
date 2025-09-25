// app/api/gh-upload/route.ts
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';       // нужен Buffer
export const dynamic = 'force-dynamic';

const GH_TOKEN  = process.env.GH_TOKEN!;
const GH_REPO   = process.env.GH_REPO!;    // "user/repo"
const GH_BRANCH = process.env.GH_BRANCH || 'main';

function slug(v: string) {
  try {
    return (v || '').normalize('NFKD').replace(/[\u0300-\u036f]/g,'')
      .replace(/[^a-zA-Z0-9]+/g,'-').replace(/^-+|-+$/g,'').toLowerCase() || 'x';
  } catch { return 'x'; }
}
const safeName = (n: string) => (n || 'file.bin').replace(/[^a-zA-Z0-9_.-]/g,'_');

// ✨ ВАЖНО: кодируем КАЖДЫЙ сегмент пути, а не весь путь целиком!
function encodePath(p: string) {
  return p.split('/').map(encodeURIComponent).join('/');
}

async function putContent(path: string, content: Buffer, message: string) {
  const url = `https://api.github.com/repos/${GH_REPO}/contents/${encodePath(path)}`;
  const body = {
    message,
    content: content.toString('base64'),
    branch: GH_BRANCH,
  };
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${GH_TOKEN}`,
      'Accept': 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'auto3d-uploader'
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  let data: any = {};
  try { data = JSON.parse(text); } catch {}

  if (!res.ok) {
    const msg = data?.message || text || `${res.status} ${res.statusText}`;
    throw new Error(msg);
  }
  const commitSha = data?.commit?.sha as string | undefined;
  return { commitSha };
}

export async function POST(req: Request) {
  try {
    if (!GH_TOKEN || !GH_REPO) {
      return NextResponse.json({ error: 'Server is not configured (GH_TOKEN/GH_REPO missing)' }, { status: 500 });
    }

    const form = await req.formData();
    const file  = form.get('file')  as File | null;   // GLB (необязательно)
    const image = form.get('image') as File | null;   // превью (необязательно)
    const brand = String(form.get('brand') || 'brand');
    const model = String(form.get('model') || 'model');

    if (!file && !image) {
      return NextResponse.json({ error: 'Nothing to upload (pick image and/or file).' }, { status: 400 });
    }

    const ts = Date.now();
    const brandSlug = slug(brand);
    const modelSlug = slug(model);

    let fileUrl: string | undefined;
    let imageUrl: string | undefined;
    let commitSha: string | undefined;

    if (file) {
      const buf = Buffer.from(await file.arrayBuffer());
      const path = `${brandSlug}/${modelSlug}/${ts}-${safeName(file.name || 'model.glb')}`;
      const r = await putContent(path, buf, `upload file ${path}`);
      commitSha = r.commitSha || commitSha;
      fileUrl = `https://cdn.jsdelivr.net/gh/${GH_REPO}@${commitSha || GH_BRANCH}/${path}`;
    }

    if (image) {
      const buf = Buffer.from(await image.arrayBuffer());
      const path = `${brandSlug}/${modelSlug}/${ts}-${safeName(image.name || 'preview.jpg')}`;
      const r = await putContent(path, buf, `upload image ${path}`);
      commitSha = r.commitSha || commitSha;
      imageUrl = `https://cdn.jsdelivr.net/gh/${GH_REPO}@${commitSha || GH_BRANCH}/${path}`;
    }

    return NextResponse.json({ url: fileUrl, imageUrl }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Upload failed' }, { status: 500 });
  }
}
