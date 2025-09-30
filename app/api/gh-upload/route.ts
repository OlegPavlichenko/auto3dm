import { NextResponse } from "next/server";
export const runtime = "nodejs";

const GH_TOKEN  = process.env.GH_TOKEN  || "";
const GH_REPO   = process.env.GH_REPO   || "";
const GH_BRANCH = process.env.GH_BRANCH || "main";

const json = (d:any, s=200)=> NextResponse.json(d,{status:s});

export async function GET(req: Request) {
  const url = new URL(req.url);
  if (url.searchParams.get("ping")) {
    if (!GH_TOKEN || !GH_REPO) return json({ ok:false, error:"Missing GH_TOKEN or GH_REPO env" }, 500);
    const who  = await fetch("https://api.github.com/user", { headers:{ Authorization:`Bearer ${GH_TOKEN}`, "User-Agent":"auto3dm" }});
    const repo = await fetch(`https://api.github.com/repos/${GH_REPO}`, { headers:{ Authorization:`Bearer ${GH_TOKEN}`, "User-Agent":"auto3dm" }});
    let perms:any=null; try { if (repo.ok) perms = await repo.json(); } catch {}
    return json({ ok: who.ok && repo.ok, who: who.status, repo: repo.status, permissions: perms?.permissions ?? null, branch: GH_BRANCH },
                who.ok && repo.ok ? 200 : 401);
  }
  return json({ ok:true, endpoint:"POST a file to /api/gh-upload" });
}

export async function POST(req: Request) {
  if (!GH_TOKEN || !GH_REPO) return json({ ok:false, error:"Missing GH_TOKEN or GH_REPO env" }, 500);
  let form: FormData;
  try {
    form = await req.formData();
  } catch (e:any) {
    // Слишком большой body падал раньше без понятного текста
    return json({ ok:false, error:`Cannot read form-data (size too big?) ${e?.message||e}` }, 400);
  }
  const file = form.get("file") as File | null;
  const brand = String(form.get("brand") || "brand");
  const model = String(form.get("model") || "model");
  if (!file) return json({ ok:false, error:"No file" }, 400);
  if (!/\.glb$/i.test(file.name)) return json({ ok:false, error:"Only .glb allowed" }, 400);

  const slug = (v:string)=>(v||"").normalize("NFKD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-zA-Z0-9]+/g,"-").replace(/^-+|-+$/g,"").toLowerCase()||"x";
  const safe = (n:string)=>(n||"model.glb").replace(/[^a-zA-Z0-9_.-]/g,"_");
  const relPath = `models/${slug(brand)}/${slug(model)}/${Date.now()}-${safe(file.name)}`;

  const buf = Buffer.from(await file.arrayBuffer());
  const contentB64 = buf.toString("base64");

  const gh = await fetch(`https://api.github.com/repos/${GH_REPO}/contents/${encodeURIComponent(relPath)}`, {
    method:"PUT",
    headers:{ Authorization:`Bearer ${GH_TOKEN}`, "User-Agent":"auto3dm", "Content-Type":"application/json" },
    body: JSON.stringify({ message:`upload via api: ${relPath}`, content: contentB64, branch: GH_BRANCH }),
  });

  const txt = await gh.text(); // читаем всегда, чтобы видеть текст ошибки
  if (!gh.ok) return json({ ok:false, error:`GitHub PUT ${gh.status}: ${txt}` }, gh.status === 401 ? 401 : 500);

  let commitSha:string|null=null;
  try { const j = JSON.parse(txt); commitSha = j?.commit?.sha || null; } catch {}
  const url = commitSha
    ? `https://cdn.jsdelivr.net/gh/${GH_REPO}@${commitSha}/${relPath}`
    : `https://cdn.jsdelivr.net/gh/${GH_REPO}@${GH_BRANCH}/${relPath}`;

  return json({ ok:true, path: relPath, url, commit: commitSha });
}
