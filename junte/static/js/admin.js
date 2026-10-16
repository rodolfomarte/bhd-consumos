/* ════════════════════════════════════════════════════════════════════════
   admin.js — login directo, pestañas de usuarios, toggle de galería y
   contador de almacenamiento. La protección real vive en firestore.rules /
   storage.rules / las funciones de servidor — esto es solo la UI.
   ════════════════════════════════════════════════════════════════════════ */
let usersUnsub = null;
let storagePollTimer = null;
let approvedUsersCache = [];
let allUsersCache = [];
let captainsUnsub = null, captainsCache = {};
let retosAdminUnsub = {}, retosAdminCache = {};
let evidenciasUnsub = null;

document.addEventListener("DOMContentLoaded", () => {
  initLoginForm();
  initTabs();
  initRetosTabs();
  initPublishForm();
  initEvidenciaFilters();
  initAjustesForm();

  JunteAuth.subscribe(state => {
    document.getElementById("adminLoading").style.display = state.loading ? "block" : "none";
    if (state.loading) return;

    const loggedOut      = !state.user;
    const authorized     = state.isAdmin;                        // panel completo
    const authorizedMusic = state.isAdmin || state.encargadoMusica; // solo "Gestión musical"

    document.getElementById("adminLoginWrap").style.display = loggedOut ? "block" : "none";
    document.getElementById("adminDenied").style.display    = (!loggedOut && !authorizedMusic) ? "block" : "none";
    document.getElementById("adminContent").style.display   = authorizedMusic ? "block" : "none";
    document.getElementById("adminFullOnly").style.display  = authorized ? "block" : "none";

    if (authorized && !usersUnsub) {
      initGalleryToggle();
      initRecalcularVillaRegistros();
      watchUsers();
      initStorageWidget();
      watchCaptains();
      watchRetosAdmin();
      watchEvidencias();
      watchAjustes();
    }
    if (!authorized && usersUnsub) {
      usersUnsub(); usersUnsub = null;
      if (storagePollTimer) { clearInterval(storagePollTimer); storagePollTimer = null; }
      if (captainsUnsub) { captainsUnsub(); captainsUnsub = null; }
      Object.values(retosAdminUnsub).forEach(fn => fn && fn());
      retosAdminUnsub = {};
      if (evidenciasUnsub) { evidenciasUnsub(); evidenciasUnsub = null; }
    }

    if (authorizedMusic && !window.__musicaAdminStarted) {
      window.__musicaAdminStarted = true;
      try { initMusicaAdmin(); } catch (err) { console.error("Error iniciando Gestión musical:", err); }
    }
    if (!authorizedMusic && window.__musicaAdminStarted) {
      window.__musicaAdminStarted = false;
      try { teardownMusicaAdmin(); } catch (err) { console.error("Error cerrando Gestión musical:", err); }
    }
  });

  document.getElementById("btnAdminDeniedLogout").addEventListener("click", () => JunteAuth.logoutAccount());
});

/* ══════════════════ LOGIN DIRECTO EN /admin ═══════════════════════════════ */
function initLoginForm() {
  document.getElementById("adminLoginForm").addEventListener("submit", async e => {
    e.preventDefault();
    const err = document.getElementById("adminLoginError");
    err.style.display = "none";
    try {
      await JunteAuth.loginAccount({
        username: document.getElementById("adminLoginUsername").value,
        password: document.getElementById("adminLoginPassword").value,
      });
      // JunteAuth.subscribe ya reacciona solo: si es admin, muestra el panel;
      // si no, cae en "acceso restringido" — no hace falta redirigir a mano.
    } catch (ex) {
      err.textContent = ex.message;
      err.style.display = "block";
    }
  });
}

/* ══════════════════ PESTAÑAS ══════════════════════════════════════════════
   Dos grupos de pestañas independientes (usuarios y retos) — cada uno se
   queda dentro de su propio contenedor para no pisar el "active" del otro. */
function initTabs() {
  document.querySelectorAll("#userAdminTabs .admin-tab").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#userAdminTabs .admin-tab").forEach(b => b.classList.remove("active"));
      document.querySelectorAll("#tabPanel-pending,#tabPanel-approved,#tabPanel-rejected,#tabPanel-suspended")
        .forEach(p => p.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById(`tabPanel-${btn.dataset.tab}`).classList.add("active");
    });
  });
}

