'use client';
import React, { useEffect, useMemo, useRef, useState } from "react";

/**
 * Auto3D — Free‑tier Starter (React/Next compatible)
 * --------------------------------------------------
 * Root‑cause addressed: `THREE.GLTFLoader: Couldn't load texture`.
 *
 * What changed (safe fixes):
 * 1) Kept <model-viewer>, but wrapped it in SafeModelViewer to catch load errors and show clear UI.
 * 2) Normalizes Google Drive / Dropbox links to direct file URLs (common cause of texture 404 via redirects).
 * 3) Uses known‑good sample GLBs (embedded textures) to avoid flaky demos.
 * 4) Adds extension guard: if user passes OBJ/STL, we show guidance instead of letting it fail.
 * 5) Adds more test cases (OK, external textures .gltf, broken share links, unsupported formats) without changing existing tests.
 *
 * Notes:
 * - Prefer **.glb** (glTF‑Binary) with embedded textures to avoid cross‑file texture fetches.
 * - If you must use .gltf with external textures, ensure CORS‑accessible paths.
 */

// --- Inject <model-viewer> script only on client ---
function useModelViewerScript() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    const id = "model-viewer-script";
    if (document.getElementById(id)) return;
    const s = document.createElement("script");
    s.id = id;
    s.type = "module";
    s.src = "https://unpkg.com/@google/model-viewer/dist/model-viewer.min.js";
    document.head.appendChild(s);
  }, []);
}

// --- Known good demo GLBs (textures embedded; CORS‑safe) ---
const SAMPLE_DUCK =
  "https://rawcdn.githack.com/KhronosGroup/glTF-Sample-Models/master/2.0/Duck/glTF-Binary/Duck.glb";
const SAMPLE_HELMET =
  "https://rawcdn.githack.com/KhronosGroup/glTF-Sample-Models/master/2.0/DamagedHelmet/glTF-Binary/DamagedHelmet.glb";
const SAMPLE_HELMET_GLTF_EXT =
  "https://rawcdn.githack.com/KhronosGroup/glTF-Sample-Models/master/2.0/DamagedHelmet/glTF/DamagedHelmet.gltf"; // external textures

// Use the simple Duck as the default demo (tiny and reliable)
const DEMO_SRC_OK = SAMPLE_DUCK;

// --- Inline poster SVG (no external request) ---
const POSTER_SVG =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(`<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns='http://www.w3.org/2000/svg' width='800' height='450'>\n  <rect fill='#f3f4f6' width='100%' height='100%'/>\n  <g fill='#6b7280' font-family='Arial,sans-serif' font-size='22'>\n    <text x='50%' y='50%' dominant-baseline='middle' text-anchor='middle'>Загрузка 3D…</text>\n  </g>\n</svg>`);

// --- Helpers to normalize common sharing links to direct file links ---
function toDirectLink(url: string): string {
  if (!url) return url;
  // Google Drive: https://drive.google.com/file/d/FILE_ID/view?usp=sharing
  const g = url.match(/drive\.google\.com\/file\/d\/([^/]+)/);
  if (g && g[1]) return `https://drive.google.com/uc?export=download&id=${g[1]}`;

  // Dropbox: https://www.dropbox.com/s/xyz/file.glb?dl=0 -> dl=1 for direct
  if (url.includes("dropbox.com")) return url.replace(/\?dl=0$/, "?dl=1");

  return url;
}

