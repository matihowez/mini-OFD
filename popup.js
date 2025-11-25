const logsEl = document.getElementById('logs');
const clearBtn = document.getElementById('clearBtn');
const refreshBtn = document.getElementById('refreshBtn');
const startAllBtn = document.getElementById('startAllBtn');
const stopAllBtn = document.getElementById('stopAllBtn');
const typeFilterEl = document.getElementById('typeFilter');
const langSelectEl = document.getElementById('langSelect');
// Base folder customization removed - using browser default Downloads folder
const folderInfoMsgEl = document.getElementById('folderInfoMsg');
const hdrTitleEl = document.getElementById('hdrTitle');
const resultadosEl = document.getElementById('resultados');

// Mapa en memoria: { [url: string]: { filename, descargado, progress, downloadId?, status? } }
let urls = {};

const VIDEO_URLS_KEY = 'videoUrls';
const TYPE_FILTER_KEY = 'typeFilter';
const LANG_KEY = 'uiLang';
let queue = [];
let running = false;
let currentUrl = null;
const controllers = new Map();
let refreshTimer = null;


// =====================
// I18N
// =====================
const I18N = {
  es: {
    title_page: 'Registros de Fetch de Video',
    header_detected_links: 'Enlaces detectados',
    filter_type_title: 'Tipo',
    filter_type_title: 'Tipo',
    filter_all: 'Todo',
    filter_photos: 'Fotos',
    filter_videos: 'Videos',
    filter_audio: 'Audio',
    refresh_title: 'Actualizar',
    start_all_title: 'Iniciar todas',
    stop_all_title: 'Detener todas',
    clear_title: 'Limpiar registros',
    empty_message: 'Sin enlaces detectados aún',
    status_completed: 'Completado',
    status_downloading: 'Descargando',
    status_paused: 'Pausado',
    status_pending: 'Pendiente',
    action_start: 'Iniciar',
    action_stop: 'Detener',
    lang_title: 'Idioma',
    tasks_label: 'Tareas',
    folder_info: '📁 Los archivos se guardan en la carpeta de Descargas predeterminada del navegador'
  },
  en: {
    title_page: 'Video Fetch Logs',
    header_detected_links: 'Detected links',
    filter_type_title: 'Type',
    filter_type_title: 'Type',
    filter_all: 'All',
    filter_photos: 'Photos',
    filter_videos: 'Videos',
    filter_audio: 'Audio',
    refresh_title: 'Refresh',
    start_all_title: 'Start all',
    stop_all_title: 'Stop all',
    clear_title: 'Clear logs',
    empty_message: 'No links detected yet',
    status_completed: 'Completed',
    status_downloading: 'Downloading',
    status_paused: 'Paused',
    status_pending: 'Pending',
    action_start: 'Start',
    action_stop: 'Stop',
    lang_title: 'Language',
    tasks_label: 'Tasks',
    folder_info: '📁 Files are saved to the browser\'s default Downloads folder'
  },
  ja: {
    title_page: '動画フェッチのログ',
    header_detected_links: '検出されたリンク',
    filter_type_title: '種類',
    filter_all: '写真 + 動画',
    filter_photos: '写真のみ',
    filter_videos: '動画のみ',
    refresh_title: '更新',
    start_all_title: 'すべて開始',
    stop_all_title: 'すべて停止',
    clear_title: 'ログを消去',
    empty_message: '検出されたリンクはまだありません',
    status_completed: '完了',
    status_downloading: 'ダウンロード中',
    status_paused: '一時停止',
    status_pending: '保留',
    action_start: '開始',
    action_stop: '停止',
    lang_title: '言語',
    tasks_label: 'タスク',
    folder_info: '📁 ファイルはブラウザのデフォルトのダウンロードフォルダに保存されます'
  },
  fr: {
    title_page: 'Journaux de récupération vidéo',
    header_detected_links: 'Liens détectés',
    filter_type_title: 'Type',
    filter_all: 'Photos + Vidéos',
    filter_photos: 'Photos uniquement',
    filter_videos: 'Vidéos uniquement',
    refresh_title: 'Actualiser',
    start_all_title: 'Tout démarrer',
    stop_all_title: 'Tout arrêter',
    clear_title: 'Effacer les journaux',
    empty_message: 'Aucun lien détecté pour le moment',
    status_completed: 'Terminé',
    status_downloading: 'Téléchargement',
    status_paused: 'En pause',
    status_pending: 'En attente',
    action_start: 'Démarrer',
    action_stop: 'Arrêter',
    lang_title: 'Langue',
    tasks_label: 'Tâches',
    folder_info: '📁 Les fichiers sont enregistrés dans le dossier Téléchargements par défaut du navigateur'
  },
  de: {
    title_page: 'Video-Fetch-Protokolle',
    header_detected_links: 'Erkannte Links',
    filter_type_title: 'Typ',
    filter_all: 'Fotos + Videos',
    filter_photos: 'Nur Fotos',
    filter_videos: 'Nur Videos',
    refresh_title: 'Aktualisieren',
    start_all_title: 'Alle starten',
    stop_all_title: 'Alle stoppen',
    clear_title: 'Protokolle löschen',
    empty_message: 'Noch keine Links erkannt',
    status_completed: 'Abgeschlossen',
    status_downloading: 'Wird heruntergeladen',
    status_paused: 'Pausiert',
    status_pending: 'Ausstehend',
    action_start: 'Starten',
    action_stop: 'Stoppen',
    lang_title: 'Sprache',
    tasks_label: 'Aufgaben',
    folder_info: '📁 Dateien werden im Standard-Download-Ordner des Browsers gespeichert'
  }
};

