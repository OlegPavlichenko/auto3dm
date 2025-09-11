'use client';
import React, { useEffect, useMemo, useRef, useState } from "react";

/**
 * Auto3D — Free‑tier Starter (React/Next compatible)
 * --------------------------------------------------
 * Fix: Handle <model-viewer> init & CORS more robustly to avoid generic
 * "<model-viewer> error" and GLTF texture load issues.
 *
 * Changes:
 * 1) Wait for custom element to be defined before rendering (<model-viewer> ready gate).
 * 2) Keep SafeModelViewer: hides viewer on error/unsupported and shows poster (your chosen UX).
 * 3) Normalize Google Drive / Dropbox share links to direct URLs.
 * 4) Add crossorigin="anonymous" for external textures and stricter extension checks.
 * 5) Keep all existing tests and add a few extra edge-case tests (querystring, Dropbox dl=1).
 *
 * Notes:
 * - Prefer .glb (glTF‑Binary) with embedded textures.
 * - If using .gltf with external textures, ensure CORS and correct relative paths.
 */

// Allow using the web component in TSX without a separate .d.ts file
declare global {
  namespace JSX {
    interface IntrinsicElements {
      'model-viewer': any;
    }
  }
}

// --- Hook: inject <model-viewer> & report readiness ---
function useModelViewerReady() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;

    // inject script once
    const id = 'model-viewer-script';
    if (!document.getElementById(id)) {
      const s = document.createElement('script');
      s.id = id;
      s.type = 'module';
      s.src = 'https://unpkg.com/@google/model-viewer/dist/model-viewer.min.js';
      document.head.appendChild(s);
      s.addEventListener('error', () => {
        // script failed — we won't mark ready, posters will remain visible
        // (useful in extremely restrictive CSP environments)
        console.error('Failed to load model-viewer script');
      });
    }

    // poll until custom element is defined
    let tries = 0;
    const tm = setInterval(() => {
      tries += 1;
      if ((window as any).customElements && (window as any).customElements.get('model-viewer')) {
        setReady(true);
        clearInterval(tm);
      } else if (tries > 200) { // ~10s
        clearInterval(tm);
        console.warn('model-viewer did not register in time; showing posters only.');
      }
    }, 50);

    return () => clearInterval(tm);
  }, []);
  return ready;
}

// --- Known good demo GLBs (textures embedded; CORS‑safe) ---
const SAMPLE_DUCK =
  'https://rawcdn.githack.com/KhronosGroup/glTF-Sample-Models/master/2.0/Duck/glTF-Binary/Duck.glb';
const SAMPLE_HELMET =
  'https://rawcdn.githack.com/KhronosGroup/glTF-Sample-Models/master/2.0/DamagedHelmet/glTF-Binary/DamagedHelmet.glb';
const SAMPLE_HELMET_GLTF_EXT =
  'https://rawcdn.githack.com/KhronosGroup/glTF-Sample-Models/master/2.0/DamagedHelmet/glTF/DamagedHelmet.gltf'; // external textures

// Use the simple Duck as the default demo (tiny and reliable)
const DEMO_SRC_OK = SAMPLE_DUCK;

// --- Inline poster SVG (no external request) ---
const POSTER_SVG =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(`<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns='http://www.w3.org/2000/svg' width='800' height='450'>\n  <rect fill='#f3f4f6' width='100%' height='100%'/>\n  <g fill='#6b7280' font-family='Arial,sans-serif' font-size='22'>\n    <text x='50%' y='50%' dominant-baseline='middle' text-anchor='middle'>Загрузка 3D…</text>\n  </g>\n</svg>`);

// --- Helpers to normalize common sharing links to direct file links ---
function toDirectLink(url: string): string {
  if (!url) return url;
  // Google Drive: https://drive.google.com/file/d/FILE_ID/view?usp=sharing
  const g = url.match(/drive\.google\.com\/file\/d\/([^/]+)/);
  if (g && g[1]) return `https://drive.google.com/uc?export=download&id=${g[1]}`;

  // Dropbox: https://www.dropbox.com/s/xyz/file.glb?dl=0 -> dl=1 for direct
  if (url.includes('dropbox.com')) return url.replace(/\?dl=0$/, '?dl=1');

  return url;
}

