// Configura los datos públicos del proyecto y la clave pública VAPID.
const SUPABASE_URL = "https://txpqszjmlvapeajwenjr.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_KgAXWoUMGvpubi-XreeNDA_1yT1-jfv";
const PUSH_VAPID_PUBLIC_KEY = "";

const QUESTION_TYPES = {
  texto: "Texto",
  seleccion: "Selección",
  checkbox: "Checkbox"
};
const configured = !SUPABASE_URL.includes("TU-PROYECTO") && !SUPABASE_ANON_KEY.includes("TU_SUPABASE");
const db = configured && window.supabase ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;
const initialHashParams = new URLSearchParams(window.location.hash.slice(1));
const initialQueryParams = new URLSearchParams(window.location.search);
let passwordFlowMode = ["setup", "reset"].find(mode =>
  initialQueryParams.get("mode") === mode || (mode === "setup" && initialHashParams.get("type") === "invite")
) || null;

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const publicView = $("#public-view");
const adminView = $("#admin-view");
const publicNav = $("#public-nav");
const adminNav = $("#admin-nav");
const loginBox = $("#admin-login");
const adminPanel = $("#admin-panel");
const editorView = $("#editor-view");
const questionEditor = $("#question-editor");
let adminForms = [];
let selectedForm = null;
let selectedQuestions = [];
let originalQuestionIds = [];
let loadedResponses = [];
let adminMembers = [];
let toastTimer;
let currentAdminId = null;
let isPrimaryAdmin = false;
let adminRealtimeChannel = null;
let adminAccessRequests = [];

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("visible");
  $("#live-announcement").textContent = message;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("visible"), 3600);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
}

