'use client';
import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { SessionProvider, useSession, signIn, signOut } from 'next-auth/react';

/**
 * Auto3D — GitHub‑only + Auth (NextAuth) + PR‑moderation UI
 * ----------------------------------------------------------
 * ✔ Вход через GitHub (NextAuth)
 * ✔ Разграничение прав: ALLOWED_UPLOADERS (allowlist по GitHub login)
 * ✔ Загрузка на GitHub через /api/gh-upload (сервер проверяет сессию)
 * ✔ Опциональный режим модерации через PR (REQUIRE_PR=1)
 * ✔ Страница \"Модерация\": список файлов и удаление (через PR, если включён)
 * ✔ Статичные превью (png/jpg/webp), без <model-viewer>
 */

// ======================= CLIENT TYPES / STORAGE =======================
export type Item = {
  id: string;
  brand: string;
  model: string;
  title: string;
  subsystem: string;
  image?: string;     // превью (png/jpg/webp)
  download: string;   // ссылка на .glb (скачать)
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

// ======================= MINI ROUTER =======================
function useView() {
  const [view, setView] = useState<string>('');
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const sync = () => {
      const url = new URL(window.location.href);
      const pathname = url.pathname.toLowerCase();
      if (pathname === '/submit' || pathname === '/sumbit') { url.pathname = '/'; url.searchParams.set('view','submit'); history.replaceState({}, '', url.toString()); }
      if (pathname === '/rules')  { url.pathname = '/'; url.searchParams.set('view','rules');  history.replaceState({}, '', url.toString()); }
      if (pathname === '/dmca')   { url.pathname = '/'; url.searchParams.set('view','dmca');   history.replaceState({}, '', url.toString()); }
      if (pathname === '/manage') { url.pathname = '/'; url.searchParams.set('view','manage'); history.replaceState({}, '', url.toString()); }
      setView((url.searchParams.get('view') || '').toLowerCase());
    };
    sync();
    const onChange = () => sync();
    window.addEventListener('popstate', onChange);
    window.addEventListener('hashchange', onChange);
    return () => {
      window.removeEventListener('popstate', onChange);
      window.removeEventListener('hashchange', onChange);
    };
  }, []);
  return view;
}

// ======================= DEMO CARDS =======================
const initialItems: Item[] = [
  { id:'kia-carnival-1', brand:'Kia', model:'Carnival', title:'Cupholder insert (demo)', subsystem:'interior', image:'https://placehold.co/800x450?text=Kia+Cupholder', download:'https://example.com/model.glb' },
  { id:'toyota-bb-1',    brand:'Toyota', model:'bB',   title:'Cargo hook (demo)',        subsystem:'interior', image:'https://placehold.co/800x450?text=Toyota+Hook',   download:'https://example.com/model.glb' },
  { id:'vw-golf3-1',     brand:'Volkswagen', model:'Golf 3', title:'Vent clip mount (demo)', subsystem:'interior', image:'https://placehold.co/800x450?text=Golf+3+Vent', download:'https://example.com/model.glb' },
];

// ======================= AUTH WIDGETS =======================
function AuthBadge() {
  const { data: session, status } = useSession();
  if (status === 'loading') return <span className="text-xs text-gray-500">…</span>;
  if (!session) return (
    <button onClick={() => signIn('github')} className="px-3 py-2 rounded-xl border">Войти GitHub</button>
  );
  const login = (session as any)?.user?.login || session.user?.name || session.user?.email;
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-gray-600">{login}</span>
      <button onClick={() => signOut()} className="px-3 py-2 rounded-xl border">Выйти</button>
    </div>
  );
}

