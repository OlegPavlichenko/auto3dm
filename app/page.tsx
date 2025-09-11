'use client';
import React, { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

/**
 * Auto3D — Free‑tier Starter (React/Next compatible)
 * --------------------------------------------------
 * New: /submit page + rules & DMCA pages
 *  - /submit: supports Google Form embed (gated by "agree to rules") or local mailto: form (also gated)
 *  - /rules: publication rules/guidelines
 *  - /dmca: takedown/removal procedure
 *
 * Viewer stability:
 *  - SafeModelViewer hides 3D & shows poster on error/unsupported/timeout/notready
 *  - Handles <model-viewer> readiness & CORS edge cases
 */

// ====== CONFIG ======
// Google Form embed URL (optional). Example: https://docs.google.com/forms/d/e/FORM_ID/viewform?embedded=true
const FORM_EMBED_URL = ""; // leave empty to use the local fallback form
// Incoming submissions email (for local fallback mailto)
const MAILTO_TO = ""; // e.g., "you@example.com"
const CONTACT_EMAIL = MAILTO_TO || "contact@example.com"; // used for Rules/DMCA display

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

    const id = 'model-viewer-script';
    if (!document.getElementById(id)) {
      const s = document.createElement('script');
      s.id = id;
      s.type = 'module';
      s.src = 'https://unpkg.com/@google/model-viewer/dist/model-viewer.min.js';
      document.head.appendChild(s);
      s.addEventListener('error', () => {
        console.error('Failed to load model-viewer script');
      });
    }

    let tries = 0;
    const tm = setInterval(() => {
      tries += 1;
      if ((window as any).customElements && (window as any).customElements.get('model-viewer')) {
        setReady(true);
        clearInterval(tm);
      } else if (tries > 200) {
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
  'https://rawcdn.githack.com/KhronosGroup/glTF-Sample-Models/master/2.0/DamagedHelmet/glTF/DamagedHelmet.gltf';

const DEMO_SRC_OK = SAMPLE_DUCK;

// --- Inline poster SVG (no external request) ---
const POSTER_SVG =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(`<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns='http://www.w3.org/2000/svg' width='800' height='450'>\n  <rect fill='#f3f4f6' width='100%' height='100%'/>\n  <g fill='#6b7280' font-family='Arial,sans-serif' font-size='22'>\n    <text x='50%' y='50%' dominant-baseline='middle' text-anchor='middle'>Загрузка 3D…</text>\n  </g>\n</svg>`);

// --- Helpers to normalize common sharing links to direct file links ---
function toDirectLink(url: string): string {
  if (!url) return url;
  const g = url.match(/drive\.google\.com\/file\/d\/([^/]+)/);
  if (g && g[1]) return `https://drive.google.com/uc?export=download&id=${g[1]}`;
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
  brand: string;
  model: string;
  title: string;
  subsystem: string;
  src: string;
  download: string;
  image?: string;
};

// --- Safe wrapper for <model-viewer> ---
function SafeModelViewer({ src, alt, poster }: { src: string; alt: string; poster?: string }) {
  const ref = useRef<any>(null);
  const mvReady = useModelViewerReady();
  const [status, setStatus] = useState<'idle' | 'loading' | 'ok' | 'error' | 'unsupported' | 'notready' | 'timeout'>('notready');
  const [loadToken, setLoadToken] = useState(0);

  const normalizedSrc = toDirectLink(src);
  const ext = getExt(normalizedSrc);

  useEffect(() => {
    if (!ext) return;
    const ok = ext === 'glb' || ext === 'gltf';
    if (!ok) setStatus('unsupported');
  }, [ext]);

  useEffect(() => {
    if (!mvReady || getExt(normalizedSrc) === '' || status === 'unsupported') return;
    setStatus('loading');
    setLoadToken((t) => t + 1);
  }, [normalizedSrc, mvReady]);

  useEffect(() => {
    if (!mvReady || status === 'unsupported') return;
    const el = ref.current as HTMLElement | null;
    if (!el) return;
    let cancelled = false;
    const onLoad = () => { if (!cancelled) setStatus('ok'); };
    const onError = (ev: any) => { console.error('<model-viewer> error:', ev?.detail || ev); if (!cancelled) setStatus('error'); };
    el.addEventListener('load', onLoad as EventListener);
    el.addEventListener('error', onError as EventListener);
    const timeout = setTimeout(() => { if (!cancelled && status === 'loading') setStatus('timeout'); }, 15000);
    return () => { cancelled = true; clearTimeout(timeout); el.removeEventListener('load', onLoad as EventListener); el.removeEventListener('error', onError as EventListener); };
  }, [mvReady, loadToken, status]);

  const showPosterOnly = status === 'error' || status === 'unsupported' || status === 'notready' || status === 'timeout';

  return (
    <div className="relative w-full h-full">
      {showPosterOnly && (
        <img src={poster || POSTER_SVG} alt={`${alt} (постер)`} className="absolute inset-0 w-full h-full object-contain" />
      )}
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
  { id: 'kia-carnival-cupholder', brand: 'Kia', model: 'Carnival', title: 'Cupholder insert (demo)', subsystem: 'interior', src: DEMO_SRC_OK, download: SAMPLE_DUCK },
  { id: 'toyota-bb-hook', brand: 'Toyota', model: 'bB', title: 'Cargo hook (demo)', subsystem: 'interior', src: DEMO_SRC_OK, download: SAMPLE_DUCK },
  { id: 'vw-golf3-vent', brand: 'Volkswagen', model: 'Golf 3', title: 'Vent clip mount (demo)', subsystem: 'interior', src: DEMO_SRC_OK, download: SAMPLE_DUCK },
];

// --- Existing tests (kept) + Extra tests ---
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
];

// ===== Pages =====
function SubmitPage() {
  const [form, setForm] = useState({ author: '', email: '', brand: '', model: '', title: '', subsystem: '', description: '', src: '', download: '', license: 'CC BY' });
  const [agree, setAgree] = useState(false);
  const subsystems = ['interior', 'body', 'electrical', 'suspension', 'engine', 'transmission'];

  const onChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target; setForm((s) => ({ ...s, [name]: value }));
  };

  const onSubmitLocal = (e: React.FormEvent) => {
    e.preventDefault();
    if (!agree) return; // should be disabled already
    const normalizedSrc = toDirectLink(form.src);
    const normalizedDownload = toDirectLink(form.download);
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
    const mailto = `mailto:${encodeURIComponent(MAILTO_TO)}?subject=${encodeURIComponent(subject)}&body=${body}`;
    window.location.href = mailto;
  };

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold mb-2">Добавить модель</h1>
      <p className="text-gray-600 mb-6">Перед отправкой ознакомьтесь с <a className="underline" href="/rules">Правилами публикации</a> и <a className="underline" href="/dmca">DMCA/удаление</a>.</p>

      {FORM_EMBED_URL ? (
        <div className="bg-white border rounded-2xl p-4">
          <label className="flex items-start gap-2 text-sm mb-4">
            <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
            <span>Я ознакомился и согласен с <a className="underline" href="/rules">Правилами</a> и <a className="underline" href="/dmca">DMCA/удалением</a>.</span>
          </label>
          <div className={agree ? "rounded-2xl overflow-hidden border" : "rounded-2xl overflow-hidden border opacity-60 pointer-events-none select-none"}>
            <iframe src={FORM_EMBED_URL} width="100%" height="1200" style={{ border: 0 }} loading="lazy" referrerPolicy="no-referrer-when-downgrade" title="Auto3D Submit Form" />
          </div>
          {!agree && <div className="text-xs text-gray-600 mt-3">Поставьте галочку, чтобы активировать форму.</div>}
        </div>
      ) : (
        <form onSubmit={onSubmitLocal} className="bg-white border rounded-2xl p-6 grid gap-4">
          <div className="grid gap-2 md:grid-cols-2">
            <label className="grid gap-1"><span className="text-sm text-gray-600">Автор</span><input name="author" value={form.author} onChange={onChange} className="px-3 py-2 rounded-xl border" required /></label>
            <label className="grid gap-1"><span className="text-sm text-gray-600">Email</span><input type="email" name="email" value={form.email} onChange={onChange} className="px-3 py-2 rounded-xl border" required /></label>
          </div>
          <div className="grid gap-2 md:grid-cols-2">
            <label className="grid gap-1"><span className="text-sm text-gray-600">Марка</span><input name="brand" value={form.brand} onChange={onChange} className="px-3 py-2 rounded-xl border" required /></label>
            <label className="grid gap-1"><span className="text-sm text-gray-600">Модель</span><input name="model" value={form.model} onChange={onChange} className="px-3 py-2 rounded-xl border" required /></label>
          </div>
          <label className="grid gap-1"><span className="text-sm text-gray-600">Название модели</span><input name="title" value={form.title} onChange={onChange} className="px-3 py-2 rounded-xl border" required /></label>
          <div className="grid gap-2 md:grid-cols-2">
            <label className="grid gap-1"><span className="text-sm text-gray-600">Узел</span><select name="subsystem" value={form.subsystem} onChange={onChange} className="px-3 py-2 rounded-xl border" required><option value="" disabled>Выберите…</option>{['interior','body','electrical','suspension','engine','transmission'].map((s)=> <option key={s} value={s}>{s}</option>)}</select></label>
            <label className="grid gap-1"><span className="text-sm text-gray-600">Лицензия</span><select name="license" value={form.license} onChange={onChange} className="px-3 py-2 rounded-xl border"><option>CC BY</option><option>CC BY-NC</option><option>CC0</option><option>MIT</option></select></label>
          </div>
          <label className="grid gap-1"><span className="text-sm text-gray-600">Описание</span><textarea name="description" value={form.description} onChange={onChange} className="px-3 py-2 rounded-xl border min-h-[120px]" /></label>
          <div className="grid gap-2 md:grid-cols-2">
            <label className="grid gap-1"><span className="text-sm text-gray-600">Ссылка на модель для предпросмотра (GLB/GLTF)</span><input name="src" value={form.src} onChange={onChange} className="px-3 py-2 rounded-xl border" placeholder="Google Drive/Dropbox/Supabase" required /></label>
            <label className="grid gap-1"><span className="text-sm text-gray-600">Ссылка для скачивания</span><input name="download" value={form.download} onChange={onChange} className="px-3 py-2 rounded-xl border" placeholder="Google Drive/Dropbox/Supabase" required /></label>
          </div>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={agree} onChange={(e)=>setAgree(e.target.checked)} required /> <span>Я ознакомился и согласен с <a className="underline" href="/rules">Правилами</a> и <a className="underline" href="/dmca">DMCA/удалением</a>.</span></label>
          <div className="flex items-center justify-between gap-3 pt-2">
            <div className="text-xs text-gray-500">Без сервера мы отправим письмо через <code>mailto:</code>. Укажите <b>MAILTO_TO</b> в коде, чтобы поставить адрес модератора.</div>
            <button disabled={!agree} className={agree?"px-4 py-2 rounded-xl bg-black text-white":"px-4 py-2 rounded-xl bg-gray-300 text-gray-600 cursor-not-allowed"}>Отправить</button>
          </div>
        </form>
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
            <li>3D‑модели авто‑компонентов для печати/ЧПУ/проектов: крепления, адаптеры, органайзеры, декоративные элементы.</li>
            <li>Модели должны принадлежать вам (вы — автор) или быть размещены по лицензии, позволяющей распространение.</li>
          </ul>
        </section>
        <section>
          <h2 className="font-semibold">2. Что нельзя</h2>
          <ul className="list-disc ml-5">
            <li>Нарушение прав третьих лиц (бренды, логотипы, коммерческие CAD, платные модели без разрешения).</li>
            <li>Опасные детали безопасности (элементы тормозной системы и т.п.) без явного предупреждения и дисклеймера.</li>
            <li>Незаконный/вредоносный контент.</li>
          </ul>
        </section>
        <section>
          <h2 className="font-semibold">3. Файлы и предпросмотр</h2>
          <ul className="list-disc ml-5">
            <li>Предпочтительно <b>.glb</b> (glTF‑Binary) с вшитыми текстурами. При использовании .gltf — проверьте пути к текстурам и CORS.</li>
            <li>Даём ссылки, доступные без авторизации. Для Google Drive — «Поделиться для всех со ссылкой».</li>
          </ul>
        </section>
        <section>
          <h2 className="font-semibold">4. Лицензии</h2>
          <p>Рекомендуем: CC BY, CC BY‑NC, CC0, MIT. Указывайте автора и лицензию в описании.</p>
        </section>
        <section>
          <h2 className="font-semibold">5. Модерация</h2>
          <p>Мы можем скрыть/удалить материалы, нарушающие правила. Для жалоб и запросов пишите на <a className="underline" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.</p>
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
            <li>Подтверждение, что вы — правообладатель или уполномоченное лицо.</li>
            <li>Краткое описание нарушения и желаемые действия.</li>
          </ol>
          <p className="mt-2">Направляйте на <a className="underline" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>. Мы постараемся оперативно ответить.</p>
        </section>
        <section>
          <h2 className="font-semibold">Контр‑уведомление</h2>
          <p>Если материал удалён по ошибке, вы можете направить обоснованное обращение на тот же адрес для пересмотра.</p>
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

  const catalog = useMemo(() => (showTests ? [...initialItems, ...TEST_ITEMS] : initialItems), [showTests]);

  const brands = useMemo(() => Array.from(new Set(catalog.map((i) => i.brand))).sort(), [catalog]);
  const models = useMemo(() => Array.from(new Set(catalog.filter((i) => !brand || i.brand === brand).map((i) => i.model))).sort(), [brand, catalog]);
  const subsystems = useMemo(() => Array.from(new Set(catalog.map((i) => i.subsystem))).sort(), [catalog]);

  const items = useMemo(() => {
    return catalog.filter((i) => {
      const matchQ = !q || i.title.toLowerCase().includes(q.toLowerCase()) || i.brand.toLowerCase().includes(q.toLowerCase()) || i.model.toLowerCase().includes(q.toLowerCase());
      const matchBrand = !brand || i.brand === brand;
      const matchModel = !model || i.model === model;
      const matchSubsystem = !subsystem || i.subsystem === subsystem;
      return matchQ && matchBrand && matchModel && matchSubsystem;
    });
  }, [q, brand, model, subsystem, catalog]);

  return (
    <main className="max-w-6xl mx-auto px-4 py-6">
      <p className="text-gray-600 mb-4">Замените ссылки <code>src</code>/<code>download</code> на ваши файлы (Google Drive/Dropbox/Supabase). Лучше использовать <strong>GLB</strong>. Для Google Drive вставляйте обычную ссылку — мы попробуем превратить её в прямую. Для OBJ/STL система подскажет конвертацию вместо падения.</p>
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
                <div className="text-sm text-gray-500">{i.brand} • {i.model} • {i.subsystem}</div>
                <h3 className="text-lg font-semibold mt-1">{i.title}</h3>
                <div className="mt-3 flex gap-2">
                  <a href={toDirectLink(i.download)} className="px-3 py-2 rounded-xl bg-black text-white text-sm" target="_blank" rel="noopener noreferrer">Скачать</a>
                  <button onClick={() => navigator.clipboard.writeText(window.location.href + '#' + i.id)} className="px-3 py-2 rounded-xl border text-sm">Поделиться</button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </main>
  );
}

// ===== App Shell with simple route switch =====
function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => { if (pathname === '/sumbit') router.replace('/submit'); }, [pathname, router]);

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="sticky top-0 z-10 backdrop-blur bg-white/70 border-b">
        <div className="max-w-6xl mx-auto px-4 py-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <h1 className="text-2xl font-bold tracking-tight">Auto3D <span className="text-gray-500 text-base">free‑tier demo</span></h1>
          <nav className="flex flex-wrap gap-2 items-center text-sm">
            <a href="/" className="px-3 py-2 rounded-xl border bg-white hover:bg-gray-100">Каталог</a>
            <a href="/submit" className="px-3 py-2 rounded-xl bg-black text-white hover:opacity-90">Добавить модель</a>
            <a href="/rules" className="px-3 py-2 rounded-xl border bg-white hover:bg-gray-100">Правила</a>
            <a href="/dmca" className="px-3 py-2 rounded-xl border bg-white hover:bg-gray-100">DMCA/Удаление</a>
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
  const pathname = usePathname();
  if (pathname === '/submit' || pathname === '/sumbit') {
    return <AppShell><SubmitPage /></AppShell>;
  }
  if (pathname === '/rules') {
    return <AppShell><RulesPage /></AppShell>;
  }
  if (pathname === '/dmca') {
    return <AppShell><DmcaPage /></AppShell>;
  }
  return <AppShell><CatalogApp /></AppShell>;
}