function formatDate(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("es", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function isInSchedule(form) {
  const now = Date.now();
  return (!form.fecha_inicio || new Date(form.fecha_inicio).getTime() <= now)
    && (!form.fecha_fin || new Date(form.fecha_fin).getTime() >= now);
}

function switchView(view) {
  const showPublic = view === "public";
  publicView.classList.toggle("hidden", !showPublic);
  adminView.classList.toggle("hidden", showPublic);
  publicNav.classList.toggle("active", showPublic);
  adminNav.classList.toggle("active", !showPublic);
  if (!showPublic && db) syncAuthState();
  if (!showPublic && !db) $("#login-message").textContent = "Configura primero las credenciales de Supabase en app.js.";
}

async function loadPublicForms() {
  const target = $("#public-forms");
  if (!db) {
    target.innerHTML = '<div class="empty-state"><span class="empty-icon">✦</span><p>Pronto encontrarás aquí los formularios disponibles para responder.</p></div>';
    return;
  }
  const { data: forms, error } = await db.from("formularios").select("*").eq("activo", true).order("creado_en", { ascending: false });
  if (error) {
    target.innerHTML = '<div class="empty-state"><p>No pudimos cargar los formularios. Revisa la conexión y las políticas de Supabase.</p></div>';
    console.error("Error cargando formularios públicos:", error.message);
    return;
  }
  const available = forms.filter(isInSchedule);
  if (!available.length) {
    target.innerHTML = '<div class="empty-state"><span class="empty-icon">☾</span><p>Por ahora no hay formularios abiertos.<br>Vuelve pronto, este espacio te espera.</p></div>';
    return;
  }
  const { data: allQuestions, error: questionsError } = await db.from("preguntas").select("*").in("formulario_id", available.map(form => form.id)).order("orden");
  if (questionsError) {
    target.innerHTML = '<div class="empty-state"><p>No pudimos cargar las preguntas. Revisa las políticas de lectura en Supabase.</p></div>';
    console.error("Error cargando preguntas:", questionsError.message);
    return;
  }
  target.innerHTML = available.map((form, index) => {
    const questions = allQuestions.filter(question => question.formulario_id === form.id);
    return `<article class="public-card">
      <div class="card-top"><span class="card-number">${String(index + 1).padStart(2, "0")} <span aria-hidden="true">✦</span></span><span class="card-tag">Tu espacio para participar</span></div>
      <h3>${escapeHtml(form.titulo)}</h3>
      ${form.descripcion ? `<p class="card-description">${escapeHtml(form.descripcion)}</p>` : ""}
      <form class="response-form" data-form-id="${escapeHtml(form.id)}">
        ${questions.map(renderPublicQuestion).join("")}
        <button class="button button-primary submit-response" type="submit">Enviar respuesta <span>→</span></button>
      </form>
    </article>`;
  }).join("");
}

function renderPublicQuestion(question) {
  const required = question.obligatoria ? "required" : "";
  const name = `question-${escapeHtml(question.id)}`;
  const label = `${escapeHtml(question.texto_pregunta)}${question.obligatoria ? '<span class="required-mark">*</span>' : ""}`;
  if (question.tipo === "texto" || question.tipo === "texto_largo" || question.tipo === "texto_corto") {
    return `<div class="public-question"><label for="${name}">${label}</label><textarea class="input-control text-answer" id="${name}" name="${name}" rows="4" ${required} placeholder="Escribe tu respuesta..."></textarea></div>`;
  }
  if (question.tipo === "seleccion" || question.tipo === "checkbox") {
    const options = Array.isArray(question.opciones) ? question.opciones : [];
    const inputType = question.tipo === "seleccion" ? "radio" : "checkbox";
    return `<fieldset class="public-question" data-required="${question.obligatoria}"><legend>${label}</legend><div class="choice-list">${options.map((option, index) =>
      `<label class="choice-item"><input type="${inputType}" name="${name}" value="${escapeHtml(option)}" ${required && question.tipo === "seleccion" && index === 0 ? "required" : ""}><span>${escapeHtml(option)}</span></label>`
    ).join("")}</div></fieldset>`;
  }
  return `<div class="public-question"><label for="${name}">${label}</label><input class="input-control" id="${name}" name="${name}" type="text" ${required} placeholder="Escribe tu respuesta..."></div>`;
}

async function submitResponse(event) {
  const formElement = event.target.closest(".response-form");
  if (!formElement) return;
  event.preventDefault();
  const button = $("button[type=submit]", formElement);
  button.disabled = true;
  const values = {};
  let missingRequiredCheckbox = false;
  $$(".public-question", formElement).forEach(block => {
    const controls = $$("input, textarea", block);
    if (!controls.length) return;
    const id = controls[0].name.replace(/^question-/, "");
    const type = controls[0].type;
    if (type === "checkbox" && block.dataset.required === "true" && !controls.some(input => input.checked)) {
      missingRequiredCheckbox = true;
    }
    values[id] = type === "checkbox"
      ? controls.filter(input => input.checked).map(input => input.value)
      : type === "radio"
        ? (controls.find(input => input.checked)?.value ?? "")
        : controls[0].value.trim();
  });
  if (missingRequiredCheckbox) {
    showToast("Elige al menos una opción en las preguntas obligatorias.");
    button.disabled = false;
    return;
  }
  const { error } = await db.from("respuestas").insert({
    formulario_id: formElement.dataset.formId,
    datos_json: values
  });
  button.disabled = false;
  if (error) {
    showToast("No pudimos guardar tu respuesta. Inténtalo de nuevo en un momento.");
    console.error("Error guardando respuesta:", error.message);
    return;
  }
  formElement.reset();
  showToast("Respuesta enviada. Gracias por participar.");
}

function syncAuthState() {
  db.auth.getSession().then(async ({ data, error }) => {
    if (error) {
      showLogin();
      $("#login-message").textContent = "No se pudo verificar la sesión.";
      console.error("Error verificando sesión:", error.message);
      return;
    }
    if (!data.session) {
      currentAdminId = null;
      isPrimaryAdmin = false;
      stopAdminRealtime();
      if (passwordFlowMode) showPasswordSetup();
      else showLogin();
      return;
    }
    if (passwordFlowMode) {
      showPasswordSetup();
      return;
    }
    const { data: admin, error: roleError } = await db.from("administradores")
      .select("usuario_id, es_propietario")
      .eq("usuario_id", data.session.user.id)
      .maybeSingle();
    if (roleError) {
      showLogin();
      $("#login-message").textContent = "No se pudo verificar el acceso del equipo. Revisa la configuración de Supabase.";
      console.error("Error verificando rol de administración:", roleError.message);
      return;
    }
    if (!admin) {
      await db.auth.signOut();
      isPrimaryAdmin = false;
      showLogin();
      $("#login-message").textContent = "Esta cuenta no tiene acceso al panel de administración.";
      return;
    }
    currentAdminId = data.session.user.id;
    isPrimaryAdmin = admin.es_propietario === true;
    loginBox.classList.add("hidden");
    $("#admin-password-setup").classList.add("hidden");
    adminPanel.classList.remove("hidden");
    $("#admin-team-management").classList.toggle("hidden", !isPrimaryAdmin);
    startAdminRealtime();
    loadAdminForms();
    if (isPrimaryAdmin) {
      loadAdminTeam();
      loadAdminAccessRequests();
    }
  });
}

function showLogin() {
  $("#admin-password-setup").classList.add("hidden");
  loginBox.classList.remove("hidden");
  adminPanel.classList.add("hidden");
}

function showPasswordSetup() {
  loginBox.classList.add("hidden");
  adminPanel.classList.add("hidden");
  $("#admin-password-setup").classList.remove("hidden");
  $("#password-setup-heading").textContent = passwordFlowMode === "reset"
    ? "Elige una contraseña nueva"
    : "Crea tu contraseña";
}

async function login(event) {
  event.preventDefault();
  const form = event.currentTarget;
  if (!db) {
    $("#login-message").textContent = "Configura primero las credenciales de Supabase en app.js.";
    return;
  }
  const button = $('button[type="submit"]', form);
  const message = $("#login-message");
  button.disabled = true;
  message.textContent = "";
  const { error } = await db.auth.signInWithPassword({
    email: form.elements.email.value.trim(),
    password: form.elements.password.value
  });
  button.disabled = false;
  if (error) {
    message.textContent = "No se pudo iniciar sesión. Revisa el correo, la contraseña y que tu cuenta esté aprobada.";
    console.error("Error de inicio de sesión:", error.message);
    return;
  }
  form.reset();
  await syncAuthState();
}

async function resetAdminPassword() {
  const email = $("#login-form").elements.email.value.trim();
  const message = $("#login-message");
  if (!db) {
    message.textContent = "Configura primero las credenciales de Supabase en app.js.";
    return;
  }
  if (!email) {
    message.textContent = "Escribe tu correo para enviarte un enlace de recuperación.";
    $("#login-form").elements.email.focus();
    return;
  }
  const button = $("#reset-password-button");
  button.disabled = true;
  message.textContent = "";
  const redirectTo = new URL(window.location.pathname, window.location.origin);
  redirectTo.searchParams.set("mode", "reset");
  const { error } = await db.auth.resetPasswordForEmail(email, { redirectTo: redirectTo.href });
  button.disabled = false;
  if (error) {
    message.textContent = "No se pudo enviar el enlace de recuperación. Revisa el correo y vuelve a intentarlo.";
    console.error("Error solicitando cambio de contraseña:", error.message);
    return;
  }
  message.textContent = "Si el correo pertenece a una cuenta autorizada, recibirá un enlace para cambiar la contraseña.";
}

async function requestAdminAccess(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = $('button[type="submit"]', form);
  const message = $("#request-access-message");
  if (!db) {
    message.textContent = "El acceso todavía no está conectado a Supabase.";
    return;
  }
  button.disabled = true;
  message.textContent = "";
  const email = form.elements.email.value.trim().toLowerCase();
  const { error } = await db.from("solicitudes_admin").insert({ email });
  button.disabled = false;
  if (error) {
    message.textContent = error.code === "23505"
      ? "Ese correo ya tiene una solicitud. Si tu acceso se retiró, contacta a la cuenta principal."
      : "No se pudo registrar la solicitud. Comprueba el correo e inténtalo de nuevo.";
    console.error("Error solicitando acceso al equipo:", error.message);
    return;
  }
  form.reset();
  message.textContent = "Solicitud recibida. La cuenta principal revisará tu correo antes de autorizarte.";
}

async function saveNewPassword(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const message = $("#password-setup-message");
  const button = $('button[type="submit"]', form);
  const password = form.elements.password.value;
  if (password.length < 8) {
    message.textContent = "La contraseña debe tener al menos 8 caracteres.";
    return;
  }
  if (password !== form.elements["password-confirmation"].value) {
    message.textContent = "Las contraseñas no coinciden.";
    return;
  }
  button.disabled = true;
  message.textContent = "";
  const { data, error } = await db.auth.updateUser({ password });
  button.disabled = false;
  if (error || !data.user) {
    message.textContent = "El enlace venció o no es válido. Solicita una invitación o recuperación nueva.";
    console.error("Error guardando la contraseña:", error?.message || "Supabase no devolvió el usuario.");
    return;
  }
  form.reset();
  passwordFlowMode = null;
  history.replaceState(null, "", window.location.pathname);
  await syncAuthState();
}

async function logout() {
  const { error } = await db.auth.signOut();
  if (error) {
    showToast("No se pudo cerrar la sesión.");
    console.error("Error cerrando sesión:", error.message);
    return;
  }
  adminForms = [];
  selectedForm = null;
  currentAdminId = null;
  isPrimaryAdmin = false;
  stopAdminRealtime();
  showLogin();
  showToast("Sesión cerrada.");
}

function startAdminRealtime() {
  stopAdminRealtime();
  adminRealtimeChannel = db.channel("admin-new-public-forms")
    .on("postgres_changes", { event: "*", schema: "public", table: "formularios" }, payload => {
      const form = payload.new;
      if (!form?.activo) return;
      const wasAlreadyPublic = payload.eventType === "UPDATE"
        && adminForms.some(item => item.id === form.id && item.activo);
      if (wasAlreadyPublic) return;
      showToast(`Nuevo formulario disponible: ${form.titulo}`);
      if (document.hidden && "Notification" in window && Notification.permission === "granted") {
        new Notification("Nuevo formulario", { body: form.titulo, icon: "logo-cuadrado.png" });
      }
      loadAdminForms();
    })
    .subscribe(status => {
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        console.error("No se pudo iniciar el canal de avisos en tiempo real:", status);
      }
    });
}

function stopAdminRealtime() {
  if (adminRealtimeChannel && db) db.removeChannel(adminRealtimeChannel);
  adminRealtimeChannel = null;
}

function decodeBase64Url(value) {
  const padding = "=".repeat((4 - value.length % 4) % 4);
  const decoded = atob(value.replace(/-/g, "+").replace(/_/g, "/") + padding);
  return Uint8Array.from(decoded, character => character.charCodeAt(0));
}

async function enablePushNotifications() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    showToast("Este navegador no admite notificaciones push.");
    return;
  }
  if (!PUSH_VAPID_PUBLIC_KEY) {
    showToast("Configura la clave pública VAPID en app.js para activar el push.");
    return;
  }
  if (!currentAdminId) {
    showToast("Inicia sesión con una cuenta del equipo para activar avisos.");
    return;
  }
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    showToast("Activa los permisos de notificación en tu navegador.");
    return;
  }
  const button = $("#notifications-button");
  button.disabled = true;
  try {
    const registration = await navigator.serviceWorker.register("./service-worker.js");
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: decodeBase64Url(PUSH_VAPID_PUBLIC_KEY)
    });
    const keys = subscription.toJSON().keys;
    const { error } = await db.from("push_subscriptions").upsert({
      usuario_id: currentAdminId,
      endpoint: subscription.endpoint,
      p256dh: keys.p256dh,
      auth: keys.auth
    }, { onConflict: "endpoint" });
    if (error) {
      console.error("Error guardando la suscripción push:", error.message);
      showToast("No pudimos guardar tus avisos. Revisa la configuración de Supabase.");
      return;
    }
    button.textContent = "Avisos push activados";
    showToast("Avisos push activados para los formularios nuevos.");
  } catch (error) {
    console.error("Error activando notificaciones push:", error);
    showToast("No se pudieron activar los avisos push en este navegador.");
  } finally {
    button.disabled = false;
  }
}

