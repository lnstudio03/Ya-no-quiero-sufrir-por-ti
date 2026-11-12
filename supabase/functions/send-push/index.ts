import webpush from "npm:web-push@3.6.7";
import { authorizeAdmin, corsHeaders, jsonResponse } from "../_shared/admin.ts";

Deno.serve(async request => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders(request) });
  }
  if (request.method !== "POST") {
    return jsonResponse(request, 405, { error: "Método no permitido." });
  }

  const authorization = await authorizeAdmin(request);
  if ("response" in authorization) return authorization.response;

  let payload: { title?: unknown; body?: unknown; url?: unknown };
  try {
    payload = await request.json();
  } catch (error) {
    console.error("La notificación no contiene JSON válido:", error);
    return jsonResponse(request, 400, { error: "La solicitud no es válida." });
  }
  if (typeof payload.title !== "string" || payload.title.length > 100
    || typeof payload.body !== "string" || payload.body.length > 240) {
    return jsonResponse(request, 400, { error: "El contenido de la notificación no es válido." });
  }

  const siteUrl = Deno.env.get("SITE_URL");
  const vapidPublicKey = Deno.env.get("PUSH_VAPID_PUBLIC_KEY");
  const vapidPrivateKey = Deno.env.get("PUSH_VAPID_PRIVATE_KEY");
  const vapidSubject = Deno.env.get("VAPID_SUBJECT");
  if (!siteUrl || !vapidPublicKey || !vapidPrivateKey || !vapidSubject) {
    console.error("Faltan secretos para enviar notificaciones push.");
    return jsonResponse(request, 500, { error: "Las notificaciones push no están configuradas." });
  }

  let destination: URL;
  try {
    destination = new URL(typeof payload.url === "string" ? payload.url : siteUrl);
    if (destination.origin !== new URL(siteUrl).origin) {
      return jsonResponse(request, 400, { error: "El destino de la notificación no es válido." });
    }
  } catch (error) {
    console.error("No se pudo validar el destino de la notificación:", error);
    return jsonResponse(request, 400, { error: "El destino de la notificación no es válido." });
  }

  const { data: subscriptions, error: subscriptionsError } = await authorization.serviceClient
    .from("push_subscriptions")
    .select("endpoint, p256dh, auth");
  if (subscriptionsError) {
    console.error("No se pudieron cargar las suscripciones push:", subscriptionsError.message);
    return jsonResponse(request, 500, { error: "No se pudieron cargar los destinatarios." });
  }
  if (!subscriptions.length) return jsonResponse(request, 200, { sent: 0 });

  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
  const results = await Promise.allSettled(subscriptions.map(subscription =>
    webpush.sendNotification({
      endpoint: subscription.endpoint,
      keys: { p256dh: subscription.p256dh, auth: subscription.auth }
    }, JSON.stringify({
      title: payload.title,
      body: payload.body,
      url: destination.href
    }))
  ));
  const expiredEndpoints = [];
  let sent = 0;
  let failed = 0;
  for (let index = 0; index < results.length; index += 1) {
    const result = results[index];
    if (result.status === "fulfilled") {
      sent += 1;
    } else if (result.reason?.statusCode === 404 || result.reason?.statusCode === 410) {
      expiredEndpoints.push(subscriptions[index].endpoint);
    } else {
      failed += 1;
      console.error("Falló la entrega de una notificación push:", result.reason);
    }
  }
  if (expiredEndpoints.length) {
    const { error: deleteError } = await authorization.serviceClient
      .from("push_subscriptions")
      .delete()
      .in("endpoint", expiredEndpoints);
    if (deleteError) console.error("No se pudieron retirar suscripciones push vencidas:", deleteError.message);
  }
  if (failed) {
    return jsonResponse(request, 502, { error: "Algunas notificaciones no se pudieron entregar.", sent, failed });
  }
  return jsonResponse(request, 200, { sent, expired: expiredEndpoints.length });
});
