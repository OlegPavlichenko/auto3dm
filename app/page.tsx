'use client';
import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";

/**
 * Auto3D — Minimal Catalog (Static images + GitHub upload)
 * -------------------------------------------------------
 * По просьбе автора:
 *  - Убрали просмотрщик 3D (<model-viewer>) и все связанные ошибки.
 *  - Убрали Meshy/Supabase/локальные IndexedDB-загрузки.
 *  - Добавили загрузку на GitHub через серверный API /api/gh-upload.
 *  - Каталог теперь показывает СТАТИЧНЫЕ КАРТИНКИ (image) + кнопку скачивания файла.
 *
 * Настройка окружения (Vercel → Project → Settings → Environment Variables):
 *  - GH_TOKEN    : GitHub Personal Access Token (repo contents:write)
 *  - GH_REPO     : user/repo (публичный)
 *  - GH_BRANCH   : main (или другая)
 *  - NEXT_PUBLIC_UPLOAD_ENDPOINT : "/api/gh-upload" (можно не задавать — такое значение по умолчанию)
 */

// ========= Types =========
export type Item = {
  id: string;
  brand: string;
  model: string;
  title: string;
  subsystem: string;
  image: string;      // картинка-карточка
  download?: string;  // файл для скачивания (GLB/STL/ZIP и т.п.)
};

// ========= Helpers =========
const UPLOAD_ENDPOINT: string = (typeof process !== 'undefined' && (process as any)?.env?.NEXT_PUBLIC_UPLOAD_ENDPOINT) || "/api/gh-upload";

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
  return (name || 'file.bin').replace(/[^a-zA-Z0-9_.-]/g, '_');
}

// Local storage
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

// ========= Demo data (static) =========
const IMG = (t: string) => `https://placehold.co/800x450?text=${encodeURIComponent(t)}`;
const initialItems: Item[] = [
  { id: 'kia-carnival-cupholder', brand: 'Kia',        model: 'Carnival',  title: 'Cupholder insert (demo)', subsystem: 'interior',   image: IMG('Kia Carnival — Cupholder'),  download: undefined },
  { id: 'toyota-bb-hook',         brand: 'Toyota',     model: 'bB',        title: 'Cargo hook (demo)',       subsystem: 'interior',   image: IMG('Toyota bB — Hook'),          download: undefined },
  { id: 'vw-golf3-vent',          brand: 'Volkswagen', model: 'Golf 3',    title: 'Vent clip mount (demo)',  subsystem: 'interior',   image: IMG('Golf 3 — Vent'),             download: undefined },
];

// ========= Minimal client router =========
function useView() {
  const [view, setView] = useState<string>('');
  useEffect(() => {
    if (typeof window === 'undefined') return;

    // Patch history once to emit a custom event on push/replace
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
      if (pathname === '/rules')  { url.pathname = '/'; url.searchParams.set('view','rules');  history.replaceState({}, '', url.toString()); }
      if (pathname === '/dmca')   { url.pathname = '/'; url.searchParams.set('view','dmca');   history.replaceState({}, '', url.toString()); }
      setView((url.searchParams.get('view') || '').toLowerCase());
    };

    // Initial sync
    sync();

    const onChange = () => sync();
    window.addEventListener('popstate', onChange);
    window.addEventListener('hashchange', onChange);
    window.addEventListener('url-change', onChange);

    // Fallback: poll href to catch any client-side nav that didn't touch history
    let lastHref = window.location.href;
    const poll = setInterval(() => {
      if (lastHref !== window.location.href) {
        lastHref = window.location.href;
        sync();
      }
    }, 250);

    return () => {
      window.removeEventListener('popstate', onChange);
      window.removeEventListener('hashchange', onChange);
      window.removeEventListener('url-change', onChange);
      clearInterval(poll);
    };
  }, []);
  return view;
}