async function inviteAdmin(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const message = $("#invite-admin-message");
  const email = form.elements.email.value.trim().toLowerCase();
  const button = $('button[type="submit"]', form);
  button.disabled = true;
  message.textContent = "";
  const { data, error } = await db.functions.invoke("invite-admin", {
    body: { email }
  });
  button.disabled = false;
  if (error) {
    message.textContent = "No se pudo enviar la invitación. Revisa que la función segura esté desplegada.";
    console.error("Error invitando administrador:", error.message);
    return;
  }
  form.reset();
  message.textContent = data?.message || "Invitación enviada.";
  await loadAdminTeam();
  await loadAdminAccessRequests();
}

async function loadAdminAccessRequests() {
  const target = $("#admin-access-requests");
  const { data, error } = await db.from("solicitudes_admin")
    .select("email, creado_en")
    .eq("estado", "pendiente")
    .order("creado_en", { ascending: true });
  if (error) {
    target.innerHTML = '<p class="form-message">No se pudieron cargar las solicitudes de acceso.</p>';
    console.error("Error cargando solicitudes de acceso:", error.message);
    return;
  }
  adminAccessRequests = data || [];
  $("#access-request-count").textContent = adminAccessRequests.length;
  target.innerHTML = adminAccessRequests.length
    ? adminAccessRequests.map(request => `<div class="access-request-item">
      <div><span class="admin-team-email">${escapeHtml(request.email)}</span><time>${escapeHtml(formatDate(request.creado_en))}</time></div>
      <button class="approve-access" type="button" data-email="${escapeHtml(request.email)}">Aprobar y enviar acceso</button>
    </div>`).join("")
    : '<p class="team-empty">No hay solicitudes pendientes.</p>';
}

