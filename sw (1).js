// Pulso Service Worker — notificações e polling de agenda
const scheduled = new Map();
let pollInterval = null;
let gcalToken = null;

self.addEventListener('install', e => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(clients.claim()));

// Mensagens do app
self.addEventListener('message', e => {
  const { type } = e.data || {};

  // Agendar lembrete de evento
  if (type === 'SCHEDULE') {
    const { id, title, fireAt, reminderMinutes } = e.data;
    const delta = fireAt - Date.now();
    if (delta <= 0) return;
    if (scheduled.has(id)) clearTimeout(scheduled.get(id));
    const label = reminderMinutes < 60
      ? `${reminderMinutes} minutos`
      : `${reminderMinutes / 60} hora${reminderMinutes > 60 ? 's' : ''}`;
    const timer = setTimeout(() => {
      self.registration.showNotification('Pulso — lembrete', {
        body: `${title} em ${label}`,
        icon: '/icon-192.png',
        vibrate: [200, 100, 200],
        data: { title, fireAt }
      });
      scheduled.delete(id);
    }, delta);
    scheduled.set(id, timer);
  }

  // Cancelar lembrete
  if (type === 'CANCEL') {
    if (scheduled.has(e.data.id)) {
      clearTimeout(scheduled.get(e.data.id));
      scheduled.delete(e.data.id);
    }
  }

  // Iniciar polling de agenda
  if (type === 'START_POLL') {
    gcalToken = e.data.token;
    if (pollInterval) clearInterval(pollInterval);
    // Roda imediatamente e depois a cada 15 minutos
    pollGoogleCalendar();
    pollInterval = setInterval(pollGoogleCalendar, 15 * 60 * 1000);
  }

  // Parar polling
  if (type === 'STOP_POLL') {
    if (pollInterval) { clearInterval(pollInterval); pollInterval = null; }
    gcalToken = null;
  }

  // Token atualizado
  if (type === 'UPDATE_TOKEN') {
    gcalToken = e.data.token;
  }
});

// Polling do Google Calendar
async function pollGoogleCalendar() {
  if (!gcalToken) return;
  try {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const end = new Date(now.getFullYear(), now.getMonth() + 2, 0).toISOString();

    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${start}&timeMax=${end}&singleEvents=true&orderBy=startTime&maxResults=100`,
      { headers: { Authorization: `Bearer ${gcalToken}` } }
    );

    if (res.status === 401) {
      // Token expirado — avisa o app
      const allClients = await clients.matchAll({ includeUncontrolled: true });
      allClients.forEach(c => c.postMessage({ type: 'TOKEN_EXPIRED' }));
      if (pollInterval) { clearInterval(pollInterval); pollInterval = null; }
      return;
    }

    const data = await res.json();
    const incoming = (data.items || []).filter(e => e.start).map(e => e.id);

    // Compara com IDs conhecidos via cache simples
    const cache = await caches.open('pulso-gcal-ids');
    const cached = await cache.match('known-ids');
    const knownIds = cached ? await cached.json() : [];

    const newIds = incoming.filter(id => !knownIds.includes(id));

    if (newIds.length > 0) {
      // Busca títulos dos novos eventos
      const newEvents = (data.items || []).filter(e => newIds.includes(e.id));
      for (const ev of newEvents) {
        await self.registration.showNotification('Pulso — novo compromisso', {
          body: ev.summary || 'Novo evento na agenda',
          icon: '/icon-192.png',
          badge: '/icon-192.png',
          vibrate: [300, 100, 300],
          tag: ev.id,
          data: { gcalId: ev.id }
        });
      }
      // Atualiza cache de IDs conhecidos
      const updatedIds = [...knownIds, ...newIds];
      await cache.put('known-ids', new Response(JSON.stringify(updatedIds)));

      // Avisa o app pra atualizar os eventos
      const allClients = await clients.matchAll({ includeUncontrolled: true });
      allClients.forEach(c => c.postMessage({ type: 'NEW_EVENTS', count: newIds.length }));
    }
  } catch (err) {
    console.error('[Pulso SW] Erro no polling:', err);
  }
}

// Clique na notificação — abre o app
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      if (list.length > 0) return list[0].focus();
      return clients.openWindow('/');
    })
  );
});