function getExt(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname;
    const m = path.match(/\.([a-z0-9]+)$/i);
    return (m?.[1] || "").toLowerCase();
  } catch {
    const m = url.match(/\.([a-z0-9]+)(?:\?|#|$)/i);
    return (m?.[1] || "").toLowerCase();
  }
}

// --- Types ---
export type Item = {
  id: string;
  brand: string; // e.g., "Kia"
  model: string; // e.g., "Carnival"
  title: string;
  subsystem: string; // interior, body, etc.
  src: string; // Prefer GLB
  download: string; // direct link to file
  image?: string; // optional thumbnail
};

// --- Safe wrapper for <model-viewer> with error & loading states ---
function SafeModelViewer({ src, alt, poster }: { src: string; alt: string; poster?: string }) {
  const ref = useRef<any>(null);
  const [status, setStatus] = useState<"loading" | "ok" | "error" | "unsupported">("loading");
  const normalizedSrc = toDirectLink(src);
  const ext = getExt(normalizedSrc);

  // Guard unsupported formats early to avoid confusing loader errors
  useEffect(() => {
    if (!ext) return; // unknown — let viewer try
    const ok = ext === "glb" || ext === "gltf"; // <model-viewer> supports glTF 2.0; prefer .glb
    if (!ok) setStatus("unsupported");
  }, [ext]);

  useEffect(() => {
    if (status === "unsupported") return;
    const el = ref.current as HTMLElement | null;
    if (!el) return;

    const onLoad = () => setStatus("ok");
    const onError = (ev: any) => {
      console.error("<model-viewer> error:", ev?.detail || ev);
      setStatus("error");
    };

    el.addEventListener("load", onLoad as EventListener);
    el.addEventListener("error", onError as EventListener);
    return () => {
      el.removeEventListener("load", onLoad as EventListener);
      el.removeEventListener("error", onError as EventListener);
    };
  }, [normalizedSrc, status]);

  const debugInfo = {
    src,
    normalizedSrc,
    ext,
  } as const;

  const copyDebug = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(debugInfo, null, 2));
    } catch {}
  };

  return (
    <div className="relative w-full h-full">
      {status === "loading" && (
        <div className="absolute inset-0 grid place-items-center text-sm text-gray-500 select-none">Загрузка…</div>
      )}

      {status === "unsupported" && (
        <div className="absolute inset-0 grid place-items-center p-4 text-center bg-white/80 text-orange-700">
          <div className="max-w-sm">
            <div className="font-semibold mb-1">Формат не поддерживается: .{ext || "unknown"}</div>
            <div className="text-xs text-gray-700">
              Используйте <b>.glb</b> (glTF‑Binary) или <b>.gltf</b>. Если у вас STL/OBJ — конвертируйте в GLB
              (например, Blender/Online конвертеры). Текстуры желательно <b>встроить</b> в GLB.
            </div>
            <button onClick={copyDebug} className="mt-2 px-2 py-1 border rounded text-xs">Скопировать debug</button>
          </div>
        </div>
      )}

      {status === "error" && (
        <div className="absolute inset-0 grid place-items-center p-4 text-center bg-white/70 text-red-600">
          <div className="max-w-sm">
            <div className="font-semibold mb-1">Не удалось загрузить модель/текстуры</div>
            <div className="text-xs text-gray-700">
              Проверьте, что GLB имеет <b>встроенные текстуры</b> и ссылка общедоступна (без авторизации/редиректов).<br/>
              Google Drive: формат <code>https://drive.google.com/uc?export=download&id=…</code>.<br/>
              Dropbox: добавьте <code>?dl=1</code>.
            </div>
            <button onClick={copyDebug} className="mt-2 px-2 py-1 border rounded text-xs">Скопировать debug</button>
          </div>
        </div>
      )}

      {/* @ts-ignore - web component */}
      <model-viewer
        ref={ref}
        src={normalizedSrc}
        alt={alt}
        camera-controls
        auto-rotate
        exposure="1.0"
        reveal="auto"
        poster={poster || POSTER_SVG}
        style={{ width: "100%", height: "100%" }}
      />
    </div>
  );
}

// --- Demo catalog (replace src + download with your links) ---
const initialItems: Item[] = [
  {
    id: "kia-carnival-cupholder",
    brand: "Kia",
    model: "Carnival",
    title: "Cupholder insert (demo)",
    subsystem: "interior",
    src: DEMO_SRC_OK,
    download: SAMPLE_DUCK,
  },
  {
    id: "toyota-bb-hook",
    brand: "Toyota",
    model: "bB",
    title: "Cargo hook (demo)",
    subsystem: "interior",
    src: DEMO_SRC_OK,
    download: SAMPLE_DUCK,
  },
  {
    id: "vw-golf3-vent",
    brand: "Volkswagen",
    model: "Golf 3",
    title: "Vent clip mount (demo)",
    subsystem: "interior",
    src: DEMO_SRC_OK,
    download: SAMPLE_DUCK,
  },
];

