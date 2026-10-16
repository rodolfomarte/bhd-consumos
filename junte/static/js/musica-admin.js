/* ════════════════════════════════════════════════════════════════════════
   musica-admin.js — panel "🎵 Gestión musical" dentro de /admin. Lo usan
   tanto el admin real como el "encargado de música" (custom claim
   encargadoMusica) — la protección real vive en firestore.rules, esto solo
   refleja lo que cada quien puede hacer. Variables como fbDb, escAdmin,
   approvedUsersCache y VILLAS vienen de admin.js, que se carga antes.
   ════════════════════════════════════════════════════════════════════════ */
let musicaCancionesCache = {}; // id -> datos
let musicaVotosCache     = {}; // voteId -> { cancionId, uid, familia }
let musicaHistorialCache = [];
let musicaCancionesUnsub = null, musicaVotosUnsub = null, musicaConfigUnsubAdmin = null, musicaHistorialUnsub = null;
let musicaManagerUnsub   = null, musicaManagerCache = null;
const MUSICA_GENEROS = { merengue: "Merengue", bachata: "Bachata", salsa: "Salsa", tipico: "Típico", dembow: "Dembow", regueton: "Reguetón", otro: "Otro" };
const MUSICA_ESTADO_LABEL = { activa: "🗳️ Solicitada", "en-cola": "📻 En cola", sonando: "🔊 Sonando ahora", reproducida: "✅ Reproducida" };

function initMusicaAdmin() {
  initMusicaTabs();
  initMusicaAgregarForm();
  initMusicaFiltros();
  initMusicaPausas();
  initMusicaFusion();
  initMusicaExportar();
  watchMusicaAdminData();
}

function teardownMusicaAdmin() {
  if (musicaCancionesUnsub) { musicaCancionesUnsub(); musicaCancionesUnsub = null; }
  if (musicaVotosUnsub) { musicaVotosUnsub(); musicaVotosUnsub = null; }
  if (musicaConfigUnsubAdmin) { musicaConfigUnsubAdmin(); musicaConfigUnsubAdmin = null; }
  if (musicaHistorialUnsub) { musicaHistorialUnsub(); musicaHistorialUnsub = null; }
  if (musicaManagerUnsub) { musicaManagerUnsub(); musicaManagerUnsub = null; }
}

function initMusicaTabs() {
  const panels = ["musicaPanel-propuestas", "musicaPanel-cola", "musicaPanel-encargado", "musicaPanel-ajustes"];
  document.querySelectorAll("#musicaAdminTabs .admin-tab").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#musicaAdminTabs .admin-tab").forEach(b => b.classList.remove("active"));
      panels.forEach(id => document.getElementById(id)?.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById(`musicaPanel-${btn.dataset.musictab}`)?.classList.add("active");
    });
  });
}

/* ══════════════════ DATOS EN VIVO ═══════════════════════════════════════ */
function watchMusicaAdminData() {
  if (typeof fbDb === "undefined") return;

  musicaCancionesUnsub = fbDb.collection("cancionesPedidas").onSnapshot(
    snap => {
      musicaCancionesCache = {};
      snap.forEach(doc => { musicaCancionesCache[doc.id] = doc.data(); });
      try { renderMusicaPropuestas(); renderMusicaCola(); renderMusicaResumen(); } catch (err) { console.error("Error en propuestas:", err); }
    },
    err => console.error("Canciones (admin) error:", err)
  );

  musicaVotosUnsub = fbDb.collection("cancionVotos").onSnapshot(
    snap => {
      musicaVotosCache = {};
      snap.forEach(doc => { musicaVotosCache[doc.id] = doc.data(); });
      try { renderMusicaPropuestas(); renderMusicaCola(); } catch (err) { console.error("Error en votos (admin):", err); }
    },
    err => console.error("Votos (admin) error:", err)
  );

  musicaConfigUnsubAdmin = fbDb.collection("config").doc("musica").onSnapshot(
    snap => {
      const data = snap.exists ? snap.data() : {};
      const p = document.getElementById("pausarPropuestas");
      const v = document.getElementById("pausarVotacion");
      if (p) p.checked = data.propuestasPausadas === true;
      if (v) v.checked = data.votacionPausada === true;
    },
    err => console.error("Config musica (admin) error:", err)
  );

  musicaHistorialUnsub = fbDb.collection("cancionModeracionLog").orderBy("creadoEn", "desc").limit(50).onSnapshot(
    snap => {
      musicaHistorialCache = [];
      snap.forEach(doc => musicaHistorialCache.push({ id: doc.id, ...doc.data() }));
      try { renderMusicaHistorial(); } catch (err) { console.error("Error en historial:", err); }
    },
    err => console.error("Historial musica error:", err)
  );

  musicaManagerUnsub = fbDb.collection("config").doc("musicManager").onSnapshot(
    snap => {
      musicaManagerCache = snap.exists ? snap.data() : null;
      try { renderMusicaEncargado(); } catch (err) { console.error("Error en encargado:", err); }
    },
    err => console.error("Encargado musica error:", err)
  );
}

