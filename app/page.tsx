'use client';
import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';

/**
 * Auto3D — GitHub‑only minimal (static previews)
 * --------------------------------------------------
 * Что изменилось:
 * - Полностью убрал <model-viewer> и любые 3D‑вьюверы (не нужен CORS/GLB‑рендеринг).
 * - Оставлена ТОЛЬКО загрузка на GitHub через API‑роут /api/gh-upload.
 * - Разделил загрузчики: «Модель (.glb)» и «Превью‑картинка (png/jpg/webp)».
 * - Карточки каталога показывают статичную картинку (если есть), а кнопка «Скачать» ведёт на GLB.
 * - Локальное сохранение каталога — через localStorage (видно только на этом устройстве).
 *
 * ВАЖНО: Для работы аплоада нужны переменные окружения на сервере (Vercel → Project → Settings → Env):
 *   GH_TOKEN   — PAT c правами Repository contents: Read and write
 *   GH_REPO    — например OlegPavlichenko/auto3dm
 *   GH_BRANCH  — main
 * И файл app/api/gh-upload/route.ts (см. ниже в комментарии «API ROUTE»)
 */

/**
 * ======================= API ROUTE (создай файл) =======================
 * Скопируй следующий файл целиком в: app/api/gh-upload/route.ts
 * Он принимает FormData { file, kind, brand, model } и кладёт в твой репозиторий.
 * kind = "model" сохраняет только .glb → в папку models/…  (лимит ~4.5MB)
 * kind = "image" разрешает png/jpg/webp → в папку images/… (лимит ~4.5MB)
 * Возвращает JSON { ok:true, url:"https://cdn.jsdelivr.net/..." }
 * ----------------------------------------------------------------------
 */
/*
import { NextRequest, NextResponse } from 'next/server';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

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
function env() {
  const token = process.env.GH_TOKEN?.trim() || '';
  const repo  = process.env.GH_REPO?.trim()  || '';
  const branch= process.env.GH_BRANCH?.trim()|| 'main';
  return { token, repo, branch };
}

export async function GET() {
  const { token, repo, branch } = env();
  const hasToken = !!token; const hasRepo = !!repo;
  if (!hasToken || !hasRepo) {
    return NextResponse.json({ ok:false, error:'Missing GH_TOKEN or GH_REPO env', hasToken, hasRepo, branch }, { status:200 });
  }
  const whoRes = await fetch('https://api.github.com/user', { headers:{ Authorization:`Bearer ${token}`, 'User-Agent':'auto3dm' } });
  const repoRes= await fetch(`https://api.github.com/repos/${repo}`, { headers:{ Authorization:`Bearer ${token}`, 'User-Agent':'auto3dm' } });
  const who = await whoRes.json().catch(()=>null);
  const j   = await repoRes.json().catch(()=>null);
  return NextResponse.json({ ok: whoRes.ok && repoRes.ok, status:{ who: whoRes.status, repo: repoRes.status }, whoami: whoRes.ok?{login:who?.login}:null, repo: repoRes.ok?{full_name:j?.full_name, permissions:j?.permissions}:null, branch }, { status:200 });
}

export async function POST(req: NextRequest) {
  const { token, repo, branch } = env();
  if (!token || !repo) return NextResponse.json({ ok:false, error:'Missing GH_TOKEN or GH_REPO env' }, { status:500 });
  const form = await req.formData();
  const file = form.get('file') as File | null;
  const kind = (form.get('kind') as string) || 'model'; // 'model' | 'image'
  const brand = (form.get('brand') as string) || 'brand';
  const model = (form.get('model') as string) || 'model';
  if (!file) return NextResponse.json({ ok:false, error:'No file' }, { status:400 });

  const name = file.name || 'file.bin';
  const lc = name.toLowerCase();
  if (kind === 'model') {
    if (!lc.endsWith('.glb')) return NextResponse.json({ ok:false, error:'Only .glb allowed' }, { status:400 });
  } else if (kind === 'image') {
    if (!(lc.endsWith('.png') || lc.endsWith('.jpg') || lc.endsWith('.jpeg') || lc.endsWith('.webp'))) {
      return NextResponse.json({ ok:false, error:'Images only: png/jpg/webp' }, { status:400 });
    }
  } else {
    return NextResponse.json({ ok:false, error:'Bad kind' }, { status:400 });
  }

  const ab = await file.arrayBuffer();
  const MAX = 4.5 * 1024 * 1024;
  if (ab.byteLength > MAX) return NextResponse.json({ ok:false, error:`File too large ${(ab.byteLength/1024/1024).toFixed(1)} MB` }, { status:413 });

  const folder = kind === 'model' ? 'models' : 'images';
  const relPath = `${folder}/${slug(brand)}/${slug(model)}/${Date.now()}-${safeFileName(name)}`;
  const contentB64 = Buffer.from(ab).toString('base64');
  const putUrl = `https://api.github.com/repos/${repo}/contents/${relPath}`;
  const gh = await fetch(putUrl, {
    method:'PUT',
    headers:{ Authorization:`Bearer ${token}`, 'Content-Type':'application/json', 'User-Agent':'auto3dm' },
    body: JSON.stringify({ message:`upload ${relPath}`, branch, content: contentB64 })
  });
  if (!gh.ok) return NextResponse.json({ ok:false, error:`GitHub PUT ${gh.status}: ${await gh.text()}` }, { status:500 });

  const cdn = `https://cdn.jsdelivr.net/gh/${repo}@${branch}/${relPath}`;
  return NextResponse.json({ ok:true, url: cdn, path: relPath, kind }, { status:200 });
}
*/

