'use client';
import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';

/**
 * Auto3D — Simplified (GitHub-only upload, static previews)
 * --------------------------------------------------------
 * • Убрали model-viewer, Meshy, Supabase, IndexedDB — только статичные превью и загрузка на GitHub через /api/gh-upload
 * • Никаких next/navigation хуков (чтобы не было ошибок Suspense/CSR)
 * • Карточки с картинкой (постер/URL) + кнопка «Скачать»
 * • /?view=submit или /submit → форма добавления + загрузка на GitHub
 * • Локальный каталог хранится в localStorage (видно только вам). После аплоада на GitHub — ссылка jsDelivr добавляется в карточку
 *
 * Требования окружения (Vercel → Settings → Environment Variables):
 *   GH_TOKEN  = <GitHub PAT с правом contents:write>
 *   GH_REPO   = OlegPavlichenko/auto3dm
 *   GH_BRANCH = main
 * Проверка: откройте /api/gh-upload?ping=1 (должно ok: true)
 */

// ===== Helpers =====
const PLACEHOLDER_IMG =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<?xml version="1.0" encoding="UTF-8"?>
` +
      `<svg xmlns='http://www.w3.org/2000/svg' width='800' height='450'>` +
      `<defs><linearGradient id='g' x1='0' x2='1'><stop offset='0' stop-color='#f3f4f6'/><stop offset='1' stop-color='#e5e7eb'/></linearGradient></defs>` +
      `<rect fill='url(#g)' width='100%' height='100%'/>` +
      `<g fill='#6b7280' font-family='Arial,sans-serif' font-size='22'>` +
      `<text x='50%' y='50%' dominant-baseline='middle' text-anchor='middle'>Предпросмотр</text>` +
      `</g>` +
      `</svg>`
  );

function toDirectLink(url: string): string {
  try {
    if (!url) return url;
    const g = url.match(/drive\.google\.com\/file\/d\/([^\/]+)/);
    if (g && g[1]) return `https://drive.google.com/uc?export=download&id=${g[1]}`;
    if (url.includes('dropbox.com')) return url.replace(/\?dl=0$/, '?dl=1');
    return url;
  } catch {
    return url;
  }
}

// ===== Data layer (localStorage) =====
export type Item = {
  id: string;
  brand: string;
  model: string;
  title: string;
  subsystem: string;
  download: string;     // ссылка на GLB (jsDelivr/GitHub/Drive и т.п.)
  image?: string;       // URL постера (необязательно)
};

const LS_KEY = 'auto3d-items-v2';
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

// ===== Demo items (tests kept, now as static cards) =====
const SAMPLE_DUCK = 'https://rawcdn.githack.com/KhronosGroup/glTF-Sample-Models/master/2.0/Duck/glTF-Binary/Duck.glb';
const SAMPLE_HELMET = 'https://rawcdn.githack.com/KhronosGroup/glTF-Sample-Models/master/2.0/DamagedHelmet/glTF-Binary/DamagedHelmet.glb';

const initialItems: Item[] = [
  { id: 'kia-carnival-cupholder', brand: 'Kia', model: 'Carnival', title: 'Cupholder insert (demo)', subsystem: 'interior', download: SAMPLE_DUCK },
  { id: 'toyota-bb-hook', brand: 'Toyota', model: 'bB', title: 'Cargo hook (demo)', subsystem: 'interior', download: SAMPLE_DUCK },
  { id: 'vw-golf3-vent', brand: 'Volkswagen', model: 'Golf 3', title: 'Vent clip mount (demo)', subsystem: 'interior', download: SAMPLE_DUCK },
];

const TEST_ITEMS: Item[] = [
  { id: 'test-ok-duck', brand: 'TEST', model: 'Embedded', title: 'TEST: Duck.glb (download only)', subsystem: 'test', download: SAMPLE_DUCK },
  { id: 'test-ok-helmet', brand: 'TEST', model: 'Embedded', title: 'TEST: DamagedHelmet.glb (download only)', subsystem: 'test', download: SAMPLE_HELMET },
  { id: 'test-broken-url', brand: 'TEST', model: 'Broken', title: 'TEST: Broken URL (expect 404 on download)', subsystem: 'test', download: 'https://example.com/notfound.glb' },
  { id: 'test-empty-download', brand: 'TEST', model: 'Edge', title: 'TEST: Empty download (disabled button)', subsystem: 'test', download: '' },
];