let currentLang = 'es';

function detectDefaultLang() {
  try {
    const nav = (navigator && navigator.language) || 'en';
    const s = String(nav).toLowerCase();
    if (s.startsWith('es')) return 'es';
    if (s.startsWith('en')) return 'en';
    if (s.startsWith('ja')) return 'ja';
    if (s.startsWith('fr')) return 'fr';
    if (s.startsWith('de')) return 'de';
    return 'en';
  } catch { return 'en'; }
}

function t(key) {
  const dict = I18N[currentLang] || I18N.en;
  return dict[key] || key;
}

function setHeaderTitle() {
  try {
    if (!hdrTitleEl) return;
    const total = Object.keys(urls || {}).length;
    let done = 0;
    try {
      done = Object.values(urls || {}).filter((it) => !!(it && it.descargado)).length;
    } catch (_) { done = 0; }
    hdrTitleEl.textContent = `${t('header_detected_links')} (${done}/${total})`;
  } catch (_) { }
}

function updateResultados() {
  try {
    if (!resultadosEl) return;
    const total = Object.keys(urls || {}).length;
    let done = 0;
    try {
      done = Object.values(urls || {}).filter((it) => !!(it && it.descargado)).length;
    } catch (_) { done = 0; }
    resultadosEl.textContent = `${t('tasks_label')}: ${done}/${total}`;
  } catch (_) { }
}

async function loadLang() {
  return new Promise((resolve) => {
    chrome.storage.local.get({ [LANG_KEY]: detectDefaultLang() }, (res) => {
      resolve(res[LANG_KEY] || detectDefaultLang());
    });
  });
}

function applyUITranslations() {
  try { document.title = t('title_page'); } catch { }
  setHeaderTitle();
  updateResultados();
  if (typeFilterEl) {
    typeFilterEl.title = t('filter_type_title');
    const opts = typeFilterEl.options || [];
    for (let i = 0; i < opts.length; i++) {
      const o = opts[i];
      if (!o) continue;
      if (o.value === 'all') o.textContent = t('filter_all');
      else if (o.value === 'photos') o.textContent = t('filter_photos');
      else if (o.value === 'videos') o.textContent = t('filter_videos');
      else if (o.value === 'audio') o.textContent = t('filter_audio');
    }
  }
  if (refreshBtn) refreshBtn.title = t('refresh_title');
  if (startAllBtn) startAllBtn.title = t('start_all_title');
  if (stopAllBtn) stopAllBtn.title = t('stop_all_title');
  if (clearBtn) clearBtn.title = t('clear_title');
  if (langSelectEl) langSelectEl.title = t('lang_title');
  if (folderInfoMsgEl) folderInfoMsgEl.textContent = t('folder_info');
  renderUrlList();
}