async function approveAdminRequest(email) {
  if (!isPrimaryAdmin || !adminAccessRequests.some(request => request.email === email)) return;
  const button = $$(".approve-access", $("#admin-access-requests"))
    .find(item => item.dataset.email === email);
  if (!button) return;
  button.disabled = true;
  const { data, error } = await db.functions.invoke("invite-admin", { body: { email } });
  button.disabled = false;
  if (error) {
    showToast("No se pudo aprobar la solicitud. Comprueba si el correo ya tiene acceso.");
    console.error("Error aprobando solicitud de acceso:", error.message);
    return;
  }
  showToast(data?.message || "Acceso aprobado. Se envió el enlace para crear la contraseña.");
  await loadAdminTeam();
  await loadAdminAccessRequests();
}

async function loadAdminTeam() {
  const target = $("#admin-team-list");
  const { data, error } = await db.from("administradores")
    .select("usuario_id, email, creado_en")
    .order("creado_en", { ascending: true });
  if (error) {
    target.innerHTML = '<p class="form-message">No se pudo cargar el equipo.</p>';
    console.error("Error cargando el equipo administrador:", error.message);
    return;
  }
  adminMembers = data;
  target.innerHTML = adminMembers.map(member => `<div class="admin-team-member">
    <span class="admin-team-email">${escapeHtml(member.email || "Cuenta de administración")}</span>
    ${member.usuario_id === currentAdminId
      ? '<span class="admin-team-self">TÚ</span>'
      : `<button class="remove-admin" type="button" data-id="${escapeHtml(member.usuario_id)}" aria-label="Retirar acceso a ${escapeHtml(member.email || "esta cuenta")}">Retirar</button>`}
  </div>`).join("");
}

