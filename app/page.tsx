'use client';
import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Script from "next/script";

/**
 * Auto3D — Free‑tier Starter (React/Next compatible)
 * --------------------------------------------------
 * New: Сразу из /?view=submit можно:
 *  - Добавить модель в каталог **локально** (сохраняется в localStorage; видно в этом браузере).
 *  - Опубликовать в каталог через **Supabase** (если заданы env NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY).
 *
 * Безопасность/устойчивость:
 *  - По‑прежнему один маршрут с параметром `?view=...` (никаких next/navigation).
 *  - <model-viewer> закрыт от null/SSR ошибок; при сбоях показывается постер.
 *  - Тест‑кейсы сохранены и расширены ранее.
 */

// ====== CONFIG ======
// e.g. https://your-project.supabase.co
// Задаются в Vercel → Settings → Environment Variables (client, NEXT_PUBLIC_*)
// На локалке — в .env.local
// declare process for TS (in case it complains in this single file)
// @ts-ignore
declare const process: any;
const SUPABASE_URL: string = (typeof process !== 'undefined' && process?.env?.NEXT_PUBLIC_SUPABASE_URL) || "";
const SUPABASE_ANON_KEY: string = (typeof process !== 'undefined' && process?.env?.NEXT_PUBLIC_SUPABASE_ANON_KEY) || "";
const HAS_SUPABASE = !!(SUPABASE_URL && SUPABASE_ANON_KEY);
const SUPABASE_BUCKET = 'models'; // публичный бакет для файлов (создай в Supabase → Storage)
// Helpers for Storage paths / filenames
function slug(v: string): string {
  try {
    return (v || '')
      .toString()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '') // убрать диакритику
      .replace(/[^a-zA-Z0-9]+/g, '-')  // всё «лишнее» в -
      .replace(/^-+|-+$/g, '')         // обрезать дефисы по краям
      .toLowerCase();
  } catch { return 'x'; }
}
function safeFileName(name: string): string {
  return (name || 'model.glb').replace(/[^a-zA-Z0-9_.-]/g, '_');
}


// Meshy API (AI retexturing: uploads STL/OBJ/FBX/GLTF/GLB and returns textured GLB)
// Docs: https://docs.meshy.ai/en/api/retexture
// In dev можно использовать тестовый ключ из доков Meshy (возвращает демонстрационные результаты):
// 'msy_dummy_api_key_for_test_mode_12345678'
const MESHY_API_KEY: string = (typeof process !== 'undefined' && process?.env?.NEXT_PUBLIC_MESHY_API_KEY) || 'msy_dummy_api_key_for_test_mode_12345678';
const HAS_MESHY = !!MESHY_API_KEY;

const FORM_EMBED_URL = ""; // Google Form embed URL (опционально)
const MAILTO_TO = ""; // если пусто — локальная кнопка mailto не появится
const CONTACT_EMAIL = MAILTO_TO || "contact@example.com"; // для Rules/DMCA

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
    if (typeof window === 'undefined' || typeof document === 'undefined') return;

    const isReady = () => {
      try { return !!(window as any)?.customElements?.get?.('model-viewer'); } catch { return false; }
    };

    if (isReady()) { setReady(true); return; }

    // Fallback: inject CDN script if not present (jsDelivr → unpkg)
    const ensureCdn = (id: string, src: string, onError?: () => void) => {
      if (document.getElementById(id)) return;
      const s = document.createElement('script');
      s.id = id; s.type = 'module'; s.src = src;
      s.onerror = () => { console.error('Failed to load model-viewer from', src); onError?.(); };
      document.head.appendChild(s);
    };
    // If Next <Script id="model-viewer-script"> didn't run yet, add one
    ensureCdn('model-viewer-script', 'https://cdn.jsdelivr.net/npm/@google/model-viewer/dist/model-viewer.min.js', () => {
      ensureCdn('model-viewer-script-2', 'https://unpkg.com/@google/model-viewer/dist/model-viewer.min.js');
    });

    let tries = 0;
    const tm = setInterval(() => {
      tries += 1;
      if (isReady()) { setReady(true); clearInterval(tm); }
      else if (tries > 300) { clearInterval(tm); console.warn('model-viewer did not register (CDN blocked?). Showing poster only.'); }
    }, 50);
    return () => clearInterval(tm);
  }, []);
  return ready;
}

// --- Demo GLBs (textures embedded; CORS‑safe) ---
const SAMPLE_DUCK =
  'https://rawcdn.githack.com/KhronosGroup/glTF-Sample-Models/master/2.0/Duck/glTF-Binary/Duck.glb';
const SAMPLE_HELMET =
  'https://rawcdn.githack.com/KhronosGroup/glTF-Sample-Models/master/2.0/DamagedHelmet/glTF-Binary/DamagedHelmet.glb';
const SAMPLE_HELMET_GLTF_EXT =
  'https://rawcdn.githack.com/KhronosGroup/glTF-Sample-Models/master/2.0/DamagedHelmet/glTF/DamagedHelmet.gltf';

const DEMO_SRC_OK = SAMPLE_DUCK;

// --- Inline poster SVG (no external request) ---
const POSTER_SVG =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(`<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns='http://www.w3.org/2000/svg' width='800' height='450'>\n  <rect fill='#f3f4f6' width='100%' height='100%'/>\n  <g fill='#6b7280' font-family='Arial,sans-serif' font-size='22'>\n    <text x='50%' y='50%' dominant-baseline='middle' text-anchor='middle'>Загрузка 3D…</text>\n  </g>\n</svg>`);

// --- Helpers ---
function toDirectLink(url: string): string {
  try {
    if (!url) return url;
    const g = url.match(/drive\.google\.com\/file\/d\/([^/]+)/);
    if (g && g[1]) return `https://drive.google.com/uc?export=download&id=${g[1]}`;
    if (url.includes('dropbox.com')) return url.replace(/\?dl=0$/, '?dl=1');
    return url;
  } catch {
    return url;
  }
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

// ===== Data Layer =====
export type Item = {
  id: string;
  brand: string;
  model: string;
  title: string;
  subsystem: string;
  src: string; // Prefer GLB/GLTF URL
  download: string; // direct file URL
  image?: string;
};

// Local (browser) storage — preview only
const LS_KEY = 'auto3d-items-v1';
function readLocalItems(): Item[] {
  if (typeof window === 'undefined') return [];
  try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]'); } catch { return []; }
}
function writeLocalItems(items: Item[]) {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(LS_KEY, JSON.stringify(items)); } catch {}
}
function addLocalItem(item: Item) {
  const items = [item, ...readLocalItems()];
  writeLocalItems(items);
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('local-items-updated'));
}