function getActiveTab() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      resolve(tabs && tabs[0]);
    });
  });
}

function getOrigin(url) {
  try { const u = new URL(url); return u.origin; } catch { return ''; }
}

function deriveFilename(href) {
  try {
    const u = new URL(href);
    const last = u.pathname.split('/').filter(Boolean).pop() || '';
    if (!last) return 'archivo';
    return decodeURIComponent(last.split('?')[0]);
  } catch { return 'archivo'; }
}

async function loadUrlsFromStorage() {
  return new Promise((resolve) => {
    chrome.storage.local.get({ [VIDEO_URLS_KEY]: {} }, (res) => {
      resolve(res[VIDEO_URLS_KEY] || {});
    });
  });
}

async function loadTypeFilter() {
  return new Promise((resolve) => {
    chrome.storage.local.get({ [TYPE_FILTER_KEY]: 'all' }, (res) => {
      resolve(res[TYPE_FILTER_KEY] || 'all');
    });
  });
}



async function getModelName() {
  try {
    const tab = await getActiveTab();
    const url = tab?.url || '';
    const u = new URL(url);
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts.length > 0) {
      const p1 = parts[0];
      // Excluir rutas reservadas comunes
      if (!['my', 'api2', 'posts', 'photos', 'videos', 'messages', 'settings', 'bookmarks'].includes(p1)) {
        return p1;
      }
    }
  } catch { }
  return 'unknown_model';
}

function updateUrlsFromLogs(logs, baseUrls) {
  const out = { ...(baseUrls || {}) };
  if (!Array.isArray(logs)) return out;
  for (const i of logs) {
    if (i && i.format === 'json' && i.bodyJson && i.bodyJson.list) {
      try {
        const lowerUrl = String(i.url || '').toLowerCase();
        const isPhoto = lowerUrl.includes('/posts/photos') || lowerUrl.includes('photo');
        const isVideo = lowerUrl.includes('/posts/videos') || lowerUrl.includes('video');
        const isMessage = lowerUrl.includes('/messages');

        i.bodyJson.list.forEach((element) => {
          if (!element || !element.media) return;
          element.media.forEach((m) => {
            try {
              const full = m && m.files && m.files.full;
              const href = full && full.url;
              if (!href) return;

              if (!out[href]) {
                let type = 'video';
                if (m.type === 'photo') type = 'photo';
                else if (m.type === 'audio') type = 'audio';
                else if (isPhoto) type = 'photo';
                else if (isVideo) type = 'video';

                out[href] = {
                  filename: full?.name || full?.filename || deriveFilename(href),
                  descargado: false,
                  progress: 0,
                  type: type,
                  origin: isMessage ? 'messages' : 'posts'
                };
              }
            } catch (_) { }
          });
        });
      } catch (_) { }
    }
  }
  return out;
}

function getCurrentFilter() {
  const v = typeFilterEl ? typeFilterEl.value : 'all';
  return ['photos', 'videos', 'audio'].includes(v) ? v : 'all';
}