// ======================= SUBMIT PAGE =======================
function SubmitPage() {
  const { data: session, status } = useSession();
  const [form, setForm] = useState({
    author:'', email:'', brand:'', model:'', title:'', subsystem:'interior', description:'',
    image:'', download:''
  });
  const [agree, setAgree] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const [glbFile, setGlbFile] = useState<File | null>(null);
  const [imgFile, setImgFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  const onChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target; setForm(s => ({ ...s, [name]: value }));
  };

  const makeItem = (): Item => ({
    id: `${Date.now()}-${Math.random().toString(36).slice(2,8)}`,
    brand: form.brand.trim() || 'Custom',
    model: form.model.trim() || 'Model',
    title: form.title.trim() || 'Custom model',
    subsystem: form.subsystem || 'interior',
    image: form.image || undefined,
    download: form.download || ''
  });

  async function upload(kind: 'model'|'image') {
    if (!session) { setStatusMsg('Войдите через GitHub, чтобы загружать.'); return; }
    const endpoint = '/api/gh-upload';
    const file = kind === 'model' ? glbFile : imgFile;
    if (!file) { setStatusMsg(kind==='model'?'Выберите .glb файл.':'Выберите картинку (png/jpg/webp).'); return; }

    const name = (file.name||'').toLowerCase();
    if (kind==='model' && !name.endsWith('.glb')) { setStatusMsg('Сейчас принимаются только модели .glb'); return; }
    if (kind==='image' && !(name.endsWith('.png')||name.endsWith('.jpg')||name.endsWith('.jpeg')||name.endsWith('.webp'))) {
      setStatusMsg('Сейчас принимаются только изображения (png/jpg/webp).'); return;
    }

    const MAX_MB = 4.2;
    const sizeMb = file.size / (1024*1024);
    if (sizeMb > MAX_MB) { setStatusMsg(`Файл ${sizeMb.toFixed(1)} MB превышает лимит ~${MAX_MB} MB.`); return; }

    try {
      setUploading(true); setStatusMsg('Загрузка на GitHub…');
      const fd = new FormData();
      fd.append('file', file, file.name|| (kind==='model'?'model.glb':'preview.png'));
      fd.append('kind', kind);
      fd.append('brand', form.brand || 'brand');
      fd.append('model', form.model || 'model');
      // если хочешь форсить PR с клиента: fd.append('pr', '1');
      const res = await fetch(endpoint, { method:'POST', body: fd });
      const data = await res.json().catch(()=>({}));
      setUploading(false);
      if (!res.ok || !data?.ok || !data?.url) { setStatusMsg(`Ошибка загрузки: HTTP ${res.status} • ${data?.error || res.statusText}`); return; }
      if (kind==='model') setForm(s=>({ ...s, download: data.url })); else setForm(s=>({ ...s, image: data.url }));
      setStatusMsg(data?.pr ? `Отправлено на модерацию (PR: ${data.pr}).` : 'Готово! Ссылка добавлена в форму. Теперь «Добавить в каталог (локально)».');
    } catch (e: any) {
      setUploading(false); setStatusMsg('Ошибка: ' + (e?.message || e));
    }
  }

  const addLocal = () => {
    if (!agree) { setStatusMsg('Поставьте галочку согласия.'); return; }
    if (!form.download) { setStatusMsg('Нет ссылки на .glb. Загрузите модель или вставьте ссылку.'); return; }
    const item = makeItem(); addLocalItem(item); setStatusMsg('Модель добавлена в локальный каталог. Открой «Каталог», чтобы увидеть карточку.');
  };

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold mb-2">Добавить модель</h1>
      {!session && <div className="mb-4 p-3 text-sm bg-amber-50 border rounded-xl">Чтобы загружать в репозиторий, войдите через GitHub.</div>}
      <p className="text-gray-600 mb-6">Работаем со статичными превью и загрузкой .glb в GitHub. Предпросмотра 3D нет — показываем картинку. Модерация через PR (если включена).</p>

      {/* A. Загрузка модели (.glb) → GitHub */}
      <div className="bg-white border rounded-2xl p-6 grid gap-4 mb-8">
        <h2 className="text-lg font-semibold">1) Загрузить модель (.glb) на GitHub</h2>
        <label className="grid gap-1">
          <span className="text-sm text-gray-600">Файл модели (.glb)</span>
          <input type="file" accept=".glb" onChange={e=>setGlbFile(e.target.files?.[0]||null)} className="px-3 py-2 rounded-xl border" />
        </label>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="grid gap-1"><span className="text-sm text-gray-600">Марка</span><input name="brand" value={form.brand} onChange={onChange} className="px-3 py-2 rounded-xl border" placeholder="Kia" /></label>
          <label className="grid gap-1"><span className="text-sm text-gray-600">Модель авто</span><input name="model" value={form.model} onChange={onChange} className="px-3 py-2 rounded-xl border" placeholder="Carnival" /></label>
        </div>
        <button type="button" onClick={()=>upload('model')} disabled={!glbFile || uploading || !session} className={!glbFile||uploading||!session?"px-4 py-2 rounded-xl bg-gray-300 text-gray-600 cursor-not-allowed":"px-4 py-2 rounded-xl bg-black text-white"}>{uploading? 'Загружаем…':'Загрузить модель в репозиторий'}</button>
        {form.download && <div className="text-xs text-green-700">GLB URL: <a className="underline" href={form.download} target="_blank">{form.download}</a></div>}
      </div>

      {/* B. Загрузка превью‑картинки → GitHub */}
      <div className="bg-white border rounded-2xl p-6 grid gap-4 mb-8">
        <h2 className="text-lg font-semibold">2) Загрузить превью (png/jpg/webp) на GitHub</h2>
        <label className="grid gap-1">
          <span className="text-sm text-gray-600">Картинка</span>
          <input type="file" accept="image/png,image/jpeg,image/webp" onChange={e=>setImgFile(e.target.files?.[0]||null)} className="px-3 py-2 rounded-xl border" />
        </label>
        <button type="button" onClick={()=>upload('image')} disabled={!imgFile || uploading || !session} className={!imgFile||uploading||!session?"px-4 py-2 rounded-xl bg-gray-300 text-gray-600 cursor-not-allowed":"px-4 py-2 rounded-xl border"}>Загрузить превью в репозиторий</button>
        {form.image && <div className="text-xs text-green-700">IMAGE URL: <a className="underline" href={form.image} target="_blank">{form.image}</a></div>}
      </div>

      {/* C. Карточка: метаданные и добавление в локальный каталог */}
      <div className="bg-white border rounded-2xl p-6 grid gap-4">
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="grid gap-1"><span className="text-sm text-gray-600">Название модели</span><input name="title" value={form.title} onChange={onChange} className="px-3 py-2 rounded-xl border" placeholder="Cupholder insert"/></label>
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
        </div>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={agree} onChange={e=>setAgree(!!e.target.checked)} /> <span>Я согласен с <Link className="underline" href="/?view=rules">Правилами</Link> и <Link className="underline" href="/?view=dmca">DMCA/удалением</Link>.</span></label>
        <button type="button" onClick={addLocal} disabled={!agree} className={!agree?"px-4 py-2 rounded-xl bg-gray-300 text-gray-600 cursor-not-allowed":"px-4 py-2 rounded-xl bg-black text-white"}>Добавить в каталог (локально)</button>
        {statusMsg && <div className="text-sm text-gray-700 bg-gray-50 border rounded-xl p-3">{statusMsg}</div>}
      </div>
    </div>
  );
}

