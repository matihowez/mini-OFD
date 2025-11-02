(() => {
  try {
    if (window.__fetch_video_logger_installed__) return;
    window.__fetch_video_logger_installed__ = true;

    const originalFetch = window.fetch;
    if (typeof originalFetch !== 'function') return;

    const shouldLog = (input) => {
      try {
        const url = typeof input === 'string' ? input : (input && input.url) || '';
        const u = String(url).toLowerCase();
        return u.includes('/posts/videos') || u.includes('/posts/photos') || u.includes('video') || u.includes('photo');
      } catch (_) {
        return false;
      }
    };

    const notify = (payload) => {
      try {
        window.postMessage({ source: 'fetch-video-detector', payload }, '*');
      } catch (_) {}
    };

    const unique = (arr) => Array.from(new Set(arr.filter(Boolean)));

    const getDeep = (obj, path) => {
      try {
        return path.reduce((acc, k) => (acc && acc[k] !== undefined ? acc[k] : undefined), obj);
      } catch { return undefined; }
    };

    const collectVideoUrls = (data) => {
      const urls = [];
      try {
        const list = data && data.list;
        if (Array.isArray(list)) {
          for (const item of list) {
            const media = item && item.media;
            if (!media) continue;
            const files = media.files;
            if (!files) continue;
            if (Array.isArray(files)) {
              for (const f of files) {
                const full = f && f.full;
                const url = full && full.url;
                if (typeof url === 'string') urls.push(url);
              }
            } else if (typeof files === 'object') {
              const full = files.full;
              const url = full && full.url;
              if (typeof url === 'string') urls.push(url);
            }
          }
        }
      } catch (_) {}
      return unique(urls);
    };

    const truncate = (str, max = 2000) => {
      try {
        if (typeof str !== 'string') str = String(str);
        return str.length > max ? str.slice(0, max) + '…' : str;
      } catch (_) {
        return '[unavailable]';
      }
    };

    window.fetch = async function patchedFetch(input, init) {
      const match = shouldLog(input);
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      const method = (init && init.method) || (typeof input === 'object' && input && input.method) || 'GET';

      const response = await originalFetch.apply(this, arguments);

      if (match) {
        try {
          const clone = response.clone();
          const ct = (clone.headers && clone.headers.get('content-type')) || '';
          const base = {
            url,
            method,
            status: clone.status,
            ok: clone.ok,
            contentType: ct,
            timestamp: Date.now()
          };

          clone.json().then((data) => {
            let preview;
            let jsonStr;
            let bodyJson = undefined;
            let bodyJsonTruncated = false;
            try {
              jsonStr = JSON.stringify(data);
              preview = truncate(jsonStr);
              const MAX_JSON_LEN = 300000; // ~300 KB para no exceder storage
              if (jsonStr.length <= MAX_JSON_LEN) {
                bodyJson = data; // enviar objeto completo
              } else {
                bodyJsonTruncated = true;
              }
            } catch (_) {
              preview = '[JSON no serializable]';
            }
            console.log('[Fetch video match]', url, data);
            notify({ ...base, bodyPreview: preview, format: 'json', bodyJson, bodyJsonSize: jsonStr ? jsonStr.length : undefined, bodyJsonTruncated });
          }).catch(() => {
            if (ct && ct.startsWith('text/')) {
              clone.text().then((text) => {
                console.log('[Fetch video match]', url, text);
                notify({ ...base, bodyPreview: truncate(text), format: 'text' });
              }).catch(() => {
                notify({ ...base, bodyPreview: '[sin cuerpo]', format: 'other' });
              });
            } else {
              console.log('[Fetch video match]', url, 'CT:', ct);
              notify({ ...base, bodyPreview: `[${ct || 'desconocido'}] sin vista previa`, format: 'other' });
            }
          });
        } catch (err) {
          console.log('[Fetch video match]', url, 'Error leyendo respuesta:', err);
          notify({ url, method, status: response.status, ok: response.ok, contentType: '[error]', timestamp: Date.now(), bodyPreview: 'Error leyendo respuesta', format: 'error' });
        }
      }

      return response;
    };

    // Interceptar XMLHttpRequest para capturar /posts/videos también
    if (typeof XMLHttpRequest === 'function') {
      const XHROpen = XMLHttpRequest.prototype.open;
      const XHRSend = XMLHttpRequest.prototype.send;

      XMLHttpRequest.prototype.open = function(method, url) {
        try {
          this.__fv_method = method || 'GET';
          this.__fv_url = url || '';
        } catch (_) {}
        return XHROpen.apply(this, arguments);
      };

      XMLHttpRequest.prototype.send = function(body) {
        try {
          const url = this.__fv_url || '';
          const method = this.__fv_method || 'GET';
          const low = String(url).toLowerCase();
          const match = low.includes('/posts/videos') || low.includes('/posts/photos');
          if (match) {
            const onReady = () => {
              if (this.readyState === 4) {
                try {
                  const base = {
                    url,
                    method,
                    status: this.status,
                    ok: this.status >= 200 && this.status < 300,
                    contentType: this.getResponseHeader && this.getResponseHeader('content-type'),
                    timestamp: Date.now(),
                    from: 'xhr'
                  };
                  if (this.responseType === '' || this.responseType === 'text') {
                    console.log('[XHR posts]', url, this.responseText);
                    notify({ ...base, bodyPreview: truncate(this.responseText || ''), format: 'text' });
                  } else if (this.responseType === 'json') {
                    let preview;
                    let videos = [];
                    try { 
                      preview = truncate(JSON.stringify(this.response));
                      videos = collectVideoUrls(this.response);
                    }
                    catch { preview = '[JSON no serializable]'; }
                    console.log('[XHR posts]', url, this.response);
                    notify({ ...base, bodyPreview: preview, format: 'json', videos });
                  } else {
                    console.log('[XHR posts]', url, 'responseType:', this.responseType);
                    notify({ ...base, bodyPreview: `[${this.responseType}] sin vista previa`, format: 'other' });
                  }
                } catch (e) {
                  notify({ url, method, status: this.status, ok: false, contentType: '[error]', timestamp: Date.now(), bodyPreview: 'Error leyendo respuesta XHR', format: 'error' });
                }
                this.removeEventListener('readystatechange', onReady);
              }
            };
            this.addEventListener('readystatechange', onReady);
          }
        } catch (_) {}
        return XHRSend.apply(this, arguments);
      };
    }
  } catch (_) {
    // No interferir con la página ante errores
  }
})();
