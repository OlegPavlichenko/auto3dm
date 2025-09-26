// app/api/gh-upload/route.ts
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";         // ВАЖНО: не edge, чтобы env + Buffer работали
export const dynamic = "force-dynamic";  // чтобы не кэшировался ping и разные аплоады

const GH_TOKEN  = (process.env.GH_TOKEN  || '').trim();
const GH_REPO   = (process.env.GH_REPO   || '').trim();
const GH_BRANCH = (process.env.GH_BRANCH || 'main').trim();

function authHeader(token: string) {
  // fine-grained токены начинаются с "github_pat_", для них надёжнее Bearer
  return token.startsWith("github_pat_") ? `Bearer ${token}` : `token ${token}`;
}

function badEnv() {
  return !GH_TOKEN || !GH_REPO;
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  if (url.searchParams.has("ping")) {
    if (badEnv()) {
      return NextResponse.json(
        { ok: false, error: "Missing GH_TOKEN or GH_REPO env" },
        { status: 500 }
      );
    }
    const hdrs = {
      Authorization: authHeader(GH_TOKEN),
      "User-Agent": "auto3dm",
      Accept: "application/vnd.github+json",
    };

    const whoResp = await fetch("https://api.github.com/user", { headers: hdrs });
    const who = await whoResp.json().catch(() => ({}));

    const repoResp = await fetch(`https://api.github.com/repos/${GH_REPO}`, { headers: hdrs });
    const repo = await repoResp.json().catch(() => ({}));

    return NextResponse.json({
      ok: whoResp.ok && repoResp.ok,
      whoami: who?.login || null,
      repo: repo?.full_name || null,
      permissions: repo?.permissions || null,
      status: { who: whoResp.status, repo: repoResp.status },
      branch: GH_BRANCH,
    });
  }
  return NextResponse.json({ ok: true });
}

export async function POST(req: NextRequest) {
  try {
    if (badEnv()) {
      return NextResponse.json(
        { error: "Missing GH_TOKEN or GH_REPO env" },
        { status: 500 }
      );
    }

    const form = await req.formData();
    const file  = form.get("file") as File | null;
    const brand = String(form.get("brand") || "brand");
    const model = String(form.get("model") || "model");

    if (!file) {
      return NextResponse.json({ error: "No file" }, { status: 400 });
    }

    // ограничения и подготовка
    const sizeMb = file.size / (1024 * 1024);
    if (sizeMb > 75) {
      return NextResponse.json(
        { error: `File too large: ${sizeMb.toFixed(1)} MB (> 75 MB)` },
        { status: 400 }
      );
    }

    const buf = Buffer.from(await file.arrayBuffer());
    const contentB64 = buf.toString("base64");

    const slug = (v: string) =>
      (v || "")
        .toLowerCase()
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "") || "x";

    const safeFileName = (name: string) =>
      (name || "model.glb").replace(/[^a-zA-Z0-9_.-]/g, "_");

    const path =
      `uploads/${slug(brand)}/${slug(model)}/${Date.now()}-${safeFileName(file.name)}`;

    // GitHub Contents API
    const ghUrl = `https://api.github.com/repos/${GH_REPO}/contents/${encodeURIComponent(path)}`;
    const resp = await fetch(ghUrl, {
      method: "PUT",
      headers: {
        Authorization: authHeader(GH_TOKEN),
        "User-Agent": "auto3dm",
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: `upload ${path}`,
        content: contentB64,
        branch: GH_BRANCH,
      }),
    });

    const json = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      return NextResponse.json(
        { error: `GitHub PUT ${resp.status}: ${json?.message || resp.statusText}`, details: json },
        { status: 500 }
      );
    }

    // готовая CDN-ссылка
    const url = `https://cdn.jsdelivr.net/gh/${GH_REPO}@${GH_BRANCH}/${path}`;
    return NextResponse.json({ ok: true, url, path, sha: json?.content?.sha || null });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}