function initRetosTabs() {
  document.querySelectorAll("#retosAdminTabs .admin-tab").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#retosAdminTabs .admin-tab").forEach(b => b.classList.remove("active"));
      document.querySelectorAll("#retosPanel-capitanes,#retosPanel-publicar,#retosPanel-evidencias,#retosPanel-ajustes")
        .forEach(p => p.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById(`retosPanel-${btn.dataset.retotab}`).classList.add("active");
    });
  });
}

/* ══════════════════ CONTADOR DE ALMACENAMIENTO ═══════════════════════════ */
function initStorageWidget() {
  document.getElementById("btnRefreshStorage").addEventListener("click", () => loadStorageUsage());
  loadStorageUsage();
  if (storagePollTimer) clearInterval(storagePollTimer);
  storagePollTimer = setInterval(loadStorageUsage, 30000); // real, no simulado — solo polling
}

function formatBytes(bytes) {
  if (bytes >= 1024 ** 3) return (bytes / 1024 ** 3).toFixed(2) + " GB";
  if (bytes >= 1024 ** 2) return (bytes / 1024 ** 2).toFixed(1) + " MB";
  if (bytes >= 1024) return (bytes / 1024).toFixed(1) + " KB";
  return bytes + " B";
}

async function loadStorageUsage() {
  const msg = document.getElementById("storageWidgetMsg");
  const btn = document.getElementById("btnRefreshStorage");
  btn.disabled = true;
  try {
    const u = await JunteAuth.callFunction("storage-usage");
    document.getElementById("storageUsedLabel").textContent      = formatBytes(u.usedBytes);
    document.getElementById("storageLimitLabel").textContent     = formatBytes(u.limitBytes);
    document.getElementById("storageAvailableLabel").textContent = formatBytes(u.availableBytes);
    document.getElementById("storagePercentLabel").textContent   = u.percent + "%";
    const bar = document.getElementById("storageProgressBar");
    bar.style.width = u.percent + "%";
    bar.classList.toggle("storage-bar-warn", u.percent >= 80 && u.percent < 100);
    bar.classList.toggle("storage-bar-full", u.percent >= 100);
    msg.textContent = "Actualizado " + new Date().toLocaleTimeString("es-DO");
  } catch (err) {
    msg.textContent = "❌ " + err.message;
  } finally {
    btn.disabled = false;
  }
}

/* ══════════════════ GALERÍA GENERAL ═══════════════════════════════════════ */
function initRecalcularVillaRegistros() {
  const btn = document.getElementById("btnRecalcularVillaRegistros");
  const msg = document.getElementById("recalcularVillaRegistrosMsg");
  if (!btn) return;
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    msg.textContent = "Recalculando… ⏳";
    try {
      await JunteAuth.callFunction("backfill-familia-registros", { method: "POST" });
      msg.textContent = "✅ Listo — los conteos públicos de Nuestras Villas ya reflejan todas las cuentas existentes.";
    } catch (err) {
      msg.textContent = "❌ " + err.message;
    } finally {
      btn.disabled = false;
    }
  });
}

function initGalleryToggle() {
  const toggle = document.getElementById("galleryToggle");
  const msg    = document.getElementById("gallerySettingMsg");

  fbDb.collection("config").doc("settings").onSnapshot(snap => {
    toggle.checked = !!(snap.exists && snap.data().galleryEnabledForUsers);
  });

  toggle.addEventListener("change", async () => {
    try {
      await fbDb.collection("config").doc("settings").set(
        { galleryEnabledForUsers: toggle.checked }, { merge: true }
      );
      msg.textContent = "✅ Guardado.";
    } catch (err) {
      msg.textContent = "❌ " + err.message;
      toggle.checked = !toggle.checked;
    }
  });
}

/* ══════════════════ USUARIOS (pestañas) ════════════════════════════════════ */
function watchUsers() {
  usersUnsub = fbDb.collection("users").orderBy("createdAt", "desc").onSnapshot(
    snap => {
      const byStatus = { pending: [], approved: [], rejected: [], suspended: [] };
      allUsersCache = [];
      snap.forEach(doc => {
        const u = { uid: doc.id, ...doc.data() };
        (byStatus[u.status] || byStatus.pending).push(u);
        allUsersCache.push(u);
      });
      Object.entries(byStatus).forEach(([status, list]) => renderGroup(status, list));
      try { renderVillaResumen(); } catch (err) { console.error("Error en resumen por villa:", err); }
    },
    err => console.error("Users error:", err)
  );
}