function votosDe(cancionId) {
  let votos = 0;
  const familias = new Set();
  Object.values(musicaVotosCache).forEach(v => {
    if (v.cancionId !== cancionId) return;
    votos++;
    if (v.familia) familias.add(v.familia);
  });
  return { votos, familias: familias.size };
}

/* ══════════════════ RESUMEN ═══════════════════════════════════════════ */
function renderMusicaResumen() {
  const el = document.getElementById("musicaResumen");
  const count = document.getElementById("tabCountMusicaProp");
  if (!el) return;
  const all = Object.values(musicaCancionesCache);
  const n = estado => all.filter(c => c.estado === estado).length;
  el.textContent = `${all.length} propuestas · ${n("activa")} solicitadas · ${n("en-cola") + n("sonando")} en cola · ${n("reproducida")} reproducidas`;
  if (count) count.textContent = String(all.length);
}

/* ══════════════════ LISTA DE PROPUESTAS (moderación) ═══════════════════ */
function initMusicaFiltros() {
  const g = document.getElementById("musicaFiltroGenero");
  const e = document.getElementById("musicaFiltroEstado");
  [g, e].forEach(sel => sel && sel.addEventListener("change", () => { try { renderMusicaPropuestas(); } catch (err) { console.error(err); } }));
}

function renderMusicaPropuestas() {
  const wrap = document.getElementById("musicaPropuestasList");
  if (!wrap) return;
  const fGenero = document.getElementById("musicaFiltroGenero")?.value || "";
  const fEstado = document.getElementById("musicaFiltroEstado")?.value || "";

  let items = Object.entries(musicaCancionesCache).map(([id, c]) => ({ id, ...c, ...votosDe(id) }));
  if (fGenero) items = items.filter(c => c.generoSlug === fGenero);
  if (fEstado) items = items.filter(c => c.estado === fEstado);
  items.sort((a, b) => (b.creadoEn?.toMillis?.() || 0) - (a.creadoEn?.toMillis?.() || 0));

  if (!items.length) { wrap.innerHTML = `<p class="admin-empty">— No hay propuestas con ese filtro —</p>`; return; }

  wrap.innerHTML = items.map(c => `
    <div class="admin-user-card">
      <div class="admin-user-info">
        <strong>${escAdmin(c.titulo)}</strong> — ${escAdmin(c.artista)}
        <span class="reto-status-badge ${c.estado === "reproducida" ? "done" : c.estado === "activa" ? "open" : "locked"}">${MUSICA_ESTADO_LABEL[c.estado] || c.estado}</span>
        ${c.ocultaInapropiado ? `<span class="reto-status-badge locked">🙈 Oculta</span>` : ""}
        <br /><span class="account-hint">${MUSICA_GENEROS[c.generoSlug] || c.generoSlug} · ${escAdmin(c.familia)} · ${c.votos} voto(s), ${c.familias} familia(s) · ID: <code>${c.id}</code></span>
      </div>
      <div class="capitan-card-actions">
        <select class="select-input" data-estado-sel="${c.id}" style="width:auto">
          <option value="activa" ${c.estado === "activa" ? "selected" : ""}>🗳️ Solicitada</option>
          <option value="en-cola" ${c.estado === "en-cola" ? "selected" : ""}>📻 En cola</option>
          <option value="sonando" ${c.estado === "sonando" ? "selected" : ""}>🔊 Sonando</option>
          <option value="reproducida" ${c.estado === "reproducida" ? "selected" : ""}>✅ Reproducida</option>
        </select>
        <button class="btn-admin-sm" data-action="guardar-estado" data-id="${c.id}">Guardar</button>
        <button class="btn-admin-sm" data-action="ocultar" data-id="${c.id}">${c.ocultaInapropiado ? "👁️ Mostrar" : "🙈 Ocultar"}</button>
        <button class="btn-admin-sm danger" data-action="borrar-cancion" data-id="${c.id}">🗑️ Borrar</button>
      </div>
    </div>`).join("");

  wrap.querySelectorAll('[data-action="guardar-estado"]').forEach(btn => btn.addEventListener("click", () => guardarEstadoCancion(btn.dataset.id)));
  wrap.querySelectorAll('[data-action="ocultar"]').forEach(btn => btn.addEventListener("click", () => toggleOcultarCancion(btn.dataset.id)));
  wrap.querySelectorAll('[data-action="borrar-cancion"]').forEach(btn => btn.addEventListener("click", () => borrarCancion(btn.dataset.id)));
}

