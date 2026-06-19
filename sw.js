// ============================================================
// GasField LogBook — Service Worker
// VERSION নাম্বার বদলালে পুরনো সব ক্যাশ স্বয়ংক্রিয়ভাবে মুছে যাবে
// নতুন কোড ডিপ্লয় করার সময় এই নাম্বার +1 বাড়িয়ে দিন
// ============================================================
const SW_VERSION = 'v4';
const CACHE_NAME = `gasfield-logbook-${SW_VERSION}`;

// app.js ও sw.js নিজে কখনো cache-first এ পরিবেশন করা হবে না — সবসময় network-first
const NETWORK_FIRST = ['index.html', 'style.css', 'app.js', '/', ''];

const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap'
];

// ============================================================
// INSTALL: নতুন ক্যাশ তৈরি করা
// ============================================================
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS).catch(() => {}))
  );
  self.skipWaiting(); // নতুন ভার্সন সাথে সাথে অ্যাক্টিভ হবে
});

// ============================================================
// ACTIVATE: পুরনো সব ভার্সনের ক্যাশ মুছে ফেলা (force update এর মূল অংশ)
// ============================================================
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== CACHE_NAME) // বর্তমান ভার্সন ছাড়া সব পুরনো cache মুছে দেওয়া
          .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim()) // সব খোলা ট্যাবে নতুন SW সাথে সাথে কন্ট্রোল নিবে
     .then(() => notifyClientsOfUpdate())
  );
});

function notifyClientsOfUpdate() {
  return self.clients.matchAll({ type: 'window' }).then(clients => {
    clients.forEach(client => client.postMessage({ type: 'SW_UPDATED', version: SW_VERSION }));
  });
}

// ============================================================
// FETCH
// ============================================================
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;

  const url = e.request.url;
  const isSameOrigin = url.startsWith(self.location.origin);
  const path = isSameOrigin ? url.replace(self.location.origin, '').replace(/^\//, '') : url;

  // ১. Supabase API/Auth/Realtime — কখনো cache না, সবসময় সরাসরি নেটওয়ার্ক
  if (url.includes('supabase.co')) {
    e.respondWith(fetch(e.request).catch(() => new Response(null, { status: 503 })));
    return;
  }

  // ২. sw.js নিজেকে কখনো cache করা হবে না (পুরনো SW আটকে থাকার বড় কারণ এটাই হয়)
  if (path.endsWith('sw.js')) {
    e.respondWith(fetch(e.request));
    return;
  }

  // ৩. মূল অ্যাপ ফাইল (HTML/CSS/JS) — Network-First: আগে নেটওয়ার্ক থেকে নতুন ভার্সন আনার চেষ্টা,
  //    ব্যর্থ হলে (অফলাইন) cache থেকে দেখানো
  const isNetworkFirst = NETWORK_FIRST.some(name => path === name || path.endsWith(name));
  if (isSameOrigin && isNetworkFirst) {
    e.respondWith(
      fetch(e.request, { cache: 'no-store' })
        .then(response => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
          }
          return response;
        })
        .catch(() => caches.match(e.request).then(c => c || caches.match('./index.html')))
    );
    return;
  }

  // ৪. বাকি সবকিছু (ফন্ট, আইকন ইত্যাদি) — Cache-First (এগুলো খুব কম পরিবর্তন হয়)
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(response => {
        if (!response || response.status !== 200 || response.type === 'opaque') return response;
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
        return response;
      }).catch(() => caches.match('./index.html'));
    })
  );
});

// ============================================================
// MESSAGE: পেজ থেকে চাইলে ম্যানুয়ালি স্কিপ-ওয়েটিং ট্রিগার করা যাবে
// ============================================================
self.addEventListener('message', (e) => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});
