// Registra peticiones de red que contengan 'video'/'photo' o endpoints de posts
const matchesTarget = (url) => {
  try {
    const u = String(url).toLowerCase();
    // Filtrar solo llamadas de API para evitar llenar el log con imágenes/videos estáticos
    if (!u.includes('api2')) return false;

    return (
      u.includes('/posts') ||
      u.includes('/messages') ||
      u.includes('/medias') ||
      u.includes('/users')
    );
  } catch {
    return false;
  }
};

function pushLog(entry) {
  chrome.storage.local.get({ videoFetchLogs: [] }, (res) => {
    let logs = Array.isArray(res.videoFetchLogs) ? res.videoFetchLogs : [];
    logs.push(entry);
    if (logs.length > 200) logs = logs.slice(-200);
    chrome.storage.local.set({ videoFetchLogs: logs });
  });
}

chrome.webRequest.onCompleted.addListener(
  (details) => {
    if (!matchesTarget(details.url)) return;
    const entry = {
      url: details.url,
      method: details.method,
      status: details.statusCode,
      ok: details.statusCode >= 200 && details.statusCode < 300,
      contentType: undefined,
      timestamp: Date.now(),
      from: 'webRequest',
      tabId: details.tabId,
      type: details.type
    };
    pushLog(entry);
  },
  { urls: ["*://*.onlyfans.com/*"] }
);

chrome.webRequest.onErrorOccurred.addListener(
  (details) => {
    if (!matchesTarget(details.url)) return;
    const entry = {
      url: details.url,
      method: details.method,
      status: 0,
      ok: false,
      contentType: undefined,
      timestamp: Date.now(),
      from: 'webRequest',
      tabId: details.tabId,
      type: details.type,
      bodyPreview: details.error
    };
    pushLog(entry);
  },
  { urls: ["*://*.onlyfans.com/*"] }
);

// =========================
// Depuración con chrome.debugger + DevTools Protocol (Network.getResponseBody)
// Captura el 100% del body y parsea JSON cuando aplique
// =========================

const attachedTabs = new Set();
// request key: `${tabId}:${requestId}` -> meta
const reqMeta = new Map();
const reqHeaders = new Map(); // key `${tabId}:${requestId}` -> request.headers
const VIDEO_HEADERS_KEY = 'videoHeaders';

function ensureDebuggerAttached(tabId) {
  if (typeof tabId !== 'number' || tabId < 0) return;
  if (attachedTabs.has(tabId)) return;
  try {
    chrome.debugger.attach({ tabId }, '1.3', () => {
      if (chrome.runtime.lastError) {
        // No adjuntar si otro debugger está activo u otro error
        return;
      }
      attachedTabs.add(tabId);
      chrome.debugger.sendCommand({ tabId }, 'Network.enable', {}, () => {
        // Ignorar errores aquí
      });
    });
  } catch (_) { }
}

function detachDebugger(tabId) {
  if (!attachedTabs.has(tabId)) return;
  try {
    chrome.debugger.detach({ tabId }, () => {
      attachedTabs.delete(tabId);
    });
  } catch (_) { }
}

// Adjuntar automáticamente a las pestañas relevantes
function tryAttachToTab(tabId, changeInfo, tab) {
  try {
    const url = (tab && tab.url) || changeInfo?.url || '';
    if (/^https?:\/\/[^\s]+onlyfans\.com\//i.test(url)) {
      ensureDebuggerAttached(tabId);
    }
  } catch (_) { }
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // Adjuntar cuando haya URL útil o la carga esté completa
  if (changeInfo.status === 'loading' || changeInfo.status === 'complete' || changeInfo.url) {
    tryAttachToTab(tabId, changeInfo, tab);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  detachDebugger(tabId);
});

chrome.debugger.onDetach.addListener((source, reason) => {
  if (source && typeof source.tabId === 'number') {
    attachedTabs.delete(source.tabId);
  }
});

