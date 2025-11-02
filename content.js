// Inyecta un script en el contexto principal de la página
(() => {
  try {
    const s = document.createElement('script');
    s.src = chrome.runtime.getURL('injected.js');
    s.onload = () => s.remove();
    (document.head || document.documentElement).appendChild(s);
  } catch (e) {
    // Si algo falla, no rompemos la página
  }
})();

// Escucha mensajes del script inyectado y guarda logs en chrome.storage
window.addEventListener('message', (event) => {
  try {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== 'fetch-video-detector' || !data.payload) return;

    const entry = {
      ...data.payload,
      pageUrl: location.href,
      pageTitle: document.title
    };

    // Guardar log bruto si se desea mantener historial (opcional)
    chrome.storage.local.get({ videoFetchLogs: [] }, (res) => {
      let logs = Array.isArray(res.videoFetchLogs) ? res.videoFetchLogs : [];
      logs.push(entry);

      console.log(entry)
      if (logs.length > 200) logs = logs.slice(-200);
      chrome.storage.local.set({ videoFetchLogs: logs });
});

// Descargar desde el contexto de la página heredando Referer/cookies del sitio
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  try {
    if (!msg || msg.type !== 'pageDownloadLink' || !msg.url) return;
    const href = msg.url;
    const name = msg.filename || '';
    const a = document.createElement('a');
    a.href = href;
    if (name) a.download = name;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { try { a.remove(); } catch (_) {} }, 0);
    sendResponse && sendResponse({ ok: true });
  } catch (_) {}
});

    // No gestionamos la colección de videos en este modo
  } catch (_) {
    // No impedir el funcionamiento de la página en caso de error
  }
});