// ===== Tiny client router based on query ?view=... (no next/navigation) =====
function useView() {
  const [view, setView] = useState('');
  useEffect(() => {
    if (typeof window === 'undefined') return;

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
      if (pathname === '/submit' || pathname === '/sumbit') { url.pathname = '/'; url.searchParams.set('view','submit'); history.replaceState({}, '', url.toString()); }
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
  const [agree, setAgree] = useState(false);
  const [status, setStatus] = useState('');

  const [form, setForm] = useState({
    author: '', email: '',
    brand: '', model: '', title: '', subsystem: 'interior',
    description: '',
    download: '',
    image: '', // optional image URL
  });

  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  const onChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target; setForm((s) => ({ ...s, [name]: value }));
  };

  const makeItem = (downloadUrl?: string): Item => ({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    brand: form.brand.trim() || 'Custom',
    model: form.model.trim() || 'Model',
    title: form.title.trim() || (file?.name || 'Uploaded model'),
    subsystem: form.subsystem || 'interior',
    download: toDirectLink(downloadUrl || form.download.trim()),
    image: form.image.trim() || undefined,
  });

  const addLocal = () => {
    if (!agree) { setStatus('Поставьте галочку согласия с правилами.'); return; }
    if (!form.download.trim()) { setStatus('Укажите ссылку для скачивания или загрузите файл.'); return; }
    addLocalItem(makeItem());
    setStatus('Карточка добавлена локально.');
  };

  const uploadToGitHub = async () => {
    if (!agree) { setStatus('Поставьте галочку согласия с правилами.'); return; }
    if (!file) { setStatus('Выберите GLB файл.'); return; }

    const sizeMb = file.size / (1024 * 1024);
    if (sizeMb > 75) { setStatus(`Файл ${sizeMb.toFixed(1)} MB больше лимита 75 MB.`); return; }

    try {
      setUploading(true);
      setStatus('Загрузка на GitHub…');
      const fd = new FormData();
      fd.append('file', file, file.name || 'model.glb');
      fd.append('brand', form.brand);
      fd.append('model', form.model);

      const res = await fetch('/api/gh-upload', { method: 'POST', body: fd });
      const data = await res.json().catch(() => ({}));
      setUploading(false);

      if (!res.ok || !data?.url) {
        setStatus(`Ошибка загрузки: HTTP ${res.status} . Ответ: ${data?.error || res.statusText}`);
        return;
      }

      const url: string = data.url;
      setForm((s) => ({ ...s, download: url }));
      const item = makeItem(url);
      addLocalItem(item);
      setStatus('Файл загружен на GitHub и добавлен в каталог.');
    } catch (e: any) {
      setUploading(false);
      setStatus('Ошибка: ' + (e?.message || e));
    }
  };

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold mb-2">Добавить модель</h1>
      <p className="text-gray-600 mb-6">Теперь только статичные карточки и загрузка на GitHub (jsDelivr). 3D‑вьюер выключен для простоты.</p>

      {/* A. Загрузка на GitHub */}
      <div className="bg-white border rounded-2xl p-6 grid gap-4 mb-8">
        <h2 className="text-lg font-semibold">Загрузка GLB на GitHub</h2>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="grid gap-1"><span className="text-sm text-gray-600">Марка</span><input name="brand" value={form.brand} onChange={onChange} className="px-3 py-2 rounded-xl border" required /></label>
          <label className="grid gap-1"><span className="text-sm text-gray-600">Модель</span><input name="model" value={form.model} onChange={onChange} className="px-3 py-2 rounded-xl border" required /></label>
        </div>
        <label className="grid gap-1"><span className="text-sm text-gray-600">Название модели</span><input name="title" value={form.title} onChange={onChange} className="px-3 py-2 rounded-xl border" placeholder="Например, Cupholder insert" /></label>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="grid gap-1"><span className="text-sm text-gray-600">Подсистема</span>
            <select name="subsystem" value={form.subsystem} onChange={onChange} className="px-3 py-2 rounded-xl border">
              <option value="interior">interior</option>
              <option value="body">body</option>
              <option value="electrical">electrical</option>
              <option value="suspension">suspension</option>
              <option value="engine">engine</option>
              <option value="transmission">transmission</option>
            </select>
          </label>
          <label className="grid gap-1"><span className="text-sm text-gray-600">Постер (URL, опционально)</span><input name="image" value={form.image} onChange={onChange} className="px-3 py-2 rounded-xl border" placeholder="https://…/preview.jpg" /></label>
        </div>
        <label className="grid gap-1"><span className="text-sm text-gray-600">GLB файл</span>
          <input type="file" accept=".glb" onChange={(e)=>setFile(e.target.files?.[0]||null)} className="px-3 py-2 rounded-xl border" />
        </label>
        <div className="flex items-center gap-3">
          <button type="button" onClick={uploadToGitHub} disabled={!file || !agree || uploading} className={(!file || !agree || uploading)?'px-4 py-2 rounded-xl bg-gray-300 text-gray-600 cursor-not-allowed':'px-4 py-2 rounded-xl bg-black text-white'}>
            {uploading? 'Загружаем…' : 'Загрузить на GitHub и добавить'}
          </button>
          <span className="text-xs text-gray-500">После загрузки ссылка добавится в поле «Ссылка для скачивания» и в каталог.</span>
        </div>
      </div>

      {/* B. Ручное добавление карточки (без загрузки) */}
      <div className="bg-white border rounded-2xl p-6 grid gap-4 mb-8">
        <h2 className="text-lg font-semibold">Или указать готовую ссылку</h2>
        <label className="grid gap-1"><span className="text-sm text-gray-600">Ссылка для скачивания (GLB)</span><input name="download" value={form.download} onChange={onChange} className="px-3 py-2 rounded-xl border" placeholder="https://cdn.jsdelivr.net/gh/user/repo@main/uploads/…/file.glb" /></label>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={agree} onChange={(e)=>setAgree(!!e.target.checked)} /> <span>Я согласен с <Link className="underline" href="/?view=rules">Правилами</Link> и <Link className="underline" href="/?view=dmca">DMCA/удалением</Link>.</span></label>
        <div className="flex items-center gap-3">
          <button type="button" onClick={addLocal} disabled={!agree} className={agree?'px-4 py-2 rounded-xl border bg-white hover:bg-gray-100':'px-4 py-2 rounded-xl border bg-gray-200 text-gray-500 cursor-not-allowed'}>
            Добавить в каталог (локально)
          </button>
          {status && <span className="text-sm text-gray-700">{status}</span>}
        </div>
      </div>
    </div>
  );
}

