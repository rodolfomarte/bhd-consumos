/* ════════════════════════════════════════════════════════════════════════
   Junte Familiar CND 2026 — main.js  v4
   Itinerario/Villas/Menú son HTML estático (ver index.html) — nada de eso
   se renderiza desde aquí. Este archivo solo maneja: el Mural de Recuerdos
   (Firestore + Storage, control de acceso por familia) y el modo admin
   para los textos editables sueltos (títulos, historia, leyenda del mapa).
   ════════════════════════════════════════════════════════════════════════ */

const YEARS = ['2020','2021','2022','2023','2024','2025'];

/* ══════════════════ ESTADO GLOBAL ════════════════════════════════════════ */
let adminMode  = false;         // derivado de JunteAuth (custom claim)
let authState  = { loading: true };
let muralCache = {};            // { "<familiaSlug>_<anio>": {...doc} }
let galleryEnabled = false;
let muralUnsub = null, settingsUnsub = null;
let familiaStatsUnsub = null;

let uploadTargetAnio    = null;
let selectedFile        = null;
let activeFilter        = null;
let currentModalKey     = null; // "<familiaSlug>_<anio>"

/* ══════════════════════ INIT ═════════════════════════════════════════════ */
document.addEventListener("DOMContentLoaded", () => {
  // Cada paso va en su propio try/catch: si uno falla, los demás igual
  // corren (antes, un solo error aquí dejaba la página entera en blanco).
  const steps = [
    ["pestañas por día", initDayTabs],
    ["clima del itinerario", initClimaItinerario],
    ["modal de subida",  initUploadModal],
    ["modal de foto",    initPhotoModal],
    ["textos editables", loadEditableTexts],
    ["cuenta regresiva", initCountdown],
    ["zoom del mapa",    initMapaZoom],
    ["fotos de villas",  watchVillaImagenesHome],
    ["zoom de villas",   initVillaPhotoZoom],
  ];
  for (const [label, fn] of steps) {
    try { fn(); } catch (err) { console.error(`Error iniciando ${label}:`, err); }
  }

  JunteAuth.subscribe(onAuthState);
});

function onAuthState(state) {
  authState = state;
  adminMode = state.isAdmin;
  try {
    document.body.classList.toggle("admin-mode", adminMode);
    document.getElementById("adminBadge").style.display = adminMode ? "flex" : "none";
    document.querySelectorAll(".editable").forEach(el => el.contentEditable = adminMode ? "true" : "false");
  } catch (err) { console.error("Error en onAuthState (admin UI):", err); }

  for (const fn of [watchSettings, watchMural, renderMuralGate, renderMuralGrid, renderLoggedOutGate, watchFamiliaStats]) {
    try { fn(); } catch (err) { console.error(`Error en onAuthState (${fn.name}):`, err); }
  }
}

/* ══════════════════ ACCESO AL RESTO DEL SITIO ═══════════════════════════
   Itinerario/Villas/Mapa/Menú/Historia empiezan display:none en el HTML
   (nunca hay parpadeo mostrando contenido antes de confirmar sesión) y
   esto las revela en cuanto hay una cuenta — no hace falta estar aprobado,
   solo registrado. Mural/Live siguen pidiendo aprobación aparte. */
function renderLoggedOutGate() {
  const authed = !!authState.user;
  const gate = document.getElementById("loggedOutGateWrap");
  if (gate) gate.style.display = authed ? "none" : "block";
  ["itinerario", "villas", "mapa", "menu", "historia"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = authed ? "" : "none";
  });
}

/* ══════════════════ HELPERS ════════════════════════════════════════════ */
function getAllFamilias() {
  return FAMILIES_ROSTER.flatMap(v => v.familias.map(f => ({ nombre: f.nombre, villa: v.name })));
}

function escHtml(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}

function myFamiliaSlug()  { return authState.profile?.familia || null; }
function myFamiliaLabel() { return authState.profile?.familiaLabel || null; }

/* ══════════════════ COUNTDOWN ══════════════════════════════════════════ */
function initCountdown() {
  const target = new Date("2026-10-16T07:00:00");
  function tick() {
    const diff = target - new Date();
    if (diff <= 0) {
      document.getElementById("countdown").innerHTML =
        '<div class="cd-block"><span>🎉</span><small>¡Hoy!</small></div>';
      return;
    }
    const d = Math.floor(diff/86400000);
    const h = Math.floor((diff%86400000)/3600000);
    const m = Math.floor((diff%3600000)/60000);
    const s = Math.floor((diff%60000)/1000);
    document.getElementById("cd-dias").textContent  = String(d).padStart(2,"0");
    document.getElementById("cd-horas").textContent = String(h).padStart(2,"0");
    document.getElementById("cd-min").textContent   = String(m).padStart(2,"0");
    document.getElementById("cd-seg").textContent   = String(s).padStart(2,"0");
  }
  tick(); setInterval(tick, 1000);
}