function decodeBody(body, base64Encoded) {
  try {
    if (base64Encoded) {
      // atob disponible en SW; si no, usar Buffer si está disponible
      return atob(body);
    }
    return body;
  } catch (_) {
    try {
      // Fallback Node style si existiera (no en MV3 estándar)
      // eslint-disable-next-line no-undef
      return Buffer.from(body, 'base64').toString('utf8');
    } catch {
      return '';
    }
  }
}

function filterRequestHeaders(h) {
  try {
    const allow = new Set(['authorization', 'cookie', 'user-agent', 'accept', 'accept-language', 'range', 'referer', 'origin']);
    const out = {};
    for (const [k, v] of Object.entries(h || {})) {
      const key = String(k).toLowerCase();
      if (allow.has(key)) out[k] = v;
    }
    return out;
  } catch { return {}; }
}

function notifyPopup(event, data) {
  try {
    chrome.runtime.sendMessage({ type: 'popupLog', event, data });
  } catch (_) { }
}

chrome.debugger.onEvent.addListener((source, method, params) => {
  try {
    const tabId = source && source.tabId;
    if (typeof tabId !== 'number') return;

    if (method === 'Network.responseReceived') {
      const resp = params && params.response;
      if (!resp) return;
      const url = resp.url || '';
      if (!matchesTarget(url)) return;
      const key = `${tabId}:${params.requestId}`;
      reqMeta.set(key, {
        url,
        status: resp.status,
        ok: resp.status >= 200 && resp.status < 300,
        contentType: resp.mimeType || '',
        timestamp: Date.now(),
        from: 'debugger',
        tabId,
        type: 'xmlhttprequest'
      });
    }

    if (method === 'Network.requestWillBeSent') {
      const url = params?.request?.url || '';
      const headers = params?.request?.headers || {};
      const key = `${tabId}:${params.requestId}`;
      reqHeaders.set(key, headers);
      // Persistir headers por URL de forma independiente
      chrome.storage.local.get({ [VIDEO_HEADERS_KEY]: {} }, (res) => {
        const map = res[VIDEO_HEADERS_KEY] || {};
        map[url] = headers;
        chrome.storage.local.set({ [VIDEO_HEADERS_KEY]: map });
      });
    }

    if (method === 'Network.loadingFinished') {
      const key = `${tabId}:${params.requestId}`;
      const meta = reqMeta.get(key);
      if (!meta) return;

      chrome.debugger.sendCommand(
        { tabId },
        'Network.getResponseBody',
        { requestId: params.requestId },
        (result) => {
          try {
            if (chrome.runtime.lastError) {
              // Si falla, aún logueamos el meta
              pushLog(meta);
              reqMeta.delete(key);
              return;
            }
            const text = decodeBody(result.body || '', Boolean(result.base64Encoded));
            // Intentar parsear JSON
            let bodyJson = null;
            let preview = undefined;
            try {
              bodyJson = JSON.parse(text);
            } catch (_) {
              // No es JSON, generamos una vista previa de texto
              try {
                preview = (text || '').slice(0, 4000);
              } catch { preview = undefined; }
            }

            const entry = {
              ...meta,
              bodyPreview: preview,
              format: bodyJson ? 'json' : 'text',
              bodyJson: bodyJson || undefined,
              bodyJsonSize: bodyJson ? (typeof text === 'string' ? text.length : undefined) : undefined,
              bodyJsonTruncated: false
            };
            // Mostrar por consola cuando sea JSON válido
            try {
              if (bodyJson) {
                //console.log('[Debugger JSON]', meta.url, bodyJson);
              }
            } catch (_) { }
            pushLog(entry);
          } catch (_) {
            pushLog(meta);
          } finally {
            reqMeta.delete(key);
            reqHeaders.delete(key);
          }
        }
      );
    }
  } catch (_) { }
});