function RulesPage() {
  const CONTACT_EMAIL = 'contact@example.com';
  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold mb-2">Правила публикации</h1>
      <p className="text-gray-600 mb-4">Коротко о том, что можно и нельзя публиковать.</p>
      <div className="bg-white border rounded-2xl p-6 space-y-4 text-sm leading-6">
        <section>
          <h2 className="font-semibold">1. Разрешено</h2>
          <ul className="list-disc ml-5">
            <li>3D‑модели автомобильных компонентов для печати/ЧПУ.</li>
            <li>Только ваши работы или по лицензии, позволяющей распространение.</li>
          </ul>
        </section>
        <section>
          <h2 className="font-semibold">2. Запрещено</h2>
          <ul className="list-disc ml-5">
            <li>Нарушение авторских прав и торговых марок.</li>
            <li>Опасные детали без дисклеймеров.</li>
          </ul>
        </section>
        <section>
          <h2 className="font-semibold">3. Файлы</h2>
          <ul className="list-disc ml-5">
            <li>Лучше .glb. Ссылка должна быть доступна без авторизации.</li>
          </ul>
        </section>
        <section>
          <h2 className="font-semibold">4. Связь</h2>
          <p>Жалобы/запросы: <a className="underline" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.</p>
        </section>
      </div>
    </div>
  );
}