/* Única fuente de verdad de "qué está sonando ahora" — config/cancionSonando.
   Esto se escribe SIEMPRE dentro de una transacción de Firestore: la
   transacción lee ese singleton, degrada a "en-cola" lo que haya ahí (si
   todavía dice "sonando" — puede que ya lo hayan cambiado a mano), promueve
   la nueva y actualiza el singleton, todo en una sola operación atómica.
   Si dos administradores aprietan "Sonando" en canciones distintas casi al
   mismo tiempo, Firestore detecta que la segunda transacción leyó un dato
   que ya cambió y la reintenta automáticamente sobre el resultado real de
   la primera — nunca quedan dos canciones "sonando" a la vez. */
async function marcarSonandoAtomico(nuevoId) {
  const sonandoRef = fbDb.collection("config").doc("cancionSonando");
  const nuevoRef = fbDb.collection("cancionesPedidas").doc(nuevoId);
  await fbDb.runTransaction(async tx => {
    const [sonandoSnap, nuevoSnap] = await Promise.all([tx.get(sonandoRef), tx.get(nuevoRef)]);
    if (!nuevoSnap.exists) throw new Error("Esa canción ya no existe.");

    const anteriorId = sonandoSnap.exists ? sonandoSnap.data().cancionId : null;
    if (anteriorId && anteriorId !== nuevoId) {
      const anteriorRef = fbDb.collection("cancionesPedidas").doc(anteriorId);
      const anteriorSnap = await tx.get(anteriorRef);
      if (anteriorSnap.exists && anteriorSnap.data().estado === "sonando") {
        tx.update(anteriorRef, { estado: "en-cola" });
      }
    }

    tx.update(nuevoRef, { estado: "sonando" });
    tx.set(sonandoRef, {
      cancionId: nuevoId,
      actualizadoEn: firebase.firestore.FieldValue.serverTimestamp(),
      actualizadoPor: fbAuth.currentUser.uid,
    });
  });
}

async function guardarEstadoCancion(id) {
  const sel = document.querySelector(`[data-estado-sel="${id}"]`);
  if (!sel) return;
  const nuevoEstado = sel.value;
  const actual = musicaCancionesCache[id];
  try {
    if (nuevoEstado === "sonando") {
      await marcarSonandoAtomico(id);
    } else {
      await fbDb.collection("cancionesPedidas").doc(id).update({ estado: nuevoEstado });
    }
    await logMusicaAccion("cambiar-estado", id, actual?.titulo, `${actual?.estado} → ${nuevoEstado}`);
  } catch (err) {
    alert("Error: " + err.message);
  }
}

async function toggleOcultarCancion(id) {
  const actual = musicaCancionesCache[id];
  if (!actual) return;
  try {
    await fbDb.collection("cancionesPedidas").doc(id).update({ ocultaInapropiado: !actual.ocultaInapropiado });
    await logMusicaAccion(actual.ocultaInapropiado ? "mostrar" : "ocultar", id, actual.titulo, "");
  } catch (err) {
    alert("Error: " + err.message);
  }
}

