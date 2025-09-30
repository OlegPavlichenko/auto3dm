// app/api/gh-upload/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs"; // нужен Buffer для base64

const GH_TOKEN  = process.env.GH_TOKEN || "";
const GH_REPO   = process.env.GH_REPO  || "";  // пример: "OlegPavlichenko/auto3dm"
const GH_BRANCH = process.env.GH_BRANCH || "main";

function json(data: any, status = 200) {
  return NextResponse.json(data, { status });
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  // Пинг: /api/gh-upload?ping=1
  if (url.searchParams.get("ping")) {
    if (!GH_TOKEN || !GH_REPO) {
      return json({ ok: false, error: "Missing GH_TOKEN or GH_REPO env" }, 500);
    }
    // Проверим токен и доступ к репо
    const who = await fetch("https://api.github.com/user", {
      headers: { Authorization: `Bearer ${GH_TOKEN}`, "User-Agent": "auto3dm" },
    });
    const repo = await fetch(`https://api.github.com/repos/${GH_REPO}`, {
      headers: { Authorization: `Bearer ${GH_TOKEN}`, "User-Agent": "auto3dm" },
    });
    const whoOk  = who.status === 200;
    const repoOk = repo.status === 200;
    let perms: any = null;
    try { if (repoOk) perms = await repo.json(); } catch {}
    return json({
      ok: whoOk && repoOk,
      who: who.status,
      repo: repo.status,
      permissions: perms?.permissions ?? null,
      branch: GH_BRANCH,
    }, whoOk && repoOk ? 200 : 401);
  }
  // иначе просто скажем, что эндпоинт жив
  return json({ ok: true, endpoint: "POST a file to /api/gh-upload" });
}

export async function POST(req: Request) {
  if (!GH_TOKEN || !GH_REPO) {
    return json({ ok: false, error: "Missing GH_TOKEN or GH_REPO env" }, 500);
  }

  const form = await req.formData();
  const file = form.get("file") as File | null;
  const brand = String(form.get("brand") || "brand");
  const model = String(form.get("model") || "model");

  if (!file) return json({ ok: false, error: "No file field 'file'" }, 400);
  if (!/\.glb$/i.test(file.name)) return json({ ok: false, error: "Only .glb allowed here" }, 400);

  // красивые пути: brand/model/<timestamp>-filename.glb
  const slug = (v: string) =>
    (v || "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase() || "x";
  const safeName = (n: string) => (n || "model.glb").replace(/[^a-zA-Z0-9_.-]/g, "_");

  const relPath = `models/${slug(brand)}/${slug(model)}/${Date.now()}-${safeName(file.name)}`;

  const buf = Buffer.from(await file.arrayBuffer());
  const contentB64 = buf.toString("base64");

  // GitHub Contents API: PUT /repos/{owner}/{repo}/contents/{path}
  const ghRes = await fetch(`https://api.github.com/repos/${GH_REPO}/contents/${encodeURIComponent(relPath)}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${GH_TOKEN}`,
      "User-Agent": "auto3dm",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message: `upload via api: ${relPath}`,
      content: contentB64,
      branch: GH_BRANCH,
    }),
  });

  if (!ghRes.ok) {
    const txt = await ghRes.text();
    return json({ ok: false, error: `GitHub PUT ${ghRes.status}: ${txt}` }, 500);
  }

  const data = await ghRes.json();
  const commitSha: string | undefined = data?.commit?.sha;
  // CDN ссылка: либо привязка к ветке, либо к коммиту
  const cdn = commitSha
    ? `https://cdn.jsdelivr.net/gh/${GH_REPO}@${commitSha}/${relPath}`
    : `https://cdn.jsdelivr.net/gh/${GH_REPO}@${GH_BRANCH}/${relPath}`;

  return json({ ok: true, path: relPath, url: cdn, commit: commitSha || null });
}