// ========= Submit Page (GitHub upload only) =========
function SubmitPage() {
  const [form, setForm] = useState({ author:'', email:'', brand:'', model:'', title:'', subsystem:'interior', imageUrl:'', downloadUrl:'' });
  const [agree, setAgree] = useState(false);
  const [status, setStatus] = useState<string>('');
  const [glbFile, setGlbFile] = useState<File|null>(null);
  const [imgFile, setImgFile] = useState<File|null>(null);
  const [uploading, setUploading] = useState(false);

  const onChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target; setForm(s=>({ ...s, [name]: value }));
  };

  const makeItem = (image: string, download?: string): Item => ({
    id: `${Date.now()}-${Math.random().toString(36).slice(2,8)}`,
    brand: form.brand.trim() || 'Custom',
    model: form.model.trim() || 'Model',
    title: form.title.trim() || 'Custom part',
    subsystem: form.subsystem || 'interior',
    image,
    download,
  });

  const addManual = () => {
    if (!agree) { setStatus('Поставьте галочку согласия с правилами.'); return; }
    const img = form.imageUrl.trim() || IMG('No image');
    const dwn = form.downloadUrl.trim() || undefined;
    addLocalItem(makeItem(img, dwn));
    setStatus('Добавлено локально в каталог.');
  };

  const uploadToGitHub = async () => {
    if (!agree) { setStatus('Поставьте галочку согласия с правилами.'); return; }
    if (!glbFile && !imgFile) { setStatus('Выберите хотя бы КАРТИНКУ (желательно) или файл для скачивания.'); return; }
    try {
      setUploading(true); setStatus('Загрузка на GitHub…');
      const fd = new FormData();
      if (glbFile) fd.append('file', glbFile, glbFile.name || 'model.glb');
      if (imgFile) fd.append('image', imgFile, imgFile.name || 'preview.png');
      fd.append('brand', form.brand || 'brand');
      fd.append('model', form.model || 'model');
      const res = await fetch(UPLOAD_ENDPOINT, { method: 'POST', body: fd });
      const data = await res.json().catch(()=> ({}));
      setUploading(false);
      if (!res.ok) { setStatus(`Ошибка загрузки: ${data?.error || res.statusText}`); return; }
      const image = (data.imageUrl as string) || form.imageUrl.trim() || IMG('No image');
      const download = (data.url as string) || form.downloadUrl.trim() || undefined;
      addLocalItem(makeItem(image, download));
      setStatus('Файлы загружены на GitHub и карточка добавлена.');
    } catch (e:any) {
      setUploading(false);
      setStatus('Ошибка: ' + (e?.message || e));
    }
  };

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold mb-2">Добавить модель</h1>
      <p className="text-gray-600 mb-6">Теперь без 3D‑вьюера: загрузи статичную картинку и (опционально) файл для скачивания. Кнопка ниже отправит их в GitHub‑репозиторий через серверный API.</p>

      <div className="bg-white border rounded-2xl p-6 grid gap-4 mb-8">
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="grid gap-1"><span className="text-sm text-gray-600">Марка</span><input name="brand" value={form.brand} onChange={onChange} className="px-3 py-2 rounded-xl border" required /></label>
          <label className="grid gap-1"><span className="text-sm text-gray-600">Модель</span><input name="model" value={form.model} onChange={onChange} className="px-3 py-2 rounded-xl border" required /></label>
        </div>
        <label className="grid gap-1"><span className="text-sm text-gray-600">Название</span><input name="title" value={form.title} onChange={onChange} className="px-3 py-2 rounded-xl border" placeholder="например, Cupholder insert" /></label>
        <label className="grid gap-1">
          <span className="text-sm text-gray-600">Узел</span>
          <select name="subsystem" value={form.subsystem} onChange={onChange} className="px-3 py-2 rounded-xl border">
            {['interior','body','electrical','suspension','engine','transmission'].map(s=> <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="grid gap-1"><span className="text-sm text-gray-600">Картинка (PNG/JPG/WEBP)</span><input type="file" accept="image/*" onChange={(e)=>setImgFile(e.target.files?.[0]||null)} className="px-3 py-2 rounded-xl border" /></label>
          <label className="grid gap-1"><span className="text-sm text-gray-600">Файл для скачивания (GLB/STL/ZIP, опц.)</span><input type="file" onChange={(e)=>setGlbFile(e.target.files?.[0]||null)} className="px-3 py-2 rounded-xl border" /></label>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="grid gap-1"><span className="text-sm text-gray-600">ИЛИ URL картинки</span><input name="imageUrl" value={form.imageUrl} onChange={onChange} className="px-3 py-2 rounded-xl border" placeholder="https://…/preview.jpg" /></label>
          <label className="grid gap-1"><span className="text-sm text-gray-600">ИЛИ URL файла</span><input name="downloadUrl" value={form.downloadUrl} onChange={onChange} className="px-3 py-2 rounded-xl border" placeholder="https://…/model.glb" /></label>
        </div>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={agree} onChange={(e)=>setAgree(!!e.target.checked)} /> Я согласен с <Link className="underline" href="/?view=rules">Правилами</Link> и <Link className="underline" href="/?view=dmca">DMCA</Link>.</label>
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={uploadToGitHub} disabled={!agree || uploading} className={!agree||uploading?"px-4 py-2 rounded-xl bg-gray-300 text-gray-600 cursor-not-allowed":"px-4 py-2 rounded-xl bg-black text-white"}>{uploading? 'Загружаем…' : 'Загрузить на GitHub и добавить'}</button>
          <button type="button" onClick={addManual} disabled={!agree} className={!agree?"px-4 py-2 rounded-xl border bg-gray-200 text-gray-500 cursor-not-allowed":"px-4 py-2 rounded-xl border bg-white hover:bg-gray-100"}>Добавить без загрузки</button>
        </div>
        {status && <div className="text-sm text-gray-700 bg-gray-50 border rounded-xl p-3">{status}</div>}
      </div>
    </div>
  );
}