function DmcaPage() {
  const CONTACT_EMAIL = 'contact@example.com';
  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold mb-2">DMCA / Удаление по запросу</h1>
      <p className="text-gray-600 mb-4">Если вы считаете, что материал нарушает ваши права, отправьте запрос.</p>
      <div className="bg-white border rounded-2xl p-6 space-y-4 text-sm leading-6">
        <ol className="list-decimal ml-5">
          <li>Ссылки на материалы.</li>
          <li>Данные правообладателя и контакт.</li>
          <li>Подтверждение прав.</li>
          <li>Описание нарушения и желаемые действия.</li>
        </ol>
        <p className="mt-2">Пишите на <a className="underline" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.</p>
      </div>
    </div>
  );
}

// ===== Catalog =====
function CatalogApp() {
  const [q, setQ] = useState('');
  const [brand, setBrand] = useState('');
  const [model, setModel] = useState('');
  const [subsystem, setSubsystem] = useState('');
  const [showTests, setShowTests] = useState(false);

  const [localItems, setLocalItems] = useState<Item[]>([]);

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

    const onUrl = () => syncFromUrl();
    window.addEventListener('url-change', onUrl);

    return () => {
      window.removeEventListener('local-items-updated', onLocal);
      window.removeEventListener('storage', onLocal);
      window.removeEventListener('url-change', onUrl);
    };
  }, []);

  const catalog = useMemo(() => {
    const base = [...initialItems];
    const withTests = showTests ? [...base, ...TEST_ITEMS] : base;
    return [...localItems, ...withTests];
  }, [localItems, showTests]);

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
      <p className="text-gray-600 mb-4">Каталог показывает статичные карточки. Ссылки ведут на GLB (GitHub/jsDelivr или другие хостинги).</p>
      <div className="flex flex-wrap gap-2 items-center mb-4">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск: Kia, Golf 3, cupholder..." className="px-3 py-2 rounded-xl border w-64 focus:outline-none focus:ring" />
        <select value={brand} onChange={(e) => { setBrand(e.target.value); setModel(''); }} className="px-3 py-2 rounded-xl border"><option value="">Марка</option>{brands.map((b)=>(<option key={b} value={b}>{b}</option>))}</select>
        <select value={model} onChange={(e) => setModel(e.target.value)} className="px-3 py-2 rounded-xl border"><option value="">Модель</option>{models.map((m)=>(<option key={m} value={m}>{m}</option>))}</select>
        <select value={subsystem} onChange={(e) => setSubsystem(e.target.value)} className="px-3 py-2 rounded-xl border"><option value="">Узел</option>{subsystems.map((s)=>(<option key={s} value={s}>{s}</option>))}</select>
        <button onClick={() => { setQ(''); setBrand(''); setModel(''); setSubsystem(''); }} className="px-3 py-2 rounded-xl border bg-white hover:bg-gray-100">Сброс</button>
        <label className="ml-2 inline-flex items-center gap-2 text-xs text-gray-600">
          <input type="checkbox" onChange={(e)=>{ try { const checked = !!e.target && (e.target as HTMLInputElement).checked; if (typeof window==='undefined') return; const url = new URL(window.location.href); if (checked) url.searchParams.set('tests','1'); else url.searchParams.delete('tests'); window.history.replaceState({}, '', url.toString()); window.dispatchEvent(new Event('url-change')); } catch{} }} />
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
                <img src={i.image || PLACEHOLDER_IMG} alt={i.title} className="absolute inset-0 w-full h-full object-contain" />
              </div>
              <div className="p-4">
                <div className="text-sm text-gray-500">{i.brand} • {i.model} • {i.subsystem}</div>
                <h3 className="text-lg font-semibold mt-1">{i.title}</h3>
                <div className="mt-3 flex gap-2">
                  <a href={toDirectLink(i.download)} className={`px-3 py-2 rounded-xl text-sm ${i.download? 'bg-black text-white' : 'bg-gray-300 text-gray-600 pointer-events-none'}`} target={i.download? '_blank' : undefined} rel={i.download? 'noopener noreferrer' : undefined}>
                    Скачать
                  </a>
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
      <header className="sticky top-0 z-10 backdrop-blur bg-white/70 border-b">
        <div className="max-w-6xl mx-auto px-4 py-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <h1 className="text-2xl font-bold tracking-tight">Auto3D <span className="text-gray-500 text-base">simple</span></h1>
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
          <div>© {new Date().getFullYear()} Auto3D — демо (GitHub upload)</div>
          <div className="flex gap-3">
            <a className="underline" href="https://vercel.com/">Vercel</a>
            <a className="underline" href="https://github.com/">GitHub</a>
            <a className="underline" href="https://www.jsdelivr.com/">jsDelivr</a>
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


