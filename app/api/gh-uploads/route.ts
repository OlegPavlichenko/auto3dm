import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs'; // serverless runtime on Vercel

function b64(data: ArrayBuffer) {
  // Convert ArrayBuffer → Base64 without btoa (Node runtime)
  const buf = Buffer.from(data);
  return buf.toString('base64');
}

export async function GET(req: NextRequest) {
  // simple ping for diagnostics
  const ok = !!(process.env.GH_TOKEN && process.env.GH_REPO);
  return NextResponse.json({ ok, repo: process.env.GH_REPO || null }, { status: ok ? 200 : 200 });
}

export async function POST(req: NextRequest) {
  try {
    const GH_TOKEN  = process.env.GH_TOKEN!;
    const GH_REPO   = process.env.GH_REPO!;    // e.g. "youruser/yourrepo"
    const GH_BRANCH = process.env.GH_BRANCH || 'main';

    if (!GH_TOKEN || !GH_REPO) {
      return NextResponse.json({ error: 'Missing GH_TOKEN or GH_REPO env' }, { status: 500 });
    }

    const form = await req.formData();
    const brand = String(form.get('brand') || 'brand').toLowerCase().replace(/[^a-z0-9-]+/g,'-');
    const model = String(form.get('model') || 'model').toLowerCase().replace(/[^a-z0-9-]+/g,'-');

    const file = form.get('file') as File | null;
    const image = form.get('image') as File | null;

    // Helper to upload one blob to GitHub
    async function putFile(path: string, blob: File) {
      const content = b64(await blob.arrayBuffer());
      const res = await fetch(`https://api.github.com/repos/${GH_REPO}/contents/${encodeURIComponent(path)}`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${GH_TOKEN}`,
          'Content-Type': 'application/json',
          'Accept': 'application/vnd.github+json'
        },
        body: JSON.stringify({
          message: `upload via api: ${path}`,
          content,
          branch: GH_BRANCH
        })
      });
      const j = await res.json();
      if (!res.ok) {
        throw new Error(`GitHub PUT ${res.status}: ${j?.message || JSON.stringify(j)}`);
      }
    }

    const ts = Date.now();
    let url: string | undefined;
    let imageUrl: string | undefined;

    if (file) {
      const safeName = (file.name || 'model.glb').replace(/[^a-zA-Z0-9_.-]/g,'_');
      const rel = `models/${brand}/${model}/${ts}-${safeName}`;
      await putFile(rel, file);
      url = `https://cdn.jsdelivr.net/gh/${GH_REPO}@${GH_BRANCH}/${rel}`;
    }
    if (image) {
      const safeName = (image.name || 'preview.png').replace(/[^a-zA-Z0-9_.-]/g,'_');
      const rel = `images/${brand}/${model}/${ts}-${safeName}`;
      await putFile(rel, image);
      imageUrl = `https://cdn.jsdelivr.net/gh/${GH_REPO}@${GH_BRANCH}/${rel}`;
    }

    return NextResponse.json({ ok: true, url, imageUrl }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