// --- Existing tests (unchanged) + More tests ---
const TEST_ITEMS: Item[] = [
  // Existing OK tests (embedded textures)
  {
    id: "test-ok-duck",
    brand: "TEST",
    model: "Embedded",
    title: "TEST: Embedded textures (Duck.glb)",
    subsystem: "test",
    src: SAMPLE_DUCK,
    download: SAMPLE_DUCK,
  },
  {
    id: "test-ok-helmet",
    brand: "TEST",
    model: "Embedded",
    title: "TEST: Embedded textures (DamagedHelmet.glb)",
    subsystem: "test",
    src: SAMPLE_HELMET,
    download: SAMPLE_HELMET,
  },
  // Existing broken test (keep)
  {
    id: "test-broken-url",
    brand: "TEST",
    model: "Broken",
    title: "TEST: Broken URL (expect error overlay)",
    subsystem: "test",
    src: "https://example.com/notfound.glb", // intentionally broken to verify error handling
    download: "#",
  },
  // NEW: Valid .gltf with external textures (should work)
  {
    id: "test-ok-helmet-gltf-external",
    brand: "TEST",
    model: "ExternalTex",
    title: "TEST: GLTF with external textures (should load)",
    subsystem: "test",
    src: SAMPLE_HELMET_GLTF_EXT,
    download: SAMPLE_HELMET_GLTF_EXT,
  },
  // NEW: Google Drive share‑link shape (likely to error if ID invalid) — tests link normalizer + error UI
  {
    id: "test-drive-share-shape",
    brand: "TEST",
    model: "DriveShare",
    title: "TEST: Google Drive share link (expect error or success if file exists)",
    subsystem: "test",
    src: "https://drive.google.com/file/d/THIS_IS_FAKE_ID/view?usp=sharing",
    download: "https://drive.google.com/file/d/THIS_IS_FAKE_ID/view?usp=sharing",
  },
  // NEW: Dropbox dl=0 share link — normalizer flips to dl=1; with fake path it should error and show overlay
  {
    id: "test-dropbox-dl0",
    brand: "TEST",
    model: "DropboxShare",
    title: "TEST: Dropbox share link dl=0 (expect normalized + error)",
    subsystem: "test",
    src: "https://www.dropbox.com/s/fakehash/file.glb?dl=0",
    download: "https://www.dropbox.com/s/fakehash/file.glb?dl=0",
  },
  // NEW: Unsupported format (STL) — should show "unsupported" message, not crash
  {
    id: "test-unsupported-stl",
    brand: "TEST",
    model: "Unsupported",
    title: "TEST: Unsupported STL (expect guidance)",
    subsystem: "test",
    src: "https://rawcdn.githack.com/alecjacobson/common-3d-test-models/master/data/bunny.stl",
    download: "#",
  },
];