/* ══════════════════ MAPA — zoom al tocar ═══════════════════════════════
   La imagen ya tiene un onerror en el HTML que muestra la tarjeta de
   respaldo sin depender de JS — esto solo añade el acercamiento opcional. */
function initMapaZoom() {
  const img   = document.getElementById("mapaImg");
  const modal = document.getElementById("mapaZoomModal");
  const bg    = document.getElementById("mapaZoomModalBg");
  const close = document.getElementById("mapaZoomClose");
  if (!img || !modal || !bg || !close) return;

  const open  = () => { modal.classList.add("open"); document.body.style.overflow = "hidden"; };
  const shut  = () => { modal.classList.remove("open"); document.body.style.overflow = ""; };
  img.addEventListener("click", open);
  bg.addEventListener("click", shut);
  close.addEventListener("click", shut);
}

/* ══════════════════ FOTO DE IDENTIDAD DE CADA VILLA ═══════════════════════
   villaImagenes/<slug> — la misma colección que usa /retos. En cuanto el
   admin aprueba la entrega de "Crea la identidad de tu equipo", esa foto
   reemplaza el ícono aquí también. Mientras no exista (o falle la lectura,
   p.ej. visitante sin cuenta), se queda el ícono de siempre — nunca un
   hueco en blanco. */
const VILLA_SLUGS_HOME = ["palmera", "perez", "cafe", "cereza", "bosque"];

function watchVillaImagenesHome() {
  if (typeof fbDb === "undefined") return;
  VILLA_SLUGS_HOME.forEach(slug => {
    fbDb.collection("villaImagenes").doc(slug).onSnapshot(
      snap => {
        try { applyVillaImagenHome(slug, snap.exists ? snap.data() : null); }
        catch (err) { console.error(`Error mostrando foto de ${slug}:`, err); }
      },
      err => console.error(`Error leyendo foto de ${slug}:`, err)
    );
  });
}

function applyVillaImagenHome(slug, data) {
  const card = document.querySelector(`.villa-card[data-villa="${slug}"]`);
  if (!card) return;
  const icon  = card.querySelector('[data-role="icon"]');
  const photo = card.querySelector('[data-role="photo"]');
  if (!icon || !photo) return;
  if (data && data.url) {
    photo.src = data.url;
    photo.style.display = "block";
    icon.style.display = "none";
  } else {
    photo.style.display = "none";
    icon.style.display = "";
  }
}

/* ══════════════════ REGISTRADOS Y ACTIVIDAD POR FAMILIA ═══════════════════
   Junto a cada nombre en "Nuestras Villas": cuántas cuentas hay registradas
   en esa familia y una insignia de actividad reciente — nunca un conteo
   exacto de fotos/votos de nadie, solo esta señal gruesa. Visible para
   cualquiera con cuenta (mismo nivel que el resto de esta sección), nunca
   para visitantes sin registrar. Si falla la lectura, cada <li> se queda
   tal cual está en el HTML (sin esa info extra), nunca en blanco. */
const DIAS_ACTIVIDAD_RECIENTE = 14;

function watchFamiliaStats() {
  if (typeof fbDb === "undefined") return;
  if (familiaStatsUnsub) { familiaStatsUnsub(); familiaStatsUnsub = null; }
  if (!authState.user) return; // requiere cuenta — se vuelve a llamar solo cuando cambie el estado de sesión
  familiaStatsUnsub = fbDb.collection("familiaRegistros").onSnapshot(
    snap => {
      const porFamilia = {};
      snap.forEach(doc => { porFamilia[doc.id] = doc.data(); });
      try { renderFamiliaStats(porFamilia); } catch (err) { console.error("Error mostrando estadísticas de familias:", err); }
    },
    err => console.error("Error leyendo estadísticas de familias:", err)
  );
}