/* ── Resumen: cuántos registrados hay por familia/villa ──────────────────
   Recorre el roster completo (las 24 familias conocidas, vengan o no
   registradas) y cuenta cuántas cuentas reales hay por cada una — en
   cualquier estado (pendiente/aprobado/rechazado/suspendido), porque la
   pregunta es "¿alguien de esa familia se registró?", no "¿ya se aprobó?".
   Las familias en 0 se marcan en rojo para verlas de un vistazo. */
function renderVillaResumen() {
  const wrap = document.getElementById("villaResumenGrid");
  if (!wrap || typeof FAMILIES_ROSTER === "undefined") return;

  const countPorFamilia = {};
  allUsersCache.forEach(u => {
    if (!u.familia) return;
    countPorFamilia[u.familia] = (countPorFamilia[u.familia] || 0) + 1;
  });

  wrap.innerHTML = FAMILIES_ROSTER.map((villa, idx) => {
    const villaInfo = VILLAS[idx] || { icon: "", name: villa.name };
    let totalVilla = 0;
    const filas = villa.familias.map(f => {
      const slug = JunteAuth.slugify(f.nombre);
      const n = countPorFamilia[slug] || 0;
      totalVilla += n;
      return `
        <li class="villa-resumen-fila ${n === 0 ? "sin-registrar" : ""}">
          <span>${escAdmin(f.nombre)}</span>
          <strong>${n}</strong>
        </li>`;
    }).join("");

    return `
      <div class="capitan-card">
        <div class="villa-icon">${villaInfo.icon}</div>
        <div class="villa-name">${escAdmin(villa.name)}</div>
        <ul class="villa-resumen-lista">${filas}</ul>
        <div class="villa-resumen-total">Total: <strong>${totalVilla}</strong></div>
      </div>`;
  }).join("");
}

function renderGroup(status, list) {
  if (status === "approved") {
    approvedUsersCache = list;
    try { renderCaptainsGrid(); } catch (err) { console.error("Error en Capitanes:", err); }
  }
  const cap = status.charAt(0).toUpperCase() + status.slice(1);
  document.getElementById(`tabCount${cap}`).textContent = list.length;
  const wrap = document.getElementById(`list${cap}`);

  if (!list.length) {
    wrap.innerHTML = `<p class="admin-empty">— Ninguno —</p>`;
    return;
  }

  wrap.innerHTML = list.map(u => {
    const villaSlug = villaSlugForFamilia(u.familia);
    const villaInfo = VILLAS.find(v => v.slug === villaSlug);
    return `
    <div class="admin-user-card">
      <div class="admin-user-info">
        <strong>${escAdmin(u.nombre)}</strong>
        <span>${escAdmin(u.familiaLabel || u.familia)}${villaInfo ? ` · ${villaInfo.icon} ${escAdmin(villaInfo.name)}` : ""}</span>
        <span class="admin-user-email">${escAdmin(u.email)}</span>
      </div>
      <div class="admin-user-actions">
        ${renderActions(status, u.uid)}
      </div>
    </div>`;
  }).join("");

  wrap.querySelectorAll("[data-action]").forEach(btn => {
    btn.addEventListener("click", () => handleAction(btn.dataset.action, btn.dataset.uid, btn));
  });
}

function renderActions(status, uid) {
  if (status === "pending") {
    return `
      <button class="btn-admin-sm" data-action="approve" data-uid="${uid}">✅ Aprobar</button>
      <button class="btn-admin-sm danger" data-action="reject" data-uid="${uid}">❌ Rechazar</button>`;
  }
  if (status === "approved") {
    return `<button class="btn-admin-sm danger" data-action="suspend" data-uid="${uid}">🚫 Suspender</button>`;
  }
  if (status === "rejected" || status === "suspended") {
    return `<button class="btn-admin-sm" data-action="approve" data-uid="${uid}">✅ Aprobar</button>`;
  }
  return "";
}

const ACTION_STATUS = { approve: "approved", reject: "rejected", suspend: "suspended" };

async function handleAction(action, uid, btn) {
  btn.disabled = true;
  const original = btn.textContent;
  btn.textContent = "…";
  try {
    await JunteAuth.callFunction("set-user-status", { method: "POST", body: { uid, status: ACTION_STATUS[action] } });
  } catch (err) {
    alert("Error: " + err.message);
    btn.disabled = false;
    btn.textContent = original;
  }
}