// Remote (Supabase) — optional publish for everyone
async function fetchRemoteItems(): Promise<Item[]> {
  if (!HAS_SUPABASE) return [];
  const url = `${SUPABASE_URL}/rest/v1/items?select=*`;
  const res = await fetch(url, { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } });
  if (!res.ok) { console.warn('Supabase fetch failed', await res.text()); return [];
  }
  const rows = await res.json();
  return (rows || []).map((r: any) => ({ id: String(r.id), brand: r.brand, model: r.model, title: r.title, subsystem: r.subsystem, src: r.src, download: r.download, image: r.image || undefined }));
}

async function insertRemoteItem(item: Item): Promise<boolean> {
  if (!HAS_SUPABASE) return false;
  const url = `${SUPABASE_URL}/rest/v1/items`;
  const payload = { ...item };
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      Prefer: 'return=representation',
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) { console.warn('Supabase insert failed', await res.text()); return false; }
  try { await res.json(); } catch {}
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('remote-items-updated'));
  return true;
}

// Upload raw file bytes to Supabase Storage (public bucket)
// Returns a public URL or null on failure
async function uploadToSupabaseStorage(file: File, pathInBucket?: string): Promise<string | null> {
  if (!HAS_SUPABASE) return null;
  const safeName = (pathInBucket || `${Date.now()}-${(file.name || 'model.glb').replace(/[^a-z0-9_.-]/gi, '_')}`).replace(/^\/+/, '');
  const uploadUrl = `${SUPABASE_URL}/storage/v1/object/${encodeURIComponent(SUPABASE_BUCKET + '/' + safeName)}`;
  const res = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': (file as any).type || 'application/octet-stream',
      'x-upsert': 'true',
    },
    body: file,
  });
  if (!res.ok) {
    console.warn('Supabase storage upload failed', res.status, await res.text());
    return null;
  }
  return `${SUPABASE_URL}/storage/v1/object/public/${SUPABASE_BUCKET}/${safeName}`;
}