function renderFamiliaStats(porFamilia) {
  document.querySelectorAll(".villa-card[data-villa]").forEach(card => {
    let totalVilla = 0;

    card.querySelectorAll(".villa-familia-item[data-familia]").forEach(li => {
      const slug = li.dataset.familia;
      const span = li.querySelector("[data-stats]");
      const datos = porFamilia[slug];
      const registrados = datos?.registrados || 0;
      totalVilla += registrados;
      if (!span) return;

      if (!registrados) {
        span.innerHTML = `<span class="familia-badge" title="Nadie de esta familia se ha registrado todavía">⚪</span>`;
        return;
      }

      const ultima = datos.ultimaActividad?.toDate ? datos.ultimaActividad.toDate() : null;
      const diasDesde = ultima ? (Date.now() - ultima.getTime()) / 86400000 : Infinity;
      const badge = diasDesde <= DIAS_ACTIVIDAD_RECIENTE
        ? `<span class="familia-badge" title="Activa recientemente">🟢</span>`
        : `<span class="familia-badge" title="Registrada, sin actividad reciente">🟡</span>`;

      span.innerHTML = `${badge}<span>👥 ${registrados}</span>`;
    });

    const totalEl = card.querySelector('[data-role="villa-total"]');
    if (totalEl) totalEl.textContent = `Total villa: ${totalVilla}`;
  });

  const granTotalEl = document.getElementById("villasGranTotal");
  if (granTotalEl) {
    const granTotal = Object.values(porFamilia).reduce((sum, d) => sum + (d.registrados || 0), 0);
    granTotalEl.textContent = `👥 Total registrados en el Junte: ${granTotal}`;
  }
}

function initVillaPhotoZoom() {
  const modal = document.getElementById("villaPhotoZoomModal");
  const img   = document.getElementById("villaPhotoZoomImg");
  if (!modal || !img) return;

  const open  = src => { if (!src) return; img.src = src; modal.classList.add("open"); document.body.style.overflow = "hidden"; };
  const close = () => { modal.classList.remove("open"); document.body.style.overflow = ""; };

  document.getElementById("villaPhotoZoomModalBg").addEventListener("click", close);
  document.getElementById("villaPhotoZoomClose").addEventListener("click", close);
  document.querySelectorAll('.villa-card .reto-card-photo[data-role="photo"]').forEach(el => {
    el.addEventListener("click", () => open(el.src));
  });
}

/* ══════════════════ PESTAÑAS POR DÍA (Itinerario / Menú) ══════════════════
   Solo click — nada de IntersectionObserver. Un mismo helper sirve para
   ambas secciones: el grupo se identifica con data-tabgroup. */
function initDayTabs() {
  document.querySelectorAll(".day-tabs[data-tabgroup]").forEach(tabBar => {
    const group = tabBar.dataset.tabgroup;
    tabBar.querySelectorAll(".day-tab").forEach(btn => {
      btn.addEventListener("click", () => {
        tabBar.querySelectorAll(".day-tab").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        document.querySelectorAll(`[data-tabgroup="${group}"][data-panel]`).forEach(p => p.classList.remove("active"));
        const panel = document.querySelector(`[data-tabgroup="${group}"][data-panel="${btn.dataset.day}"]`);
        if (panel) panel.classList.add("active");
      });
    });
  });
}

/* ══════════════════ CLIMA DEL ITINERARIO ═══════════════════════════════
   Pronóstico real (Open-Meteo, gratis, sin llave) para Jarabacoa, junto a
   cada pestaña de día del Itinerario — nunca en Menú, que reusa la misma
   clase .day-tab para otras pestañas (Kit de Alimentos, Bebidas, etc.).
   Si falla la red o la API, las pestañas se quedan exactamente como están
   en el HTML — nunca rotas ni vacías por culpa del clima. */
const CLIMA_FECHA_POR_DIA = { viernes: "2026-10-16", sabado: "2026-10-17", domingo: "2026-10-18" };
const CLIMA_WMO = {
  0: ["☀️", "Despejado"], 1: ["🌤️", "Mayormente despejado"], 2: ["⛅", "Parcialmente nublado"], 3: ["☁️", "Nublado"],
  45: ["🌫️", "Neblina"], 48: ["🌫️", "Neblina"],
  51: ["🌦️", "Llovizna leve"], 53: ["🌦️", "Llovizna"], 55: ["🌧️", "Llovizna fuerte"],
  61: ["🌦️", "Lluvia leve"], 63: ["🌧️", "Lluvia"], 65: ["🌧️", "Lluvia fuerte"],
  80: ["🌦️", "Aguaceros"], 81: ["🌧️", "Aguaceros"], 82: ["⛈️", "Aguaceros fuertes"],
  95: ["⛈️", "Tormenta"], 96: ["⛈️", "Tormenta con granizo"], 99: ["⛈️", "Tormenta con granizo"],
};

