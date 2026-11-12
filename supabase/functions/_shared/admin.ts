import { createClient, type SupabaseClient, type User } from "https://esm.sh/@supabase/supabase-js@2";

type AuthorizationResult =
  | { user: User; serviceClient: SupabaseClient }
  | { response: Response };

export function corsHeaders(request: Request): Record<string, string> {
  const siteUrl = Deno.env.get("SITE_URL");
  const requestOrigin = request.headers.get("origin");
  let allowedOrigin = "";
  if (siteUrl && requestOrigin) {
    try {
      if (new URL(siteUrl).origin === requestOrigin) allowedOrigin = requestOrigin;
    } catch (error) {
      console.error("SITE_URL no es una URL válida:", error);
    }
  }
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin"
  };
}

export function jsonResponse(
  request: Request,
  status: number,
  payload: Record<string, unknown>
): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders(request), "Content-Type": "application/json" }
  });
}

export async function authorizeAdmin(
  request: Request,
  requirePrimaryAdmin = false
): Promise<AuthorizationResult> {
  const authorization = request.headers.get("authorization");
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) {
    return { response: jsonResponse(request, 401, { error: "Se requiere una sesión." }) };
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    console.error("Faltan secretos de Supabase para verificar administradores.");
    return { response: jsonResponse(request, 500, { error: "La función no está configurada." }) };
  }

  const authClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } }
  });
  const { data: userData, error: userError } = await authClient.auth.getUser(token);
  if (userError || !userData.user) {
    return { response: jsonResponse(request, 401, { error: "La sesión no es válida." }) };
  }

  const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const { data: role, error: roleError } = await serviceClient
    .from("administradores")
    .select("usuario_id, es_propietario")
    .eq("usuario_id", userData.user.id)
    .maybeSingle();
  if (roleError) {
    console.error("No se pudo verificar el rol de administrador:", roleError.message);
    return { response: jsonResponse(request, 500, { error: "No se pudo verificar el acceso." }) };
  }
  if (!role) {
    return { response: jsonResponse(request, 403, { error: "Se requiere una cuenta administradora." }) };
  }
  if (requirePrimaryAdmin && role.es_propietario !== true) {
    return { response: jsonResponse(request, 403, { error: "Solo la cuenta principal puede administrar el equipo." }) };
  }
  return { user: userData.user, serviceClient };
}