// ===== IndexedDB (local browser file store) =====
const IDB_DB = 'auto3d-idb';
const IDB_STORE = 'files';
function openIDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    try {
      const req = indexedDB.open(IDB_DB, 1);
      req.onupgradeneeded = () => { const db = req.result; if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    } catch (e) { reject(e); }
  });
}
async function idbPut(key: string, blob: Blob): Promise<void> {
  const db = await openIDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.objectStore(IDB_STORE).put(blob, key);
  });
  db.close();
}
async function idbGet(key: string): Promise<Blob | null> {
  const db = await openIDB();
  const blob: Blob | null = await new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readonly');
    tx.onerror = () => reject(tx.error);
    const req = tx.objectStore(IDB_STORE).get(key);
    req.onsuccess = () => resolve((req.result as Blob) || null);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return blob;
}
function isIdbSrc(u: string): boolean { return typeof u === 'string' && u.startsWith('idb://'); }
function idbKeyFromSrc(u: string): string { return u.replace(/^idb:\/\//, ''); }

// ===== <model-viewer> Safe wrapper =====
function useModelViewerStatus(src: string, supported: boolean) {
  const mvReady = useModelViewerReady();
  const [node, setNode] = useState<HTMLElement | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ok' | 'error' | 'unsupported' | 'notready' | 'timeout'>('notready');
  const [token, setToken] = useState(0);

  useEffect(() => {
    if (!supported) { setStatus('unsupported'); return; }
    if (!mvReady) { setStatus('notready'); return; }
    if (!src) { setStatus('error'); return; }
    setStatus('loading');
    setToken((t) => t + 1);
  }, [src, mvReady, supported]);

  useEffect(() => {
    if (!mvReady || !node || status === 'unsupported') return;
    let cancelled = false;
    const onLoad = () => { if (!cancelled) setStatus('ok'); };
    const onError = (ev: any) => { if (!cancelled) { console.error('<model-viewer> error:', ev?.detail || ev); setStatus('error'); } };
    try {
      node.addEventListener('load', onLoad as EventListener);
      node.addEventListener('error', onError as EventListener);
    } catch (e) { console.warn('listener attach failed', e); }
    const timeout = setTimeout(() => { if (!cancelled && status === 'loading') setStatus('timeout'); }, 15000);
    return () => { cancelled = true; clearTimeout(timeout); try { node.removeEventListener('load', onLoad as EventListener); node.removeEventListener('error', onError as EventListener); } catch {} };
  }, [mvReady, node, token, status]);

  return { mvReady, status, setNode } as const;
}

function SafeModelViewer({ src, alt, poster }: { src: string; alt: string; poster?: string }) {
  const [resolved, setResolved] = useState<string>('');
  const [blobUrl, setBlobUrl] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (blobUrl) { URL.revokeObjectURL(blobUrl); setBlobUrl(null); }
        if (isIdbSrc(src)) {
          const key = idbKeyFromSrc(src);
          const blob = await idbGet(key);
          if (!alive) return;
          if (!blob) { setResolved(''); return; }
          const url = URL.createObjectURL(blob);
          setBlobUrl(url);
          setResolved(url);
        } else {
          setResolved(toDirectLink(src));
        }
      } catch (e) { console.warn('resolve src failed', e); setResolved(toDirectLink(src)); }
    })();
    return () => { alive = false; };
  }, [src]);

  const ext = getExt(resolved);
  const supported = !!resolved && (ext === 'glb' || ext === 'gltf' || resolved.startsWith('blob:') || resolved.startsWith('data:'));
  const { mvReady, status, setNode } = useModelViewerStatus(resolved, supported);
  const showPosterOnly = !resolved || status === 'error' || status === 'unsupported' || status === 'notready' || status === 'timeout';

  useEffect(() => () => { if (blobUrl) URL.revokeObjectURL(blobUrl); }, [blobUrl]);

  return (
    <div className="relative w-full h-full">
      {showPosterOnly && (
        <img src={poster || POSTER_SVG} alt={`${alt} (постер)`} className="absolute inset-0 w-full h-full object-contain" />
      )}
      {mvReady && supported && resolved && (
        // @ts-ignore - web component
        <model-viewer
          key={resolved}
          ref={(el: any) => setNode(el as unknown as HTMLElement)}
          src={resolved}
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

// ===== Demo catalog (static) =====
const initialItems: Item[] = [
  { id: 'kia-carnival-cupholder', brand: 'Kia', model: 'Carnival', title: 'Cupholder insert (demo)', subsystem: 'interior', src: DEMO_SRC_OK, download: SAMPLE_DUCK },
  { id: 'toyota-bb-hook', brand: 'Toyota', model: 'bB', title: 'Cargo hook (demo)', subsystem: 'interior', src: DEMO_SRC_OK, download: SAMPLE_DUCK },
  { id: 'vw-golf3-vent', brand: 'Volkswagen', model: 'Golf 3', title: 'Vent clip mount (demo)', subsystem: 'interior', src: DEMO_SRC_OK, download: SAMPLE_DUCK },
];

// ===== Tests (unchanged + extra) =====
const TEST_ITEMS: Item[] = [
  { id: 'test-ok-duck', brand: 'TEST', model: 'Embedded', title: 'TEST: Embedded textures (Duck.glb)', subsystem: 'test', src: SAMPLE_DUCK, download: SAMPLE_DUCK },
  { id: 'test-ok-helmet', brand: 'TEST', model: 'Embedded', title: 'TEST: Embedded textures (DamagedHelmet.glb)', subsystem: 'test', src: SAMPLE_HELMET, download: SAMPLE_HELMET },
  { id: 'test-broken-url', brand: 'TEST', model: 'Broken', title: 'TEST: Broken URL (poster only)', subsystem: 'test', src: 'https://example.com/notfound.glb', download: '#' },
  { id: 'test-ok-helmet-gltf-external', brand: 'TEST', model: 'ExternalTex', title: 'TEST: GLTF with external textures (should load)', subsystem: 'test', src: SAMPLE_HELMET_GLTF_EXT, download: SAMPLE_HELMET_GLTF_EXT },
  { id: 'test-drive-share-shape', brand: 'TEST', model: 'DriveShare', title: 'TEST: Google Drive share link (normalized; likely poster only)', subsystem: 'test', src: 'https://drive.google.com/file/d/THIS_IS_FAKE_ID/view?usp=sharing', download: 'https://drive.google.com/file/d/THIS_IS_FAKE_ID/view?usp=sharing' },
  { id: 'test-dropbox-dl0', brand: 'TEST', model: 'DropboxShare', title: 'TEST: Dropbox share link dl=0 (normalized; poster only)', subsystem: 'test', src: 'https://www.dropbox.com/s/fakehash/file.glb?dl=0', download: 'https://www.dropbox.com/s/fakehash/file.glb?dl=0' },
  { id: 'test-unsupported-stl', brand: 'TEST', model: 'Unsupported', title: 'TEST: Unsupported STL (poster only)', subsystem: 'test', src: 'https://rawcdn.githack.com/alecjacobson/common-3d-test-models/master/data/bunny.stl', download: '#' },
  { id: 'test-ok-duck-query', brand: 'TEST', model: 'QueryExt', title: 'TEST: Duck.glb?raw=1 (should load)', subsystem: 'test', src: SAMPLE_DUCK + '?raw=1', download: SAMPLE_DUCK + '?raw=1' },
  { id: 'test-dropbox-dl1', brand: 'TEST', model: 'DropboxDirect', title: 'TEST: Dropbox share link dl=1 (poster only; fake path)', subsystem: 'test', src: 'https://www.dropbox.com/s/fakehash/file.glb?dl=1', download: 'https://www.dropbox.com/s/fakehash/file.glb?dl=1' },
  { id: 'test-ok-duck-hash', brand: 'TEST', model: 'HashExt', title: 'TEST: Duck.glb#view (should load)', subsystem: 'test', src: SAMPLE_DUCK + '#view', download: SAMPLE_DUCK + '#view' },
  { id: 'test-empty-src', brand: 'TEST', model: 'Edge', title: 'TEST: Empty src (poster only)', subsystem: 'test', src: '', download: '#' },
];

// ===== Minimal client router (no next/navigation) =====
function useView() {
  const [view, setView] = useState<string>('');
  useEffect(() => {
    if (typeof window === 'undefined') return;

    // Patch history API once to emit a custom event on push/replace
    const w = window as any;
    if (!w.__auto3d_history_patched) {
      const wrap = (fn: any) => function(this: any, ...args: any[]) {
        const ret = fn.apply(this, args);
        try { window.dispatchEvent(new Event('url-change')); } catch {}
        return ret;
      };
      try {
        history.pushState = wrap(history.pushState);
        history.replaceState = wrap(history.replaceState);
        w.__auto3d_history_patched = true;
      } catch {}
    }

    const sync = () => {
      const url = new URL(window.location.href);
      const pathname = url.pathname.toLowerCase();
      // Soft redirects from path routes to single route with view param
      if (pathname === '/submit' || pathname === '/sumbit') { url.pathname = '/'; url.searchParams.set('view','submit'); history.replaceState({}, '', url.toString()); }
      if (pathname === '/rules') { url.pathname = '/'; url.searchParams.set('view','rules'); history.replaceState({}, '', url.toString()); }
      if (pathname === '/dmca') { url.pathname = '/'; url.searchParams.set('view','dmca'); history.replaceState({}, '', url.toString()); }
      setView((url.searchParams.get('view') || '').toLowerCase());
    };

    sync();
    const onChange = () => sync();
    window.addEventListener('popstate', onChange);
    window.addEventListener('hashchange', onChange);
    window.addEventListener('url-change', onChange);
    return () => {
      window.removeEventListener('popstate', onChange);
      window.removeEventListener('hashchange', onChange);
      window.removeEventListener('url-change', onChange);
    };
  }, []);
  return view;
}

// ===== Pages =====
function SubmitPage() {
  // Main metadata form (for card fields)
  const [form, setForm] = useState({ author: '', email: '', brand: '', model: '', title: '', subsystem: '', description: '', src: '', download: '', license: 'CC BY' });
  const [agree, setAgree] = useState(false);
  const [status, setStatus] = useState<string>("");
  const subsystems = ['interior', 'body', 'electrical', 'suspension', 'engine', 'transmission'];

  // A) Meshy section state
  const [meshFile, setMeshFile] = useState<File | null>(null);
  const [styleText, setStyleText] = useState<string>('black rubber with subtle hex pattern, slightly worn');
  const [styleImageUrl, setStyleImageUrl] = useState<string>('');
  const [useOriginalUV, setUseOriginalUV] = useState<boolean>(false);
  const [enablePBR, setEnablePBR] = useState<boolean>(true);
  const [autoPublishRemote, setAutoPublishRemote] = useState<boolean>(HAS_SUPABASE);
  const [meshyTaskId, setMeshyTaskId] = useState<string>('');
  const [meshyProgress, setMeshyProgress] = useState<number>(0);
  const [meshyPhase, setMeshyPhase] = useState<'idle'|'upload'|'queue'|'run'|'succeeded'|'failed'>('idle');

  // B) Local GLB — IndexedDB storage
  const [localGlbFile, setLocalGlbFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState<boolean>(false);

  const onChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e?.target ?? ({} as any);
    if (!name) return;
    setForm((s) => ({ ...s, [name]: value }));
  };

  const makeItem = (glbUrl?: string): Item => ({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    brand: form.brand.trim() || 'Custom',
    model: form.model.trim() || 'Model',
    title: form.title.trim() || (glbUrl ? 'Uploaded via Meshy' : 'Custom model'),
    subsystem: form.subsystem || 'interior',
    src: toDirectLink(glbUrl || form.src.trim()),
    download: toDirectLink(form.download.trim() || glbUrl || form.src.trim()),
  });

  const addLocal = () => {
    if (!agree) return;
    const item = makeItem();
    addLocalItem(item);
    setStatus('Модель добавлена в каталог локально (видно только вам на этом устройстве).');
  };

  const publishRemote = async () => {
    if (!agree) return;
    if (!HAS_SUPABASE) { setStatus('Supabase не настроен. Добавьте переменные окружения и таблицу items.'); return; }
    setStatus('Публикация…');
    const ok = await insertRemoteItem(makeItem());
    setStatus(ok ? 'Опубликовано в общем каталоге (Supabase).' : 'Не удалось опубликовать в Supabase. Проверьте ключи и политику RLS.');
  };

  const mailtoSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!MAILTO_TO) return;
    const normalizedSrc = toDirectLink(form.src);
    const normalizedDownload = toDirectLink(form.download || form.src);
    const subject = `Auto3D submission: ${form.brand} ${form.model} — ${form.title}`.trim();
    const body = [
      `Author: ${form.author}`,
      `Email: ${form.email}`,
      `Brand: ${form.brand}`,
      `Model: ${form.model}`,
      `Title: ${form.title}`,
      `Subsystem: ${form.subsystem}`,
      `License: ${form.license}`,
      `Agreed to rules: yes`,
      `Viewer src: ${normalizedSrc}`,
      `Download: ${normalizedDownload}`,
      '',
      'Description:',
      form.description,
    ].join('%0D%0A');
    const href = `mailto:${encodeURIComponent(MAILTO_TO)}?subject=${encodeURIComponent(subject)}&body=${body}`;
    if (typeof window !== 'undefined') window.location.href = href;
  };

  // === Meshy integration ===
  async function fileToDataURI(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onerror = () => reject(fr.error);
      fr.onload = () => {
        try {
          let v = String(fr.result || '');
          v = v.replace(/^data:[^;]+;base64,/, 'data:application/octet-stream;base64,');
          resolve(v);
        } catch (e) { reject(e); }
      };
      fr.readAsDataURL(file);
    });
  }
  async function meshyCreateRetextureTask(modelDataURI: string, textPrompt: string, imageUrl: string, enableOriginalUV: boolean, enablePbr: boolean): Promise<string> {
    const payload: any = { model_url: modelDataURI, enable_original_uv: enableOriginalUV, enable_pbr: enablePbr };
    if (imageUrl) payload.image_style_url = imageUrl; else payload.text_style_prompt = textPrompt || 'generic automotive plastic';
    const res = await fetch('https://api.meshy.ai/openapi/v1/retexture', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${MESHY_API_KEY}` }, body: JSON.stringify(payload) });
    if (!res.ok) throw new Error(`Meshy create failed: ${res.status}`);
    const data = await res.json();
    return data.result as string; // task id
  }
  async function meshyGetTask(taskId: string): Promise<any> {
    const res = await fetch(`https://api.meshy.ai/openapi/v1/retexture/${taskId}`, { headers: { Authorization: `Bearer ${MESHY_API_KEY}` } });
    if (!res.ok) throw new Error(`Meshy status failed: ${res.status}`);
    return res.json();
  }
  async function startMeshyPipeline() {
    if (!agree) { setStatus('Поставьте галочку согласия с правилами.'); return; }
    if (!meshFile) { setStatus('Выберите файл STL/OBJ/FBX/GLTF/GLB.'); return; }
    try {
      setMeshyPhase('upload'); setStatus('Подготовка файла…'); setMeshyProgress(0);
      const dataURI = await fileToDataURI(meshFile);
      setMeshyPhase('queue'); setStatus('Создание задачи на Meshy…');
      const taskId = await meshyCreateRetextureTask(dataURI, styleText, styleImageUrl, useOriginalUV, enablePBR);
      setMeshyTaskId(taskId);
      setMeshyPhase('run'); setStatus('Задача создана. Ожидаем результат…');
      let done = false;
      for (let i = 0; i < 300; i++) {
        const t = await meshyGetTask(taskId);
        const st = String(t.status || '').toUpperCase();
        const pr = Number(t.progress || 0);
        setMeshyProgress(isFinite(pr) ? pr : 0);
        if (st === 'SUCCEEDED') {
          done = true;
          setMeshyPhase('succeeded');
          const glbUrl: string | undefined = t?.model_urls?.glb;
          if (!glbUrl) throw new Error('Meshy вернул задачу без ссылки на GLB.');
          const item = makeItem(glbUrl);
          addLocalItem(item);
          if (autoPublishRemote && HAS_SUPABASE) { try { await insertRemoteItem(item); } catch (e) { console.warn(e); } }
          setForm((s) => ({ ...s, src: glbUrl, download: glbUrl, title: s.title || 'Textured via Meshy' }));
          setStatus('Готово! GLB получен и добавлен в каталог.');
          break;
        }
        if (st === 'FAILED') { setMeshyPhase('failed'); setStatus(t?.task_error?.message || 'Meshy: задача завершилась с ошибкой'); break; }
        await new Promise(r => setTimeout(r, 5000));
      }
      if (!done && meshyPhase !== 'failed') setStatus('Время ожидания вышло. Попробуйте позже.');
    } catch (e: any) {
      console.error(e);
      setMeshyPhase('failed');
      setStatus(`Ошибка: ${e?.message || e}`);
    }
  }

  // === Local GLB → IndexedDB ===
  const addLocalFromFile = async () => {
    if (!agree) { setStatus('Поставьте галочку согласия с правилами.'); return; }
    if (!localGlbFile) { setStatus('Выберите GLB файл.'); return; }
    try {
      const item = makeItem();
      const id = item.id;
      await idbPut(id, localGlbFile);
      const localSrc = `idb://${id}`;
      addLocalItem({ ...item, src: localSrc, download: localSrc });
      setForm((s) => ({ ...s, src: localSrc, download: localSrc, title: s.title || localGlbFile.name }));
      setStatus('Файл сохранён локально (IndexedDB) и добавлен в каталог. Видно только на этом устройстве.');
    } catch (e: any) {
      console.error(e);
      setStatus('Не удалось сохранить локально: ' + (e?.message || e));
    }
  };

  // === Upload GLB to Supabase Storage ===
  // === Upload GLB to Supabase Storage ===
const uploadLocalToSupabase = async () => {
  if (!agree) { setStatus('Поставьте галочку согласия с правилами.'); return; }
  if (!HAS_SUPABASE) { setStatus('Supabase не настроен. Добавьте NEXT_PUBLIC_SUPABASE_URL/ANON_KEY.'); return; }
  if (!localGlbFile) { setStatus('Выберите GLB файл.'); return; }

  // Лимиты/проверки (можно подстроить под себя)
  const MAX_MB = 75;
  const sizeMb = localGlbFile.size / (1024 * 1024);
  if (sizeMb > MAX_MB) {
    setStatus(`Файл слишком большой: ${sizeMb.toFixed(1)} MB (лимит ${MAX_MB} MB). Сожмите: npx gltfpack -i in.glb -o out.glb -cc`);
    return;
  }
  if (!/\.glb$/i.test(localGlbFile.name)) {
    setStatus('Разрешены только .glb файлы для этого загрузчика.');
    return;
  }

  try {
    setUploading(true);
    setStatus('Загрузка файла в Supabase Storage…');

    // ВАЖНО: вот тут используем helpers → красивый путь brand/model/…
    const relPath = `${slug(form.brand || 'brand')}/${slug(form.model || 'model')}/${Date.now()}-${safeFileName(localGlbFile.name)}`;

    // Передаём relPath вторым аргументом — uploadToSupabaseStorage уже умеет его принимать
    const url = await uploadToSupabaseStorage(localGlbFile, relPath);

    setUploading(false);

    if (!url) {
      setStatus('Не удалось загрузить в Supabase Storage. Проверьте политику доступа для бакета.');
      return;
    }

    const item = makeItem(url);
    addLocalItem(item);
    setForm((s) => ({ ...s, src: url, download: url, title: s.title || localGlbFile.name }));
    setStatus('Файл загружен в Storage и добавлен в каталог.');
  } catch (e: any) {
    setUploading(false);
    setStatus('Ошибка загрузки: ' + (e?.message || e));
  }
};


  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold mb-2">Добавить модель</h1>
      <p className="text-gray-600 mb-6">Перед отправкой ознакомьтесь с <Link className="underline" href="/?view=rules">Правилами публикации</Link> и <Link className="underline" href="/?view=dmca">DMCA/удаление</Link>.</p>

      {/* A. Автотекстуринг (Meshy) */}
      <div className="bg-white border rounded-2xl p-6 grid gap-4 mb-8">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold">Автотекстуринг (Meshy) — STL → GLB с текстурами</h2>
          <span className="text-xs px-2 py-0.5 rounded-full border">{HAS_MESHY ? 'ключ найден' : 'test‑mode'}</span>
        </div>
        <label className="grid gap-1">
          <span className="text-sm text-gray-600">Файл модели (STL/OBJ/FBX/GLTF/GLB)</span>
          <input type="file" accept=".stl,.obj,.fbx,.gltf,.glb" onChange={(e)=>setMeshFile(e.target.files?.[0]||null)} className="px-3 py-2 rounded-xl border" />
        </label>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="grid gap-1"><span className="text-sm text-gray-600">Стиль (текстовое описание)</span><input value={styleText} onChange={(e)=>setStyleText(e.target.value)} className="px-3 py-2 rounded-xl border" placeholder="чёрный пластик с лёгкой матовой фактурой" /></label>
          <label className="grid gap-1"><span className="text-sm text-gray-600">Style Image URL (опционально)</span><input value={styleImageUrl} onChange={(e)=>setStyleImageUrl(e.target.value)} className="px-3 py-2 rounded-xl border" placeholder="Ссылка на картинку-референс" /></label>
        </div>
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <label className="inline-flex items-center gap-2"><input type="checkbox" checked={useOriginalUV} onChange={(e)=>setUseOriginalUV(!!e.target.checked)} /> Использовать исходные UV (если есть)</label>
          <label className="inline-flex items-center gap-2"><input type="checkbox" checked={enablePBR} onChange={(e)=>setEnablePBR(!!e.target.checked)} /> Сгенерировать PBR‑карты</label>
          {HAS_SUPABASE && (
            <label className="inline-flex items-center gap-2"><input type="checkbox" checked={autoPublishRemote} onChange={(e)=>setAutoPublishRemote(!!e.target.checked)} /> Сразу опубликовать в общий каталог (Supabase)</label>
          )}
        </div>
        <div className="flex items-center gap-3">
          <button type="button" onClick={startMeshyPipeline} disabled={!meshFile || !agree} className={(!meshFile || !agree)?"px-4 py-2 rounded-xl bg-gray-300 text-gray-600 cursor-not-allowed":"px-4 py-2 rounded-xl bg-black text-white"}>Сделать GLB (Meshy)</button>
          <span className="text-xs text-gray-500">После завершения карточка добавится автоматически.</span>
        </div>
        {meshyPhase !== 'idle' && (
          <div className="text-sm text-gray-700 bg-gray-50 border rounded-xl p-3">
            <div>Статус: <b>{meshyPhase}</b>{meshyTaskId?` • task ${meshyTaskId}`:''}</div>
            <div className="mt-2 h-2 bg-gray-200 rounded">
              <div className="h-2 bg-black rounded" style={{width: `${Math.max(2,Math.min(100,meshyProgress))}%`}} />
            </div>
          </div>
        )}
      </div>

      {/* B. Локальный GLB без хостинга */}
      <div className="bg-white border rounded-2xl p-6 grid gap-4 mb-8">
        <h2 className="text-lg font-semibold">Быстро: добавить локальный GLB (без загрузки в интернет)</h2>
        <label className="grid gap-1">
          <span className="text-sm text-gray-600">GLB файл</span>
          <input type="file" accept=".glb" onChange={(e)=>setLocalGlbFile(e.target.files?.[0]||null)} className="px-3 py-2 rounded-xl border" />
        </label>
        <div className="flex items-center gap-3">
          <button type="button" onClick={addLocalFromFile} disabled={!localGlbFile || !agree} className={(!localGlbFile || !agree)?"px-4 py-2 rounded-xl bg-gray-300 text-gray-600 cursor-not-allowed":"px-4 py-2 rounded-xl border"}>Добавить в каталог (локально)</button>
          <span className="text-xs text-gray-500">Хранится в браузере (IndexedDB), будет видно после перезагрузки, но только на этом устройстве.</span>
        </div>
      </div>

      {/* C. Бесплатный хостинг через Supabase Storage */}
      {HAS_SUPABASE && (
        <div className="bg-white border rounded-2xl p-6 grid gap-4 mb-8">
          <h2 className="text-lg font-semibold">Бесплатный хостинг: Supabase Storage</h2>
          <p className="text-sm text-gray-600">Создайте публичный бакет <code>{SUPABASE_BUCKET}</code> и разрешите INSERT для роли <code>anon</code> (для прототипа). Загрузите GLB и получите публичную ссылку.</p>
          <label className="grid gap-1">
            <span className="text-sm text-gray-600">GLB файл</span>
            <input type="file" accept=".glb" onChange={(e)=>setLocalGlbFile(e.target.files?.[0]||null)} className="px-3 py-2 rounded-xl border" />
          </label>
          <div className="flex items-center gap-3">
            <button type="button" onClick={uploadLocalToSupabase} disabled={!localGlbFile || !agree || uploading} className={(!localGlbFile || !agree || uploading)?"px-4 py-2 rounded-xl bg-gray-300 text-gray-600 cursor-not-allowed":"px-4 py-2 rounded-xl bg-black text-white"}>{uploading? 'Загружаем…' : 'Загрузить в Storage и добавить'}</button>
            <span className="text-xs text-gray-500">Публичная ссылка с корректным CORS → работает в предпросмотре у всех.</span>
          </div>
        </div>
      )}

      {/* D. Ручное заполнение карточки */}
      <form onSubmit={MAILTO_TO ? mailtoSubmit : (e)=>e.preventDefault()} className="bg-white border rounded-2xl p-6 grid gap-4">
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="grid gap-1"><span className="text-sm text-gray-600">Автор</span><input name="author" value={form.author} onChange={onChange} className="px-3 py-2 rounded-xl border" required /></label>
          <label className="grid gap-1"><span className="text-sm text-gray-600">Email</span><input type="email" name="email" value={form.email} onChange={onChange} className="px-3 py-2 rounded-xl border" required /></label>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="grid gap-1"><span className="text-sm text-gray-600">Марка</span><input name="brand" value={form.brand} onChange={onChange} className="px-3 py-2 rounded-xl border" required /></label>
          <label className="grid gap-1"><span className="text-sm text-gray-600">Модель</span><input name="model" value={form.model} onChange={onChange} className="px-3 py-2 rounded-xl border" required /></label>
        </div>
        <label className="grid gap-1"><span className="text-sm text-gray-600">Название модели</span><input name="title" value={form.title} onChange={onChange} className="px-3 py-2 rounded-xl border" required /></label>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="grid gap-1"><span className="text-sm text-gray-600">Ссылка на модель для предпросмотра (GLB/GLTF)</span><input name="src" value={form.src} onChange={onChange} className="px-3 py-2 rounded-xl border" placeholder="idb://… или Supabase URL или /models/duck.glb" required /></label>
          <label className="grid gap-1"><span className="text-sm text-gray-600">Ссылка для скачивания</span><input name="download" value={form.download} onChange={onChange} className="px-3 py-2 rounded-xl border" placeholder="Можно оставить пустым — возьмём из src" /></label>
        </div>

        <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={agree} onChange={(e)=>setAgree(!!e?.target?.checked)} required /> <span>Я согласен с <Link className="underline" href="/?view=rules">Правилами</Link> и <Link className="underline" href="/?view=dmca">DMCA/удалением</Link>.</span></label>

        <div className="flex flex-wrap items-center gap-3 pt-2">
          <button type="button" onClick={addLocal} disabled={!agree} className={agree?"px-4 py-2 rounded-xl border bg-white hover:bg-gray-100":"px-4 py-2 rounded-xl border bg-gray-200 text-gray-500 cursor-not-allowed"}>Добавить в каталог (локально)</button>
          <button type="button" onClick={publishRemote} disabled={!agree} className={agree?"px-4 py-2 rounded-xl bg-black text-white":"px-4 py-2 rounded-xl bg-gray-300 text-gray-600 cursor-not-allowed"}>{HAS_SUPABASE?"Опубликовать (Supabase)":"Опубликовать (Supabase не настроен)"}</button>
          {MAILTO_TO && <button type="submit" className="px-4 py-2 rounded-xl border">Отправить на почту</button>}
          <span className="text-xs text-gray-500">Подсказка: можно использовать <code>idb://…</code> (локально), Supabase URL или <code>/models/…</code> из папки public.</span>
        </div>
        {status && <div className="text-sm text-gray-700 bg-gray-50 border rounded-xl p-3">{status}</div>}
      </form>

      {HAS_SUPABASE ? (
        <div className="mt-4 text-xs text-gray-500">Supabase подключён. Таблица: <code>items</code>; Storage: публичный бакет <code>{SUPABASE_BUCKET}</code> с политикой INSERT/SELECT для роли <code>anon</code> (для прототипа).</div>
      ) : (
        <div className="mt-4 text-xs text-gray-500">Чтобы публикации были видны всем, подключите Supabase (переменные <code>NEXT_PUBLIC_SUPABASE_URL</code>, <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code>). Для бесплатного хостинга файлов можно использовать Storage (публичный бакет).</div>
      )}
    </div>
  );
}

