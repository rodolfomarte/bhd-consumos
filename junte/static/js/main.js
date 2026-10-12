/* ════════════════════════════════════════════════════════════════════════
   Junté Familiar CND 2026 — main.js  v4
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

let uploadTargetAnio    = null;
let selectedFile        = null;
let activeFilter        = null;
let currentModalKey     = null; // "<familiaSlug>_<anio>"

/* ══════════════════════ INIT ═════════════════════════════════════════════ */
document.addEventListener("DOMContentLoaded", () => {
  // Cada paso va en su propio try/catch: si uno falla, los demás igual
  // corren (antes, un solo error aquí dejaba la página entera en blanco).
  const steps = [
    ["nav",              initNav],
    ["pestañas por día", initDayTabs],
    ["modal de subida",  initUploadModal],
    ["modal de foto",    initPhotoModal],
    ["textos editables", loadEditableTexts],
    ["cuenta regresiva", initCountdown],
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

  for (const fn of [watchSettings, watchMural, renderMuralGate, renderMuralGrid]) {
    try { fn(); } catch (err) { console.error(`Error en onAuthState (${fn.name}):`, err); }
  }
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

/* ══════════════════ NAV ═════════════════════════════════════════════════ */
function initNav() {
  const toggle = document.getElementById("navToggle");
  const links  = document.getElementById("navLinks");
  if (toggle) toggle.addEventListener("click", () => links.classList.toggle("open"));
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
    wrap.innerHTML = gateHtml("❌ Solicitud rechazada", "Contacta al administrador del Junté si crees que es un error.", true);
  } else if (authState.profile?.status === "suspended") {
    wrap.innerHTML = gateHtml("🚫 Cuenta suspendida", "Tu acceso fue suspendido. Contacta al administrador del Junté.", true);
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

function openUploadModal(slug, label, anio) {
  if (!authState.isAdmin && slug !== myFamiliaSlug()) {
    alert("Solo puedes subir fotos de tu propia familia.");
    return;
  }
  uploadTargetSlug  = slug;
  uploadTargetLabel = label;
  uploadTargetAnio  = anio;
  selectedFile = null;
  const prev = document.getElementById("uploadImgPreview");
  prev.src = ""; prev.style.display = "none";
  document.getElementById("photoFileInput").value = "";
  document.getElementById("uploadDescInput").value = "";
  document.getElementById("uploadStatusMsg").textContent = "";
  document.getElementById("uploadFamiliaLabel").textContent = label;
  if (anio) document.getElementById("uploadAnioSelect").value = anio;

  document.getElementById("uploadModal").classList.add("open");
}

function closeUploadModal() {
  document.getElementById("uploadModal").classList.remove("open");
}

async function doUpload() {
  const anio   = document.getElementById("uploadAnioSelect").value;
  const desc   = document.getElementById("uploadDescInput").value.trim();
  const status = document.getElementById("uploadStatusMsg");
  const btn    = document.getElementById("btnDoUpload");

  if (!selectedFile) { status.textContent = "⚠️ Selecciona una imagen."; return; }
  const key = `${uploadTargetSlug}_${anio}`;
  if (muralCache[key]) { status.textContent = `❌ ${uploadTargetLabel} ya tiene foto de ${anio}.`; return; }

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
}

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
  document.getElementById("photoModal").classList.add("open");
  document.body.style.overflow = "hidden";
}

function closePhotoModal() {
  document.getElementById("photoModal").classList.remove("open");
  document.body.style.overflow = "";
}

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