function getExt(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname;
    const m = path.match(/\.([a-z0-9]+)$/i);
    return (m?.[1] || '').toLowerCase();
  } catch {
    const m = url.match(/\.([a-z0-9]+)(?:\?|#|$)/i);
    return (m?.[1] || '').toLowerCase();
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

// --- Safe wrapper for <model-viewer> with readiness, error & loading states ---
function SafeModelViewer({ src, alt, poster }: { src: string; alt: string; poster?: string }) {
  const ref = useRef<any>(null);
  const mvReady = useModelViewerReady();
  const [status, setStatus] = useState<'idle' | 'loading' | 'ok' | 'error' | 'unsupported' | 'notready' | 'timeout'>('notready');
  const [loadToken, setLoadToken] = useState(0);

  const normalizedSrc = toDirectLink(src);
  const ext = getExt(normalizedSrc);

  // Unsupported formats → poster only
  useEffect(() => {
    if (!ext) return;
    const ok = ext === 'glb' || ext === 'gltf';
    if (!ok) setStatus('unsupported');
  }, [ext]);

  // Start/track loading only when component is registered
  useEffect(() => {
    if (!mvReady || status === 'unsupported') return;
    // kick a new load cycle whenever src changes and element is ready
    setStatus('loading');
    setLoadToken((t) => t + 1);
  }, [normalizedSrc, mvReady]);

  // Attach events; add a timeout fallback so we never hang in loading
  useEffect(() => {
    if (!mvReady || status === 'unsupported') return;
    const el = ref.current as HTMLElement | null;
    if (!el) return;

    let cancelled = false;

    const onLoad = () => {
      if (cancelled) return;
      setStatus('ok');
    };
    const onError = (ev: any) => {
      console.error('<model-viewer> error:', ev?.detail || ev);
      if (cancelled) return;
      setStatus('error');
    };

    el.addEventListener('load', onLoad as EventListener);
    el.addEventListener('error', onError as EventListener);

    // timeout guard (15s) → treat as error to avoid infinite "loading"
    const timeout = setTimeout(() => {
      if (cancelled) return;
      if (status === 'loading') setStatus('timeout');
    }, 15000);

    return () => {
      cancelled = true;
      clearTimeout(timeout);
      el.removeEventListener('load', onLoad as EventListener);
      el.removeEventListener('error', onError as EventListener);
    };
    // re-run when a new load cycle starts
  }, [mvReady, loadToken, status]);

  // Preferred UX: hide viewer and show poster for error/unsupported/notready/timeout;
  // poster also remains visible by model-viewer itself while loading.
  const showPosterOnly = status === 'error' || status === 'unsupported' || status === 'notready' || status === 'timeout';

  return (
    <div className="relative w-full h-full">
      {showPosterOnly && (
        <img
          src={poster || POSTER_SVG}
          alt={`${alt} (постер)`}
          className="absolute inset-0 w-full h-full object-contain"
        />
      )}

      {/* Render viewer when registered; its own poster handles the loading state */}
      {mvReady && (
        // @ts-ignore - web component
        <model-viewer
          ref={ref}
          src={normalizedSrc}
          alt={alt}
          camera-controls
          auto-rotate
          exposure="1.0"
          reveal="auto"
          crossorigin="anonymous"
          poster={poster || POSTER_SVG}
          style={{ width: '100%', height: '100%', display: showPosterOnly ? 'none' : 'block' }}
        />
      )}
    </div>
  );
}

// --- Demo catalog (replace src + download with your links) ---
const initialItems: Item[] = [
  {
    id: 'kia-carnival-cupholder',
    brand: 'Kia',
    model: 'Carnival',
    title: 'Cupholder insert (demo)',
    subsystem: 'interior',
    src: DEMO_SRC_OK,
    download: "https://drive.google.com/file/d/1_Qa0qlvg7Q1Itl_JiLKqBGMw7kPZPpCd/view?usp=drive_link",
  },
  {
    id: 'toyota-bb-hook',
    brand: 'Toyota',
    model: 'bB',
    title: 'Cargo hook (demo)',
    subsystem: 'interior',
    src: DEMO_SRC_OK,
    download: SAMPLE_DUCK,
  },
  {
    id: 'vw-golf3-vent',
    brand: 'Volkswagen',
    model: 'Golf 3',
    title: 'Vent clip mount (demo)',
    subsystem: 'interior',
    src: DEMO_SRC_OK,
    download: SAMPLE_DUCK,
  },
];

// --- Existing tests (kept) + Extra tests ---
const TEST_ITEMS: Item[] = [
  // Existing OK tests (embedded textures)
  {
    id: 'test-ok-duck',
    brand: 'TEST',
    model: 'Embedded',
    title: 'TEST: Embedded textures (Duck.glb)',
    subsystem: 'test',
    src: SAMPLE_DUCK,
    download: SAMPLE_DUCK,
  },
  {
    id: 'test-ok-helmet',
    brand: 'TEST',
    model: 'Embedded',
    title: 'TEST: Embedded textures (DamagedHelmet.glb)',
    subsystem: 'test',
    src: SAMPLE_HELMET,
    download: SAMPLE_HELMET,
  },
  // Existing broken test (keep)
  {
    id: 'test-broken-url',
    brand: 'TEST',
    model: 'Broken',
    title: 'TEST: Broken URL (poster only)',
    subsystem: 'test',
    src: 'https://example.com/notfound.glb', // intentionally broken
    download: '#',
  },
  // NEW: Valid .gltf with external textures (should work if CORS ok)
  {
    id: 'test-ok-helmet-gltf-external',
    brand: 'TEST',
    model: 'ExternalTex',
    title: 'TEST: GLTF with external textures (should load)',
    subsystem: 'test',
    src: SAMPLE_HELMET_GLTF_EXT,
    download: SAMPLE_HELMET_GLTF_EXT,
  },
  // NEW: Google Drive share‑link shape (tests normalizer; fake -> poster only)
  {
    id: 'test-drive-share-shape',
    brand: 'TEST',
    model: 'DriveShare',
    title: 'TEST: Google Drive share link (normalized; likely poster only)',
    subsystem: 'test',
    src: 'https://drive.google.com/file/d/THIS_IS_FAKE_ID/view?usp=sharing',
    download: 'https://drive.google.com/file/d/THIS_IS_FAKE_ID/view?usp=sharing',
  },
  // NEW: Dropbox dl=0 share link — normalizer flips to dl=1; fake -> poster only
  {
    id: 'test-dropbox-dl0',
    brand: 'TEST',
    model: 'DropboxShare',
    title: 'TEST: Dropbox share link dl=0 (normalized; poster only)',
    subsystem: 'test',
    src: 'https://www.dropbox.com/s/fakehash/file.glb?dl=0',
    download: 'https://www.dropbox.com/s/fakehash/file.glb?dl=0',
  },
  // NEW: Unsupported format (STL) — poster only + guidance
  {
    id: 'test-unsupported-stl',
    brand: 'TEST',
    model: 'Unsupported',
    title: 'TEST: Unsupported STL (poster only)',
    subsystem: 'test',
    src: 'https://rawcdn.githack.com/alecjacobson/common-3d-test-models/master/data/bunny.stl',
    download: '#',
  },
  // NEW: Querystring ext — ensure we still detect .glb correctly
  {
    id: 'test-ok-duck-query',
    brand: 'TEST',
    model: 'QueryExt',
    title: 'TEST: Duck.glb?raw=1 (should load)',
    subsystem: 'test',
    src: SAMPLE_DUCK + '?raw=1',
    download: SAMPLE_DUCK + '?raw=1',
  },
  // NEW: Dropbox dl=1 (direct) — still fake path so poster only, but normalizer not needed
  {
    id: 'test-dropbox-dl1',
    brand: 'TEST',
    model: 'DropboxDirect',
    title: 'TEST: Dropbox share link dl=1 (poster only; fake path)',
    subsystem: 'test',
    src: 'https://www.dropbox.com/s/fakehash/file.glb?dl=1',
    download: 'https://www.dropbox.com/s/fakehash/file.glb?dl=1',
  },
];

export default function Auto3DStarter() {
  const [q, setQ] = useState('');
  const [brand, setBrand] = useState('');
  const [model, setModel] = useState('');
  const [subsystem, setSubsystem] = useState('');
  const [showTests, setShowTests] = useState(false);

  const catalog = useMemo(() => (showTests ? [...initialItems, ...TEST_ITEMS] : initialItems), [showTests]);

  const brands = useMemo(() => Array.from(new Set(catalog.map((i) => i.brand))).sort(), [catalog]);
  const models = useMemo(
    () => Array.from(new Set(catalog.filter((i) => !brand || i.brand === brand).map((i) => i.model))).sort(),
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
                setModel('');
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
                setQ('');
                setBrand('');
                setModel('');
                setSubsystem('');
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
                      onClick={() => navigator.clipboard.writeText(window.location.href + '#' + i.id)}
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