function RulesPage() {
  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold mb-2">Правила публикации</h1>
      <p className="text-gray-600 mb-4">Эти правила помогают поддерживать качество и законность контента.</p>
      <div className="bg-white border rounded-2xl p-6 space-y-4 text-sm leading-6">
        <section>
          <h2 className="font-semibold">1. Что можно публиковать</h2>
          <ul className="list-disc ml-5">
            <li>3D‑модели авто‑компонентов для печати/ЧПУ: крепления, адаптеры, органайзеры, декоративные элементы.</li>
            <li>Модели должны принадлежать вам (вы — автор) или быть размещены по лицензии, позволяющей распространение.</li>
          </ul>
        </section>
        <section>
          <h2 className="font-semibold">2. Что нельзя</h2>
          <ul className="list-disc ml-5">
            <li>Нарушение прав третьих лиц (бренды, логотипы, коммерческие CAD, платные модели без разрешения).</li>
            <li>Опасные детали безопасности без дисклеймера.</li>
            <li>Незаконный/вредоносный контент.</li>
          </ul>
        </section>
        <section>
          <h2 className="font-semibold">3. Файлы и предпросмотр</h2>
          <ul className="list-disc ml-5">
            <li>Предпочтительно <b>.glb</b> (glTF‑Binary) с вшитыми текстурами. При .gltf — проверьте пути к текстурам и CORS.</li>
            <li>Ссылки должны быть доступны без авторизации. Для Google Drive — общий доступ по ссылке.</li>
          </ul>
        </section>
        <section>
          <h2 className="font-semibold">4. Лицензии</h2>
          <p>Рекомендуем: CC BY, CC BY‑NC, CC0, MIT. Указывайте автора и лицензию.</p>
        </section>
        <section>
          <h2 className="font-semibold">5. Модерация</h2>
          <p>Жалобы и запросы на <a className="underline" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.</p>
        </section>
      </div>
    </div>
  );
}

