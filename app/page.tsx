'use client';
import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';

// Allow NEXT_PUBLIC_* override for upload endpoint in client code
// @ts-ignore
declare const process: any;
const UPLOAD_ENDPOINT: string =
  (typeof process !== 'undefined' && process?.env?.NEXT_PUBLIC_UPLOAD_ENDPOINT) ||
  '/api/gh-upload';

/**
 * Auto3D — GitHub‑only, static preview edition
 * --------------------------------------------
 * Что изменил:
 * - Полностью убрал <model-viewer>, Supabase и Meshy: теперь только статичные картинки и загрузка на GitHub.
 * - Починил синтаксис и разметку — никаких «висячих» JSX‑блоков и дубликатов функций.
 * - Добавил простой роутер через query (?view=submit|rules|dmca).
 * - Кнопка «Загрузить на GitHub и добавить» отправляет файл в /api/gh-upload и сразу добавляет карточку.
 * - Карточки сохраняются в localStorage (видно только на этом устройстве). Можно дополнительно дублировать метаданные в репо, если нужно — скажешь, добавлю.
 */

// ===== Types =====
export type Item = {
  id: string;
  brand: string;
  model: string;
  title: string;
  subsystem: string;
  // Для статического превью используем image
  image?: string; // URL статичной картинки (png/jpg/webp)
  // Для скачивания храним ссылку (например, на GLB или zip) — опционально
  download?: string;
};

// ===== Local storage =====
const LS_KEY = 'auto3d-items-v2-static';
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

// ===== Small helpers =====
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
function safeFileName(name: string): string { return (name || 'file').replace(/[^a-zA-Z0-9_.-]/g, '_'); }

