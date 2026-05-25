// Pulso Service Worker — gerencia notificações em segundo plano
const CACHE = 'pulso-v1';
const scheduled = new Map();

self.addEventListener('install', e => {
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(clients.claim());
});

// Recebe mensagem do app para agendar notificação
self.addEventListener('message', e => {
  if (e.data?.type === 'SCHEDULE') {
    const { id, title, fireAt, reminderMinutes } = e.data;
    const delta = fireAt - Date.now();
    if (delta <= 0) return;

    // Cancela agendamento anterior se existir
    if (scheduled.has(id)) clearTimeout(scheduled.get(id));

    const label = reminderMinutes < 60
      ? `${reminderMinutes} minutos`
      : `${reminderMinutes / 60} hora${reminderMinutes > 60 ? 's' : ''}`;

    const timer = setTimeout(() => {
      self.registration.showNotification('Pulso — lembrete', {
        body: `${title} em ${label}`,
        icon: '/icon-192.png',
        badge: '/icon-192.png',
        vibrate: [200, 100, 200],
        data: { title, fireAt }
      });
      scheduled.delete(id);
    }, delta);

    scheduled.set(id, timer);
  }

  if (e.data?.type === 'CANCEL') {
    const { id } = e.data;
    if (scheduled.has(id)) {
      clearTimeout(scheduled.get(id));
      scheduled.delete(id);
    }
  }
});

// Ao clicar na notificação, abre o app
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      if (list.length > 0) return list[0].focus();
      return clients.openWindow('/');
    })
  );
});