function escAdmin(s) {
  return String(s ?? "").replace(/[&<>"']/g, c =>
    ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}

/* ══════════════════════════════════════════════════════════════════════
   GESTIÓN DE RETOS — capitanes, publicar el reto, revisar evidencias.
   El bloqueo real de verdad vive en firestore.rules / storage.rules
   (claim capitanVilla, mirror de retoEvidencias) — este panel es solo la
   interfaz para administrarlo, no la fuente del permiso.
   ══════════════════════════════════════════════════════════════════════ */
const VILLAS = [
  { slug: "palmera", name: "Villa Palmera", icon: "🌴" },
  { slug: "perez",   name: "Villa Pérez",   icon: "🌿" },
  { slug: "cafe",    name: "Villa Café",    icon: "☕" },
  { slug: "cereza",  name: "Villa Cereza",  icon: "🍒" },
  { slug: "bosque",  name: "Villa Bosque",  icon: "🌲" },
];
// Catálogo de los 7 retos del reglamento (Junte Familiar de Logística 2026).
// El reto 1 conserva su retoId original ("identidad-equipo") para no romper
// lo que ya existe en producción; los retos 2-7 usan su número como id.
const CHALLENGES = [
  {
    retoId: "identidad-equipo", numero: 1, titulo: "Identidad y slogan",
    objetivo: "Crear nombre, slogan y una presentación breve que represente al equipo.",
    criterio: "Creatividad, identidad, presentación y energía.",
    entregables: ["nombre_equipo", "eslogan", "foto"],
  },
  {
    retoId: "2", numero: 2, titulo: "Carrera de sacos",
    objetivo: "Completar el recorrido en sacos, respetando el circuito y los relevos definidos.",
    criterio: "Menor tiempo con el recorrido completado correctamente.",
    entregables: ["foto"],
  },
  {
    retoId: "3", numero: 3, titulo: "Tiro al aro",
    objetivo: "Cada equipo recibe igual cantidad de lanzamientos desde la línea marcada hacia objetivos con valores definidos.",
    criterio: "Mayor suma de puntos válidos obtenidos.",
    entregables: ["foto"],
  },
  {
    retoId: "4", numero: 4, titulo: "Saltar la cuerda",
    objetivo: "Realizar la mayor cantidad de saltos válidos durante 1 minuto.",
    criterio: "Mayor cantidad de saltos válidos dentro del tiempo.",
    entregables: ["foto"],
  },
  {
    retoId: "5", numero: 5, titulo: "Tiro al saco",
    objetivo: "Lanzar desde la línea marcada con igual número de oportunidades por equipo.",
    criterio: "Mayor cantidad de aciertos válidos.",
    entregables: ["foto"],
  },
  {
    retoId: "6", numero: 6, titulo: "Búsqueda de patitos/pelotas",
    objetivo: "Buscar y entregar elementos escondidos dentro del área y tiempo definidos.",
    criterio: "Mayor cantidad de elementos entregados a tiempo (10 pts por pieza, máximo 100 pts).",
    entregables: ["foto"],
  },
  {
    retoId: "7", numero: 7, titulo: "Dame hombro",
    objetivo: "Realizar una performance grupal dentro del tiempo indicado.",
    criterio: "Coordinación, creatividad, energía y puesta en escena.",
    entregables: ["foto"],
  },
];
function challengeById(retoId) { return CHALLENGES.find(c => c.retoId === retoId); }

function villaSlugForFamilia(familiaSlug) {
  const idx = FAMILIES_ROSTER.findIndex(v => v.familias.some(f => JunteAuth.slugify(f.nombre) === familiaSlug));
  return idx >= 0 ? VILLAS[idx].slug : null;
}

/* ── Capitanes de Villa ──────────────────────────────────────────────── */
function watchCaptains() {
  captainsUnsub = fbDb.collection("retoCaptains").onSnapshot(
    snap => {
      captainsCache = {};
      snap.forEach(doc => { captainsCache[doc.id] = doc.data(); });
      try { renderCaptainsGrid(); } catch (err) { console.error("Error en Capitanes:", err); }
    },
    err => console.error("Captains error:", err)
  );
}

function renderCaptainsGrid() {
  const wrap = document.getElementById("capitanesGrid");
  if (!wrap) return;

  wrap.innerHTML = VILLAS.map(v => {
    const eligibles = approvedUsersCache.filter(u => villaSlugForFamilia(u.familia) === v.slug);
    const captain = captainsCache[v.slug];
    const options = eligibles.map(u =>
      `<option value="${u.uid}" ${captain?.uid === u.uid ? "selected" : ""}>${escAdmin(u.nombre)}</option>`
    ).join("");

    return `
      <div class="capitan-card" data-villa="${v.slug}">
        <div class="villa-icon">${v.icon}</div>
        <div class="villa-name">${v.name}</div>
        <div class="capitan-actual ${captain ? "" : "ninguno"}">
          ${captain ? `👑 ${escAdmin(captain.nombre)}` : "— Sin capitán —"}
        </div>
        <select class="select-input" id="capSelect-${v.slug}" ${eligibles.length ? "" : "disabled"}>
          ${eligibles.length ? options : `<option value="">— Sin aprobados en esta villa —</option>`}
        </select>
        <div class="capitan-card-actions">
          <button class="btn-admin-sm" data-action="assign-captain" data-villa="${v.slug}" ${eligibles.length ? "" : "disabled"}>Asignar</button>
          ${captain ? `<button class="btn-admin-sm danger" data-action="remove-captain" data-villa="${v.slug}">Retirar</button>` : ""}
        </div>
      </div>`;
  }).join("");

  wrap.querySelectorAll('[data-action="assign-captain"]').forEach(btn => {
    btn.addEventListener("click", () => assignCaptain(btn.dataset.villa, btn));
  });
  wrap.querySelectorAll('[data-action="remove-captain"]').forEach(btn => {
    btn.addEventListener("click", () => removeCaptain(btn.dataset.villa, btn));
  });
}

async function assignCaptain(villa, btn) {
  const uid = document.getElementById(`capSelect-${villa}`).value;
  if (!uid) { alert("Elige una familia aprobada de esta villa."); return; }
  btn.disabled = true;
  try {
    await JunteAuth.callFunction("set-captain", { method: "POST", body: { villa, uid } });
  } catch (err) {
    alert("Error: " + err.message);
  } finally {
    btn.disabled = false;
  }
}

async function removeCaptain(villa, btn) {
  if (!confirm(`¿Retirar al capitán actual de ${villa}?`)) return;
  btn.disabled = true;
  try {
    await JunteAuth.callFunction("set-captain", { method: "POST", body: { villa, uid: null } });
  } catch (err) {
    alert("Error: " + err.message);
    btn.disabled = false;
  }
}

/* ── Publicar reto ───────────────────────────────────────────────────── */
function initPublishForm() {
  const form = document.getElementById("publishRetoForm");
  if (!form) return;

  const retoSelect = document.getElementById("publishRetoId");
  retoSelect.innerHTML = CHALLENGES.map(c => `<option value="${c.retoId}">Reto ${c.numero}: ${escAdmin(c.titulo)}</option>`).join("");
  function renderPreview() {
    const c = challengeById(retoSelect.value);
    document.getElementById("publishRetoPreview").innerHTML = c
      ? `<p><strong>Objetivo:</strong> ${escAdmin(c.objetivo)}</p><p><strong>Criterio para ganar:</strong> ${escAdmin(c.criterio)}</p>`
      : "";
  }
  retoSelect.addEventListener("change", renderPreview);
  renderPreview();

  document.getElementById("publishVillaAll").addEventListener("change", e => {
    document.querySelectorAll('#publishVillaChecks input[type="checkbox"]:not(#publishVillaAll)')
      .forEach(cb => { cb.checked = e.target.checked; });
  });

  form.addEventListener("submit", async e => {
    e.preventDefault();
    const msg = document.getElementById("publishRetoMsg");
    const villasElegidas = Array.from(
      document.querySelectorAll('#publishVillaChecks input[type="checkbox"]:not(#publishVillaAll)')
    ).filter(cb => cb.checked).map(cb => cb.value);

    if (!villasElegidas.length) { msg.textContent = "Elige al menos una villa."; return; }

    const c = challengeById(retoSelect.value);
    if (!c) { msg.textContent = "Elige un reto válido."; return; }
    const fechaRaw = document.getElementById("publishFechaLimite").value;
    const fechaLimite = fechaRaw ? new Date(fechaRaw) : null;
    const estado = document.getElementById("publishEstado").value;

    msg.textContent = "Guardando… ⏳";
    try {
      const batch = fbDb.batch();
      villasElegidas.forEach(slug => {
        const ref = fbDb.collection("retos").doc(slug);
        batch.set(ref, {
          retoId: c.retoId, numero: c.numero, titulo: c.titulo, objetivo: c.objetivo,
          criterio: c.criterio, entregables: c.entregables,
          fechaLimite,
          estado,
          publishedAt: firebase.firestore.FieldValue.serverTimestamp(),
          publishedBy: fbAuth.currentUser.uid,
        }, { merge: true });
      });
      await batch.commit();
      msg.textContent = `✅ Guardado para ${villasElegidas.length} villa(s).`;
    } catch (err) {
      console.error(err);
      msg.textContent = "❌ " + err.message;
    }
  });
}

function watchRetosAdmin() {
  VILLAS.forEach(v => {
    retosAdminUnsub[v.slug] = fbDb.collection("retos").doc(v.slug).onSnapshot(
      snap => {
        retosAdminCache[v.slug] = snap.exists ? snap.data() : null;
        try { renderRetosStatusList(); } catch (err) { console.error("Error en estado de retos:", err); }
      },
      err => console.error(`Retos admin error (${v.slug}):`, err)
    );
  });
}

function renderRetosStatusList() {
  const wrap = document.getElementById("retosStatusList");
  if (!wrap) return;
  wrap.innerHTML = VILLAS.map(v => {
    const r = retosAdminCache[v.slug];
    const estadoLabel = !r ? "— Sin configurar —" : r.estado === "disponible" ? "✅ Disponible" : r.estado === "completado" ? "🏁 Completado" : "🔒 Bloqueado";
    const fecha = r?.fechaLimite ? (r.fechaLimite.toDate ? r.fechaLimite.toDate() : new Date(r.fechaLimite)).toLocaleString("es-DO", { day:"numeric", month:"short", hour:"2-digit", minute:"2-digit" }) : "sin fecha";
    return `
      <div class="admin-user-card reto-status-row">
        <div class="admin-user-info">
          <strong>${v.icon} ${v.name}</strong>
          <span>${estadoLabel}${r ? ` · Reto ${r.numero ?? "?"}: ${escAdmin(r.titulo || "")} · ${fecha}` : ""}</span>
        </div>
      </div>`;
  }).join("");
}

/* ── Ajustar puntos (bonus / penalizaciones) ─────────────────────────── */
let villaPuntosAjustesCache = [];

function initAjustesForm() {
  const form = document.getElementById("ajustarPuntosForm");
  if (!form) return;

  const villaSel = document.getElementById("ajusteVilla");
  villaSel.innerHTML = VILLAS.map(v => `<option value="${v.slug}">${v.icon} ${v.name}</option>`).join("");

  const motivoSel = document.getElementById("ajusteMotivoPreset");
  const PRESETS = {
    "": { motivo: "", puntos: "" },
    "espiritu": { motivo: "Espíritu de equipo", puntos: 50 },
    "fairplay": { motivo: "Fair Play", puntos: 50 },
    "salida": { motivo: "Salió antes de la señal de inicio", puntos: -5 },
    "ayuda": { motivo: "Recibió ayuda externa durante un reto", puntos: -10 },
    "turnos": { motivo: "No respetó instrucciones o turnos", puntos: -10 },
    "interferir": { motivo: "Interferir intencionalmente con otro equipo", puntos: -20 },
    "antideportiva": { motivo: "Conducta antideportiva o falta de respeto", puntos: -20 },
  };
  motivoSel.addEventListener("change", () => {
    const p = PRESETS[motivoSel.value];
    if (p) {
      document.getElementById("ajusteMotivo").value = p.motivo;
      document.getElementById("ajustePuntos").value = p.puntos;
    }
  });

  form.addEventListener("submit", async e => {
    e.preventDefault();
    const msg = document.getElementById("ajustarPuntosMsg");
    const villa = villaSel.value;
    const motivo = document.getElementById("ajusteMotivo").value.trim();
    const puntos = Number(document.getElementById("ajustePuntos").value);
    if (!motivo) { msg.textContent = "Escribe un motivo."; return; }
    if (!Number.isFinite(puntos) || puntos === 0) { msg.textContent = "Escribe un puntaje distinto de 0 (puede ser negativo)."; return; }

    msg.textContent = "Aplicando… ⏳";
    try {
      const ajusteRef = fbDb.collection("villaPuntosAjustes").doc();
      const villaPtsRef = fbDb.collection("villaPuntos").doc(villa);
      await fbDb.runTransaction(async tx => {
        const snap = await tx.get(villaPtsRef);
        const prevTotal = snap.exists ? (snap.data().total || 0) : 0;
        tx.set(ajusteRef, {
          villa, motivo, puntos,
          creadoPor: fbAuth.currentUser.uid,
          creadoEn: firebase.firestore.FieldValue.serverTimestamp(),
        });
        tx.set(villaPtsRef, { total: prevTotal + puntos, updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
      });
      msg.textContent = "✅ Ajuste aplicado.";
      document.getElementById("ajusteMotivo").value = "";
      document.getElementById("ajustePuntos").value = "";
      motivoSel.value = "";
    } catch (err) {
      console.error(err);
      msg.textContent = "❌ " + err.message;
    }
  });
}

function watchAjustes() {
  fbDb.collection("villaPuntosAjustes").orderBy("creadoEn", "desc").limit(50).onSnapshot(
    snap => {
      villaPuntosAjustesCache = [];
      snap.forEach(doc => villaPuntosAjustesCache.push({ id: doc.id, ...doc.data() }));
      try { renderAjustesList(); } catch (err) { console.error("Error en ajustes:", err); }
    },
    err => console.error("Ajustes error:", err)
  );
}

function renderAjustesList() {
  const wrap = document.getElementById("ajustesList");
  if (!wrap) return;
  if (!villaPuntosAjustesCache.length) { wrap.innerHTML = `<p class="admin-empty">— Todavía no hay ajustes aplicados —</p>`; return; }
  wrap.innerHTML = villaPuntosAjustesCache.map(a => {
    const villa = VILLAS.find(v => v.slug === a.villa);
    const d = a.creadoEn?.toDate ? a.creadoEn.toDate() : null;
    const fecha = d ? d.toLocaleString("es-DO", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "";
    return `
      <div class="admin-user-card">
        <div class="admin-user-info">
          <strong>${villa ? villa.icon + " " + villa.name : a.villa}</strong>
          <span>${escAdmin(a.motivo)}</span>
          <span class="admin-user-email">${fecha}</span>
        </div>
        <span class="reto-status-badge ${a.puntos > 0 ? "open" : "locked"}">${a.puntos > 0 ? "+" : ""}${a.puntos} pts</span>
      </div>`;
  }).join("");
}

/* ── Evidencias ──────────────────────────────────────────────────────── */
const EVID_ESTADOS = {
  pendiente: "⏳ Pendiente de validación",
  correccion: "✏️ Corrección solicitada",
  aprobado: "✅ Aprobado",
};
let evidenciasAll = [];

function initEvidenciaFilters() {
  const villaSel  = document.getElementById("evidFiltroVilla");
  const estadoSel = document.getElementById("evidFiltroEstado");
  if (!villaSel || !estadoSel) return;
  [villaSel, estadoSel].forEach(sel => sel.addEventListener("change", () => renderEvidenciasList(evidenciasAll)));
}

function watchEvidencias() {
  evidenciasUnsub = fbDb.collection("retoEvidencias").orderBy("createdAt", "desc").onSnapshot(
    snap => {
      evidenciasAll = [];
      snap.forEach(doc => evidenciasAll.push({ id: doc.id, ...doc.data() }));
      document.getElementById("tabCountEvid").textContent = evidenciasAll.length;
      try { renderEvidenciasList(evidenciasAll); } catch (err) { console.error("Error en Evidencias:", err); }
    },
    err => console.error("Evidencias error:", err)
  );
}

function fechaEnvioLabel(ev) {
  const d = ev.createdAt?.toDate ? ev.createdAt.toDate() : (ev.createdAt ? new Date(ev.createdAt) : null);
  return d ? d.toLocaleString("es-DO", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";
}

function historialHtml(ev) {
  if (!ev.historial || !ev.historial.length) return "";
  const items = ev.historial.slice().reverse().map(h => {
    const d = h.en?.toDate ? h.en.toDate() : (h.en ? new Date(h.en) : null);
    const fecha = d ? d.toLocaleString("es-DO", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "";
    return `<div class="evidencia-historial-item">${fecha} — ${escAdmin(h.accion)}${h.comentario ? `: "${escAdmin(h.comentario)}"` : ""}</div>`;
  }).join("");
  return `<details class="evidencia-historial"><summary>Historial (${ev.historial.length})</summary>${items}</details>`;
}

function renderEvidenciasList(list) {
  const wrap = document.getElementById("evidenciasList");
  if (!wrap) return;

  const villaFiltro  = document.getElementById("evidFiltroVilla")?.value || "";
  const estadoFiltro = document.getElementById("evidFiltroEstado")?.value || "";
  const filtered = list.filter(ev =>
    (!villaFiltro || ev.villa === villaFiltro) && (!estadoFiltro || ev.estado === estadoFiltro)
  );

  if (!filtered.length) { wrap.innerHTML = `<p class="admin-empty">— No hay entregas con ese filtro —</p>`; return; }

  wrap.innerHTML = filtered.map(ev => {
    const villa = VILLAS.find(v => v.slug === ev.villa);
    return `
      <div class="admin-user-card evidencia-card">
        <div class="admin-user-info">
          <strong>${villa ? villa.icon + " " + villa.name : ev.villa}</strong>
          <span>Capitán: ${escAdmin(ev.nombreUsuario || "")}</span>
          <span>Equipo: ${escAdmin(ev.nombreEquipo)} — "${escAdmin(ev.eslogan)}"</span>
          <span class="admin-user-email">Enviado: ${fechaEnvioLabel(ev)}${ev.tardia ? '<span class="evidencia-badge-tardia">Tardía</span>' : ""}</span>
          ${ev.fotoUrl ? `<img src="${ev.fotoUrl}" alt="Foto del equipo" class="evidencia-photo-thumb" onclick="window.open('${ev.fotoUrl}','_blank')" />` : ""}
          <span class="reto-status-badge ${ev.estado === 'aprobado' ? 'open' : ev.estado === 'correccion' ? 'done' : 'locked'}">${EVID_ESTADOS[ev.estado] || ev.estado}</span>
          ${ev.comentarioAdmin ? `<p class="reto-admin-comment">💬 ${escAdmin(ev.comentarioAdmin)}</p>` : ""}
          ${historialHtml(ev)}
        </div>
        <textarea class="textarea-input" id="evidComentario-${ev.id}" rows="2" placeholder="Comentario (obligatorio para corregir o revocar)"></textarea>
        <input class="input-inline" type="number" id="evidPuntos-${ev.id}" placeholder="Puntos a otorgar a esta villa" value="${ev.estado === 'aprobado' ? ev.puntosOtorgados : ''}" />
        <div class="evidencia-actions">
          <button class="btn-admin-sm" data-action="aprobar" data-id="${ev.id}" data-villa="${ev.villa}" data-reto="${ev.retoId}" ${ev.estado === 'aprobado' ? "disabled" : ""}>✅ Aprobar</button>
          <button class="btn-admin-sm" data-action="corregir" data-id="${ev.id}" data-villa="${ev.villa}" data-reto="${ev.retoId}" ${ev.estado !== 'pendiente' ? "disabled" : ""}>✏️ Solicitar corrección</button>
          <button class="btn-admin-sm danger" data-action="revocar" data-id="${ev.id}" data-villa="${ev.villa}" data-reto="${ev.retoId}" ${ev.estado !== 'aprobado' ? "disabled" : ""}>↩️ Revocar aprobación</button>
        </div>
      </div>`;
  }).join("");

  wrap.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener("click", () => reviewEvidencia(btn.dataset.action, btn));
  });
}

async function reviewEvidencia(action, btn) {
  const { villa, reto: retoId, id } = btn.dataset;
  const comentario = document.getElementById(`evidComentario-${id}`).value.trim();
  if ((action === "corregir" || action === "revocar") && !comentario) {
    alert("Escribe un comentario — es obligatorio para esta acción.");
    return;
  }
  let puntos;
  if (action === "aprobar") {
    puntos = Number(document.getElementById(`evidPuntos-${id}`).value);
    if (!Number.isFinite(puntos) || puntos < 0) {
      alert("Escribe el puntaje que le corresponde a esta villa (0 o más) antes de aprobar.");
      return;
    }
  }
  btn.disabled = true;
  const original = btn.textContent;
  btn.textContent = "…";
  try {
    await JunteAuth.callFunction("review-evidencia", { method: "POST", body: { villa, retoId, action, comentario, puntos } });
    btn.textContent = "✅ Listo";
    setTimeout(() => { btn.textContent = original; }, 1500);
  } catch (err) {
    alert("Error: " + err.message);
    btn.textContent = original;
    btn.disabled = false;
  }
}