function initClimaItinerario() {
  const tabBar = document.querySelector('.day-tabs[data-tabgroup="itin"]');
  if (!tabBar) return;

  const url = "https://api.open-meteo.com/v1/forecast"
    + "?latitude=19.12&longitude=-70.63"
    + "&daily=weathercode,temperature_2m_max,temperature_2m_min"
    + "&timezone=America%2FSanto_Domingo&forecast_days=3";

  fetch(url)
    .then(res => { if (!res.ok) throw new Error(`Open-Meteo respondió ${res.status}`); return res.json(); })
    .then(data => {
      const dias = data?.daily;
      if (!dias?.time) return;

      Object.entries(CLIMA_FECHA_POR_DIA).forEach(([dia, fecha]) => {
        const idx = dias.time.indexOf(fecha);
        if (idx === -1) return;
        const btn = tabBar.querySelector(`[data-day="${dia}"]`);
        if (!btn) return;

        const [icon, label] = CLIMA_WMO[dias.weathercode[idx]] || ["🌡️", ""];
        const min = Math.round(dias.temperature_2m_min[idx]);
        const max = Math.round(dias.temperature_2m_max[idx]);

        const badge = document.createElement("span");
        badge.className = "day-tab-clima";
        badge.title = label;
        badge.innerHTML = `<span class="icon">${icon}</span><span>${min}°–${max}°</span>`;
        btn.appendChild(badge);
      });
    })
    .catch(err => console.error("Error cargando el clima del itinerario:", err));
}

/* ══════════════════════════════════════════════════════════════════════
   MURAL DE RECUERDOS — Firestore + Storage, acceso por familia
   ══════════════════════════════════════════════════════════════════════ */

function watchSettings() {
  if (settingsUnsub) { settingsUnsub(); settingsUnsub = null; }
  settingsUnsub = fbDb.collection("config").doc("settings").onSnapshot(
    snap => {
      const next = !!(snap.exists && snap.data().galleryEnabledForUsers);
      if (next !== galleryEnabled) { galleryEnabled = next; watchMural(); }
      renderMuralGrid();
    },
    () => { galleryEnabled = false; }
  );
}

function watchMural() {
  if (muralUnsub) { muralUnsub(); muralUnsub = null; }
  muralCache = {};
  if (!authState.isApproved && !authState.isAdmin) { renderMuralGrid(); return; }

  const canSeeAll = authState.isAdmin || galleryEnabled;
  const query = canSeeAll
    ? fbDb.collection("muralPhotos")
    : fbDb.collection("muralPhotos").where("familia", "==", myFamiliaSlug());

  muralUnsub = query.onSnapshot(snap => {
    muralCache = {};
    snap.forEach(doc => { muralCache[doc.id] = doc.data(); });
    renderMuralGrid();
  }, err => console.error("Mural error:", err));
}

function renderMuralGate() {
  const wrap = document.getElementById("muralGateWrap");
  if (!wrap) return;
  if (authState.isAdmin || authState.isApproved) { wrap.style.display = "none"; return; }
  wrap.style.display = "block";

  if (!authState.user) {
    wrap.innerHTML = gateHtml("👪 Inicia sesión para ver el Mural", "El Mural de Recuerdos es solo para familias registradas y aprobadas.");
  } else if (authState.profile?.status === "pending") {
    wrap.innerHTML = gateHtml("⏳ Pendiente de aprobación de Rodolfo", "Tu cuenta está esperando revisión. Te avisaremos cuando esté lista.");
  } else if (authState.profile?.status === "rejected") {
    wrap.innerHTML = gateHtml("❌ Solicitud rechazada", "Contacta al administrador del Junte si crees que es un error.", true);
  } else if (authState.profile?.status === "suspended") {
    wrap.innerHTML = gateHtml("🚫 Cuenta suspendida", "Tu acceso fue suspendido. Contacta al administrador del Junte.", true);
  } else {
    wrap.innerHTML = gateHtml("👪 Mural exclusivo para familias", "Inicia sesión con tu cuenta aprobada para continuar.");
  }
}

function gateHtml(title, msg, denied) {
  return `
    <div class="auth-gate-banner ${denied ? 'denied' : ''}">
      <h3>${title}</h3>
      <p>${msg}</p>
      <a href="/cuenta" class="btn-primary" style="text-decoration:none;display:inline-block">Ir a Mi Cuenta</a>
    </div>`;
}