async function removeAdmin(id) {
  const member = adminMembers.find(item => item.usuario_id === id);
  if (!member || !confirm(`¿Retirar el acceso de administración de ${member.email || "esta cuenta"}?`)) return;
  const { data, error } = await db.functions.invoke("remove-admin", {
    body: { userId: id }
  });
  if (error) {
    showToast("No se pudo actualizar el equipo. Revisa que la función segura esté desplegada.");
    console.error("Error retirando administrador:", error.message);
    return;
  }
  await loadAdminTeam();
  showToast(data?.message || "Acceso de administración retirado.");
}

async function notifyAdminsOfNewForm(title) {
  if (!PUSH_VAPID_PUBLIC_KEY) return;
  const { error } = await db.functions.invoke("send-push", {
    body: { title: "Nuevo formulario", body: title, url: window.location.href }
  });
  if (error) {
    console.error("Error enviando notificación push:", error.message);
    showToast("El formulario se guardó, pero no se pudo enviar el aviso push.");
  }
}

async function loadAdminForms(selectId) {
  const { data, error } = await db.from("formularios").select("*").order("creado_en", { ascending: false });
  if (error) {
    showToast("No se pudieron cargar los formularios.");
    console.error("Error cargando formularios de administración:", error.message);
    return;
  }
  adminForms = data;
  renderAdminFormList();
  if (selectId) {
    const form = adminForms.find(item => item.id === selectId);
    if (form) await selectAdminForm(form);
  }
}

function renderAdminFormList() {
  const target = $("#admin-form-list");
  if (!adminForms.length) {
    target.innerHTML = '<p class="form-message">Aún no tienes formularios.</p>';
    return;
  }
  target.innerHTML = adminForms.map(form => `<button class="admin-form-item ${selectedForm?.id === form.id ? "selected" : ""}" type="button" data-id="${escapeHtml(form.id)}">
    <span class="admin-form-name">${escapeHtml(form.titulo)}</span>
    <span class="admin-form-meta"><i class="mini-dot ${form.activo ? "" : "off"}"></i>${form.activo ? "Visible para responder" : "Oculto"} · ${formatDate(form.creado_en)}</span>
  </button>`).join("");
}

async function selectAdminForm(form) {
  selectedForm = form;
  $("#admin-welcome").classList.add("hidden");
  editorView.classList.remove("hidden");
  $("#editor-kicker").textContent = "EDITANDO FORMULARIO";
  $("#editor-heading").textContent = form.titulo;
  const editor = $("#form-editor");
  editor.elements["form-id"].value = form.id;
  editor.elements.title.value = form.titulo;
  editor.elements.description.value = form.descripcion || "";
  editor.elements.active.checked = form.activo;
  editor.elements["starts-at"].value = toLocalDateTime(form.fecha_inicio);
  editor.elements["ends-at"].value = toLocalDateTime(form.fecha_fin);
  const { data, error } = await db.from("preguntas").select("*").eq("formulario_id", form.id).order("orden");
  if (error) {
    showToast("No se pudieron cargar las preguntas.");
    console.error("Error cargando preguntas de administración:", error.message);
    return;
  }
  selectedQuestions = data;
  originalQuestionIds = data.map(question => question.id);
  renderQuestionEditor();
  $("#responses-section").classList.remove("hidden");
  $("#toggle-form-button").textContent = form.activo ? "Ocultar de la página pública" : "Mostrar en la página pública";
  renderAdminFormList();
  await loadResponses(form);
}

function toLocalDateTime(value) {
  if (!value) return "";
  const date = new Date(value);
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}

