// app/api/gh-upload/route.ts
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs'; // требуется файловый доступ/Buffer

const GH_TOKEN  = process.env.GH_TOKEN!;
const GH_REPO   = process.env.GH_REPO!;   // "user/repo"
const GH_BRANCH = process.env.GH_BRANCH || 'main';

function slug(v: string): string {
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
function safeFileName(name: string): string {
  return (name || 'file.bin').replace(/[^a-zA-Z0-9_.-]/g, '_');
}
async function putToGitHub(path: string, bytes: Uint8Array, message: string) {
  const url = `https://api.github.com/repos/${GH_REPO}/contents/${encodeURIComponent(path)}`;
  const body = {
    message,
    content: Buffer.from(bytes).toString('base64'),
    branch: GH_BRANCH,
  };
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${GH_TOKEN}`,
      'Accept': 'application/vnd.github+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text().catch(()=> '');
    throw new Error(`GitHub PUT ${res.status}: ${t}`);
  }
  const data = await res.json();
  // предпочитаем raw.githubusercontent для скачивания; для CDN можно jsDelivr
  const rawUrl = `https://raw.githubusercontent.com/${GH_REPO}/${GH_BRANCH}/${path}`;
  const cdnUrl = `https://cdn.jsdelivr.net/gh/${GH_REPO}@${GH_BRANCH}/${path}`;
  return { rawUrl, cdnUrl, apiResponse: data };
}

export async function POST(req: NextRequest) {
  try {
    if (!GH_TOKEN || !GH_REPO) {
      return NextResponse.json({ error: 'Server not configured (GH_TOKEN/GH_REPO)' }, { status: 500 });
    }

    const form = await req.formData();
    const brand = slug(String(form.get('brand') || 'brand'));
    const model = slug(String(form.get('model') || 'model'));

    const out: any = {};
    const now = Date.now();

    // image (опционально)
    const image = form.get('image') as File | null;
    if (image) {
      const imgBytes = new Uint8Array(await image.arrayBuffer());
      const imgPath  = `uploads/${brand}/${model}/${now}-preview-${safeFileName(image.name)}`;
      const imgRes   = await putToGitHub(imgPath, imgBytes, `Upload preview ${brand}/${model}`);
      out.imageUrl   = imgRes.cdnUrl; // или rawUrl
    }

    // file (опционально)
    const file = form.get('file') as File | null;
    if (file) {
      const fileBytes = new Uint8Array(await file.arrayBuffer());
      const filePath  = `uploads/${brand}/${model}/${now}-${safeFileName(file.name)}`;
      const fileRes   = await putToGitHub(filePath, fileBytes, `Upload file ${brand}/${model}`);
      out.url        = fileRes.cdnUrl; // или rawUrl
    }

    return NextResponse.json(out);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