export default function Auto3DStarter() {
  useModelViewerScript();

  const [q, setQ] = useState("");
  const [brand, setBrand] = useState("");
  const [model, setModel] = useState("");
  const [subsystem, setSubsystem] = useState("");
  const [showTests, setShowTests] = useState(false);

  const catalog = useMemo(() => (showTests ? [...initialItems, ...TEST_ITEMS] : initialItems), [showTests]);

  const brands = useMemo(() => Array.from(new Set(catalog.map((i) => i.brand))).sort(), [catalog]);
  const models = useMemo(
    () =>
      Array.from(new Set(catalog.filter((i) => !brand || i.brand === brand).map((i) => i.model))).sort(),
    [brand, catalog],
  );
  const subsystems = useMemo(() => Array.from(new Set(catalog.map((i) => i.subsystem))).sort(), [catalog]);

  const items = useMemo(() => {
    return catalog.filter((i) => {
      const matchQ =
        !q ||
        i.title.toLowerCase().includes(q.toLowerCase()) ||
        i.brand.toLowerCase().includes(q.toLowerCase()) ||
        i.model.toLowerCase().includes(q.toLowerCase());
      const matchBrand = !brand || i.brand === brand;
      const matchModel = !model || i.model === model;
      const matchSubsystem = !subsystem || i.subsystem === subsystem;
      return matchQ && matchBrand && matchModel && matchSubsystem;
    });
  }, [q, brand, model, subsystem, catalog]);

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="sticky top-0 z-10 backdrop-blur bg-white/70 border-b">
        <div className="max-w-6xl mx-auto px-4 py-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <h1 className="text-2xl font-bold tracking-tight">
            Auto3D <span className="text-gray-500 text-base">free‑tier demo</span>
          </h1>
          <div className="flex flex-wrap gap-2 items-center">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Поиск: Kia, Golf 3, cupholder..."
              className="px-3 py-2 rounded-xl border w-64 focus:outline-none focus:ring"
            />
            <select
              value={brand}
              onChange={(e) => {
                setBrand(e.target.value);
                setModel("");
              }}
              className="px-3 py-2 rounded-xl border"
            >
              <option value="">Марка</option>
              {brands.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
            <select value={model} onChange={(e) => setModel(e.target.value)} className="px-3 py-2 rounded-xl border">
              <option value="">Модель</option>
              {models.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            <select value={subsystem} onChange={(e) => setSubsystem(e.target.value)} className="px-3 py-2 rounded-xl border">
              <option value="">Узел</option>
              {subsystems.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <button
              onClick={() => {
                setQ("");
                setBrand("");
                setModel("");
                setSubsystem("");
              }}
              className="px-3 py-2 rounded-xl border bg-white hover:bg-gray-100"
            >
              Сброс
            </button>
            {/* Debug / Tests toggle */}
            <label className="ml-2 inline-flex items-center gap-2 text-xs text-gray-600">
              <input type="checkbox" checked={showTests} onChange={(e) => setShowTests(e.target.checked)} />
              Показать тест‑карточки
            </label>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6">
        <p className="text-gray-600 mb-4">
          Замените ссылки <code>src</code>/<code>download</code> на ваши файлы (Google Drive/Dropbox/Supabase). Лучше использовать
          <strong> GLB</strong>. Если используете Google Drive, можно вставлять обычную ссылку «Поделиться» — код попытается
          преобразовать её в прямую. Для OBJ/STL система подскажет конвертацию вместо падения.
        </p>

        {items.length === 0 ? (
          <div className="p-6 rounded-2xl bg-white border shadow-sm">Ничего не найдено. Попробуйте изменить фильтры.</div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {items.map((i) => (
              <article key={i.id} className="bg-white rounded-2xl border shadow-sm overflow-hidden hover:shadow-md transition">
                <div className="aspect-video bg-gray-100 flex items-center justify-center">
                  <SafeModelViewer src={i.src} alt={i.title} poster={POSTER_SVG} />
                </div>
                <div className="p-4">
                  <div className="text-sm text-gray-500">
                    {i.brand} • {i.model} • {i.subsystem}
                  </div>
                  <h3 className="text-lg font-semibold mt-1">{i.title}</h3>
                  <div className="mt-3 flex gap-2">
                    <a
                      href={toDirectLink(i.download)}
                      className="px-3 py-2 rounded-xl bg-black text-white text-sm"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Скачать
                    </a>
                    <button
                      onClick={() => navigator.clipboard.writeText(window.location.href + "#" + i.id)}
                      className="px-3 py-2 rounded-xl border text-sm"
                    >
                      Поделиться
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </main>

      <footer className="max-w-6xl mx-auto px-4 py-10 text-sm text-gray-500">
        <div className="border-t pt-6 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div>© {new Date().getFullYear()} Auto3D — демо на фри‑тарифах</div>
          <div className="flex gap-3">
            <a className="underline" href="https://vercel.com/">Vercel</a>
            <a className="underline" href="https://supabase.com/">Supabase</a>
            <a className="underline" href="https://modelviewer.dev/">model‑viewer</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