// ======================= MANAGE / MODERATION PAGE =======================
function ManagePage() {
  const { data: session } = useSession();
  const [tab, setTab] = useState<'models'|'images'>('models');
  const [items, setItems] = useState<{path:string,size:number,url:string,sha?:string}[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const load = async (which: 'models'|'images') => {
    setBusy(true); setMsg('Загрузка списка…');
    try {
      const res = await fetch(`/api/gh-upload?list=1&prefix=${which}`);
      const j = await res.json();
      if (!res.ok || !j?.ok) { setMsg(`Ошибка списка: ${j?.error || res.statusText}`); setItems([]); }
      else { setItems(j.items || []); setMsg(''); }
    } catch (e:any) { setMsg(e?.message||String(e)); setItems([]); }
    setBusy(false);
  };

  useEffect(()=>{ load(tab); }, [tab]);

  const del = async (path: string) => {
    if (!confirm(`Удалить файл через PR/commit?
${path}`)) return;
    setBusy(true); setMsg('Удаление…');
    try {
      const res = await fetch('/api/gh-upload', { method:'DELETE', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({ path }) });
      const j = await res.json();
      if (!res.ok || !j?.ok) { setMsg(`Ошибка удаления: ${j?.error || res.statusText}`); }
      else { setMsg(j?.pr ? `Создан PR на удаление: ${j.pr}` : 'Удалено.'); load(tab); }
    } catch (e:any) { setMsg(e?.message||String(e)); }
    setBusy(false);
  };

  if (!session) return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold mb-2">Модерация</h1>
      <div className="p-4 rounded-xl border bg-amber-50">Войдите через GitHub, чтобы видеть и управлять файлами.</div>
    </div>
  );

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold mb-4">Модерация / Файлы</h1>
      <div className="flex gap-2 mb-4">
        <button onClick={()=>setTab('models')} className={`px-3 py-2 rounded-xl border ${tab==='models'?'bg-black text-white':''}`}>models</button>
        <button onClick={()=>setTab('images')} className={`px-3 py-2 rounded-xl border ${tab==='images'?'bg-black text-white':''}`}>images</button>
        <button onClick={()=>load(tab)} className="ml-auto px-3 py-2 rounded-xl border">Обновить</button>
      </div>

      {busy && <div className="text-sm text-gray-600 mb-2">{msg||'…'}</div>}
      {!busy && msg && <div className="text-sm text-red-600 mb-2">{msg}</div>}

      <div className="bg-white border rounded-2xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="text-left p-3">Путь</th>
              <th className="text-left p-3">Размер</th>
              <th className="text-left p-3">Действие</th>
            </tr>
          </thead>
          <tbody>
            {items.map(it => (
              <tr key={it.path} className="border-t">
                <td className="p-3">
                  <a className="underline" href={it.url} target="_blank" rel="noreferrer">{it.path}</a>
                </td>
                <td className="p-3">{(it.size/1024).toFixed(1)} KB</td>
                <td className="p-3">
                  <button onClick={()=>del(it.path)} className="px-3 py-1.5 rounded-lg border">Удалить</button>
                </td>
              </tr>
            ))}
            {items.length===0 && (
              <tr><td className="p-4 text-gray-500" colSpan={3}>Пусто.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ======================= RULES & DMCA =======================
function RulesPage() {
  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold mb-2">Правила публикации</h1>
      <ul className="list-disc ml-6 text-sm text-gray-700 space-y-2">
        <li>Загружайте только то, что вы имеете право распространять.</li>
        <li>Модель — в формате .glb (желательно до ~4MB).</li>
        <li>Превью — png/jpg/webp (до ~4MB).</li>
      </ul>
    </div>
  );
}
function DmcaPage() {
  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold mb-2">DMCA / Удаление</h1>
      <p className="text-gray-700 text-sm">Пишите на contact@example.com, указывая ссылки на материалы и подтверждение прав.</p>
    </div>
  );
}

// ======================= CATALOG =======================
function CatalogApp() {
  const [q, setQ] = useState('');
  const [brand, setBrand] = useState('');
  const [model, setModel] = useState('');
  const [subsystem, setSubsystem] = useState('');
  const [localItems, setLocalItems] = useState<Item[]>([]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const sync = () => setLocalItems(readLocalItems());
    sync();
    window.addEventListener('local-items-updated', sync);
    window.addEventListener('storage', sync);
    return () => { window.removeEventListener('local-items-updated', sync); window.removeEventListener('storage', sync); };
  }, []);

  const catalog = useMemo(() => {
    return [...localItems, ...initialItems];
  }, [localItems]);

  const brands = useMemo(() => Array.from(new Set(catalog.map(i=>i.brand))).sort(), [catalog]);
  const models = useMemo(() => Array.from(new Set(catalog.filter(i=>!brand || i.brand===brand).map(i=>i.model))).sort(), [brand, catalog]);
  const subsystems = useMemo(() => Array.from(new Set(catalog.map(i=>i.subsystem))).sort(), [catalog]);

  const items = useMemo(() => catalog.filter(i => {
    const ql = q.toLowerCase();
    const matchQ = !q || i.title.toLowerCase().includes(ql) || i.brand.toLowerCase().includes(ql) || i.model.toLowerCase().includes(ql);
    const matchBrand = !brand || i.brand===brand;
    const matchModel = !model || i.model===model;
    const matchSubsystem = !subsystem || i.subsystem===subsystem;
    return matchQ && matchBrand && matchModel && matchSubsystem;
  }), [q, brand, model, subsystem, catalog]);

  return (
    <main className="max-w-6xl mx-auto px-4 py-6">
      <p className="text-gray-600 mb-4">Карточки показывают <b>картинку‑превью</b> и ссылку на скачивание <b>.glb</b>. Чтобы добавить свою — зайдите на «Добавить модель».</p>
      <div className="flex flex-wrap gap-2 items-center mb-4">
        <input value={q} onChange={e=>setQ(e.target.value)} placeholder="Поиск: Kia, Golf 3, cupholder..." className="px-3 py-2 rounded-xl border w-64 focus:outline-none focus:ring" />
        <select value={brand} onChange={e=>{ setBrand(e.target.value); setModel(''); }} className="px-3 py-2 rounded-xl border"><option value="">Марка</option>{brands.map(b=>(<option key={b} value={b}>{b}</option>))}</select>
        <select value={model} onChange={e=>setModel(e.target.value)} className="px-3 py-2 rounded-xl border"><option value="">Модель</option>{models.map(m=>(<option key={m} value={m}>{m}</option>))}</select>
        <select value={subsystem} onChange={e=>setSubsystem(e.target.value)} className="px-3 py-2 rounded-xl border"><option value="">Узел</option>{subsystems.map(s=>(<option key={s} value={s}>{s}</option>))}</select>
        <button onClick={()=>{ setQ(''); setBrand(''); setModel(''); setSubsystem(''); }} className="px-3 py-2 rounded-xl border bg-white hover:bg-gray-100">Сброс</button>
        <Link href="/?view=submit" className="ml-auto px-3 py-2 rounded-xl bg-black text-white text-sm">Добавить модель</Link>
      </div>

      {items.length===0 ? (
        <div className="p-6 rounded-2xl bg-white border shadow-sm">Ничего не найдено. Попробуйте изменить фильтры.</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {items.map(i => (
            <article key={i.id} className="bg-white rounded-2xl border shadow-sm overflow-hidden hover:shadow-md transition">
              <div className="bg-gray-100 flex items-center justify-center" style={{ aspectRatio:'16 / 9' }}>
                {i.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={i.image} alt={i.title} className="w-full h-full object-cover" />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={`https://placehold.co/800x450?text=${encodeURIComponent(i.brand+' '+i.model)}`} alt={i.title} className="w-full h-full object-cover" />
                )}
              </div>
              <div className="p-4">
                <div className="text-sm text-gray-500">{i.brand} • {i.model} • {i.subsystem}</div>
                <h3 className="text-lg font-semibold mt-1">{i.title}</h3>
                <div className="mt-3 flex gap-2">
                  <a href={i.download} className="px-3 py-2 rounded-xl bg-black text-white text-sm" target="_blank" rel="noopener noreferrer">Скачать .glb</a>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </main>
  );
}

// ======================= SHELL =======================
function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <div className="min-h-screen bg-gray-50">
        <header className="sticky top-0 z-10 backdrop-blur bg-white/70 border-b">
          <div className="max-w-6xl mx-auto px-4 py-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <h1 className="text-2xl font-bold tracking-tight">Auto3D <span className="text-gray-500 text-base">(auth+moderation)</span></h1>
            <nav className="flex flex-wrap gap-2 items-center text-sm">
              <Link href="/" className="px-3 py-2 rounded-xl border bg-white hover:bg-gray-100">Каталог</Link>
              <Link href="/?view=submit" className="px-3 py-2 rounded-xl bg-black text-white hover:opacity-90">Добавить модель</Link>
              <Link href="/?view=manage" className="px-3 py-2 rounded-xl border bg-white hover:bg-gray-100">Модерация</Link>
              <Link href="/?view=rules" className="px-3 py-2 rounded-xl border bg-white hover:bg-gray-100">Правила</Link>
              <Link href="/?view=dmca" className="px-3 py-2 rounded-xl border bg-white hover:bg-gray-100">DMCA</Link>
              <AuthBadge />
            </nav>
          </div>
        </header>
        {children}
        <footer className="max-w-6xl mx-auto px-4 py-10 text-sm text-gray-500">
          <div className="border-t pt-6 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div>© {new Date().getFullYear()} Auto3D — демо</div>
            <div className="flex gap-3">
              <a className="underline" href="https://vercel.com/">Vercel</a>
              <a className="underline" href="https://github.com/">GitHub</a>
              <a className="underline" href="https://www.jsdelivr.com/">jsDelivr</a>
            </div>
          </div>
        </footer>
      </div>
    </SessionProvider>
  );
}

export default function AppRouter() {
  const view = useView();
  let page: React.ReactNode = <CatalogApp />;
  if (view === 'submit') page = <SubmitPage />;
  if (view === 'rules')  page = <RulesPage />;
  if (view === 'dmca')   page = <DmcaPage />;
  if (view === 'manage') page = <ManagePage />;
  return <AppShell>{page}</AppShell>;
}