function renderMuralGrid() {
  const wrap = document.getElementById("muralGridWrap");
  if (!wrap) return;

  const unlocked = authState.isAdmin || authState.isApproved;
  if (!unlocked) { wrap.innerHTML = ""; document.getElementById("muralProgress").textContent = ""; document.getElementById("muralProgressBar").style.width = "0%"; return; }

  const familias = getAllFamilias();
  const mySlug   = myFamiliaSlug();
  const total    = familias.length;
  const conFoto  = new Set(Object.values(muralCache).map(p => p.familia)).size;

  document.getElementById("muralProgress").textContent =
    `${conFoto} / ${total} familias han compartido al menos 1 foto`;
  document.getElementById("muralProgressBar").style.width = (total ? Math.round(conFoto/total*100) : 0)+"%";

  let html = `
    <div class="mural-table-wrap">
      <div class="mural-filter-bar" id="muralFilterBar">
        <span class="filter-label">Filtrar:</span>
        <button class="filter-btn active" onclick="setFilter(null)">Todas</button>
        ${FAMILIES_ROSTER.map(v =>
          `<button class="filter-btn" onclick="setFilter('${v.name}')">${v.icon} ${v.name}</button>`
        ).join("")}
      </div>
      <div class="mural-table">
        <div class="mural-header-row">
          <div class="mural-cell mural-family-col">Familia</div>
          ${YEARS.map(y => `<div class="mural-cell mural-year-col">${y}</div>`).join("")}
        </div>`;

  FAMILIES_ROSTER.forEach(v => {
    html += `<div class="mural-villa-row" data-villa="${v.name}">
               <div class="mural-cell mural-villa-label">${v.icon} ${v.name}</div>
               ${YEARS.map(()=>`<div class="mural-cell mural-spacer"></div>`).join("")}
             </div>`;
    v.familias.forEach(f => {
      const slug      = JunteAuth.slugify(f.nombre);
      const isMine    = authState.isAdmin ? false : slug === mySlug;
      const visible   = authState.isAdmin || galleryEnabled || slug === mySlug;
      html += `<div class="mural-familia-row" data-villa="${v.name}">
                 <div class="mural-cell mural-family-col mural-family-name">${escHtml(f.nombre)}</div>`;
      YEARS.forEach(y => {
        const key   = `${slug}_${y}`;
        const photo = muralCache[key];
        if (photo) {
          html += `<div class="mural-cell mural-photo-cell has-photo"
                        onclick="openPhotoModal('${key}')"
                        title="${escHtml(f.nombre)} – ${y}">
                     <img src="${photo.url}" alt="${escHtml(f.nombre)} ${y}" loading="lazy"/>
                     <div class="photo-cell-overlay">
                       <span>❤️ ${photo.likes ? photo.likes.length : 0}</span>
                       <span>💬 ${photo.comments ? photo.comments.length : 0}</span>
                     </div>
                   </div>`;
        } else if (isMine || authState.isAdmin) {
          html += `<div class="mural-cell mural-photo-cell empty"
                        onclick="openUploadModal('${slug}','${escHtml(f.nombre)}','${y}')"
                        title="Subir foto de ${escHtml(f.nombre)} – ${y}">
                     <span class="plus-icon">+</span>
                     <span class="plus-year">${y}</span>
                   </div>`;
        } else if (visible) {
          html += `<div class="mural-cell mural-photo-cell empty" title="${y}"><span class="plus-year">${y}</span></div>`;
        } else {
          html += `<div class="mural-cell mural-photo-cell empty" title="Disponible cuando el admin habilite la galería general">
                     <span class="plus-year">🔒</span>
                   </div>`;
        }
      });
      html += `</div>`;
    });
  });
  html += `</div></div>`;

  // Resumen por año: cuántas fotos hay cargadas en cada año — respeta lo
  // mismo que ya se puede ver arriba (la propia familia, o todas si el
  // admin habilitó la galería general o es admin).
  const countsByYear = YEARS.map(anio => ({
    anio,
    count: Object.values(muralCache).filter(p => p.anio === anio).length,
  }));
  html += `
    <div class="mural-year-summary">
      <h3>📊 Resumen por año</h3>
      <div class="mural-year-summary-list">
        ${countsByYear.map(({ anio, count }) => `
          <div class="year-summary-item" onclick="openYearGallery('${anio}')">
            <span class="year-summary-year">${anio}</span>
            <span class="year-summary-count">${count} foto${count === 1 ? "" : "s"}</span>
          </div>`).join("")}
      </div>
    </div>`;

  wrap.innerHTML = html;
}

