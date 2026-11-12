import { authorizeAdmin, corsHeaders, jsonResponse } from "../_shared/admin.ts";

Deno.serve(async request => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders(request) });
  }
  if (request.method !== "POST") {
    return jsonResponse(request, 405, { error: "Método no permitido." });
  }

  const authorization = await authorizeAdmin(request, true);
  if ("response" in authorization) return authorization.response;

  let payload: { userId?: unknown };
  try {
    payload = await request.json();
  } catch (error) {
    console.error("La solicitud de cambio de equipo no contiene JSON válido:", error);
    return jsonResponse(request, 400, { error: "La solicitud no es válida." });
  }
  if (typeof payload.userId !== "string"
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(payload.userId)) {
    return jsonResponse(request, 400, { error: "Selecciona un administrador válido." });
  }
  if (payload.userId === authorization.user.id) {
    return jsonResponse(request, 400, { error: "No puedes retirar tu propio acceso." });
  }

  const { data: result, error: removeError } = await authorization.serviceClient
    .rpc("remover_admin", {
      p_usuario: payload.userId,
      p_actor: authorization.user.id
    });
  if (removeError) {
    console.error("No se pudo retirar el rol de administrador:", removeError.message);
    return jsonResponse(request, 500, { error: "No se pudo actualizar el equipo." });
  }
  if (result === "self" || result === "last_admin" || result === "owner") {
    return jsonResponse(request, 400, { error: "No puedes retirar tu propio acceso ni el de la cuenta principal." });
  }
  if (result === "not_found") {
    return jsonResponse(request, 404, { error: "Esa cuenta ya no forma parte del equipo." });
  }
  if (result !== "removed") {
    return jsonResponse(request, 403, { error: "No tienes permiso para cambiar el equipo." });
  }
  return jsonResponse(request, 200, { message: "Acceso de administración retirado." });
});
