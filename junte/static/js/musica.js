/* ════════════════════════════════════════════════════════════════════════
   musica.js — "Pide tu canción": cualquier aprobado propone y vota, el
   admin/encargado modera y arma la cola. Los conteos de voto y de familias
   SIEMPRE se calculan a partir de los documentos reales de cancionVotos —
   nunca de un contador que el cliente pudiera falsear — igual que la tabla
   de puntos de Retos. El bloqueo real vive en firestore.rules; este
   archivo es solo la UI que lo refleja.
   ════════════════════════════════════════════════════════════════════════ */
const GENEROS = {
  merengue: "Merengue", bachata: "Bachata", salsa: "Salsa",
  tipico: "Típico", dembow: "Dembow", regueton: "Reguetón", otro: "Otro",
};

const ESTADO_LABEL = {
  activa: "🗳️ Solicitada", "en-cola": "📻 En cola",
  sonando: "🔊 Sonando ahora", reproducida: "✅ Reproducida",
};

let authState       = { loading: true };
let cancionesCache  = {}; // id -> datos del doc
let votosCache      = {}; // voteId -> { cancionId, uid, familia }
let currentVista    = "top";
let currentGenero   = "";
let currentBusqueda  = "";
let cancionesUnsub  = null;
let votosUnsub      = null;
let musicaConfig    = {}; // { propuestasPausadas, votacionPausada }
let configUnsub     = null;

const FAMILIA_INDEX = {}; // familiaSlug -> { label, villa, icon }
(function buildFamiliaIndex() {
  if (typeof FAMILIES_ROSTER === "undefined" || typeof JunteAuth === "undefined") return;
  FAMILIES_ROSTER.forEach(v => {
    v.familias.forEach(f => {
      FAMILIA_INDEX[JunteAuth.slugify(f.nombre)] = { label: f.nombre, villa: v.name, icon: v.icon };
    });
  });
})();

document.addEventListener("DOMContentLoaded", () => {
  const steps = [
    ["formulario de propuesta", initProponerForm],
    ["filtros",                 initFiltros],
    ["vistas",                  initVistas],
  ];
  for (const [label, fn] of steps) {
    try { fn(); } catch (err) { console.error(`Error iniciando ${label}:`, err); }
  }

  JunteAuth.subscribe(state => {
    authState = state;
    try { renderGate(); } catch (err) { console.error("Error en gate de música:", err); }
    if (state.loading) return;
    if (state.isApproved || state.isAdmin) {
      if (!cancionesUnsub) watchCanciones();
      if (!votosUnsub) watchVotos();
      if (!configUnsub) watchMusicaConfig();
    }
  });
});

function watchMusicaConfig() {
  if (typeof fbDb === "undefined") return;
  configUnsub = fbDb.collection("config").doc("musica").onSnapshot(
    snap => {
      musicaConfig = snap.exists ? snap.data() : {};
      try { renderPausas(); } catch (err) { console.error("Error en pausas:", err); }
    },
    err => console.error("Config de música error:", err)
  );
}

function renderPausas() {
  const form = document.getElementById("proponerForm");
  const formMsg = document.getElementById("proponerPausadoMsg");
  if (form) {
    const submitBtn = form.querySelector("button[type=submit]");
    const pausado = musicaConfig.propuestasPausadas === true;
    if (submitBtn) submitBtn.disabled = pausado;
    if (formMsg) formMsg.textContent = pausado ? "⏸️ El encargado pausó las propuestas nuevas por ahora." : "";
  }
  try { renderLista(); } catch (err) { console.error("Error al refrescar por pausa:", err); }
}

/* ══════════════════ ACCESO ══════════════════════════════════════════════
   Visitantes y cuentas pendientes/rechazadas/suspendidas ven un mensaje
   claro en vez del módulo — la protección real está en firestore.rules. */
function renderGate() {
  const gateWrap = document.getElementById("musicaGateWrap");
  const content  = document.getElementById("musicaContent");
  if (!gateWrap || !content) return;
  if (authState.loading) { gateWrap.style.display = "none"; content.style.display = "none"; return; }

  const ok = authState.isAdmin || authState.isApproved;
  gateWrap.style.display = ok ? "none" : "block";
  content.style.display  = ok ? "block" : "none";
  if (ok) return;

  let title, msg;
  if (!authState.user) {
    title = "👪 Inicia sesión para pedir tu canción";
    msg = "Esta sección es solo para familias registradas y aprobadas del Junte.";
  } else if (authState.profile?.status === "pending") {
    title = "⏳ Pendiente de aprobación de Rodolfo";
    msg = "Tu cuenta está esperando revisión. En cuanto esté aprobada podrás proponer y votar canciones.";
  } else if (authState.profile?.status === "rejected") {
    title = "❌ Solicitud rechazada";
    msg = "Contacta al administrador del Junte si crees que es un error.";
  } else if (authState.profile?.status === "suspended") {
    title = "🚫 Cuenta suspendida";
    msg = "Tu acceso fue suspendido. Contacta al administrador del Junte.";
  } else {
    title = "👪 Sección exclusiva para familias";
    msg = "Inicia sesión con tu cuenta aprobada para continuar.";
  }
  gateWrap.innerHTML = `
    <div class="auth-gate-banner">
      <h3>${title}</h3>
      <p>${msg}</p>
      <a href="/cuenta" class="btn-primary" style="text-decoration:none;display:inline-block">Ir a Mi Cuenta</a>
    </div>`;
}