function setFilter(villaName) {
  activeFilter = villaName;
  document.querySelectorAll(".filter-btn").forEach(b => b.classList.remove("active"));
  const btns = document.querySelectorAll(".filter-btn");
  btns[villaName ? FAMILIES_ROSTER.findIndex(v=>v.name===villaName)+1 : 0].classList.add("active");

  document.querySelectorAll(".mural-familia-row, .mural-villa-row").forEach(row => {
    row.style.display = (!villaName || row.dataset.villa === villaName) ? "" : "none";
  });
}

/* ────── Upload Modal ────── */
function initUploadModal() {
  document.getElementById("btnOpenUpload").addEventListener("click", () => {
    if (!authState.isApproved) { alert("Necesitas una cuenta aprobada para subir fotos. Ve a Mi Cuenta."); return; }
    openUploadModal(myFamiliaSlug(), myFamiliaLabel(), null);
  });
  document.getElementById("photoFileInput").addEventListener("change", async e => {
    const original = e.target.files[0];
    if (!original) return;
    const status = document.getElementById("uploadStatusMsg");
    status.textContent = "Comprimiendo imagen... ⏳";
    try {
      selectedFile = await compressImage(original);
    } catch (err) {
      console.error("Compress error:", err);
      selectedFile = original;
    }
    status.textContent = "";
    const prev = document.getElementById("uploadImgPreview");
    prev.src = URL.createObjectURL(selectedFile); prev.style.display = "block";
  });
  document.getElementById("btnDoUpload").addEventListener("click", doUpload);
  document.getElementById("btnCancelUpload").addEventListener("click", closeUploadModal);
  document.getElementById("uploadModalBg").addEventListener("click", closeUploadModal);
}

let uploadTargetSlug = null, uploadTargetLabel = null;
let isReplacingPhoto = false;

function openUploadModal(slug, label, anio, replacing = false) {
  if (!authState.isAdmin && slug !== myFamiliaSlug()) {
    alert("Solo puedes subir fotos de tu propia familia.");
    return;
  }
  uploadTargetSlug  = slug;
  uploadTargetLabel = label;
  uploadTargetAnio  = anio;
  isReplacingPhoto  = replacing;
  selectedFile = null;
  const prev = document.getElementById("uploadImgPreview");
  const existing = replacing ? muralCache[`${slug}_${anio}`] : null;
  prev.src = existing?.url || ""; prev.style.display = existing ? "block" : "none";
  document.getElementById("photoFileInput").value = "";
  document.getElementById("uploadDescInput").value = existing?.description || "";
  document.getElementById("uploadStatusMsg").textContent = "";
  document.getElementById("uploadFamiliaLabel").textContent = label;
  document.getElementById("uploadModalTitle").textContent = replacing ? "Sustituir foto familiar" : "Subir foto familiar";
  if (anio) document.getElementById("uploadAnioSelect").value = anio;

  document.getElementById("uploadModal").classList.add("open");
}

function closeUploadModal() {
  document.getElementById("uploadModal").classList.remove("open");
  isReplacingPhoto = false;
}

function replaceMuralPhoto() {
  const photo = muralCache[currentModalKey];
  if (!photo || !canDeleteMuralPhoto(photo)) return;
  closePhotoModal();
  openUploadModal(photo.familia, photo.familiaLabel, photo.anio, true);
}
window.replaceMuralPhoto = replaceMuralPhoto;