function startNewForm() {
  selectedForm = null;
  selectedQuestions = [];
  originalQuestionIds = [];
  loadedResponses = [];
  $("#admin-welcome").classList.add("hidden");
  editorView.classList.remove("hidden");
  $("#editor-kicker").textContent = "NUEVO";
  $("#editor-heading").textContent = "Crear formulario";
  $("#form-editor").reset();
  $("#form-editor").elements["form-id"].value = "";
  $("#form-editor").elements.active.checked = false;
  $("#responses-section").classList.add("hidden");
  renderQuestionEditor();
  renderAdminFormList();
  $("#editor-message").textContent = "";
}

function renderQuestionEditor() {
  $("#question-count").textContent = selectedQuestions.length;
  questionEditor.innerHTML = selectedQuestions.map((question, index) => {
    const options = Array.isArray(question.opciones) ? question.opciones.join("\n") : "";
    const type = question.tipo === "texto_corto" || question.tipo === "texto_largo" ? "texto" : question.tipo;
    return `<div class="question-card" data-index="${index}" data-id="${escapeHtml(question.id || "")}">
      <label class="question-text-label">Pregunta
        <textarea data-field="text" required maxlength="500" rows="2" placeholder="Escribe la pregunta...">${escapeHtml(question.texto_pregunta || "")}</textarea>
      </label>
      <label class="question-type-label">Tipo
        <select data-field="type">${Object.entries(QUESTION_TYPES).map(([key, title]) => `<option value="${key}" ${type === key ? "selected" : ""}>${title}</option>`).join("")}</select>
      </label>
      ${["seleccion", "checkbox"].includes(question.tipo) ? `<label class="options-label">Opciones (una por línea)
        <textarea data-field="options" rows="3" placeholder="Opción 1&#10;Opción 2">${escapeHtml(options)}</textarea>
      </label>` : ""}
      <div class="question-bottom"><label class="required-toggle"><input data-field="required" type="checkbox" ${question.obligatoria ? "checked" : ""}> Obligatoria</label><button class="remove-question" type="button">Quitar pregunta ×</button></div>
    </div>`;
  }).join("");
}

function addQuestion() {
  selectedQuestions = readEditorQuestions();
  selectedQuestions.push({ texto_pregunta: "", tipo: "texto", obligatoria: false, opciones: [] });
  renderQuestionEditor();
  $(".question-card:last-child [data-field='text']", questionEditor)?.focus();
}

function readEditorQuestions() {
  const cards = $$(".question-card", questionEditor);
  $("#question-count").textContent = cards.length;
  return cards.map(card => {
    const text = $('[data-field="text"]', card).value.trim();
    const type = $('[data-field="type"]', card).value;
    const optionsField = $('[data-field="options"]', card);
    const options = optionsField ? optionsField.value.split("\n").map(item => item.trim()).filter(Boolean) : [];
    return {
      id: card.dataset.id || null,
      texto_pregunta: text,
      tipo: type,
      obligatoria: $('[data-field="required"]', card).checked,
      opciones: options
    };
  });
}