function DmcaPage() {
  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold mb-2">DMCA / Удаление по запросу</h1>
      <p className="text-gray-600 mb-4">Если вы считаете, что материал нарушает ваши права, отправьте запрос на удаление.</p>
      <div className="bg-white border rounded-2xl p-6 space-y-4 text-sm leading-6">
        <section>
          <h2 className="font-semibold">Как отправить запрос</h2>
          <ol className="list-decimal ml-5">
            <li>Ссылка(и) на материал(ы), которые нужно удалить.</li>
            <li>Данные правообладателя и контакт для связи.</li>
            <li>Подтверждение прав.</li>
            <li>Описание нарушения и желаемые действия.</li>
          </ol>
          <p className="mt-2">Пишите на <a className="underline" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.</p>
        </section>
      </div>
    </div>
  );
}

// ===== Catalog (main) =====
function CatalogApp() {
  const [q, setQ] = useState('');
  const [brand, setBrand] = useState('');
  const [model, setModel] = useState('');
  const [subsystem, setSubsystem] = useState('');
  const [showTests, setShowTests] = useState(false);

  const [localItems, setLocalItems] = useState<Item[]>([]);
  const [remoteItems, setRemoteItems] = useState<Item[]>([]);

  // Init toggles & load data
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const syncFromUrl = () => {
      try { const url = new URL(window.location.href); setShowTests(url.searchParams.get('tests') === '1'); } catch {}
    };
    syncFromUrl();

    setLocalItems(readLocalItems());
    const onLocal = () => setLocalItems(readLocalItems());
    window.addEventListener('local-items-updated', onLocal);
    window.addEventListener('storage', onLocal);

    // React to header checkbox (tests toggle)
    const onTests = (e: any) => setShowTests(!!e?.detail?.checked);
    window.addEventListener('tests-toggle', onTests as any);
    // React to URL changes from Link navigation
    const onUrl = () => syncFromUrl();
    window.addEventListener('url-change', onUrl);

    (async () => { try { const rows = await fetchRemoteItems(); setRemoteItems(rows); } catch (e) { console.warn(e); } })();
    const onRemote = async () => { try { const rows = await fetchRemoteItems(); setRemoteItems(rows); } catch {} };
    window.addEventListener('remote-items-updated', onRemote);

    return () => {
      window.removeEventListener('local-items-updated', onLocal);
      window.removeEventListener('storage', onLocal);
      window.removeEventListener('tests-toggle', onTests as any);
      window.removeEventListener('url-change', onUrl);
      window.removeEventListener('remote-items-updated', onRemote);
    };
  }, []);

  const catalog = useMemo(() => {
    const base = [...remoteItems, ...initialItems];
    const withTests = showTests ? [...base, ...TEST_ITEMS] : base;
    return [...localItems, ...withTests];
  }, [remoteItems, localItems, showTests]);

  const brands = useMemo(() => Array.from(new Set(catalog.map((i) => i.brand))).sort(), [catalog]);
  const models = useMemo(() => Array.from(new Set(catalog.filter((i) => !brand || i.brand === brand).map((i) => i.model))).sort(), [brand, catalog]);
  const subsystems = useMemo(() => Array.from(new Set(catalog.map((i) => i.subsystem))).sort(), [catalog]);

  const items = useMemo(() => {
    return catalog.filter((i) => {
      const ql = q.toLowerCase();
      const matchQ = !q || i.title.toLowerCase().includes(ql) || i.brand.toLowerCase().includes(ql) || i.model.toLowerCase().includes(ql);
      const matchBrand = !brand || i.brand === brand;
      const matchModel = !model || i.model === model;
      const matchSubsystem = !subsystem || i.subsystem === subsystem;
      return matchQ && matchBrand && matchModel && matchSubsystem;
    });
  }, [q, brand, model, subsystem, catalog]);

  return (
    <main className="max-w-6xl mx-auto px-4 py-6">
      <p className="text-gray-600 mb-4">Добавляйте модели: локально (только вы видите) или через Supabase (видят все). Для предпросмотра лучше <strong>GLB</strong> с вшитыми текстурами. Google Drive/Dropbox ссылки будут нормализованы.</p>
      <div className="flex flex-wrap gap-2 items-center mb-4">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск: Kia, Golf 3, cupholder..." className="px-3 py-2 rounded-xl border w-64 focus:outline-none focus:ring" />
        <select value={brand} onChange={(e) => { setBrand(e.target.value); setModel(''); }} className="px-3 py-2 rounded-xl border"><option value="">Марка</option>{brands.map((b)=>(<option key={b} value={b}>{b}</option>))}</select>
        <select value={model} onChange={(e) => setModel(e.target.value)} className="px-3 py-2 rounded-xl border"><option value="">Модель</option>{models.map((m)=>(<option key={m} value={m}>{m}</option>))}</select>
        <select value={subsystem} onChange={(e) => setSubsystem(e.target.value)} className="px-3 py-2 rounded-xl border"><option value="">Узел</option>{subsystems.map((s)=>(<option key={s} value={s}>{s}</option>))}</select>
        <button onClick={() => { setQ(''); setBrand(''); setModel(''); setSubsystem(''); }} className="px-3 py-2 rounded-xl border bg-white hover:bg-gray-100">Сброс</button>
        <label className="ml-2 inline-flex items-center gap-2 text-xs text-gray-600">
          <input type="checkbox" onChange={(e)=>{ try { const checked = !!e.target && (e.target as HTMLInputElement).checked; if (typeof window==='undefined') return; const url = new URL(window.location.href); if (checked) url.searchParams.set('tests','1'); else url.searchParams.delete('tests'); window.history.replaceState({}, '', url.toString()); window.dispatchEvent(new CustomEvent('tests-toggle', { detail: { checked } })); } catch{} }} />
          Показать тест‑карточки
        </label>
        <Link href="/?view=submit" className="ml-auto px-3 py-2 rounded-xl bg-black text-white text-sm">Добавить модель</Link>
      </div>

      {items.length === 0 ? (
        <div className="p-6 rounded-2xl bg-white border shadow-sm">Ничего не найдено. Попробуйте изменить фильтры.</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {items.map((i) => (
            <article key={i.id} className="bg-white rounded-2xl border shadow-sm overflow-hidden hover:shadow-md transition">
              <div className="bg-gray-100 flex items-center justify-center relative" style={{ aspectRatio: '16 / 9' }}>
                <SafeModelViewer src={i.src} alt={i.title} poster={POSTER_SVG} />
              </div>
              <div className="p-4">
                <div className="text-sm text-gray-500">{i.brand} • {i.model} • {i.subsystem}</div>
                <h3 className="text-lg font-semibold mt-1">{i.title}</h3>
                <div className="mt-3 flex gap-2">
                  <a href={toDirectLink(i.download)} className="px-3 py-2 rounded-xl bg-black text-white text-sm" target="_blank" rel="noopener noreferrer">Скачать</a>
                  <button onClick={() => { try { if (typeof window !== 'undefined') navigator.clipboard.writeText(window.location.href + '#' + i.id); } catch {} }} className="px-3 py-2 rounded-xl border text-sm">Поделиться</button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </main>
  );
}

// ===== App Shell & Router =====
function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Load model-viewer early via Next Script; our hook will also fallback if CDN blocked */}
      <Script id="model-viewer-script" src="https://cdn.jsdelivr.net/npm/@google/model-viewer/dist/model-viewer.min.js" type="module" strategy="beforeInteractive" />

      <header className="sticky top-0 z-10 backdrop-blur bg-white/70 border-b">
        <div className="max-w-6xl mx-auto px-4 py-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <h1 className="text-2xl font-bold tracking-tight">Auto3D <span className="text-gray-500 text-base">free‑tier demo</span></h1>
          <nav className="flex flex-wrap gap-2 items-center text-sm">
            <Link href="/" className="px-3 py-2 rounded-xl border bg-white hover:bg-gray-100">Каталог</Link>
            <Link href="/?view=submit" className="px-3 py-2 rounded-xl bg-black text-white hover:opacity-90">Добавить модель</Link>
            <Link href="/?view=rules" className="px-3 py-2 rounded-xl border bg-white hover:bg-gray-100">Правила</Link>
            <Link href="/?view=dmca" className="px-3 py-2 rounded-xl border bg-white hover:bg-gray-100">DMCA/Удаление</Link>
          </nav>
        </div>
      </header>

      {children}

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

export default function AppRouter() {
  const view = useView();
  let page: React.ReactNode = <CatalogApp />;
  if (view === 'submit') page = <SubmitPage />;
  else if (view === 'rules') page = <RulesPage />;
  else if (view === 'dmca') page = <DmcaPage />;
  return <AppShell>{page}</AppShell>;
}