async function doUpload() {
  const anio   = document.getElementById("uploadAnioSelect").value;
  const desc   = document.getElementById("uploadDescInput").value.trim();
  const status = document.getElementById("uploadStatusMsg");
  const btn    = document.getElementById("btnDoUpload");

  if (!selectedFile) { status.textContent = "⚠️ Selecciona una imagen."; return; }
  const key = `${uploadTargetSlug}_${anio}`;
  if (muralCache[key] && !isReplacingPhoto) { status.textContent = `❌ ${uploadTargetLabel} ya tiene foto de ${anio}.`; return; }

  status.textContent = "Verificando espacio disponible... ⏳";
  btn.disabled = true;
  let quota;
  try {
    quota = await JunteAuth.callFunction("check-storage-quota", { method: "POST", body: { bytes: selectedFile.size } });
  } catch (err) {
    status.textContent = "❌ " + err.message;
    btn.disabled = false;
    return;
  }
  if (!quota.ok) {
    status.textContent = `❌ No hay espacio suficiente (disponible: ${(quota.availableBytes/1024/1024).toFixed(1)} MB). Contacta al administrador.`;
    btn.disabled = false;
    return;
  }
  if (quota.warnAt80) alert(`⚠️ El almacenamiento llegará al ${quota.projectedPercent}% con esta foto.`);

  status.textContent = "Subiendo... ⏳";
  try {
    // Fuerza un token fresco: si al usuario lo acaban de aprobar, su claim
    // "approved" podría no haber llegado aún al token en caché.
    await authState.user.getIdToken(true);
    const ref = fbStorage.ref(`mural/${uploadTargetSlug}/${anio}`);
    await ref.put(selectedFile, { contentType: selectedFile.type });
    const url = await ref.getDownloadURL();

    if (isReplacingPhoto) {
      // Misma casilla (familia+año) — conserva los likes/comentarios que
      // ya tenía, solo cambia la imagen y la descripción.
      await fbDb.collection("muralPhotos").doc(key).update({
        url,
        description:   desc,
        uploaderUid:   authState.user.uid,
        uploaderEmail: authState.user.email,
        createdAt:     firebase.firestore.FieldValue.serverTimestamp(),
      });
    } else {
      await fbDb.collection("muralPhotos").doc(key).set({
        familia:       uploadTargetSlug,
        familiaLabel:  uploadTargetLabel,
        anio,
        url,
        description:   desc,
        uploaderUid:   authState.user.uid,
        uploaderEmail: authState.user.email,
        createdAt:     firebase.firestore.FieldValue.serverTimestamp(),
        likes:         [],
        comments:      [],
      });
    }

    closeUploadModal();
  } catch (err) {
    console.error("Upload error:", err);
    status.textContent = "❌ Error al subir: " + err.message;
  } finally {
    btn.disabled = false;
    status.textContent = "";
  }
}

/* ────── Photo View Modal (likes & comments) ────── */
function initPhotoModal() {
  document.getElementById("photoModalBg").addEventListener("click", closePhotoModal);
  document.getElementById("photoModalClose").addEventListener("click", closePhotoModal);
  document.getElementById("btnLike").addEventListener("click", doLike);
  document.getElementById("btnComment").addEventListener("click", doComment);

  document.getElementById("yearGalleryModalBg").addEventListener("click", closeYearGallery);
  document.getElementById("yearGalleryClose").addEventListener("click", closeYearGallery);
}

// Al tocar un año en el "Resumen por año" — muestra todas las fotos de ese
// año en una galería; tocar una foto lleva al modal de siempre (likes y
// comentarios). Respeta lo mismo que ya se ve en la cuadrícula (muralCache
// ya viene filtrado a lo que el usuario actual puede ver).
function openYearGallery(anio) {
  const items = Object.entries(muralCache)
    .filter(([, p]) => p.anio === anio)
    .map(([key, p]) => ({ key, ...p }));

  document.getElementById("yearGalleryTitle").textContent = `📅 Fotos de ${anio}`;
  const grid = document.getElementById("yearGalleryGrid");
  grid.innerHTML = items.length
    ? items.map(p => `
        <div class="year-gallery-item" onclick="closeYearGallery(); openPhotoModal('${p.key}');">
          <img src="${p.url}" alt="${escHtml(p.familiaLabel)}" loading="lazy" />
          <span>${escHtml(p.familiaLabel)}</span>
        </div>`).join("")
    : `<p class="admin-empty">— Todavía no hay fotos de ${anio} —</p>`;

  document.getElementById("yearGalleryModal").classList.add("open");
  document.body.style.overflow = "hidden";
}

function closeYearGallery() {
  document.getElementById("yearGalleryModal").classList.remove("open");
  document.body.style.overflow = "";
}
window.openYearGallery = openYearGallery;
window.closeYearGallery = closeYearGallery;

function openPhotoModal(key) {
  currentModalKey = key;
  const photo = muralCache[key];
  if (!photo) return;

  document.getElementById("modalImg").src = photo.url;
  document.getElementById("modalFamilia").textContent = photo.familiaLabel;
  document.getElementById("modalAnio").textContent    = photo.anio;
  document.getElementById("modalDesc").textContent    = photo.description || "";
  document.getElementById("modalDownload").href       = photo.url;
  document.getElementById("modalDownload").download   = `${photo.familiaLabel.replace(/ /g,"_")}_${photo.anio}.jpg`;

  renderLikes();
  renderComments();
  document.getElementById("commentTexto").value  = "";

  const del = document.getElementById("muralPhotoDelete");
  if (del) del.style.display = canDeleteMuralPhoto(photo) ? "block" : "none";

  document.getElementById("photoModal").classList.add("open");
  document.body.style.overflow = "hidden";
}

