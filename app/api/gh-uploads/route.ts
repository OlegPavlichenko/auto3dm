export const runtime = 'nodejs'; // нужен Node для Buffer/HTTP

function slug(s: string) {
  try {
    return (s || '')
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase();
  } catch { return 'x'; }
}

export async function GET() {
  // health-check: можно открыть /api/gh-upload в браузере, чтобы убедиться, что эндпоинт жив
  return new Response(JSON.stringify({ ok: true }), { headers: { 'content-type': 'application/json' } });
}

export async function POST(req: Request) {
  try {
    const repo = process.env.GH_REPO;       // "user/repo"
    const branch = process.env.GH_BRANCH || 'main';
    const token = process.env.GH_TOKEN;     // GitHub PAT с правом записи contents
    const dir = process.env.GH_DIR || 'models'; // корневая папка в репо

    if (!repo || !token) {
      return new Response(JSON.stringify({ error: 'Missing env GH_REPO or GH_TOKEN' }), { status: 500 });
    }

    const form = await req.formData();
    const file = form.get('file') as File | null;
    const brand = String(form.get('brand') || 'brand');
    const model = String(form.get('model') || 'model');

    if (!file) {
      return new Response(JSON.stringify({ error: 'file field is required' }), { status: 400 });
    }

    const arrayBuf = await file.arrayBuffer();
    const base64 = Buffer.from(arrayBuf).toString('base64');

    const baseName = (file.name || 'model.glb').replace(/[^a-zA-Z0-9_.-]/g, '_');
    const relPath = `${dir}/${slug(brand)}/${slug(model)}/${Date.now()}-${baseName}`;

    const apiUrl = `https://api.github.com/repos/${repo}/contents/${encodeURIComponent(relPath)}`;

    const gh = await fetch(apiUrl, {
      method: 'PUT',
      headers: {
        Authorization: `token ${token}`,
        'Content-Type': 'application/json',
        'User-Agent': 'auto3d-uploader'
      },
      body: JSON.stringify({
        message: `Upload ${baseName}`,
        content: base64,
        branch
      })
    });

    const json = await gh.json();

    if (!gh.ok) {
      return new Response(JSON.stringify({ error: json?.message || 'GitHub upload failed', details: json }), { status: 500 });
    }

    // Публичная CDN-ссылка (репо должен быть PUBLIC)
    const cdn = `https://cdn.jsdelivr.net/gh/${repo}@${branch}/${relPath}`;
    return Response.json({ url: cdn, path: relPath });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || String(e) }), { status: 500 });
  }
}