// ===== Minimal client router (no next/navigation) =====
function useView() {
  const [view, setView] = useState<string>('');
  useEffect(() => {
    if (typeof window === 'undefined') return;

    // Патчим history API, чтобы отправлять событие при push/replace
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
      // Мягкие редиректы на один маршрут с query
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
  const [form, setForm] = useState({
    author: '', email: '', brand: '', model: '', title: '', subsystem: 'interior',
    description: '', download: ''
  });
  const [agree, setAgree] = useState(false);
  const [status, setStatus] = useState<string>('');
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  const onChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target; setForm((s) => ({ ...s, [name]: value }));
  };

  const makeItem = (imageUrl?: string, downloadUrl?: string): Item => ({
    id: `${Date.now()}-${Math.random().toString(36).slice(2,8)}`,
    brand: form.brand.trim() || 'Custom',
    model: form.model.trim() || 'Model',
    title: form.title.trim() || (file?.name || 'Item'),
    subsystem: form.subsystem || 'interior',
    image: imageUrl,
    download: downloadUrl || form.download.trim() || imageUrl,
  });

  const addLocalImageOnly = () => {
    if (!agree) { setStatus('Поставьте галочку согласия с правилами.'); return; }
    if (!form.download && !file) { setStatus('Выберите файл или укажите ссылку на картинку.'); return; }
    // Если пользователь указал внешнюю ссылку на картинку
    if (!file && form.download) {
      addLocalItem(makeItem(form.download, form.download));
      setStatus('Карточка добавлена (с внешней картинкой).');
      return;
    }
    setStatus('Чтобы добавить локальный файл — используйте загрузку на GitHub ниже.');
  };

  const uploadToGitHub = async () => {
    if (!agree) { setStatus('Поставьте галочку согласия с правилами.'); return; }
    if (!file) { setStatus('Выберите файл картинки (.glb/.png/.jpg/.jpeg/.webp).'); return; }
    const isImage = /^image\//.test(file.type) || /\.(glb|png|jpe?g|webp)$/i.test(file.name);
    if (!isImage) { setStatus('Сейчас принимаются только изображения (glb/png/jpg/webp).'); return; }

    try {
      setUploading(true); setStatus('Загрузка на GitHub…');
      const fd = new FormData();
      fd.append('file', file, file.name || 'image.png');
      // Красивый путь в репо: brand/model/timestamp-filename
      const rel = `${slug(form.brand||'brand')}/${slug(form.model||'model')}/${Date.now()}-${safeFileName(file.name||'image.png')}`;
      fd.append('path', rel);

      const res = await fetch(UPLOAD_ENDPOINT, { method: 'POST', body: fd });
      const data = await res.json().catch(()=>({}));
      setUploading(false);
      if (!res.ok || !data?.url) { setStatus(`Ошибка загрузки: HTTP ${res.status}${data?.error?` • ${data.error}`:''}`); return; }

      const url: string = data.url; // CDN (jsDelivr)
      const item = makeItem(url, url);
      addLocalItem(item);
      setStatus('Готово! Файл загружен на GitHub и карточка добавлена.');
    } catch (e: any) {
      setUploading(false);
      setStatus('Ошибка: ' + (e?.message || e));
    }
  };

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold mb-2">Добавить модель (картинка)</h1>
      <p className="text-gray-600 mb-6">Сейчас поддерживаем <b>статичные изображения</b> (png/jpg/webp). 3D‑просмотр временно отключён.</p>

      <div className="bg-white border rounded-2xl p-6 grid gap-4 mb-8">
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="grid gap-1"><span className="text-sm text-gray-600">Марка</span><input name="brand" value={form.brand} onChange={onChange} className="px-3 py-2 rounded-xl border" required/></label>
          <label className="grid gap-1"><span className="text-sm text-gray-600">Модель</span><input name="model" value={form.model} onChange={onChange} className="px-3 py-2 rounded-xl border" required/></label>
        </div>
        <label className="grid gap-1"><span className="text-sm text-gray-600">Название</span><input name="title" value={form.title} onChange={onChange} className="px-3 py-2 rounded-xl border" required/></label>
        <label className="grid gap-1"><span className="text-sm text-gray-600">Узел</span>
          <select name="subsystem" value={form.subsystem} onChange={onChange} className="px-3 py-2 rounded-xl border">
            <option value="interior">interior</option>
            <option value="body">body</option>
            <option value="electrical">electrical</option>
            <option value="suspension">suspension</option>
            <option value="engine">engine</option>
            <option value="transmission">transmission</option>
          </select>
        </label>
        <label className="grid gap-1"><span className="text-sm text-gray-600">Описание (необязательно)</span><textarea name="description" value={form.description} onChange={onChange} className="px-3 py-2 rounded-xl border"/></label>

        {/* Вариант A: просто добавить внешнюю ссылку на картинку (без загрузки) */}
        <div className="grid gap-1">
          <span className="text-sm text-gray-600">Прямая ссылка на картинку (опционально)</span>
          <input name="download" value={form.download} onChange={onChange} className="px-3 py-2 rounded-xl border" placeholder="https://.../image.png"/>
          <div className="flex items-center gap-3 mt-2">
            <button type="button" onClick={addLocalImageOnly} disabled={!agree} className={agree?"px-4 py-2 rounded-xl border":"px-4 py-2 rounded-xl border bg-gray-200 text-gray-500 cursor-not-allowed"}>Добавить без загрузки</button>
            <span className="text-xs text-gray-500">Ссылка должна быть общедоступной.</span>
          </div>
        </div>

        {/* Вариант B: загрузить файл на GitHub через API */}
        <div className="grid gap-1">
          <span className="text-sm text-gray-600">Файл картинки (png/jpg/webp)</span>
          <input type="file" accept=".png,.jpg,.jpeg,.webp" onChange={(e)=>setFile(e.target.files?.[0]||null)} className="px-3 py-2 rounded-xl border"/>
          <div className="flex items-center gap-3 mt-2">
            <button type="button" onClick={uploadToGitHub} disabled={!file || !agree || uploading} className={!file || !agree || uploading?"px-4 py-2 rounded-xl bg-gray-300 text-gray-600 cursor-not-allowed":"px-4 py-2 rounded-xl bg-black text-white"}>{uploading? 'Загружаем…':'Загрузить на GitHub и добавить'}</button>
            <span className="text-xs text-gray-500">Файл будет доступен через CDN (jsDelivr).</span>
          </div>
        </div>

        <label className="flex items-start gap-2 text-sm mt-2"><input type="checkbox" checked={agree} onChange={(e)=>setAgree(!!e.target.checked)} required/> <span>Я согласен с <Link className="underline" href="/?view=rules">Правилами</Link> и <Link className="underline" href="/?view=dmca">DMCA/удалением</Link>.</span></label>
        {status && <div className="text-sm text-gray-700 bg-gray-50 border rounded-xl p-3">{status}</div>}
      </div>
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
            <li>3D‑модели/фото авто‑компонентов: крепления, адаптеры, органайзеры, декоративные элементы.</li>
            <li>Контент должен принадлежать вам или распространяться по лицензии, позволяющей публикацию.</li>
          </ul>
        </section>
        <section>
          <h2 className="font-semibold">2. Что нельзя</h2>
          <ul className="list-disc ml-5">
            <li>Нарушение прав третьих лиц (бренды, логотипы, коммерческие CAD без разрешения).</li>
            <li>Опасные детали безопасности без дисклеймера.</li>
            <li>Незаконный/вредоносный контент.</li>
          </ul>
        </section>
        <section>
          <h2 className="font-semibold">3. Файлы и предпросмотр</h2>
          <ul className="list-disc ml-5">
            <li>Пока поддерживаем статичные изображения (png/jpg/webp). 3D‑просмотр позже.</li>
            <li>Ссылки на картинки должны быть доступны без авторизации.</li>
          </ul>
        </section>
        <section>
          <h2 className="font-semibold">4. Лицензии</h2>
          <p>Рекомендуем: CC BY, CC BY‑NC, CC0, MIT. Указывайте автора и лицензию.</p>
        </section>
        <section>
          <h2 className="font-semibold">5. Модерация</h2>
          <p>Жалобы и запросы — на контактный email на сайте.</p>
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
        </section>
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
  const [localItems, setLocalItems] = useState<Item[]>([]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    setLocalItems(readLocalItems());
    const onLocal = () => setLocalItems(readLocalItems());
    window.addEventListener('local-items-updated', onLocal);
    window.addEventListener('storage', onLocal);
    return () => { window.removeEventListener('local-items-updated', onLocal); window.removeEventListener('storage', onLocal); };
  }, []);

  const catalog = useMemo(() => localItems, [localItems]);
  const brands = useMemo(() => Array.from(new Set(catalog.map(i=>i.brand))).sort(), [catalog]);
  const models = useMemo(() => Array.from(new Set(catalog.filter(i=>!brand || i.brand===brand).map(i=>i.model))).sort(), [brand, catalog]);
  const subsystems = useMemo(() => Array.from(new Set(catalog.map(i=>i.subsystem))).sort(), [catalog]);

  const items = useMemo(() => catalog.filter((i) => {
    const ql = q.toLowerCase();
    const matchQ = !q || i.title.toLowerCase().includes(ql) || i.brand.toLowerCase().includes(ql) || i.model.toLowerCase().includes(ql);
    const matchBrand = !brand || i.brand === brand;
    const matchModel = !model || i.model === model;
    const matchSubsystem = !subsystem || i.subsystem === subsystem;
    return matchQ && matchBrand && matchModel && matchSubsystem;
  }), [q, brand, model, subsystem, catalog]);

  return (
    <main className="max-w-6xl mx-auto px-4 py-6">
      <p className="text-gray-600 mb-4">Каталог показывает локально добавленные карточки (картинки). Чтобы добавить новую — перейдите на вкладку «Добавить модель».</p>
      <div className="flex flex-wrap gap-2 items-center mb-4">
        <input value={q} onChange={(e)=>setQ(e.target.value)} placeholder="Поиск: Kia, Golf 3..." className="px-3 py-2 rounded-xl border w-64 focus:outline-none focus:ring"/>
        <select value={brand} onChange={(e)=>{ setBrand(e.target.value); setModel(''); }} className="px-3 py-2 rounded-xl border"><option value="">Марка</option>{brands.map(b=>(<option key={b} value={b}>{b}</option>))}</select>
        <select value={model} onChange={(e)=>setModel(e.target.value)} className="px-3 py-2 rounded-xl border"><option value="">Модель</option>{models.map(m=>(<option key={m} value={m}>{m}</option>))}</select>
        <select value={subsystem} onChange={(e)=>setSubsystem(e.target.value)} className="px-3 py-2 rounded-xl border"><option value="">Узел</option>{subsystems.map(s=>(<option key={s} value={s}>{s}</option>))}</select>
        <button onClick={()=>{ setQ(''); setBrand(''); setModel(''); setSubsystem(''); }} className="px-3 py-2 rounded-xl border bg-white hover:bg-gray-100">Сброс</button>
        <Link href="/?view=submit" className="ml-auto px-3 py-2 rounded-xl bg-black text-white text-sm">Добавить модель</Link>
      </div>

      {items.length === 0 ? (
        <div className="p-6 rounded-2xl bg-white border shadow-sm">Ничего не найдено. Добавьте хотя бы одну карточку на вкладке «Добавить модель».</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {items.map((i) => (
            <article key={i.id} className="bg-white rounded-2xl border shadow-sm overflow-hidden hover:shadow-md transition">
              <div className="bg-gray-100 flex items-center justify-center" style={{ aspectRatio: '16 / 9' }}>
                {i.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={i.image} alt={i.title} className="w-full h-full object-contain"/>
                ) : (
                  <div className="text-gray-500 text-sm p-6">Нет предпросмотра</div>
                )}
              </div>
              <div className="p-4">
                <div className="text-sm text-gray-500">{i.brand} • {i.model} • {i.subsystem}</div>
                <h3 className="text-lg font-semibold mt-1">{i.title}</h3>
                <div className="mt-3 flex gap-2">
                  {i.download && <a href={i.download} className="px-3 py-2 rounded-xl bg-black text-white text-sm" target="_blank" rel="noopener noreferrer">Открыть</a>}
                  <button onClick={()=>{ try { if (typeof window!=='undefined') navigator.clipboard.writeText(window.location.href + '#' + i.id); } catch {} }} className="px-3 py-2 rounded-xl border text-sm">Поделиться</button>
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
          <h1 className="text-2xl font-bold tracking-tight">Auto3D <span className="text-gray-500 text-base">static demo</span></h1>
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
          <div>© {new Date().getFullYear()} Auto3D — статичный предпросмотр</div>
          <div className="flex gap-3">
            <a className="underline" href="https://vercel.com/">Vercel</a>
            <a className="underline" href="https://github.com/">GitHub</a>
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