// =============================
// File: app/api/gh-upload/route.ts
// Node runtime Route Handler for uploading GLB to GitHub and returning jsDelivr URL
// =============================

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';

function slug(v: string): string {
  try {
    return (v || '')
      .toString()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase();
  } catch { return 'x'; }
}
function safeFileName(name: string): string {
  return (name || 'model.glb').replace(/[^a-zA-Z0-9_.-]/g, '_');
}

// GET /api/gh-upload?ping=1 → quick health/env check (does NOT leak secrets)
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  if (searchParams.get('ping') === '1') {
    const GH_TOKEN  = process.env.GH_TOKEN;
    const GH_REPO   = process.env.GH_REPO;
    const GH_BRANCH = process.env.GH_BRANCH || 'main';
    return NextResponse.json(
      {
        ok: true,
        env: {
          GH_TOKEN: !!GH_TOKEN,           // true/false only
          GH_REPO: GH_REPO || '(empty)',
          GH_BRANCH,
        },
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  }
  return NextResponse.json({ ok: true });
}

// POST multipart/form-data { file, brand, model } → upload to GitHub
export async function POST(req: Request) {
  try {
    const GH_TOKEN  = process.env.GH_TOKEN;
    const GH_REPO   = process.env.GH_REPO;
    const GH_BRANCH = process.env.GH_BRANCH || 'main';

    if (!GH_TOKEN || !GH_REPO) {
      return NextResponse.json({ error: 'Missing GH_TOKEN or GH_REPO env' }, { status: 500 });
    }

    const form = await req.formData();
    const file = form.get('file') as File | null;
    const brand = String(form.get('brand') || 'brand');
    const model = String(form.get('model') || 'model');

    if (!file) {
      return NextResponse.json({ error: 'file is required' }, { status: 400 });
    }

    const relPath = `${slug(brand)}/${slug(model)}/${Date.now()}-${safeFileName((file as any).name || 'model.glb')}`;

    const [owner, repo] = GH_REPO.split('/');
    if (!owner || !repo) {
      return NextResponse.json({ error: `GH_REPO should be in the form owner/repo, got: ${GH_REPO}` }, { status: 500 });
    }

    const buf = Buffer.from(await file.arrayBuffer());
    const base64 = buf.toString('base64');
    const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(relPath)}`;

    const ghRes = await fetch(apiUrl, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${GH_TOKEN}`,
        'Accept': 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify({
        message: `upload ${relPath}`,
        branch: GH_BRANCH,
        content: base64,
      }),
    });

    const text = await ghRes.text();
    if (!ghRes.ok) {
      return NextResponse.json({ error: `GitHub PUT ${ghRes.status}: ${text}` }, { status: ghRes.status });
    }

    const cdnUrl = `https://cdn.jsdelivr.net/gh/${owner}/${repo}@${GH_BRANCH}/${relPath}`;
    return NextResponse.json({ ok: true, url: cdnUrl, path: relPath });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}


// ======================
// app/api/gh-upload/route.ts
// Server route for uploading GLB files to GitHub via PAT
// ======================

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Small helpers
function slug(v: string): string {
  try {
    return (v || '')
      .toString()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase();
  } catch { return 'x'; }
}
function safeFileName(name: string): string {
  return (name || 'model.glb').replace(/[^a-zA-Z0-9_.-]/g, '_');
}

function env() {
  const GH_TOKEN  = (process.env.GH_TOKEN  || '').trim();
  const GH_REPO   = (process.env.GH_REPO   || '').trim();
  const GH_BRANCH = (process.env.GH_BRANCH || 'main').trim();
  return { GH_TOKEN, GH_REPO, GH_BRANCH };
}