function renderUrlList() {
  logsEl.innerHTML = '';
  setHeaderTitle();
  updateResultados();
  const filter = getCurrentFilter();
  const entries = Object.entries(urls).filter(([href, info]) => {
    if (filter === 'photos') return (info?.type || '').startsWith('photo');
    if (filter === 'videos') return (info?.type || '').startsWith('video');
    if (filter === 'audio') return (info?.type || '').startsWith('audio');
    return true;
  });
  if (entries.length === 0) {
    const empty = document.createElement('div');
    try { empty.textContent = t('empty_message'); } catch { }
    empty.style.color = '#666';
    empty.style.padding = '10px';
    logsEl.appendChild(empty);
    return;
  }

  for (const [href, info] of entries) {
    const row = document.createElement('div');
    row.className = 'url-item';

    const line = document.createElement('div');
    line.className = 'url-line';

    if (info?.origin === 'messages') {
      const tag = document.createElement('span');
      tag.textContent = 'MSG';
      tag.style.backgroundColor = '#ffd480';
      tag.style.color = '#121821';
      tag.style.fontSize = '10px';
      tag.style.fontWeight = 'bold';
      tag.style.padding = '2px 5px';
      tag.style.borderRadius = '4px';
      tag.style.marginRight = '6px';
      tag.style.verticalAlign = 'middle';
      line.appendChild(tag);
    }

    const name = info?.filename || deriveFilename(href);
    line.appendChild(document.createTextNode(name));
    row.appendChild(line);

    const div = document.createElement('div');
    div.classList.add('div-wrap');

    const barWrap = document.createElement('div');
    barWrap.className = 'bar-wrap';
    const progress = document.createElement('progress');
    progress.max = 100;
    progress.value = info?.descargado ? 100 : (typeof info?.progress === 'number' ? info.progress : 0);
    const status = document.createElement('span');
    status.className = 'status';
    const pct = typeof info?.progress === 'number' ? ` ${info.progress}%` : '';
    status.textContent = info?.descargado
      ? t('status_completed')
      : (info?.status === 'downloading'
        ? `${t('status_downloading')}${pct}`
        : (info?.status === 'paused' ? t('status_paused') : t('status_pending')));
    barWrap.appendChild(progress);
    barWrap.appendChild(status);
    div.appendChild(barWrap);


    const actions = document.createElement('div');
    actions.className = 'bar-wrap';
    actions.style['justify-content'] = 'end';
    const startBtn = document.createElement('button');
    startBtn.textContent = t('action_start');
    startBtn.title = t('action_start');
    startBtn.disabled = info?.status === 'downloading';
    startBtn.addEventListener('click', () => startOne(href));
    const stopBtn = document.createElement('button');
    stopBtn.textContent = t('action_stop');
    stopBtn.title = t('action_stop');
    stopBtn.disabled = info?.status !== 'downloading';
    stopBtn.addEventListener('click', () => stopOne(href));
    actions.appendChild(startBtn);
    actions.appendChild(stopBtn);
    div.appendChild(actions);
    row.appendChild(div);

    logsEl.appendChild(row);
  }
}

async function loadFiltered() {
  const tab = await getActiveTab();
  const tabId = tab?.id;
  const tabOrigin = getOrigin(tab?.url || '');
  return new Promise((resolve) => {
    chrome.storage.local.get({ videoFetchLogs: [] }, (res) => {
      const logs = Array.isArray(res.videoFetchLogs) ? res.videoFetchLogs : [];
      const filtered = logs.filter((e) => {
        if (typeof e.tabId === 'number' && typeof tabId === 'number') {
          return e.tabId === tabId;
        }
        if (e.pageUrl && tabOrigin) {
          return e.pageUrl.startsWith(tabOrigin);
        }
        return true;
      });
      resolve(filtered);
    });
  });
}

async function refresh() {
  const logs = await loadFiltered();
  const stored = await loadUrlsFromStorage();
  const merged = updateUrlsFromLogs(logs, stored);
  urls = merged;
  // Persistir para mantener progreso y nuevas entradas
  chrome.storage.local.set({ [VIDEO_URLS_KEY]: merged }, () => {
    renderUrlList();
  });
}

clearBtn.addEventListener('click', () => {
  try {
    // Cancelar descargas en curso y limpiar estado local
    queue = [];
    running = false;
    currentUrl = null;
    controllers.forEach((c) => { try { c.abort(); } catch (_) { } });
    controllers.clear();
    urls = {};
    // Limpiar todo el storage local de la extensión
    chrome.storage.local.clear(() => {
      if (typeFilterEl) typeFilterEl.value = 'all';
      if (langSelectEl) langSelectEl.value = currentLang;
      // Restaurar filtro por defecto a 'all' y mantener idioma actual
      chrome.storage.local.set({ [TYPE_FILTER_KEY]: 'all', [LANG_KEY]: currentLang }, () => {
        applyUITranslations();
        renderUrlList();
      });
    });
  } catch (_) {
    // fallback de renderizado
    renderUrlList();
  }
});

refreshBtn.addEventListener('click', async () => {
  const tab = await getActiveTab();
  if (tab && tab.id) {
    chrome.tabs.reload(tab.id);
  }
});

startAllBtn.addEventListener('click', () => startAll());