async function borrarCancion(id) {
  const actual = musicaCancionesCache[id];
  if (!confirm(`¿Borrar "${actual?.titulo || id}" de la lista? Esto no se puede deshacer.`)) return;
  try {
    await fbDb.collection("cancionesPedidas").doc(id).delete();
    await logMusicaAccion("borrar", id, actual?.titulo, "");
  } catch (err) {
    alert("Error: " + err.message);
  }
}

/* ══════════════════ COLA ═══════════════════════════════════════════════ */
function renderMusicaCola() {
  const wrap = document.getElementById("musicaColaList");
  if (!wrap) return;
  const items = Object.entries(musicaCancionesCache)
    .filter(([, c]) => c.estado === "en-cola" || c.estado === "sonando")
    .map(([id, c]) => ({ id, ...c }))
    .sort((a, b) => (a.ordenCola || 0) - (b.ordenCola || 0));

  if (!items.length) { wrap.innerHTML = `<p class="admin-empty">— La cola está vacía —</p>`; return; }

  wrap.innerHTML = items.map(c => `
    <div class="admin-user-card">
      <div class="admin-user-info">
        <strong>${escAdmin(c.titulo)}</strong> — ${escAdmin(c.artista)}
        ${c.estado === "sonando" ? `<span class="reto-status-badge open">🔊 Sonando</span>` : ""}
      </div>
      <div class="capitan-card-actions">
        <input type="number" class="input-inline" data-orden-id="${c.id}" value="${c.ordenCola || 0}" style="width:70px" />
        <button class="btn-admin-sm" data-action="guardar-orden" data-id="${c.id}">Guardar orden</button>
        ${c.estado !== "sonando" ? `<button class="btn-admin-sm" data-action="marcar-sonando" data-id="${c.id}">🔊 Sonando</button>` : ""}
        <button class="btn-admin-sm" data-action="marcar-reproducida" data-id="${c.id}">✅ Reproducida</button>
      </div>
    </div>`).join("");

  wrap.querySelectorAll('[data-action="guardar-orden"]').forEach(btn => btn.addEventListener("click", async () => {
    const input = document.querySelector(`[data-orden-id="${btn.dataset.id}"]`);
    try { await fbDb.collection("cancionesPedidas").doc(btn.dataset.id).update({ ordenCola: Number(input.value) || 0 }); }
    catch (err) { alert("Error: " + err.message); }
  }));
  wrap.querySelectorAll('[data-action="marcar-sonando"]').forEach(btn => btn.addEventListener("click", async () => {
    try {
      await marcarSonandoAtomico(btn.dataset.id);
      await logMusicaAccion("marcar-sonando", btn.dataset.id, musicaCancionesCache[btn.dataset.id]?.titulo, "");
    } catch (err) { alert("Error: " + err.message); }
  }));
  wrap.querySelectorAll('[data-action="marcar-reproducida"]').forEach(btn => btn.addEventListener("click", async () => {
    try {
      await fbDb.collection("cancionesPedidas").doc(btn.dataset.id).update({ estado: "reproducida" });
      await logMusicaAccion("marcar-reproducida", btn.dataset.id, musicaCancionesCache[btn.dataset.id]?.titulo, "");
    } catch (err) { alert("Error: " + err.message); }
  }));
}

/* ══════════════════ AGREGAR DIRECTO ═══════════════════════════════════ */
function initMusicaAgregarForm() {
  const form = document.getElementById("musicaAgregarForm");
  if (!form) return;
  form.addEventListener("submit", async e => {
    e.preventDefault();
    const msg = document.getElementById("musicaAgregarMsg");
    const titulo = document.getElementById("magTitulo").value.trim();
    const artista = document.getElementById("magArtista").value.trim();
    const generoSlug = document.getElementById("magGenero").value;
    const spotifyUrl = document.getElementById("magSpotify").value.trim();
    const estado = document.getElementById("magEstado").value;
    if (!titulo || !artista || !generoSlug) { msg.textContent = "Completa canción, artista y género."; return; }

    const id = JunteAuth.slugify(`${titulo}-${artista}`) || `cancion-${Date.now()}`;
    try {
      await fbDb.collection("cancionesPedidas").doc(id).set({
        titulo, artista, generoSlug, spotifyUrl, dedicatoria: "",
        familia: "organizacion", nombre: "Organización", uid: fbAuth.currentUser.uid,
        estado, ocultaInapropiado: false, etiquetaContenido: "", ordenCola: 0,
        creadoEn: firebase.firestore.FieldValue.serverTimestamp(),
      });
      await logMusicaAccion("agregar-directo", id, titulo, "");
      msg.textContent = "✅ Agregada.";
      form.reset();
    } catch (err) {
      msg.textContent = "❌ " + err.message;
    }
  });
}

