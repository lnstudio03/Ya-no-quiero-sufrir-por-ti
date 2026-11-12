self.addEventListener("push", event => {
  let payload = {};
  if (event.data) {
    try {
      payload = event.data.json();
    } catch (error) {
      console.error("No se pudo leer el contenido de la notificación:", error);
    }
  }
  const title = payload.title || "Nuevo formulario";
  const options = {
    body: payload.body || "Hay novedades para compartir.",
    icon: "./logo-cuadrado.png",
    badge: "./favicon.png",
    data: { url: payload.url || "./" }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const destination = new URL(event.notification.data?.url || "./", self.location.origin);
  if (destination.origin !== self.location.origin) return;
  event.waitUntil(clients.openWindow(destination.href));
});
