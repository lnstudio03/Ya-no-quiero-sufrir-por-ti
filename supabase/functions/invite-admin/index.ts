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

  let payload: { email?: unknown };
  try {
    payload = await request.json();
  } catch (error) {
    console.error("La invitación no contiene JSON válido:", error);
    return jsonResponse(request, 400, { error: "La solicitud no es válida." });
  }
  if (typeof payload.email !== "string" || payload.email.length > 254) {
    return jsonResponse(request, 400, { error: "Escribe un correo electrónico válido." });
  }
  const email = payload.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return jsonResponse(request, 400, { error: "Escribe un correo electrónico válido." });
  }

  const { data: existingAdmin, error: existingAdminError } = await authorization.serviceClient
    .from("administradores")
    .select("usuario_id")
    .eq("email", email)
    .maybeSingle();
  if (existingAdminError) {
    console.error("No se pudo verificar si el correo ya pertenece al equipo:", existingAdminError.message);
    return jsonResponse(request, 500, { error: "No se pudo comprobar el equipo." });
  }
  if (existingAdmin) {
    return jsonResponse(request, 409, { error: "Ese correo ya tiene acceso al equipo." });
  }

  const configuredSiteUrl = Deno.env.get("SITE_URL");
  if (!configuredSiteUrl) {
    console.error("Falta el secreto SITE_URL para enviar invitaciones.");
    return jsonResponse(request, 500, { error: "La función no está configurada." });
  }
  let redirectTo: string;
  try {
    const siteUrl = new URL(configuredSiteUrl);
    if (siteUrl.protocol !== "https:") throw new Error("SITE_URL debe usar HTTPS.");
    siteUrl.searchParams.set("mode", "setup");
    redirectTo = siteUrl.href;
  } catch (error) {
    console.error("SITE_URL no es una URL válida:", error);
    return jsonResponse(request, 500, { error: "La función no está configurada." });
  }

  let userId: string | null = null;
  let createdByInvite = false;
  let existingAccount = false;
  const { data: invitation, error: inviteError } = await authorization.serviceClient.auth.admin.inviteUserByEmail(email, {
    redirectTo
  });
  if (!inviteError && invitation.user) {
    userId = invitation.user.id;
    createdByInvite = true;
  } else {
    const perPage = 1000;
    for (let page = 1; page <= 100; page += 1) {
      const { data: users, error: usersError } = await authorization.serviceClient.auth.admin.listUsers({
        page,
        perPage
      });
      if (usersError) {
        console.error("No se pudo verificar si el correo ya tiene una cuenta:", usersError.message);
        return jsonResponse(request, 500, { error: "No se pudo comprobar el correo." });
      }
      const existingUser = users.users.find(user => user.email?.toLowerCase() === email);
      if (existingUser) {
        userId = existingUser.id;
        existingAccount = true;
        break;
      }
      if (users.users.length < perPage) break;
    }
    if (!userId) {
      console.error("No se pudo enviar la invitación:", inviteError?.message || "Supabase no devolvió el usuario.");
      return jsonResponse(request, 400, { error: "No se pudo invitar ese correo. Comprueba el SMTP y que la dirección sea válida." });
    }
  }

  if (!userId) {
    console.error("Supabase no devolvió un identificador de usuario para la invitación.");
    return jsonResponse(request, 500, { error: "No se pudo completar la invitación." });
  }
  const invitedUserId = userId;
  const { error: roleError } = await authorization.serviceClient
    .from("administradores")
    .insert({
      usuario_id: invitedUserId,
      email,
      invitado_por: authorization.user.id
    });
  if (roleError) {
    console.error("No se pudo asignar el rol de administrador:", roleError.message);
    if (createdByInvite) {
      const { error: cleanupError } = await authorization.serviceClient.auth.admin.deleteUser(invitedUserId);
      if (cleanupError) {
        console.error("No se pudo retirar la cuenta incompleta:", cleanupError.message);
      }
    }
    return jsonResponse(request, 500, { error: "No se pudo completar la invitación. Vuelve a intentarlo." });
  }

  if (existingAccount) {
    const { error: recoveryError } = await authorization.serviceClient.auth.resetPasswordForEmail(email, {
      redirectTo
    });
    if (recoveryError) {
      console.error("No se pudo enviar el enlace para crear la contraseña:", recoveryError.message);
      const { error: roleCleanupError } = await authorization.serviceClient
        .from("administradores")
        .delete()
        .eq("usuario_id", invitedUserId);
      if (roleCleanupError) {
        console.error("No se pudo retirar el acceso incompleto:", roleCleanupError.message);
      }
      return jsonResponse(request, 400, { error: "No se pudo enviar el enlace. Comprueba el SMTP y vuelve a intentarlo." });
    }
  }

  const { error: requestError } = await authorization.serviceClient
    .from("solicitudes_admin")
    .update({ estado: "invitado" })
    .eq("email", email);
  if (requestError) {
    console.error("La invitación se envió pero no se pudo cerrar su solicitud:", requestError.message);
    return jsonResponse(request, 200, {
      message: "Acceso aprobado y enlace enviado. La solicitud sigue apareciendo; actualiza la lista.",
      requestUpdated: false
    });
  }
  return jsonResponse(request, 200, { message: "Acceso aprobado; se envió el enlace para crear la contraseña." });
});