async function saveForm(event) {
  event.preventDefault();
  const editor = event.currentTarget;
  const message = $("#editor-message");
  const button = $('button[type="submit"]', editor);
  const questions = readEditorQuestions();
  if (!questions.length) {
    message.textContent = "Agrega al menos una pregunta.";
    return;
  }
  if (questions.some(q => !q.texto_pregunta)) {
    message.textContent = "Completa el texto de todas las preguntas.";
    return;
  }
  if (questions.some(q => ["seleccion", "checkbox"].includes(q.tipo) && !q.opciones.length)) {
    message.textContent = "Agrega al menos una opción a cada pregunta de selección o checkbox.";
    return;
  }
  const start = editor.elements["starts-at"].value;
  const end = editor.elements["ends-at"].value;
  if (start && end && new Date(start) >= new Date(end)) {
    message.textContent = "La fecha de cierre debe ser posterior a la fecha de inicio.";
    return;
  }
  button.disabled = true;
  message.textContent = "";
  const payload = {
    titulo: editor.elements.title.value.trim(),
    descripcion: editor.elements.description.value.trim(),
    activo: editor.elements.active.checked,
    fecha_inicio: start ? new Date(start).toISOString() : null,
    fecha_fin: end ? new Date(end).toISOString() : null
  };
  let formId = editor.elements["form-id"].value;
  const isNewForm = !formId;
  const wasPublic = selectedForm?.activo === true;
  let error;
  if (formId) {
    ({ error } = await db.from("formularios").update(payload).eq("id", formId));
  } else {
    const result = await db.from("formularios")
      .insert({ ...payload, activo: false })
      .select("id")
      .single();
    error = result.error;
    formId = result.data?.id;
  }
  if (error) {
    button.disabled = false;
    message.textContent = "No se pudo guardar el formulario. Revisa los permisos de Supabase.";
    console.error("Error guardando formulario:", error.message);
    return;
  }
  const retainedIds = questions.map(question => question.id).filter(Boolean);
  const removedIds = originalQuestionIds.filter(id => !retainedIds.includes(id));
  if (removedIds.length) {
    const { error: deleteError } = await db.from("preguntas").delete().in("id", removedIds);
    if (deleteError) {
      button.disabled = false;
      message.textContent = "Se guardó el formulario, pero no se pudieron actualizar sus preguntas.";
      console.error("Error reemplazando preguntas:", deleteError.message);
      await loadAdminForms(formId);
      return;
    }
  }
  const questionRows = questions.map((question, order) => ({
    ...(question.id ? { id: question.id } : {}),
    formulario_id: formId,
    texto_pregunta: question.texto_pregunta,
    tipo: question.tipo,
    orden: order,
    obligatoria: question.obligatoria,
    opciones: question.opciones
  }));
  const { error: questionError } = await db.from("preguntas").upsert(questionRows, { onConflict: "id" });
  if (questionError) {
    button.disabled = false;
    message.textContent = "El formulario se guardó, pero hubo un problema al guardar las preguntas.";
    console.error("Error guardando preguntas:", questionError.message);
    await loadAdminForms(formId);
    return;
  }
  if (isNewForm && payload.activo) {
    const { error: publishError } = await db.from("formularios")
      .update({ activo: true })
      .eq("id", formId);
    if (publishError) {
      button.disabled = false;
      message.textContent = "Se guardaron las preguntas, pero no se pudo publicar el formulario.";
      console.error("Error publicando formulario nuevo:", publishError.message);
      await loadAdminForms(formId);
      return;
    }
  }
  button.disabled = false;
  showToast(payload.activo ? "Formulario guardado y disponible para responder." : "Formulario guardado como borrador; no aparece en la página pública.");
  if (payload.activo && (isNewForm || !wasPublic)) await notifyAdminsOfNewForm(payload.titulo);
  await loadAdminForms(formId);
}

async function loadResponses(form) {
  const wrap = $("#responses-table-wrap");
  wrap.innerHTML = '<div class="table-empty">Cargando respuestas...</div>';
  const [{ data: responses, error: responseError }, { data: questions, error: questionError }] = await Promise.all([
    db.from("respuestas").select("*").eq("formulario_id", form.id).order("creado_en", { ascending: false }),
    db.from("preguntas").select("*").eq("formulario_id", form.id).order("orden")
  ]);
  if (responseError || questionError) {
    wrap.innerHTML = '<div class="table-empty">No se pudieron cargar las respuestas. Revisa las políticas de Supabase.</div>';
    console.error("Error cargando respuestas:", responseError?.message || questionError?.message);
    return;
  }
  loadedResponses = responses;
  $("#response-count").textContent = responses.length;
  if (!responses.length) {
    wrap.innerHTML = '<div class="table-empty">Aún no hay respuestas para este formulario.</div>';
    return;
  }
  wrap.innerHTML = `<table class="responses-table"><thead><tr><th>Fecha</th>${questions.map(question => `<th>${escapeHtml(question.texto_pregunta)}</th>`).join("")}<th>Acción</th></tr></thead><tbody>
    ${responses.map(response => `<tr data-response-id="${escapeHtml(response.id)}"><td>${escapeHtml(formatDate(response.creado_en))}</td>
      ${questions.map(question => `<td>${escapeHtml(formatAnswer(response.datos_json?.[question.id]))}</td>`).join("")}
      <td><button class="delete-response" type="button" data-id="${escapeHtml(response.id)}">Borrar</button></td></tr>`).join("")}
    </tbody></table>`;
}

function formatAnswer(value) {
  if (Array.isArray(value)) return value.join(", ") || "—";
  return value == null || value === "" ? "—" : String(value);
}

async function deleteResponse(id) {
  if (!confirm("¿Borrar esta respuesta? Esta acción no se puede deshacer.")) return;
  const { error } = await db.from("respuestas").delete().eq("id", id);
  if (error) {
    showToast("No se pudo borrar la respuesta.");
    console.error("Error borrando respuesta:", error.message);
    return;
  }
  await loadResponses(selectedForm);
  showToast("Respuesta borrada.");
}