// Intentar adjuntar a las pestañas existentes al iniciar el SW
try {
  chrome.tabs.query({ url: ["*://*.onlyfans.com/*"] }, (tabs) => {
    try {
      for (const t of tabs || []) {
        if (t && typeof t.id === 'number') ensureDebuggerAttached(t.id);
      }
    } catch (_) { }
  });
} catch (_) { }

// =========================
// Gestor de descargas: start/stop y progreso persistente
// Guarda el listado en chrome.storage.local.videoUrls
// Estructura por entrada: { filename, descargado, progress, downloadId, status }
// =========================

const VIDEO_URLS_KEY = 'videoUrls';
// Cola de descargas en serie
const downloadQueue = [];
let queueRunning = false;
let currentUrl = null;
let currentAbort = null;
const activeDownloads = new Map(); // downloadId -> url

function deriveFilename(href) {
  try {
    const u = new URL(href);
    const last = u.pathname.split('/').filter(Boolean).pop() || '';
    if (!last) return 'archivo';
    return decodeURIComponent(last.split('?')[0]);
  } catch {
    return 'archivo';
  }
}

function withVideoUrls(mutator, cb) {
  chrome.storage.local.get({ [VIDEO_URLS_KEY]: {} }, (res) => {
    const urls = (res && res[VIDEO_URLS_KEY]) || {};
    const next = mutator(urls) || urls;
    chrome.storage.local.set({ [VIDEO_URLS_KEY]: next }, () => {
      if (typeof cb === 'function') cb(next);
    });
  });
}

function startDownload(url) {
  if (!url) return;
  // Comprobar si hay descarga pausada para reanudar; si no, iniciar una nueva
  chrome.storage.local.get({ [VIDEO_URLS_KEY]: {} }, (res) => {
    const state = res[VIDEO_URLS_KEY] || {};
    const it = state[url];
    if (it && typeof it.downloadId === 'number' && (it.status === 'paused' || it.status === 'downloading')) {
      chrome.downloads.resume(it.downloadId, () => {
        withVideoUrls((st) => {
          const cur = st[url] || {};
          cur.status = 'downloading';
          st[url] = cur;
          return st;
        });
      });
      return;
    }

    chrome.downloads.download({ url, saveAs: false, conflictAction: 'uniquify' }, (downloadId) => {
      if (typeof downloadId !== 'number') {
        // Error al iniciar
        withVideoUrls((state) => {
          const it = state[url] || { filename: deriveFilename(url), descargado: false, progress: 0 };
          it.status = 'error';
          state[url] = it;
          return state;
        });
        return;
      }
      activeDownloads.set(downloadId, url);
      withVideoUrls((state) => {
        const it = state[url] || { filename: deriveFilename(url), descargado: false, progress: 0 };
        it.downloadId = downloadId;
        it.status = 'downloading';
        it.descargado = false;
        state[url] = it;
        return state;
      });
    });
  });
}

function pauseOrCancelDownload(url) {
  chrome.storage.local.get({ [VIDEO_URLS_KEY]: {} }, (res) => {
    const state = res[VIDEO_URLS_KEY] || {};
    const it = url ? state[url] : null;
    const id = it && it.downloadId;
    if (typeof id === 'number') {
      chrome.downloads.pause(id, () => {
        // Si no se puede pausar, intentamos cancelar
        if (chrome.runtime.lastError) {
          chrome.downloads.cancel(id, () => { });
        }
        withVideoUrls((st) => {
          const cur = st[url] || {};
          cur.status = 'paused';
          st[url] = cur;
          return st;
        });
      });
      return;
    }
    // Si es la actual y no hay id, abortar fetch si existiera
    if (currentUrl && (!url || url === currentUrl)) {
      try { currentAbort && currentAbort.abort(); } catch (_) { }
    }
    // Marcar como pausado
    withVideoUrls((st) => {
      if (url) {
        const cur = st[url] || {};
        cur.status = 'paused';
        st[url] = cur;
      }
      return st;
    });
  });
}