/* ══════════════════ DATOS EN VIVO ═══════════════════════════════════════
   Suscripciones acotadas (limit) para controlar lecturas/costos, como pide
   el proyecto — de sobra para un junte de 72 personas. */
function watchCanciones() {
  if (typeof fbDb === "undefined") return;
  const list = document.getElementById("cancionesList");
  if (list && !Object.keys(cancionesCache).length) list.innerHTML = `<p class="account-hint">Cargando canciones…</p>`;
  cancionesUnsub = fbDb.collection("cancionesPedidas").orderBy("creadoEn", "desc").limit(300).onSnapshot(
    snap => {
      cancionesCache = {};
      snap.forEach(doc => { cancionesCache[doc.id] = doc.data(); });
      try { renderLista(); } catch (err) { console.error("Error en lista de canciones:", err); }
    },
    err => {
      console.error("Canciones error:", err);
      if (list) list.innerHTML = `<p class="account-hint">No se pudo cargar la lista — intenta de nuevo en un momento.</p>`;
    }
  );
}

function watchVotos() {
  if (typeof fbDb === "undefined") return;
  votosUnsub = fbDb.collection("cancionVotos").limit(2000).onSnapshot(
    snap => {
      votosCache = {};
      snap.forEach(doc => { votosCache[doc.id] = doc.data(); });
      try { renderLista(); } catch (err) { console.error("Error en votos:", err); }
    },
    err => console.error("Votos error:", err)
  );
}

function statsFor(id) {
  let votos = 0;
  const familias = new Set();
  let yoVote = false;
  const myUid = authState.user?.uid;
  Object.values(votosCache).forEach(v => {
    if (v.cancionId !== id) return;
    votos++;
    if (v.familia) familias.add(v.familia);
    if (myUid && v.uid === myUid) yoVote = true;
  });
  return { votos, familias: familias.size, yoVote };
}

