/* رتل: Service Worker — تخزين مؤقت للعمل بدون إنترنت + استقبال إشعارات التذكير */
const V = 'rattil-v9';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(V);
    await Promise.allSettled(SHELL.map(u => c.add(u)));   // لو ملف ناقص ما يوقفش التثبيت
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== V) await caches.delete(k);
    await self.clients.claim();
  })());
});

// بيرجّع النسخة المخزنة فورًا ويحدّثها في الخلفية
async function swr(e) {
  const c = await caches.open(V), hit = await c.match(e.request);
  const net = fetch(e.request).then(r => { if (r && (r.ok || r.type === 'opaque')) c.put(e.request, r.clone()); return r; }).catch(() => null);
  if (hit) { e.waitUntil(net); return hit; }
  return (await net) || new Response('', { status: 504, statusText: 'offline' });
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const u = new URL(req.url);
  if (req.mode === 'navigate') {                      // الصفحة نفسها: الشبكة أولًا عشان التحديثات توصل
    e.respondWith((async () => {
      const c = await caches.open(V);
      try { const r = await fetch(req); if (r.ok) c.put(req, r.clone()); return r; }
      catch (_) { return (await c.match(req)) || (await c.match('./index.html')) || (await c.match('./')) || Response.error(); }
    })());
    return;
  }
  const same = u.origin === self.location.origin;
  const ext = ['api.alquran.cloud', 'fonts.googleapis.com', 'fonts.gstatic.com'].includes(u.hostname) ||
              (u.hostname === 'www.gstatic.com' && u.pathname.startsWith('/firebasejs/'));
  if (same || ext) e.respondWith(swr(e));              // الصوت (everyayah) وFirebase API مش بنتدخل فيهم
});

// استقبال الإشعار من FCM (رسالة data) وعرضه
self.addEventListener('push', e => {
  let p = {}; try { p = e.data ? e.data.json() : {}; } catch (_) {}
  const d = p.data || p.notification || p;
  e.waitUntil(self.registration.showNotification(d.title || 'رتل', {
    body: d.body || 'حان وقت الحفظ',
    icon: 'icon-192.png', badge: 'icon-192.png', dir: 'rtl', lang: 'ar',
    tag: 'rattil-daily', data: { url: d.url || './' }
  }));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || './', self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cs => {
    for (const c of cs) if (c.url.startsWith(self.registration.scope) && 'focus' in c) return c.focus();
    return self.clients.openWindow(url);
  }));
});
