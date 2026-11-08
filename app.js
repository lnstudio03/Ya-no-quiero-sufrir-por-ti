// Cambia estos valores por las credenciales de tu proyecto Supabase.
const SUPABASE_URL = "https://txpqszjmlvapeajwenjr.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_KgAXWoUMGvpubi-XreeNDA_1yT1-jfv";

const QUESTION_TYPES = {
  texto_corto: "Texto corto",
  texto_largo: "Texto largo",
  seleccion: "Selección",
  checkbox: "Checkbox"
};
const configured = !SUPABASE_URL.includes("TU-PROYECTO") && !SUPABASE_ANON_KEY.includes("TU_SUPABASE");
const db = configured && window.supabase ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

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
let toastTimer;

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("visible");
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
  if (question.tipo === "texto_largo") {
    return `<div class="public-question"><label for="${name}">${label}</label><textarea class="input-control" id="${name}" name="${name}" rows="3" ${required} placeholder="Escribe tu respuesta..."></textarea></div>`;
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
  db.auth.getSession().then(({ data, error }) => {
    if (error) {
      showLogin();
      $("#login-message").textContent = "No se pudo verificar la sesión.";
      console.error("Error verificando sesión:", error.message);
      return;
    }
    if (data.session) {
      loginBox.classList.add("hidden");
      adminPanel.classList.remove("hidden");
      loadAdminForms();
    } else {
      showLogin();
    }
  });
}

function showLogin() {
  loginBox.classList.remove("hidden");
  adminPanel.classList.add("hidden");
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
    message.textContent = "No pudimos iniciar sesión. Revisa tu correo y contraseña.";
    console.error("Error de inicio de sesión:", error.message);
    return;
  }
  form.reset();
  showLogin();
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
  showLogin();
  showToast("Sesión cerrada.");
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
  questionEditor.innerHTML = selectedQuestions.map((question, index) => {
    const options = Array.isArray(question.opciones) ? question.opciones.join("\n") : "";
    return `<div class="question-card" data-index="${index}" data-id="${escapeHtml(question.id || "")}">
      <label class="question-text-label">Pregunta
        <input type="text" data-field="text" required maxlength="500" value="${escapeHtml(question.texto_pregunta || "")}" placeholder="Escribe la pregunta...">
      </label>
      <label class="question-type-label">Tipo
        <select data-field="type">${Object.entries(QUESTION_TYPES).map(([key, title]) => `<option value="${key}" ${question.tipo === key ? "selected" : ""}>${title}</option>`).join("")}</select>
      </label>
      ${["seleccion", "checkbox"].includes(question.tipo) ? `<label class="options-label">Opciones (una por línea)
        <textarea data-field="options" rows="3" placeholder="Opción 1&#10;Opción 2">${escapeHtml(options)}</textarea>
      </label>` : ""}
      <div class="question-bottom"><label class="required-toggle"><input data-field="required" type="checkbox" ${question.obligatoria ? "checked" : ""}> Obligatoria</label><button class="remove-question" type="button">Quitar pregunta ×</button></div>
    </div>`;
  }).join("");
}

function addQuestion() {
  selectedQuestions.push({ texto_pregunta: "", tipo: "texto_corto", obligatoria: false, opciones: [] });
  renderQuestionEditor();
  $("input[data-field=text]:last-of-type", questionEditor)?.focus();
}

function readEditorQuestions() {
  const cards = $$(".question-card", questionEditor);
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
  let error;
  if (formId) {
    ({ error } = await db.from("formularios").update(payload).eq("id", formId));
  } else {
    const result = await db.from("formularios").insert(payload).select("id").single();
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
  button.disabled = false;
  if (questionError) {
    message.textContent = "El formulario se guardó, pero hubo un problema al guardar las preguntas.";
    console.error("Error guardando preguntas:", questionError.message);
    await loadAdminForms(formId);
    return;
  }
  showToast(payload.activo ? "Formulario guardado y disponible para responder." : "Formulario guardado como borrador; no aparece en la página pública.");
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
$("#logout-button").addEventListener("click", logout);
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
  selectedQuestions.splice(Number(event.target.closest(".question-card").dataset.index), 1);
  renderQuestionEditor();
});
$("#admin-form-list").addEventListener("click", event => {
  const button = event.target.closest(".admin-form-item");
  if (button) selectAdminForm(adminForms.find(form => form.id === button.dataset.id));
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
    if (session && !adminPanel.classList.contains("hidden")) loadAdminForms();
    if (!session) showLogin();
  });
}
loadPublicForms();