/* ══════════════════ FILTROS / ORDEN ═══════════════════════════════════ */
function normText(s) {
  return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function listaFiltrada() {
  const myUid = authState.user?.uid;
  const puedeModerar = authState.isAdmin || authState.encargadoMusica;

  let items = Object.entries(cancionesCache)
    .filter(([, c]) => puedeModerar || !c.ocultaInapropiado)
    .map(([id, c]) => ({ id, ...c, ...statsFor(id) }));

  if (currentVista === "mias") {
    items = items.filter(c => c.uid === myUid);
  } else if (currentVista === "cola") {
    items = items.filter(c => c.estado === "en-cola" || c.estado === "sonando");
  } else if (currentVista === "reproducidas") {
    items = items.filter(c => c.estado === "reproducida");
  } else {
    items = items.filter(c => c.estado !== "reproducida");
  }

  if (currentGenero) items = items.filter(c => c.generoSlug === currentGenero);

  if (currentBusqueda.trim()) {
    const q = normText(currentBusqueda);
    items = items.filter(c => normText(c.titulo).includes(q) || normText(c.artista).includes(q));
  }

  if (currentVista === "recientes") {
    items.sort((a, b) => (b.creadoEn?.toMillis?.() || 0) - (a.creadoEn?.toMillis?.() || 0));
  } else if (currentVista === "cola") {
    items.sort((a, b) => (a.ordenCola || 0) - (b.ordenCola || 0));
  } else {
    items.sort((a, b) =>
      b.votos - a.votos ||
      b.familias - a.familias ||
      (a.creadoEn?.toMillis?.() || 0) - (b.creadoEn?.toMillis?.() || 0)
    );
  }

  return items;
}

/* ══════════════════ RENDER ══════════════════════════════════════════════ */
function escMusica(s) {
  return String(s ?? "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function isSpotifyUrl(url) {
  return typeof url === "string" && /^https:\/\/open\.spotify\.com\/(intl-[a-z]{2}\/)?track\/[A-Za-z0-9]{22}(\?.*)?$/.test(url);
}

function spotifyTrackId(url) {
  const m = /open\.spotify\.com\/(?:intl-[a-z]{2}\/)?track\/([A-Za-z0-9]{22})/.exec(url || "");
  return m ? m[1] : null;
}

function familiaInfo(c) {
  if (c.familia === "organizacion") return { label: "Organización", villa: "", icon: "🎶" };
  return FAMILIA_INDEX[c.familia] || { label: c.familia || "—", villa: "", icon: "" };
}

function renderLista() {
  const list  = document.getElementById("cancionesList");
  const empty = document.getElementById("cancionesEmpty");
  if (!list || !empty) return;

  const items = listaFiltrada();
  if (!items.length) {
    list.innerHTML = "";
    empty.style.display = "block";
    return;
  }
  empty.style.display = "none";
  list.innerHTML = items.map(cardHtml).join("");

  list.querySelectorAll("[data-vote-id]").forEach(btn => {
    btn.addEventListener("click", () => toggleVoto(btn.dataset.voteId, btn));
  });
}

function cardHtml(c) {
  const fam = familiaInfo(c);
  const generoLabel = GENEROS[c.generoSlug] || c.generoSlug || "";
  const spotifyOk = isSpotifyUrl(c.spotifyUrl);
  const puedeVotar = (authState.isApproved || authState.isAdmin)
    && c.estado !== "reproducida" && musicaConfig.votacionPausada !== true;
  const etiqueta = c.etiquetaContenido === "requiere-revision"
    ? `<span class="cancion-etiqueta revision">⚠️ Requiere revisión</span>`
    : c.etiquetaContenido === "version-limpia-verificada"
      ? `<span class="cancion-etiqueta limpia">✅ Versión limpia verificada</span>`
      : "";

  return `
    <div class="cancion-card">
      <div class="cancion-card-top">
        <span class="cancion-badge cancion-badge-${c.estado}">${ESTADO_LABEL[c.estado] || c.estado}</span>
        <span class="cancion-genero-tag">${escMusica(generoLabel)}</span>
      </div>
      <h4 class="cancion-titulo">${escMusica(c.titulo)}</h4>
      <p class="cancion-artista">${escMusica(c.artista)}</p>
      <p class="cancion-propone">👪 ${escMusica(fam.label)}${fam.villa ? ` · ${fam.icon} ${escMusica(fam.villa)}` : ""}</p>
      ${c.dedicatoria ? `<p class="cancion-dedicatoria">💬 “${escMusica(c.dedicatoria)}”</p>` : ""}
      ${etiqueta}
      <div class="cancion-card-footer">
        <button class="cancion-vote-btn ${c.yoVote ? "voted" : ""}" data-vote-id="${c.id}" ${puedeVotar ? "" : "disabled"}>
          ${c.yoVote ? "✅ Ya la votaste" : "👍 Quiero escucharla"}
        </button>
        <span class="cancion-votos-total">${c.votos} voto${c.votos === 1 ? "" : "s"} · ${c.familias} familia${c.familias === 1 ? "" : "s"}</span>
      </div>
      ${spotifyOk ? `<a href="${c.spotifyUrl}" target="_blank" rel="noopener noreferrer" class="btn-secondary" style="display:block;text-align:center;text-decoration:none;margin-top:10px">🎧 Abrir en Spotify</a>` : ""}
    </div>`;
}

/* ══════════════════ VOTAR / RETIRAR VOTO ═══════════════════════════════
   El ID del voto es "<cancionId>_<uid>" — Firestore solo deja "crear" un
   documento que no existe, así que dos clics/pestañas votando a la vez
   nunca producen un voto duplicado ni un conteo incorrecto. */
async function toggleVoto(cancionId, btn) {
  if (!authState.user || !(authState.isApproved || authState.isAdmin)) return;
  const myUid = authState.user.uid;
  const voteId = `${cancionId}_${myUid}`;
  if (btn) btn.disabled = true;
  try {
    if (votosCache[voteId]) {
      await fbDb.collection("cancionVotos").doc(voteId).delete();
    } else {
      await fbDb.collection("cancionVotos").doc(voteId).set({
        cancionId, uid: myUid, familia: authState.profile.familia,
        creadoEn: firebase.firestore.FieldValue.serverTimestamp(),
      });
    }
  } catch (err) {
    console.error("Error al votar:", err);
    alert("No se pudo registrar tu voto: " + err.message);
  } finally {
    if (btn) btn.disabled = false;
  }
}

/* ══════════════════ PROPONER CANCIÓN ═══════════════════════════════════
   El ID del documento es un slug determinístico de "título-artista"
   normalizado (sin mayúsculas/acentos) — así dos personas que escriben la
   misma canción al mismo tiempo chocan en el mismo ID: solo la primera
   "crea" el documento, la segunda recibe un permiso denegado (porque ya no
   es una creación, es una edición) y se lo mostramos como duplicado. */
function initProponerForm() {
  const form = document.getElementById("proponerForm");
  if (!form) return;

  form.addEventListener("submit", async e => {
    e.preventDefault();
    const msg = document.getElementById("proponerMsg");
    const aviso = document.getElementById("duplicadoAviso");
    aviso.style.display = "none";
    aviso.innerHTML = "";
    msg.textContent = "";

    if (!authState.user || !(authState.isApproved || authState.isAdmin)) {
      msg.textContent = "Necesitas una cuenta aprobada para proponer canciones.";
      return;
    }
    if (musicaConfig.propuestasPausadas === true) {
      msg.textContent = "⏸️ El encargado pausó las propuestas nuevas por ahora.";
      return;
    }

    const titulo        = document.getElementById("cancionTitulo").value.trim();
    const artista        = document.getElementById("cancionArtista").value.trim();
    const generoSlug      = document.getElementById("cancionGenero").value;
    const spotifyUrlRaw   = document.getElementById("cancionSpotify").value.trim();
    const dedicatoria     = document.getElementById("cancionDedicatoria").value.trim();

    if (!titulo || !artista || !generoSlug) {
      msg.textContent = "Completa canción, artista y género.";
      return;
    }
    if (spotifyUrlRaw && !isSpotifyUrl(spotifyUrlRaw)) {
      msg.textContent = "El enlace de Spotify no parece válido — debe verse como https://open.spotify.com/track/...";
      return;
    }
    if (dedicatoria.length > 150) {
      msg.textContent = "La dedicatoria debe tener 150 caracteres o menos.";
      return;
    }

    const cancionId = JunteAuth.slugify(`${titulo}-${artista}`) || `cancion-${Date.now()}`;

    const trackId = spotifyTrackId(spotifyUrlRaw);
    if (trackId) {
      const porTrackId = Object.entries(cancionesCache).find(([, c]) => spotifyTrackId(c.spotifyUrl) === trackId);
      if (porTrackId) { mostrarDuplicado(porTrackId[0], porTrackId[1]); return; }
    }
    if (cancionesCache[cancionId]) { mostrarDuplicado(cancionId, cancionesCache[cancionId]); return; }

    const submitBtn = form.querySelector("button[type=submit]");
    submitBtn.disabled = true;
    try {
      await fbDb.collection("cancionesPedidas").doc(cancionId).set({
        titulo, artista, generoSlug,
        spotifyUrl: spotifyUrlRaw, dedicatoria,
        familia: authState.profile.familia,
        nombre: authState.profile.nombre,
        uid: authState.user.uid,
        estado: "activa",
        ocultaInapropiado: false,
        etiquetaContenido: "",
        ordenCola: 0,
        creadoEn: firebase.firestore.FieldValue.serverTimestamp(),
      });
      msg.textContent = "✅ ¡Canción propuesta! Ya aparece en la lista — no se reproduce automáticamente.";
      form.reset();
    } catch (err) {
      if (err.code === "permission-denied") {
        try {
          const existente = await fbDb.collection("cancionesPedidas").doc(cancionId).get();
          if (existente.exists) { mostrarDuplicado(cancionId, existente.data()); return; }
        } catch (_) { /* cae al mensaje genérico de abajo */ }
      }
      console.error("Error al proponer canción:", err);
      msg.textContent = "❌ No se pudo guardar: " + err.message;
    } finally {
      submitBtn.disabled = false;
    }
  });
}

function mostrarDuplicado(id, data) {
  const aviso = document.getElementById("duplicadoAviso");
  aviso.style.display = "block";
  aviso.innerHTML = `
    <h3>¡Esta canción ya fue propuesta!</h3>
    <p>“${escMusica(data.titulo)}” — ${escMusica(data.artista)}. Vota por ella para que suba de posición.</p>
    <button type="button" class="btn-primary" id="irAVotarDuplicado">👍 Quiero escucharla</button>`;
  document.getElementById("irAVotarDuplicado").addEventListener("click", ev => toggleVoto(id, ev.currentTarget));
}

/* ══════════════════ FILTROS / VISTAS (UI) ══════════════════════════════ */
function initFiltros() {
  const buscar = document.getElementById("buscarCancion");
  const genero = document.getElementById("filtroGenero");
  if (buscar) buscar.addEventListener("input", e => {
    currentBusqueda = e.target.value;
    try { renderLista(); } catch (err) { console.error("Error al filtrar:", err); }
  });
  if (genero) genero.addEventListener("change", e => {
    currentGenero = e.target.value;
    try { renderLista(); } catch (err) { console.error("Error al filtrar:", err); }
  });
}

function initVistas() {
  document.querySelectorAll("#musicaVistas .admin-tab").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#musicaVistas .admin-tab").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      currentVista = btn.dataset.vista;
      try { renderLista(); } catch (err) { console.error("Error al cambiar de vista:", err); }
    });
  });
}