stopAllBtn.addEventListener('click', () => stopAll());

if (typeFilterEl) {
  typeFilterEl.addEventListener('change', async () => {
    const v = getCurrentFilter();
    chrome.storage.local.set({ [TYPE_FILTER_KEY]: v }, () => renderUrlList());
  });
}

if (langSelectEl) {
  langSelectEl.addEventListener('change', async () => {
    const v = langSelectEl.value || 'en';
    const next = I18N[v] ? v : 'en';
    chrome.storage.local.set({ [LANG_KEY]: next }, () => {
      currentLang = next;
      applyUITranslations();
    });
  });
}




chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'local') return;
  if (changes.videoFetchLogs) {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => { refreshTimer = null; refresh(); }, 120);
  }
  if (changes[VIDEO_URLS_KEY]) {
    const stored = await loadUrlsFromStorage();
    urls = stored;
    renderUrlList();
  }
  if (changes[TYPE_FILTER_KEY]) {
    if (typeFilterEl) typeFilterEl.value = await loadTypeFilter();
    renderUrlList();
  }
  if (changes[LANG_KEY]) {
    const v = await loadLang();
    currentLang = I18N[v] ? v : 'en';
    if (langSelectEl) langSelectEl.value = currentLang;
    applyUITranslations();
  }

});

// Recibir logs del background y volcarlos a la consola del popup
chrome.runtime.onMessage.addListener((msg) => {
  if (!msg || msg.type !== 'popupLog') return;
  const { event, data } = msg;
  const prefix = '[Fetch]';
  try {
    if (event && String(event).includes('error')) {
      console.error(prefix, event, data);
    } else {
      console.log(prefix, event, data);
    }
  } catch (_) { }
});

// =====================
// Cola y descarga con fetch en popup
// =====================

function setUrlState(href, mut) {
  const next = { ...urls };
  const cur = next[href] || { filename: deriveFilename(href), descargado: false, progress: 0 };
  const updated = mut(cur) || cur;
  next[href] = updated;
  urls = next;
  chrome.storage.local.set({ [VIDEO_URLS_KEY]: next }, () => renderUrlList());
}

function startOne(href) {
  if (!href) return;
  if (!queue.includes(href)) queue.push(href);
  if (!running) processNext();
}

function stopOne(href) {
  const idx = queue.indexOf(href);
  if (idx >= 0) queue.splice(idx, 1);
  const c = controllers.get(href);
  if (c) { try { c.abort(); } catch (_) { } controllers.delete(href); }
  setUrlState(href, (it) => { it.status = 'paused'; return it; });
  if (currentUrl === href) {
    running = false; currentUrl = null; processNext();
  }
}

function startAll() {
  const filter = getCurrentFilter();
  for (const [href, it] of Object.entries(urls)) {
    const t = (it && it.type) || '';
    const match = filter === 'all' ||
      (filter === 'photos' && t.startsWith('photo')) ||
      (filter === 'videos' && t.startsWith('video')) ||
      (filter === 'audio' && t.startsWith('audio'));
    if (match && it && !it.descargado && !queue.includes(href)) queue.push(href);
  }
  if (!running) processNext();
}

function stopAll() {
  for (const href of queue) {
    const c = controllers.get(href);
    if (c) { try { c.abort(); } catch (_) { } controllers.delete(href); }
    setUrlState(href, (it) => { if (it.status === 'downloading') it.status = 'paused'; return it; });
  }
  queue = [];
  running = false;
  currentUrl = null;
}