/* ══════════════════ PAUSAS ═══════════════════════════════════════════ */
function initMusicaPausas() {
  const p = document.getElementById("pausarPropuestas");
  const v = document.getElementById("pausarVotacion");
  const msg = document.getElementById("musicaPausasMsg");
  async function guardar() {
    try {
      await fbDb.collection("config").doc("musica").set({
        propuestasPausadas: p.checked, votacionPausada: v.checked,
      }, { merge: true });
      msg.textContent = "✅ Guardado.";
    } catch (err) {
      msg.textContent = "❌ " + err.message;
    }
  }
  if (p) p.addEventListener("change", guardar);
  if (v) v.addEventListener("change", guardar);
}

/* ══════════════════ FUSIONAR DUPLICADOS ═══════════════════════════════ */
function initMusicaFusion() {
  const btn = document.getElementById("btnFusionar");
  if (!btn) return;
  btn.addEventListener("click", async () => {
    const msg = document.getElementById("fusionMsg");
    const conservarId = document.getElementById("fusionConservar").value.trim();
    const borrarId = document.getElementById("fusionBorrar").value.trim();
    if (!conservarId || !borrarId || conservarId === borrarId) { msg.textContent = "Escribe dos IDs distintos."; return; }
    if (!musicaCancionesCache[conservarId] || !musicaCancionesCache[borrarId]) { msg.textContent = "No encuentro una de esas dos canciones (revisa el ID en la lista de propuestas)."; return; }

    msg.textContent = "Fusionando… ⏳";
    try {
      // Votos de la canción que desaparece: se mueven a la que se conserva,
      // pero nunca duplicando un voto de la misma persona (máximo uno).
      const votosABorrar = Object.entries(musicaVotosCache).filter(([, v]) => v.cancionId === borrarId);
      for (const [voteId, v] of votosABorrar) {
        const nuevoVoteId = `${conservarId}_${v.uid}`;
        if (!musicaVotosCache[nuevoVoteId]) {
          await fbDb.collection("cancionVotos").doc(nuevoVoteId).set({ cancionId: conservarId, uid: v.uid, familia: v.familia, creadoEn: v.creadoEn || firebase.firestore.FieldValue.serverTimestamp() });
        }
        await fbDb.collection("cancionVotos").doc(voteId).delete();
      }
      const tituloBorrada = musicaCancionesCache[borrarId]?.titulo;
      await fbDb.collection("cancionesPedidas").doc(borrarId).delete();
      await logMusicaAccion("fusionar", conservarId, musicaCancionesCache[conservarId]?.titulo, `se fusionó con "${tituloBorrada}" (${borrarId})`);
      msg.textContent = "✅ Fusionadas.";
      document.getElementById("fusionConservar").value = "";
      document.getElementById("fusionBorrar").value = "";
    } catch (err) {
      msg.textContent = "❌ " + err.message;
    }
  });
}

/* ══════════════════ EXPORTAR CSV ═══════════════════════════════════════ */
/* Función pura (sin tocar el DOM) para poder probarla directo: cada campo
   siempre va entre comillas y las comillas internas se duplican (RFC 4180)
   — así una coma o una comilla dentro de un título nunca rompe una columna,
   y los acentos viajan tal cual porque el archivo se declara UTF-8. */