function stopAll() {
  downloadQueue.length = 0;
  pauseOrCancelDownload(currentUrl || undefined);
  queueRunning = false;
  notifyPopup('stopAll', {});
}

function enqueue(url) {
  if (!url) return;
  if (!downloadQueue.includes(url)) downloadQueue.push(url);
  notifyPopup('enqueue', { url });
}

function enqueueAll(state) {
  const urls = Object.keys(state || {});
  for (const u of urls) {
    const it = state[u];
    if (!it || it.descargado) continue;
    if (!downloadQueue.includes(u)) downloadQueue.push(u);
  }
}

async function fetchWithHeaders(url, headers) {
  const controller = new AbortController();
  currentAbort = controller;
  const init = { method: 'GET', headers: headers || {}, credentials: 'include', signal: controller.signal };
  notifyPopup('fetch:start', { url, headers: init.headers });
  const resp = await fetch(url, init);
  notifyPopup('fetch:response', { url, status: resp.status, ok: resp.ok, contentType: resp.headers.get('content-type') || '' });
  const total = Number(resp.headers.get('content-length') || 0) || undefined;
  const contentType = resp.headers.get('content-type') || 'application/octet-stream';
  const reader = resp.body && resp.body.getReader ? resp.body.getReader() : null;
  const chunks = [];
  let received = 0;
  if (!reader) {
    const buf = await resp.arrayBuffer();
    return { blob: new Blob([buf], { type: contentType }), total: buf.byteLength };
  }
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.byteLength;
    // Actualizar progreso
    withVideoUrls((st) => {
      const it = st[url] || { filename: deriveFilename(url), descargado: false, progress: 0 };
      it.bytesReceived = received;
      if (typeof total === 'number') it.totalBytes = total;
      it.progress = typeof total === 'number' && total > 0 ? Math.max(0, Math.min(100, Math.round((received / total) * 100))) : it.progress || 0;
      it.status = 'downloading';
      st[url] = it;
      return st;
    });
  }
  const blob = new Blob(chunks, { type: contentType });
  notifyPopup('fetch:completed', { url, size: received, contentType });
  return { blob, total: typeof total === 'number' ? total : received };
}

function processNext() {
  if (queueRunning) return;
  const next = downloadQueue.shift();
  if (!next) return;
  queueRunning = true;
  currentUrl = next;
  notifyPopup('queue:start', { url: next });

  // Descargar con un simple fetch GET y luego guardar el blob
  chrome.storage.local.get({ [VIDEO_URLS_KEY]: {}, [VIDEO_HEADERS_KEY]: {} }, async (res) => {
    const state = res[VIDEO_URLS_KEY] || {};
    const it = state[next] || {};
    const name = it.filename || deriveFilename(next);
    try {
      const { blob, total } = await fetchWithHeaders(next, {});
      const blobUrl = URL.createObjectURL(blob);
      chrome.downloads.download({ url: blobUrl, filename: name, saveAs: false, conflictAction: 'uniquify' }, (downloadId) => {
        if (typeof downloadId === 'number') {
          activeDownloads.set(downloadId, next);
          notifyPopup('download:created', { url: next, id: downloadId, filename: name, size: total });
        }
        // Marcamos completado ya que el fetch terminó y el blob está listo
        withVideoUrls((st) => {
          const cur = st[next] || {};
          cur.status = 'completed';
          cur.descargado = true;
          cur.progress = 100;
          st[next] = cur;
          return st;
        });
        try { URL.revokeObjectURL(blobUrl); } catch (_) { }
        queueRunning = false;
        currentUrl = null;
        currentAbort = null;
        notifyPopup('download:saved', { url: next, filename: name });
        processNext();
      });
    } catch (e) {
      const msg = String((e && e.message) || e);
      notifyPopup('fetch:error', { url: next, message: msg });
      withVideoUrls((st) => {
        const cur = st[next] || {};
        cur.status = 'error';
        st[next] = cur;
        return st;
      });
      queueRunning = false;
      currentUrl = null;
      currentAbort = null;
      processNext();
    }
  });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.type) return;
  if (msg.type === 'startDownload' && msg.url) {
    enqueue(msg.url);
    processNext();
    sendResponse && sendResponse({ ok: true });
  }
  if (msg.type === 'stopDownload' && msg.url) {
    // Quitar de la cola; si es el actual, abortar
    const idx = downloadQueue.indexOf(msg.url);
    if (idx >= 0) downloadQueue.splice(idx, 1);
    if (currentUrl === msg.url) pauseOrCancelDownload(msg.url);
    sendResponse && sendResponse({ ok: true });
  }
  if (msg.type === 'startAll') {
    chrome.storage.local.get({ [VIDEO_URLS_KEY]: {} }, (res) => {
      notifyPopup('startAll', {});
      enqueueAll(res[VIDEO_URLS_KEY] || {});
      processNext();
      sendResponse && sendResponse({ ok: true });
    });
    return true;
  }
  if (msg.type === 'stopAll') {
    stopAll();
    sendResponse && sendResponse({ ok: true });
  }
});