async function fetchAndSave(href) {
  const it = urls[href] || {};
  let name = it.filename || deriveFilename(href);
  const typ = (it && it.type) || 'video';
  const controller = new AbortController();
  controllers.set(href, controller);
  console.log('[POPUP] fetch:start', href);
  const resp = await fetch(href, { method: 'GET', credentials: 'include', signal: controller.signal });
  console.log('[POPUP] fetch:response', href, resp.status, resp.ok);
  const total = Number(resp.headers.get('content-length') || 0) || undefined;
  const contentType = resp.headers.get('content-type') || '';
  const reader = resp.body && resp.body.getReader ? resp.body.getReader() : null;
  const chunks = [];
  let received = 0;
  setUrlState(href, (s) => { s.status = 'downloading'; s.descargado = false; return s; });

  if (!reader) {
    const buf = await resp.arrayBuffer();
    const blob = new Blob([buf], { type: contentType || undefined });
    name = ensureExtension(name, contentType, href, typ);
    const modelName = await getModelName();
    await saveBlob(blob, name, typ, modelName);
    return { size: buf.byteLength };
  }
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.byteLength;
    setUrlState(href, (s) => {
      s.bytesReceived = received;
      if (typeof total === 'number') s.totalBytes = total;
      s.progress = typeof total === 'number' && total > 0 ? Math.max(0, Math.min(100, Math.round((received / total) * 100))) : (s.progress || 0);
      s.status = 'downloading';
      return s;
    });
  }
  const blob = new Blob(chunks, { type: contentType || undefined });
  name = ensureExtension(name, contentType, href, typ);
  console.log('[POPUP] fetch:completed', href, received);
  const modelName = await getModelName();
  await saveBlob(blob, name, typ, modelName);
  return { size: received };
}

function ensureExtension(filename, contentType, url, typ) {
  try {
    const hasExt = /\.[a-z0-9]{2,5}$/i.test(filename || '');
    if (hasExt) return filename;
    const ct = (contentType || '').split(';')[0].trim().toLowerCase();
    const map = {
      'video/mp4': 'mp4',
      'video/webm': 'webm',
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
      'image/gif': 'gif',
      'audio/mpeg': 'mp3',
      'audio/wav': 'wav',
      'audio/ogg': 'ogg',
      'audio/mp4': 'm4a'
    };
    let ext = map[ct] || '';
    if (!ext) {
      try {
        const u = new URL(url);
        const m = (u.pathname || '').match(/\.([a-z0-9]{2,5})$/i);
        if (m) ext = m[1];
      } catch { }
    }
    if (!ext) {
      if (ct.startsWith('image/')) ext = 'jpg';
      else if (ct.startsWith('video/')) ext = 'mp4';
      else if (ct.startsWith('audio/')) ext = 'mp3';
      else ext = typ === 'photo' ? 'jpg' : (typ === 'audio' ? 'mp3' : 'mp4');
    }
    return filename ? `${filename}.${ext}` : `file.${ext}`;
  } catch {
    return filename || 'file.bin';
  }
}

async function saveBlob(blob, filename, type, modelName) {
  try {
    const blobUrl = URL.createObjectURL(blob);

    // Usar solo el nombre del archivo, Chrome lo guardará en la carpeta de Descargas predeterminada
    let defExt = 'video.mp4';
    if (type === 'photo') defExt = 'photo.jpg';
    else if (type === 'audio') defExt = 'audio.mp3';

    const finalFilename = filename || defExt;

    chrome.downloads.download({ url: blobUrl, filename: finalFilename, saveAs: false }, () => {
      setTimeout(() => { try { URL.revokeObjectURL(blobUrl); } catch (_) { } }, 0);
    });
  } catch (e) {
    console.error('[POPUP] download:error', e);
  }
}

async function processNext() {
  if (running) return;
  const next = queue.shift();
  if (!next) return;
  running = true;
  currentUrl = next;
  try {
    await fetchAndSave(next);
    setUrlState(next, (s) => { s.status = 'completed'; s.descargado = true; s.progress = 100; return s; });
  } catch (e) {
    if (e && (e.name === 'AbortError' || (typeof e.message === 'string' && e.message.includes('aborted')))) {
      console.warn('[POPUP] fetch:aborted', next);
      setUrlState(next, (s) => { s.status = 'paused'; return s; });
    } else {
      console.error('[POPUP] fetch:error', next, e);
      setUrlState(next, (s) => { s.status = 'error'; return s; });
    }
  } finally {
    controllers.delete(next);
    running = false;
    currentUrl = null;
    processNext();
  }
}

(async () => {
  if (typeFilterEl) typeFilterEl.value = await loadTypeFilter();
  const lang = await loadLang();
  currentLang = I18N[lang] ? lang : detectDefaultLang();
  if (langSelectEl) langSelectEl.value = currentLang;
  applyUITranslations();
  refresh();
})();