async function ghJson(url: string, token: string, init: RequestInit = {}) {
  const res = await fetch(url, {
    ...init,
    headers: {
      'Authorization': `token ${token}`,
      'Accept': 'application/vnd.github+json',
      ...(init.headers || {}),
    },
    cache: 'no-store',
  });
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* keep text */ }
  return { res, json, text };
}

export async function GET(request: Request) {
  const { GH_TOKEN, GH_REPO, GH_BRANCH } = env();
  const { searchParams } = new URL(request.url);
  if (searchParams.get('ping') !== '1') {
    return new Response('OK', { status: 200 });
  }

  // Basic env presence
  const present = {
    GH_TOKEN: !!GH_TOKEN,
    GH_REPO,
    GH_BRANCH,
    VERCEL_ENV: process.env.VERCEL_ENV || null,
  };

  // Optional: check GitHub whoami + repo access to help debug
  let who = { ok: false as boolean, status: 0 as number };
  let repo = { ok: false as boolean, status: 0 as number };
  if (GH_TOKEN) {
    try {
      const r1 = await fetch('https://api.github.com/user', { headers: { Authorization: `token ${GH_TOKEN}` }, cache: 'no-store' });
      who = { ok: r1.ok, status: r1.status };
    } catch { /* ignore */ }
  }
  if (GH_TOKEN && GH_REPO) {
    try {
      const r2 = await fetch(`https://api.github.com/repos/${GH_REPO}`, { headers: { Authorization: `token ${GH_TOKEN}` }, cache: 'no-store' });
      repo = { ok: r2.ok, status: r2.status };
    } catch { /* ignore */ }
  }

  const ok = !!GH_TOKEN && !!GH_REPO;
  const body = { ok, env: present, status: { who, repo } };
  return new Response(JSON.stringify(body, null, 2), { status: ok ? 200 : 500, headers: { 'content-type': 'application/json' } });
}

export async function POST(request: Request) {
  try {
    const { GH_TOKEN, GH_REPO, GH_BRANCH } = env();
    if (!GH_TOKEN || !GH_REPO) {
      return new Response(JSON.stringify({ ok: false, error: 'Missing GH_TOKEN or GH_REPO env' }, null, 2), { status: 500, headers: { 'content-type': 'application/json' } });
    }

    const form = await request.formData();
    const file = form.get('file');
    const brand = String(form.get('brand') || 'brand');
    const model = String(form.get('model') || 'model');
    if (!(file instanceof File)) {
      return new Response(JSON.stringify({ ok: false, error: 'No file field' }), { status: 400, headers: { 'content-type': 'application/json' } });
    }

    const contentArrayBuffer = await file.arrayBuffer();
    const contentB64 = Buffer.from(contentArrayBuffer).toString('base64');

    const path = `${slug(brand)}/${slug(model)}/${Date.now()}-${safeFileName(file.name || 'model.glb')}`;
    const [owner, repo] = GH_REPO.split('/');
    const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`;

    const message = `upload: ${path}`;
    const putBody = {
      message,
      content: contentB64,
      branch: GH_BRANCH,
    };

    const put = await ghJson(url, GH_TOKEN, {
      method: 'PUT',
      body: JSON.stringify(putBody),
      headers: { 'content-type': 'application/json' },
    });

    if (!put.res.ok) {
      const text = put.text || JSON.stringify(put.json);
      return new Response(JSON.stringify({ ok: false, error: `GitHub PUT ${put.res.status}: ${put.res.statusText}`, detail: text }), { status: put.res.status || 500, headers: { 'content-type': 'application/json' } });
    }

    // Compose a CDN URL via jsDelivr (available soon after commit)
    const cdn = `https://cdn.jsdelivr.net/gh/${GH_REPO}@${GH_BRANCH}/${path}`;
    return new Response(JSON.stringify({ ok: true, url: cdn, path, branch: GH_BRANCH }), { status: 200, headers: { 'content-type': 'application/json' } });
  } catch (e: any) {
    return new Response(JSON.stringify({ ok: false, error: String(e?.message || e) }), { status: 500, headers: { 'content-type': 'application/json' } });
  }
}