// Trackear progresos y finalización desde el gestor de descargas del navegador
chrome.downloads.onCreated.addListener((item) => {
  try {
    const href = item && item.url;
    if (!href) return;
    chrome.storage.local.get({ [VIDEO_URLS_KEY]: {} }, (res) => {
      const state = res[VIDEO_URLS_KEY] || {};
      const it = state[href];
      if (!it) return; // solo seguimos URLs que conocemos
      it.downloadId = item.id;
      it.status = 'downloading';
      it.descargado = false;
      state[href] = it;
      chrome.storage.local.set({ [VIDEO_URLS_KEY]: state }, () => { });
      activeDownloads.set(item.id, href);
      notifyPopup('download:created', { url: href, id: item.id });
    });
  } catch (_) { }
});

chrome.downloads.onChanged.addListener((delta) => {
  try {
    const id = delta.id;
    if (typeof id !== 'number') return;
    const href = activeDownloads.get(id);
    if (!href) return;
    withVideoUrls((state) => {
      const it = state[href] || { filename: deriveFilename(href), descargado: false, progress: 0 };
      if (delta.totalBytes && typeof delta.totalBytes.current === 'number') it.totalBytes = delta.totalBytes.current;
      if (delta.bytesReceived && typeof delta.bytesReceived.current === 'number') it.bytesReceived = delta.bytesReceived.current;
      if (typeof it.totalBytes === 'number' && it.totalBytes > 0 && typeof it.bytesReceived === 'number') {
        it.progress = Math.max(0, Math.min(100, Math.round((it.bytesReceived / it.totalBytes) * 100)));
      }
      if (delta.state && delta.state.current) {
        const st = delta.state.current;
        if (st === 'complete') {
          it.status = 'completed';
          it.descargado = true;
          it.progress = 100;
          activeDownloads.delete(id);
          if (currentUrl === href) {
            queueRunning = false; currentUrl = null; currentAbort = null; processNext();
          }
        } else if (st === 'interrupted') {
          it.status = 'error';
          activeDownloads.delete(id);
          if (currentUrl === href) {
            queueRunning = false; currentUrl = null; currentAbort = null; processNext();
          }
        } else if (st === 'in_progress') {
          it.status = 'downloading';
        }
      }
      state[href] = it;
      return state;
    });
  } catch (_) { }
});

// Inicializar estructura en storage al arrancar el SW
chrome.storage.local.get({ [VIDEO_URLS_KEY]: {} }, (res) => {
  const cur = res[VIDEO_URLS_KEY] || {};
  if (typeof cur !== 'object') {
    chrome.storage.local.set({ [VIDEO_URLS_KEY]: {} });
  }
});