function closePhotoModal() {
  document.getElementById("photoModal").classList.remove("open");
  document.body.style.overflow = "";
}

// Admin, o cualquier aprobado de esa misma familia (no solo quien subió la
// foto) — la regla de verdad vive en firestore.rules/storage.rules, esto
// solo decide si se muestra el botón.
function canDeleteMuralPhoto(photo) {
  return authState.isAdmin || (authState.isApproved && photo.familia === myFamiliaSlug());
}

async function deleteMuralPhoto() {
  const key = currentModalKey;
  const photo = muralCache[key];
  if (!photo || !canDeleteMuralPhoto(photo)) return;
  if (!confirm("¿Eliminar esta foto?")) return;
  try {
    await fbDb.collection("muralPhotos").doc(key).delete();
    try { await fbStorage.ref(`mural/${photo.familia}/${photo.anio}`).delete(); } catch {}
    closePhotoModal();
  } catch (err) {
    console.error("Error al eliminar foto del Mural:", err);
    alert("Error al eliminar: " + err.message);
  }
}
window.deleteMuralPhoto = deleteMuralPhoto;

function renderLikes() {
  const photo = muralCache[currentModalKey];
  if (!photo) return;
  const likes = photo.likes || [];
  document.getElementById("btnLike").innerHTML = `❤️ ${likes.length} ${likes.length===1?"like":"likes"}`;
  document.getElementById("likeNames").innerHTML = likes.length
    ? `<div class="like-names">${likes.slice(-5).map(l=>`<span>${escHtml(l.nombre)}</span>`).join(" ")}</div>`
    : "";
}

function renderComments() {
  const photo = muralCache[currentModalKey];
  const list  = document.getElementById("commentsList");
  if (!photo || !photo.comments || !photo.comments.length) {
    list.innerHTML = "<p class='no-comments'>Sé el primero en comentar.</p>"; return;
  }
  list.innerHTML = photo.comments.map(c => `
    <div class="comment-item">
      <strong>${escHtml(c.nombre)}</strong>
      <span class="comment-date">${escHtml(c.fecha)}</span>
      <p>${escHtml(c.texto)}</p>
    </div>`).join("");
  list.scrollTop = list.scrollHeight;
}

async function doLike() {
  if (!authState.isApproved) return;
  const photo = muralCache[currentModalKey];
  if (!photo) return;
  if ((photo.likes||[]).some(l => l.uid === authState.user.uid)) { alert("¡Ya diste like!"); return; }
  try {
    await fbDb.collection("muralPhotos").doc(currentModalKey).update({
      likes: firebase.firestore.FieldValue.arrayUnion({ uid: authState.user.uid, nombre: authState.profile.nombre }),
    });
  } catch (err) {
    console.error("Like error:", err);
    alert("Error al guardar: " + err.message);
  }
}

async function doComment() {
  if (!authState.isApproved) return;
  const texto = document.getElementById("commentTexto").value.trim();
  if (!texto) { alert("Escribe un comentario."); return; }
  const comment = { uid: authState.user.uid, nombre: authState.profile.nombre, texto, fecha: new Date().toLocaleDateString("es-DO") };
  try {
    await fbDb.collection("muralPhotos").doc(currentModalKey).update({
      comments: firebase.firestore.FieldValue.arrayUnion(comment),
    });
    document.getElementById("commentTexto").value = "";
  } catch (err) {
    console.error("Comment error:", err);
    alert("Error al guardar: " + err.message);
  }
}

/* ══════════════════ ADMIN: textos editables sueltos ══════════════════════
   Mural/Historia/Mapa siguen teniendo títulos y textos con class="editable"
   — esto es independiente de Itinerario/Villas/Menú, que ahora son HTML
   fijo y no tienen nada que guardar. */
function saveAdminData() {
  document.querySelectorAll(".editable[data-key]").forEach(el => {
    localStorage.setItem("junte_text_"+el.dataset.key, el.textContent.trim());
  });
}

function loadEditableTexts() {
  document.querySelectorAll(".editable[data-key]").forEach(el => {
    const saved = localStorage.getItem("junte_text_"+el.dataset.key);
    if (saved) el.textContent = saved;
  });
}

/* ══════════════════ GLOBAL EXPORTS ══════════════════════════════════════ */
window.saveAdminData   = saveAdminData;
window.openUploadModal = openUploadModal;
window.openPhotoModal  = openPhotoModal;
window.setFilter       = setFilter;