function buildMusicaCsv(cancionesCache, votosCache) {
  const rows = [["id", "titulo", "artista", "genero", "familia", "estado", "votos", "familias_distintas", "spotifyUrl"]];
  Object.entries(cancionesCache).forEach(([id, c]) => {
    let votos = 0;
    const familias = new Set();
    Object.values(votosCache).forEach(v => {
      if (v.cancionId !== id) return;
      votos++;
      if (v.familia) familias.add(v.familia);
    });
    rows.push([id, c.titulo, c.artista, c.generoSlug, c.familia, c.estado, votos, familias.size, c.spotifyUrl || ""]);
  });
  return rows.map(r => r.map(v => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
}

function initMusicaExportar() {
  const btn = document.getElementById("btnExportarCsv");
  if (!btn) return;
  btn.addEventListener("click", () => {
    const csv = buildMusicaCsv(musicaCancionesCache, musicaVotosCache);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `pide-tu-cancion-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  });
}

/* ══════════════════ HISTORIAL ═══════════════════════════════════════════ */
function logMusicaAccion(accion, cancionId, titulo, detalle) {
  return fbDb.collection("cancionModeracionLog").add({
    accion, cancionId: cancionId || "", titulo: titulo || "", detalle: detalle || "",
    uid: fbAuth.currentUser.uid, creadoEn: firebase.firestore.FieldValue.serverTimestamp(),
  }).catch(err => console.error("No se pudo registrar en el historial:", err));
}

function renderMusicaHistorial() {
  const wrap = document.getElementById("musicaHistorialList");
  if (!wrap) return;
  if (!musicaHistorialCache.length) { wrap.innerHTML = `<p class="admin-empty">— Sin acciones todavía —</p>`; return; }
  wrap.innerHTML = musicaHistorialCache.map(h => {
    const d = h.creadoEn?.toDate ? h.creadoEn.toDate() : null;
    const fecha = d ? d.toLocaleString("es-DO", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "";
    return `<div class="admin-user-card"><div class="admin-user-info"><strong>${escAdmin(h.accion)}</strong> — ${escAdmin(h.titulo)} <span class="account-hint">${fecha}${h.detalle ? " · " + escAdmin(h.detalle) : ""}</span></div></div>`;
  }).join("");
}

/* ══════════════════ ENCARGADO DE MÚSICA ═══════════════════════════════ */
function renderMusicaEncargado() {
  const actual = document.getElementById("encargadoActual");
  const sel = document.getElementById("encargadoSelect");
  if (!actual || !sel) return;
  actual.textContent = musicaManagerCache ? `🎧 ${musicaManagerCache.nombre}` : "— Sin encargado asignado —";
  sel.innerHTML = approvedUsersCache.map(u =>
    `<option value="${u.uid}" ${musicaManagerCache?.uid === u.uid ? "selected" : ""}>${escAdmin(u.nombre)} (${escAdmin(u.familiaLabel || u.familia)})</option>`
  ).join("") || `<option value="">— No hay aprobados —</option>`;
}

document.addEventListener("DOMContentLoaded", () => {
  const btnAsignar = document.getElementById("btnAsignarEncargado");
  const btnRetirar = document.getElementById("btnRetirarEncargado");
  if (btnAsignar) btnAsignar.addEventListener("click", async () => {
    const msg = document.getElementById("encargadoMsg");
    const uid = document.getElementById("encargadoSelect").value;
    if (!uid) { msg.textContent = "Elige una persona aprobada."; return; }
    btnAsignar.disabled = true;
    try {
      await JunteAuth.callFunction("set-music-manager", { method: "POST", body: { uid } });
      msg.textContent = "✅ Asignado.";
    } catch (err) {
      msg.textContent = "❌ " + err.message;
    } finally {
      btnAsignar.disabled = false;
    }
  });
  if (btnRetirar) btnRetirar.addEventListener("click", async () => {
    if (!confirm("¿Retirar al encargado de música actual?")) return;
    const msg = document.getElementById("encargadoMsg");
    btnRetirar.disabled = true;
    try {
      await JunteAuth.callFunction("set-music-manager", { method: "POST", body: { uid: null } });
      msg.textContent = "✅ Retirado.";
    } catch (err) {
      msg.textContent = "❌ " + err.message;
    } finally {
      btnRetirar.disabled = false;
    }
  });
});