// ========= Rules/DMCA =========
function RulesPage() {
  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold mb-2">Правила публикации</h1>
      <p className="text-gray-600 mb-4">Эти правила помогают поддерживать качество и законность контента.</p>
      <div className="bg-white border rounded-2xl p-6 space-y-4 text-sm leading-6">
        <section>
          <h2 className="font-semibold">1. Что можно публиковать</h2>
          <ul className="list-disc ml-5">
            <li>3D‑модели авто‑компонентов для печати/ЧПУ и их фотографии.</li>
            <li>Контент должен принадлежать вам или публиковаться по подходящей лицензии.</li>
          </ul>
        </section>
        <section>
          <h2 className="font-semibold">2. Что нельзя</h2>
          <ul className="list-disc ml-5">
            <li>Нарушение прав третьих лиц (бренды, логотипы, платные модели без разрешения).</li>
            <li>Опасные детали безопасности без дисклеймера.</li>
            <li>Незаконный/вредоносный контент.</li>
          </ul>
        </section>
        <section>
          <h2 className="font-semibold">3. Файлы и предпросмотр</h2>
          <ul className="list-disc ml-5">
            <li>Используйте чёткие изображения (JPG/PNG/WEBP). Файл для скачивания — по желанию.</li>
            <li>Если даёте ссылку на файл — убедитесь, что он доступен без авторизации.</li>
          </ul>
        </section>
        <section>
          <h2 className="font-semibold">4. Лицензии</h2>
          <p>Рекомендуем: CC BY, CC BY‑NC, CC0, MIT. Указывайте автора и лицензию.</p>
        </section>
        <section>
          <h2 className="font-semibold">5. Модерация</h2>
          <p>Жалобы и запросы — на контактный email.</p>
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
            <li>Ссылка(и) на карточки, которые нужно удалить.</li>
            <li>Данные правообладателя и контакт для связи.</li>
            <li>Подтверждение прав.</li>
            <li>Описание нарушения и желаемые действия.</li>
          </ol>
        </section>
      </div>
    </div>
  );
}