async function toggleForm() {
  if (!selectedForm) return;
  const next = !selectedForm.activo;
  const { error } = await db.from("formularios").update({ activo: next }).eq("id", selectedForm.id);
  if (error) {
    showToast("No se pudo cambiar el estado del formulario.");
    console.error("Error actualizando estado:", error.message);
    return;
  }
  selectedForm.activo = next;
  $("#form-editor").elements.active.checked = next;
  $("#toggle-form-button").textContent = next ? "Ocultar de la página pública" : "Mostrar en la página pública";
  await loadAdminForms(selectedForm.id);
  await loadPublicForms();
  if (next) await notifyAdminsOfNewForm(selectedForm.titulo);
  showToast(next ? "Formulario activado." : "Formulario desactivado.");
}

async function deleteForm() {
  if (!selectedForm || !confirm(`¿Borrar "${selectedForm.titulo}" y todas sus respuestas? Esta acción no se puede deshacer.`)) return;
  const { error } = await db.from("formularios").delete().eq("id", selectedForm.id);
  if (error) {
    showToast("No se pudo borrar el formulario. Revisa que la base de datos tenga borrado en cascada.");
    console.error("Error borrando formulario:", error.message);
    return;
  }
  selectedForm = null;
  selectedQuestions = [];
  editorView.classList.add("hidden");
  $("#admin-welcome").classList.remove("hidden");
  await loadAdminForms();
  await loadPublicForms();
  showToast("Formulario borrado.");
}

function exportCsv() {
  if (!selectedForm || !loadedResponses.length) {
    showToast("Todavía no hay respuestas para exportar.");
    return;
  }
  const headers = ["Fecha", ...selectedQuestions.map(question => question.texto_pregunta)];
  const rows = loadedResponses.map(response => [
    formatDate(response.creado_en),
    ...selectedQuestions.map(question => formatAnswer(response.datos_json?.[question.id]))
  ]);
  const csv = [headers, ...rows].map(row => row.map(csvCell).join(",")).join("\r\n");
  const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  link.href = url;
  link.download = `${slugify(selectedForm.titulo)}-respuestas.csv`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function csvCell(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function slugify(value) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "formulario";
}

publicNav.addEventListener("click", () => switchView("public"));
adminNav.addEventListener("click", () => switchView("admin"));
$("#public-forms").addEventListener("submit", event => {
  if (event.target.matches(".response-form")) submitResponse(event);
});
$("#login-form").addEventListener("submit", login);
$("#reset-password-button").addEventListener("click", resetAdminPassword);
$("#setup-password-form").addEventListener("submit", saveNewPassword);
$("#request-access-form").addEventListener("submit", requestAdminAccess);
$("#logout-button").addEventListener("click", logout);
$("#notifications-button").addEventListener("click", enablePushNotifications);
$("#invite-admin-form").addEventListener("submit", inviteAdmin);
$("#new-form-button").addEventListener("click", startNewForm);
$("#add-question-button").addEventListener("click", addQuestion);
$("#form-editor").addEventListener("submit", saveForm);
$("#cancel-edit-button").addEventListener("click", () => {
  editorView.classList.add("hidden");
  $("#admin-welcome").classList.remove("hidden");
  selectedForm = null;
  renderAdminFormList();
});
$("#question-editor").addEventListener("change", event => {
  if (event.target.matches('[data-field="type"]')) {
    selectedQuestions = readEditorQuestions();
    renderQuestionEditor();
  }
});
$("#question-editor").addEventListener("click", event => {
  if (!event.target.matches(".remove-question")) return;
  selectedQuestions = readEditorQuestions();
  selectedQuestions.splice(Number(event.target.closest(".question-card").dataset.index), 1);
  renderQuestionEditor();
});
$("#admin-form-list").addEventListener("click", event => {
  const button = event.target.closest(".admin-form-item");
  if (button) selectAdminForm(adminForms.find(form => form.id === button.dataset.id));
});
$("#admin-team-list").addEventListener("click", event => {
  const button = event.target.closest(".remove-admin");
  if (button) removeAdmin(button.dataset.id);
});
$("#admin-access-requests").addEventListener("click", event => {
  const button = event.target.closest(".approve-access");
  if (button) approveAdminRequest(button.dataset.email);
});
$("#responses-table-wrap").addEventListener("click", event => {
  const button = event.target.closest(".delete-response");
  if (button) deleteResponse(button.dataset.id);
});
$("#toggle-form-button").addEventListener("click", toggleForm);
$("#delete-form-button").addEventListener("click", deleteForm);
$("#export-button").addEventListener("click", exportCsv);

if (db) {
  db.auth.onAuthStateChange((_event, session) => {
    if (session) {
      setTimeout(syncAuthState, 0);
    } else {
      currentAdminId = null;
      stopAdminRealtime();
      showLogin();
    }
  });
}
loadPublicForms();
