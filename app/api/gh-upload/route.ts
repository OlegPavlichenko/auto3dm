// app/api/gh-upload/route.ts
import { NextResponse } from 'next/server';

export const runtime = 'nodejs'; // Нужен Node.js (Buffer, multipart)

const token  = (process.env.GH_TOKEN  || '').trim();         // PAT
const repo   = (process.env.GH_REPO   || '').trim();         // "user/repo"
const branch = (process.env.GH_BRANCH || 'main').trim();     // "main" по умолчанию

function requireHeaders() {
  if (!token) throw new Error('Missing GH_TOKEN');
  return {
    'Accept': 'application/vnd.github+json',
    'Authorization': `token ${token}`,       // ВАЖНО: именно "token", не "Bearer"
    'User-Agent': 'auto3d-uploader',
  };
}

function slug(v: string): string {
  try {
    return (v || '')
      .toString()
      .normalize('NFKD')
      .replace(/[\u0300-\u036F]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase();
  } catch { return 'x'; }
}
function safeFileName(name: string): string {
  return (name || 'file.bin').replace(/[^a-zA-Z0-9_.-]/g, '_');
}

// PUT /repos/:owner/:repo/contents/:path
async function githubPutContent(relPath: string, contentBase64: string, message: string) {
  const apiUrl = `https://api.github.com/repos/${repo}/contents/${relPath}`; // relPath уже безопасен
  const body = JSON.stringify({ message, content: contentBase64, branch });
  const res  = await fetch(apiUrl, { method: 'PUT', headers: requireHeaders(), body });
  const txt  = await res.text();
  let data: any = undefined; try { data = JSON.parse(txt); } catch {}
  if (!res.ok) {
    const msg = data?.message || txt || res.statusText;
    throw new Error(`GitHub PUT ${res.status}: ${msg}`);
  }
  return data; // data.content.path, data.commit.sha
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  if (searchParams.get('ping') === '1') {
    return NextResponse.json({
      ok: !!(token && repo),
      repo,
      branch,
      auth: token ? 'present' : 'missing',
    });
  }
  return NextResponse.json({ ok: true });
}

export async function POST(req: Request) {
  try {
    if (!token || !repo) {
      return NextResponse.json({ error: 'Missing GH_TOKEN or GH_REPO env' }, { status: 500 });
    }

    const fd = await req.formData();
    const brand = (fd.get('brand') as string) || 'brand';
    const model = (fd.get('model') as string) || 'model';

    const baseDir = `${slug(brand)}/${slug(model)}/${Date.now()}`;

    // optional image
    let imageUrl: string | undefined;
    const imgFile = fd.get('image') as File | null;
    if (imgFile && imgFile.size > 0) {
      const name = safeFileName(imgFile.name || 'preview.png');
      const rel  = `${baseDir}/${name}`;
      const b64  = Buffer.from(await imgFile.arrayBuffer()).toString('base64');
      const out  = await githubPutContent(rel, b64, `upload image ${name}`);
      const sha  = out?.commit?.sha || branch;
      imageUrl   = `https://cdn.jsdelivr.net/gh/${repo}@${sha}/${rel}`;
    }

    // optional downloadable file
    let url: string | undefined;
    const anyFile = fd.get('file') as File | null;
    if (anyFile && anyFile.size > 0) {
      const name = safeFileName(anyFile.name || 'model.glb');
      const rel  = `${baseDir}/${name}`;
      const b64  = Buffer.from(await anyFile.arrayBuffer()).toString('base64');
      const out  = await githubPutContent(rel, b64, `upload file ${name}`);
      const sha  = out?.commit?.sha || branch;
      url        = `https://cdn.jsdelivr.net/gh/${repo}@${sha}/${rel}`;
    }

    if (!imageUrl && !url) {
      return NextResponse.json({ error: 'No files received. Send field "image" and/or "file".' }, { status: 400 });
    }

    // на всякий случай вернём и raw-ссылки
    const toRaw = (cdn?: string) =>
      cdn ? cdn.replace('https://cdn.jsdelivr.net/gh/', 'https://raw.githubusercontent.com/').replace(/@[^/]+/, `/${branch}`) : undefined;

    return NextResponse.json({
      ok: true,
      repo, branch,
      imageUrl,
      url,
      rawImageUrl: toRaw(imageUrl),
      rawUrl: toRaw(url),
    });
  } catch (e: any) {
    const msg = e?.message || String(e);
    console.error('[gh-upload] error:', msg);
    const isAuth = /401|credentials|Bad credentials/i.test(msg);
    return NextResponse.json({ error: msg }, { status: isAuth ? 401 : 500 });
  }
}