// ========= Catalog =========
function CatalogApp() {
  const [q, setQ] = useState('');
  const [brand, setBrand] = useState('');
  const [model, setModel] = useState('');
  const [subsystem, setSubsystem] = useState('');
  const [showTests, setShowTests] = useState(false);
  const [localItems, setLocalItems] = useState<Item[]>([]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const syncFromUrl = () => { try { const url = new URL(window.location.href); setShowTests(url.searchParams.get('tests') === '1'); } catch {} };
    syncFromUrl();
    setLocalItems(readLocalItems());
    const onLocal = () => setLocalItems(readLocalItems());
    window.addEventListener('local-items-updated', onLocal);
    window.addEventListener('storage', onLocal);
    const onUrl = () => syncFromUrl();
    window.addEventListener('url-change', onUrl);
    return () => { window.removeEventListener('local-items-updated', onLocal); window.removeEventListener('storage', onLocal); window.removeEventListener('url-change', onUrl); };
  }, []);

  const catalog = useMemo(() => {
    const base = [...initialItems];
    const withTests = showTests ? base : base; // (сейчас тест-карточек нет)
    return [...localItems, ...withTests];
  }, [localItems, showTests]);

  const brands = useMemo(() => Array.from(new Set(catalog.map(i=>i.brand))).sort(), [catalog]);
  const models = useMemo(() => Array.from(new Set(catalog.filter(i=>!brand || i.brand===brand).map(i=>i.model))).sort(), [brand, catalog]);
  const subsystems = useMemo(() => Array.from(new Set(catalog.map(i=>i.subsystem))).sort(), [catalog]);

  const items = useMemo(() => catalog.filter(i => {
    const ql = q.toLowerCase();
    const matchQ = !q || i.title.toLowerCase().includes(ql) || i.brand.toLowerCase().includes(ql) || i.model.toLowerCase().includes(ql);
    const matchBrand = !brand || i.brand === brand;
    const matchModel = !model || i.model === model;
    const matchSubsystem = !subsystem || i.subsystem === subsystem;
    return matchQ && matchBrand && matchModel && matchSubsystem;
  }), [q, brand, model, subsystem, catalog]);

  return (
    <main className="max-w-6xl mx-auto px-4 py-6">
      <p className="text-gray-600 mb-4">Каталог показывает статичные изображения. Чтобы добавить карточку — зайдите в «Добавить модель», загрузите картинку и, при желании, файл для скачивания (на GitHub).</p>
      <div className="flex flex-wrap gap-2 items-center mb-4">
        <input value={q} onChange={(e)=>setQ(e.target.value)} placeholder="Поиск: Kia, Golf 3…" className="px-3 py-2 rounded-xl border w-64 focus:outline-none focus:ring" />
        <select value={brand} onChange={(e)=>{ setBrand(e.target.value); setModel(''); }} className="px-3 py-2 rounded-xl border"><option value="">Марка</option>{brands.map(b=> <option key={b} value={b}>{b}</option>)}</select>
        <select value={model} onChange={(e)=>setModel(e.target.value)} className="px-3 py-2 rounded-xl border"><option value="">Модель</option>{models.map(m=> <option key={m} value={m}>{m}</option>)}</select>
        <select value={subsystem} onChange={(e)=>setSubsystem(e.target.value)} className="px-3 py-2 rounded-xl border"><option value="">Узел</option>{subsystems.map(s=> <option key={s} value={s}>{s}</option>)}</select>
        <button onClick={()=>{ setQ(''); setBrand(''); setModel(''); setSubsystem(''); }} className="px-3 py-2 rounded-xl border bg-white hover:bg-gray-100">Сброс</button>
        <label className="ml-2 inline-flex items-center gap-2 text-xs text-gray-600">
          <input type="checkbox" onChange={(e)=>{ try { const checked = !!(e.target as HTMLInputElement).checked; if (typeof window==='undefined') return; const url = new URL(window.location.href); if (checked) url.searchParams.set('tests','1'); else url.searchParams.delete('tests'); window.history.replaceState({}, '', url.toString()); window.dispatchEvent(new CustomEvent('url-change')); } catch{} }} />
          Показать тест‑карточки
        </label>
        <Link href="/?view=submit" className="ml-auto px-3 py-2 rounded-xl bg-black text-white text-sm">Добавить модель</Link>
      </div>

      {items.length === 0 ? (
        <div className="p-6 rounded-2xl bg-white border shadow-sm">Ничего не найдено. Попробуйте изменить фильтры.</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {items.map(i => (
            <article key={i.id} className="bg-white rounded-2xl border shadow-sm overflow-hidden hover:shadow-md transition">
              <div className="bg-gray-100 flex items-center justify-center relative" style={{ aspectRatio: '16 / 9' }}>
                <img src={i.image} alt={i.title} className="absolute inset-0 w-full h-full object-cover"/>
              </div>
              <div className="p-4">
                <div className="text-sm text-gray-500">{i.brand} • {i.model} • {i.subsystem}</div>
                <h3 className="text-lg font-semibold mt-1">{i.title}</h3>
                <div className="mt-3 flex gap-2">
                  {i.download && <a href={i.download} className="px-3 py-2 rounded-xl bg-black text-white text-sm" target="_blank" rel="noopener noreferrer">Скачать</a>}
                  <button onClick={()=>{ try { if (typeof window !== 'undefined') navigator.clipboard.writeText(window.location.href + '#' + i.id); } catch{} }} className="px-3 py-2 rounded-xl border text-sm">Поделиться</button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </main>
  );
}

// ========= App Shell & Router =========
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
          <div>© {new Date().getFullYear()} Auto3D — демо без 3D‑вьюера</div>
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