// ======================= CLIENT CODE (эта страница) =======================

// Тип карточки
export type Item = {
  id: string;
  brand: string;
  model: string;
  title: string;
  subsystem: string;
  image?: string;     // превью (png/jpg/webp)
  download: string;   // ссылка на .glb (скачать)
};

// Локальное хранилище каталога (только в этом браузере)
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

// Мини‑роутер на одном / (без next/navigation)
function useView() {
  const [view, setView] = useState<string>('');
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const sync = () => {
      const url = new URL(window.location.href);
      const pathname = url.pathname.toLowerCase();
      // мягкие редиректы на /?view=...
      if (pathname === '/submit' || pathname === '/sumbit') { url.pathname = '/'; url.searchParams.set('view','submit'); history.replaceState({}, '', url.toString()); }
      if (pathname === '/rules')  { url.pathname = '/'; url.searchParams.set('view','rules');  history.replaceState({}, '', url.toString()); }
      if (pathname === '/dmca')   { url.pathname = '/'; url.searchParams.set('view','dmca');   history.replaceState({}, '', url.toString()); }
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

// Заглушки/демо карточки
const initialItems: Item[] = [
  { id:'kia-carnival-1', brand:'Kia', model:'Carnival', title:'Cupholder insert (demo)', subsystem:'interior', image:'https://placehold.co/800x450?text=Kia+Cupholder', download:'https://example.com/model.glb' },
  { id:'toyota-bb-1',    brand:'Toyota', model:'bB',   title:'Cargo hook (demo)',        subsystem:'interior', image:'https://placehold.co/800x450?text=Toyota+Hook',   download:'https://example.com/model.glb' },
  { id:'vw-golf3-1',     brand:'Volkswagen', model:'Golf 3', title:'Vent clip mount (demo)', subsystem:'interior', image:'https://placehold.co/800x450?text=Golf+3+Vent', download:'https://example.com/model.glb' },
];

// ===== Страница добавления =====
function SubmitPage() {
  const [form, setForm] = useState({
    author:'', email:'', brand:'', model:'', title:'', subsystem:'interior', description:'',
    image:'', download:''
  });
  const [agree, setAgree] = useState(false);
  const [status, setStatus] = useState('');
  const [glbFile, setGlbFile] = useState<File | null>(null);
  const [imgFile, setImgFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  // --- НОВОЕ: состояния для “Мои файлы”
  type GhListItem = { path:string; size:number; url:string };
  const [listModels, setListModels] = useState<GhListItem[]>([]);
  const [listImages, setListImages] = useState<GhListItem[]>([]);
  const [repoInfo, setRepoInfo] = useState<{repo:string, branch:string} | null>(null);
  const [listBusy, setListBusy] = useState(false);
  const [listMsg, setListMsg] = useState('');

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
    const endpoint = '/api/gh-upload';
    const file = kind === 'model' ? glbFile : imgFile;
    if (!file) { setStatus(kind==='model'?'Выберите .glb файл.':'Выберите картинку (png/jpg/webp).'); return; }

    const name = (file.name||'').toLowerCase();
    if (kind==='model' && !name.endsWith('.glb')) { setStatus('Сейчас принимаются только модели .glb'); return; }
    if (kind==='image' && !(name.endsWith('.png')||name.endsWith('.jpg')||name.endsWith('.jpeg')||name.endsWith('.webp'))) {
      setStatus('Сейчас принимаются только изображения (png/jpg/webp).'); return;
    }

    const MAX_MB = 4.2;
    const sizeMb = file.size / (1024*1024);
    if (sizeMb > MAX_MB) {
      setStatus(`Файл ${sizeMb.toFixed(1)} MB превышает лимит ~${MAX_MB} MB. Сожмите файл (для .glb — gltfpack).`);
      return;
    }

    try {
      setUploading(true); setStatus('Загрузка на GitHub…');
      const fd = new FormData();
      fd.append('file', file, file.name|| (kind==='model'?'model.glb':'preview.png'));
      fd.append('kind', kind);
      fd.append('brand', form.brand || 'brand');
      fd.append('model', form.model || 'model');
      const res = await fetch(endpoint, { method:'POST', body: fd });
      const data = await res.json().catch(()=>({}));
      setUploading(false);
      if (!res.ok || !data?.ok || !data?.url) {
        setStatus(`Ошибка загрузки: HTTP ${res.status} • ${data?.error || res.statusText}`);
        return;
      }
      if (kind==='model') setForm(s=>({ ...s, download: data.url }));
      else setForm(s=>({ ...s, image: data.url }));
      setStatus('Готово! Ссылка добавлена в форму. Теперь «Добавить в каталог (локально)» (необязательно, см. ниже).');
    } catch (e: any) {
      setUploading(false);
      setStatus('Ошибка: ' + (e?.message || e));
    }
  }

  const addLocal = () => {
    if (!agree) { setStatus('Поставьте галочку согласия.'); return; }
    if (!form.download) { setStatus('Нет ссылки на .glb. Загрузите модель или вставьте ссылку.'); return; }
    const item = makeItem();
    addLocalItem(item);
    setStatus('Модель добавлена в локальный каталог. (Но теперь она и так будет видна всем из GitHub — см. Каталог)');
  };

  // --- НОВОЕ: листинг/удаление файлов в репо
  async function refreshList(prefix: 'models'|'images') {
    try {
      setListBusy(true);
      const r = await fetch(`/api/gh-upload?list=1&prefix=${prefix}`);
      const j = await r.json();
      if (!r.ok || !j?.ok) { setListMsg(`List ${prefix} failed: ${j?.error || r.statusText}`); return; }
      setRepoInfo({ repo: j.repo, branch: j.branch });
      (prefix === 'models' ? setListModels : setListImages)(j.items || []);
      setListMsg('');
    } catch (e:any) {
      setListMsg(String(e?.message || e));
    } finally { setListBusy(false); }
  }
  async function deletePath(path: string) {
    try {
      setListBusy(true);
      const r = await fetch('/api/gh-upload', { method:'DELETE', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ path }) });
      const j = await r.json();
      if (!r.ok || !j?.ok) { setListMsg(`Delete failed: ${j?.error || r.statusText}`); return; }
      await Promise.all([refreshList('models'), refreshList('images')]);
    } catch (e:any) {
      setListMsg(String(e?.message || e));
    } finally { setListBusy(false); }
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold mb-2">Добавить модель</h1>
      <p className="text-gray-600 mb-6">Работаем со статичными превью и загрузкой .glb в GitHub. Каталог теперь может подтягивать файлы напрямую из репозитория (видно всем).</p>

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
        <button type="button" onClick={()=>upload('model')} disabled={!glbFile || uploading} className={!glbFile||uploading?"px-4 py-2 rounded-xl bg-gray-300 text-gray-600 cursor-not-allowed":"px-4 py-2 rounded-xl bg-black text-white"}>{uploading? 'Загружаем…':'Загрузить модель в репозиторий'}</button>
        {form.download && <div className="text-xs text-green-700">GLB URL: <a className="underline" href={form.download} target="_blank" rel="noreferrer">{form.download}</a></div>}
      </div>

      {/* B. Загрузка превью-картинки → GitHub */}
      <div className="bg-white border rounded-2xl p-6 grid gap-4 mb-8">
        <h2 className="text-lg font-semibold">2) Загрузить превью (png/jpg/webp) на GitHub</h2>
        <label className="grid gap-1">
          <span className="text-sm text-gray-600">Картинка</span>
          <input type="file" accept="image/png,image/jpeg,image/webp" onChange={e=>setImgFile(e.target.files?.[0]||null)} className="px-3 py-2 rounded-xl border" />
        </label>
        <button type="button" onClick={()=>upload('image')} disabled={!imgFile || uploading} className={!imgFile||uploading?"px-4 py-2 rounded-xl bg-gray-300 text-gray-600 cursor-not-allowed":"px-4 py-2 rounded-xl border"}>Загрузить превью в репозиторий</button>
        {form.image && <div className="text-xs text-green-700">IMAGE URL: <a className="underline" href={form.image} target="_blank" rel="noreferrer">{form.image}</a></div>}
      </div>

      {/* C. (Необязательно) Добавить карточку локально */}
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
        {status && <div className="text-sm text-gray-700 bg-gray-50 border rounded-xl p-3">{status}</div>}
      </div>

      {/* D. НОВОЕ: Мои файлы в репозитории */}
      <div className="bg-white border rounded-2xl p-6 grid gap-4 mt-8">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Мои файлы в репозитории</h2>
          <div className="flex gap-2">
            <button type="button" onClick={()=>refreshList('models')} className="px-3 py-2 rounded-xl border">Обновить модели</button>
            <button type="button" onClick={()=>refreshList('images')} className="px-3 py-2 rounded-xl border">Обновить картинки</button>
          </div>
        </div>
        {listMsg && <div className="text-sm text-red-600">{listMsg}</div>}
        {!repoInfo && <div className="text-xs text-gray-500">Нужны переменные окружения <code>GH_TOKEN</code>, <code>GH_REPO</code>, <code>GH_BRANCH</code>. Нажмите «Обновить…»</div>}
        <div className="grid md:grid-cols-2 gap-6">
          <div>
            <div className="font-medium mb-2">models/</div>
            <div className="space-y-2">
              {listModels.length === 0 ? <div className="text-sm text-gray-500">пусто</div> : listModels.map(it=>(
                <div key={it.path} className="flex items-center gap-2 text-sm">
                  <code className="flex-1 break-all">{it.path}</code>
                  <span className="text-gray-500">{(it.size/1024).toFixed(1)} KB</span>
                  <a className="underline" href={it.url} target="_blank" rel="noreferrer">ссылка</a>
                  <button className="text-red-600 underline" onClick={()=>deletePath(it.path)} disabled={listBusy}>удалить</button>
                </div>
              ))}
            </div>
          </div>
          <div>
            <div className="font-medium mb-2">images/</div>
            <div className="space-y-2">
              {listImages.length === 0 ? <div className="text-sm text-gray-500">пусто</div> : listImages.map(it=>(
                <div key={it.path} className="flex items-center gap-2 text-sm">
                  <code className="flex-1 break-all">{it.path}</code>
                  <span className="text-gray-500">{(it.size/1024).toFixed(1)} KB</span>
                  <a className="underline" href={it.url} target="_blank" rel="noreferrer">ссылка</a>
                  <button className="text-red-600 underline" onClick={()=>deletePath(it.path)} disabled={listBusy}>удалить</button>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

    </div>
  );
}


// ===== Правила и DMCA простые страницы =====
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

// ===== Каталог =====
function CatalogApp() {
  const [q, setQ] = useState('');
  const [brand, setBrand] = useState('');
  const [model, setModel] = useState('');
  const [subsystem, setSubsystem] = useState('');

  const [localItems, setLocalItems] = useState<Item[]>([]);
  const [remoteItems, setRemoteItems] = useState<Item[]>([]);
  const [errRemote, setErrRemote] = useState<string>('');

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const sync = () => setLocalItems(readLocalItems());
    sync();
    window.addEventListener('local-items-updated', sync);
    window.addEventListener('storage', sync);
    return () => { window.removeEventListener('local-items-updated', sync); window.removeEventListener('storage', sync); };
  }, []);

  // --- НОВОЕ: подтягиваем из GitHub списки models/ и images/
  useEffect(() => {
    (async () => {
      try {
        setErrRemote('');
        const [mr, ir] = await Promise.all([
          fetch('/api/gh-upload?list=1&prefix=models'),
          fetch('/api/gh-upload?list=1&prefix=images'),
        ]);
        const mj = await mr.json().catch(()=>({}));
        const ij = await ir.json().catch(()=>({}));
        if (!mj?.ok) { setErrRemote(`models list: ${mj?.error || mr.statusText}`); return; }
        if (!ij?.ok) { setErrRemote(`images list: ${ij?.error || ir.statusText}`); return; }

        type LI = { path:string; url:string; size:number };
        const models: LI[] = mj.items || [];
        const images: LI[] = ij.items || [];

        // helpers: parse path → brand, model, ts, filename
        const parse = (kind:'models'|'images', p:string) => {
          const re = kind==='models'
            ? /^models\/([^/]+)\/([^/]+)\/(\d+)-(.+\.glb)$/i
            : /^images\/([^/]+)\/([^/]+)\/(\d+)-(.+\.(png|jpg|jpeg|webp))$/i;
          const m = p.match(re);
          if (!m) return null;
          return { brand: m[1], model: m[2], ts: Number(m[3]), filename: m[4] };
        };

        // выберем свежайшую картинку по паре brand/model
        const latestImageByKey = new Map<string, string>();
        for (const im of images) {
          const meta = parse('images', im.path); if (!meta) continue;
          const key = `${meta.brand}/${meta.model}`;
          const prev = latestImageByKey.get(key);
          if (!prev) latestImageByKey.set(key, im.url);
          else {
            // у prev ts неизвестен. для простоты перезаписываем — список уже отсортирован по времени на сервере
            latestImageByKey.set(key, im.url);
          }
        }

        // на каждый .glb делаем Item
        const items: Item[] = [];
        for (const mo of models) {
          const meta = parse('models', mo.path); if (!meta) continue;
          const title = meta.filename.replace(/\.glb$/i,'').replace(/[_-]+/g,' ').trim();
          const key = `${meta.brand}/${meta.model}`;
          items.push({
            id: mo.path,
            brand: meta.brand,
            model: meta.model,
            title: title || 'Model',
            subsystem: 'interior',
            image: latestImageByKey.get(key) || undefined,
            download: mo.url,
          });
        }
        setRemoteItems(items);
      } catch (e:any) {
        setErrRemote(String(e?.message || e));
      }
    })();
  }, []);

  // теперь каталог = GitHub (remote) + локальные + демо
  const catalog = useMemo(() => {
    return [...remoteItems, ...localItems /* , ...initialItems */];
  }, [remoteItems, localItems]);

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
      {errRemote && <div className="mb-4 text-sm text-red-600">GitHub: {errRemote}</div>}
      <p className="text-gray-600 mb-4">Каталог теперь строится из файлов репозитория (<code>models/</code> и <code>images/</code>), плюс ваши локальные карточки.</p>
      <div className="flex flex-wrap gap-2 items-center mb-4">
        <input value={q} onChange={e=>setQ(e.target.value)} placeholder="Поиск: Kia, Golf 3, cupholder..." className="px-3 py-2 rounded-xl border w-64 focus:outline-none focus:ring" />
        <select value={brand} onChange={e=>{ setBrand(e.target.value); setModel(''); }} className="px-3 py-2 rounded-xl border"><option value="">Марка</option>{brands.map(b=>(<option key={b} value={b}>{b}</option>))}</select>
        <select value={model} onChange={e=>setModel(e.target.value)} className="px-3 py-2 rounded-xl border"><option value="">Модель</option>{models.map(m=>(<option key={m} value={m}>{m}</option>))}</select>
        <select value={subsystem} onChange={e=>setSubsystem(e.target.value)} className="px-3 py-2 rounded-xl border"><option value="">Узел</option>{subsystems.map(s=>(<option key={s} value={s}>{s}</option>))}</select>
        <button onClick={()=>{ setQ(''); setBrand(''); setModel(''); setSubsystem(''); }} className="px-3 py-2 rounded-xl border bg-white hover:bg-gray-100">Сброс</button>
        <Link href="/?view=submit" className="ml-auto px-3 py-2 rounded-xl bg-black text-white text-sm">Добавить модель</Link>
      </div>

      {items.length===0 ? (
        <div className="p-6 rounded-2xl bg-white border shadow-sm">Ничего не найдено. Загрузите .glb и (опционально) превью в репозиторий — и обновите страницу.</div>
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


// ===== Общий каркас =====
function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="sticky top-0 z-10 backdrop-blur bg-white/70 border-b">
        <div className="max-w-6xl mx-auto px-4 py-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <h1 className="text-2xl font-bold tracking-tight">Auto3D <span className="text-gray-500 text-base">(static)</span></h1>
          <nav className="flex flex-wrap gap-2 items-center text-sm">
            <Link href="/" className="px-3 py-2 rounded-xl border bg-white hover:bg-gray-100">Каталог</Link>
            <Link href="/?view=submit" className="px-3 py-2 rounded-xl bg-black text-white hover:opacity-90">Добавить модель</Link>
            <Link href="/?view=rules" className="px-3 py-2 rounded-xl border bg-white hover:bg-gray-100">Правила</Link>
            <Link href="/?view=dmca" className="px-3 py-2 rounded-xl border bg-white hover:bg-gray-100">DMCA</Link>
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
  );
}

export default function AppRouter() {
  const view = useView();
  let page: React.ReactNode = <CatalogApp />;
  if (view === 'submit') page = <SubmitPage />;
  if (view === 'rules')  page = <RulesPage />;
  if (view === 'dmca')   page = <DmcaPage />;
  return <AppShell>{page}</AppShell>;
}
