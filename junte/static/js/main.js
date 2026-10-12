/* ════════════════════════════════════════════════════════════════════════
   Junté Familiar CND 2026 — main.js  v3
   Mural de Recuerdos sobre Firestore/Storage, con control de acceso real
   (registro + aprobación + reglas de seguridad) en vez de localStorage.
   ════════════════════════════════════════════════════════════════════════ */

const YEARS = ['2020','2021','2022','2023','2024','2025'];

const DEFAULT_DATA = {
  agenda: {
    viernes: [
      { hora:"6:30 AM",  act:"Salida para Jarabacoa",        icon:"🚌" },
      { hora:"10:00 AM", act:"Llegada al Rancho Las Guazaras", icon:"🏡" },
      { hora:"10:30 AM", act:"Actividades de bienvenida",     icon:"🎉" },
      { hora:"12:30 PM", act:"Almuerzo",                      icon:"🍽️" },
      { hora:"1:00 PM",  act:"Inflables",                     icon:"🏟️" },
      { hora:"5:00 PM",  act:"Música DJ",                     icon:"🎶" },
      { hora:"8:00 PM",  act:"Karaoke / Fogata",              icon:"🔥" },
    ],
    sabado: [
      { hora:"8:00 AM",  act:"Desayuno",                      icon:"☕" },
      { hora:"9:30 AM",  act:"Actividades Deportivas",         icon:"⚽" },
      { hora:"12:00 PM", act:"Almuerzo",                      icon:"🍽️" },
      { hora:"2:30 PM",  act:"Pool Party – Fiesta de Espuma",  icon:"🏊" },
      { hora:"3:00 PM",  act:"Música DJ",                     icon:"🎶" },
      { hora:"6:30 PM",  act:"Cine al Aire Libre",            icon:"🎬" },
      { hora:"9:00 PM",  act:"Karaoke",                       icon:"🎤" },
    ],
    domingo: [
      { hora:"6:30 AM",  act:"Senderismo",                    icon:"🥾" },
      { hora:"9:00 AM",  act:"Desayuno",                      icon:"☕" },
      { hora:"11:30 AM", act:"Almuerzo de despedida",         icon:"🍽️" },
      { hora:"3:00 PM",  act:"Salida del Rancho",             icon:"👋" },
    ],
  },

  menu: {
    viernes: {
      desayuno: [],
      almuerzo: ["Arroz Blanco","Arroz de Moro","Pollo","Cerdo Asado","Ensalada Verde","Papas Fritas","Ensalada Rusa"],
      cena:     ["Parrillada","Hot Dog"],
    },
    sabado: {
      desayuno: ["3 Golpes","Pan con Chocolate"],
      almuerzo: ["Arroz Blanco","Arroz Moro","Yuca","Chivo Guisado","Pollo Frito","Ensalada Verde / Rusa"],
      cena:     ["Parrillada","Hot Dog","Mondongo"],
    },
    domingo: {
      desayuno: ["3 Golpes","Pan con Chocolate"],
      almuerzo: ["Arroz Blanco","Pollo Frito","Ensalada Verde","Papas Fritas","Sancocho"],
      cena:     [],
    },
  },

  menuImgs: {
    desayuno: "https://images.unsplash.com/photo-1528207776546-365bb710ee93?w=800&q=80",
    almuerzo: "https://images.unsplash.com/photo-1547592180-85f173990554?w=800&q=80",
    cena:     "https://images.unsplash.com/photo-1555939594-58d7cb561ad1?w=800&q=80",
  },
};

/* ══════════════════ ESTADO GLOBAL ════════════════════════════════════════ */
let appData    = loadData();
let adminMode  = false;         // derivado de JunteAuth (custom claim), ya no de una contraseña
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
  renderTimelines();
  initTabs();
  renderVillas();
  renderMenus();
  initMenuTabs();
  initNav();
  initUploadModal();
  initPhotoModal();
  initReveal();
  loadEditableTexts();
  initCountdown();

  JunteAuth.subscribe(onAuthState);
});

function onAuthState(state) {
  authState = state;
  adminMode = state.isAdmin;
  document.body.classList.toggle("admin-mode", adminMode);
  document.getElementById("adminBadge").style.display = adminMode ? "flex" : "none";
  document.querySelectorAll(".editable").forEach(el => el.contentEditable = adminMode ? "true" : "false");

  renderVillas();
  renderMenus();
  renderTimelines();

  watchSettings();
  watchMural();
  renderMuralGate();
  renderMuralGrid();
}

/* ══════════════════ PERSISTENCIA (contenido general, no fotos) ═══════════ */
function loadData() {
  try {
    const s = localStorage.getItem("junte_data");
    const d = s ? JSON.parse(s) : null;
    if (!d || !d.villas) return seedFromRoster();
    return d;
  } catch { return seedFromRoster(); }
}

function seedFromRoster() {
  const d = JSON.parse(JSON.stringify(DEFAULT_DATA));
  d.villas = JSON.parse(JSON.stringify(FAMILIES_ROSTER));
  return d;
}

function saveData() {
  localStorage.setItem("junte_data", JSON.stringify(appData));
}

/* ══════════════════ HELPERS ════════════════════════════════════════════ */
function getAllFamilias() {
  return appData.villas.flatMap(v => v.familias.map(f => ({ nombre: f.nombre, villa: v.name })));
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

/* ══════════════════ ITINERARIO ══════════════════════════════════════════ */
function renderTimelines() {
  ["viernes","sabado","domingo"].forEach(day => {
    const el = document.getElementById("timeline-"+day);
    if (!el) return;
    el.innerHTML = appData.agenda[day].map((item,i) => `
      <div class="timeline-item reveal" data-icon="${item.icon}" style="animation-delay:${i*.08}s">
        <div class="timeline-time">🕐 ${escHtml(item.hora)}</div>
        <div class="timeline-act editable" data-key="agenda-${day}-${i}">${escHtml(item.act)}</div>
        ${adminMode
          ? `<button class="btn-del-timeline" onclick="removeAgendaItem('${day}',${i})" title="Eliminar">🗑️</button>`
          : ''}
      </div>`).join("");
    if (adminMode) {
      el.innerHTML += `<div class="add-agenda-wrap">
        <button class="btn-add-agenda" onclick="addAgendaItem('${day}')">＋ Agregar actividad</button>
      </div>`;
    }
  });
}

function addAgendaItem(day) {
  const hora = prompt("Hora (ej: 10:30 AM):");
  if (!hora) return;
  const act  = prompt("Descripción de la actividad:");
  if (!act)  return;
  const icon = prompt("Emoji para el ícono (ej: 🎉):", "📌") || "📌";
  appData.agenda[day].push({ hora: hora.trim(), act: act.trim(), icon: icon.trim() });
  saveData();
  renderTimelines(); forceReveal();
}

function removeAgendaItem(day, i) {
  if (!confirm(`¿Eliminar "${appData.agenda[day][i].act}" del itinerario?`)) return;
  appData.agenda[day].splice(i, 1);
  saveData();
  renderTimelines(); forceReveal();
}

function initTabs() {
  document.querySelectorAll(".day-tab[data-day]").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".day-tab[data-day]").forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".day-panel").forEach(p => p.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById("panel-"+btn.dataset.day).classList.add("active");
    });
  });
}

/* ══════════════════ VILLAS ══════════════════════════════════════════════ */
function renderVillas() {
  const grid = document.getElementById("villasGrid");
  if (!grid) return;
  grid.innerHTML = appData.villas.map((v,vi) => `
    <div class="villa-card reveal" data-vi="${vi}">
      <div class="villa-icon">${v.icon}</div>
      <div class="villa-name editable" data-key="villa-name-${vi}">${v.name}</div>
      <ul class="villa-familia-list">
        ${v.familias.map((f,fi) => `
          <li class="villa-familia-item">
            <span class="familia-nombre editable" data-key="familia-${vi}-${fi}">${f.nombre}</span>
            ${adminMode
              ? `<input class="familia-hab-input" type="text" placeholder="Hab #"
                   value="${escHtml(f.hab)}" onchange="updateFamiliaHab(${vi},${fi},this.value)" />
                 <button class="btn-del-familia" onclick="removeFamilia(${vi},${fi})" title="Eliminar persona">×</button>`
              : `<span class="familia-hab-badge">${f.hab ? '#'+f.hab : '—'}</span>`
            }
          </li>`).join("")}
      </ul>
      ${adminMode ? `
        <div class="villa-admin-btns">
          <button class="btn-admin-sm" onclick="addFamilia(${vi})">+ Agregar</button>
          <button class="btn-admin-sm danger" onclick="removeVilla(${vi})">🗑️ Villa</button>
        </div>` : ""}
    </div>`).join("");
}

function updateFamiliaHab(vi,fi,val) { appData.villas[vi].familias[fi].hab = val.trim(); }

function removeFamilia(vi, fi) {
  const nombre = appData.villas[vi].familias[fi].nombre;
  if (!confirm(`¿Eliminar a "${nombre}" de esta villa?`)) return;
  appData.villas[vi].familias.splice(fi, 1);
  saveData();
  renderVillas(); forceReveal();
}

function addVilla() {
  appData.villas.push({ name:"Nueva Villa", icon:"🏠", familias:[] });
  saveData(); renderVillas(); forceReveal();
}
function removeVilla(vi) {
  if (!confirm("¿Eliminar esta villa?")) return;
  appData.villas.splice(vi,1); saveData(); renderVillas(); forceReveal();
}
function addFamilia(vi) {
  const n = prompt("Nombre de la familia:");
  if (!n) return;
  appData.villas[vi].familias.push({ nombre:n, hab:"" }); saveData(); renderVillas(); forceReveal();
}

/* ══════════════════ MENÚ ════════════════════════════════════════════════ */
function renderMenus() {
  ["viernes","sabado","domingo"].forEach(day => {
    const col = document.getElementById("menu-cols-"+day);
    if (!col) return;
    const m    = appData.menu[day];
    const imgs = appData.menuImgs || DEFAULT_DATA.menuImgs;
    const sections = [
      { key:"desayuno", label:"Desayuno", emoji:"☀️",  color:"#F57F17" },
      { key:"almuerzo", label:"Almuerzo", emoji:"🌤️", color:"#2E7D32" },
      { key:"cena",     label:"Cena",     emoji:"🌙",  color:"#1A237E" },
    ];
    col.innerHTML = sections.map(s => `
      <div class="menu-card reveal">
        <div class="menu-card-img-wrap">
          <img class="menu-card-img" src="${imgs[s.key]}" alt="${s.label}" loading="lazy" />
          <div class="menu-card-badge" style="background:${s.color}">${s.emoji} ${s.label}</div>
        </div>
        <div class="menu-card-body">
          <ul class="menu-dish-list" id="dishes-${day}-${s.key}">
            ${m[s.key].length
              ? m[s.key].map((d,i) => renderDishItem(day,s.key,i,d)).join("")
              : `<li class="dish-empty">—</li>`}
          </ul>
          ${adminMode ? `<button class="btn-add-dish" onclick="addDish('${day}','${s.key}')">+ Agregar plato</button>` : ""}
        </div>
      </div>`).join("");
  });
}

function renderDishItem(day,meal,i,text) {
  return adminMode
    ? `<li class="dish-item">
         <span class="dish-text" contenteditable="true"
           onblur="updateDish('${day}','${meal}',${i},this.textContent)">${escHtml(text)}</span>
         <button class="btn-del-dish" onclick="removeDish('${day}','${meal}',${i})" title="Eliminar">🗑️</button>
       </li>`
    : `<li class="dish-item"><span class="dish-dot"></span>${escHtml(text)}</li>`;
}

function addDish(day,meal) {
  const t = prompt("Nombre del plato:");
  if (!t) return;
  appData.menu[day][meal].push(t); saveData(); renderMenus(); forceReveal();
}
function removeDish(day,meal,i) {
  appData.menu[day][meal].splice(i,1); saveData(); renderMenus(); forceReveal();
}
function updateDish(day,meal,i,val) {
  appData.menu[day][meal][i] = val.trim();
}

function initMenuTabs() {
  document.querySelectorAll(".day-tab[data-menu]").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".day-tab[data-menu]").forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".menu-panel").forEach(p => p.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById("menu-"+btn.dataset.menu).classList.add("active");
    });
  });
}

/* ══════════════════ NAV ═════════════════════════════════════════════════ */
function initNav() {
  const toggle = document.getElementById("navToggle");
  const links  = document.getElementById("navLinks");
  if (toggle) toggle.addEventListener("click", () => links.classList.toggle("open"));
  const obs = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        document.querySelectorAll(".nav-links a").forEach(a => a.classList.remove("active-nav"));
        const m = document.querySelector(`.nav-links a[href="#${e.target.id}"]`);
        if (m) m.classList.add("active-nav");
      }
    });
  }, { threshold:.3 });
  document.querySelectorAll("section[id]").forEach(s => obs.observe(s));
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
        ${appData.villas.map(v =>
          `<button class="filter-btn" onclick="setFilter('${v.name}')">${v.icon} ${v.name}</button>`
        ).join("")}
      </div>
      <div class="mural-table">
        <div class="mural-header-row">
          <div class="mural-cell mural-family-col">Familia</div>
          ${YEARS.map(y => `<div class="mural-cell mural-year-col">${y}</div>`).join("")}
        </div>`;

  appData.villas.forEach(v => {
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
  btns[villaName ? appData.villas.findIndex(v=>v.name===villaName)+1 : 0].classList.add("active");

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

/* ══════════════════ ADMIN: guardar contenido editable ═══════════════════ */
function saveAdminData() {
  document.querySelectorAll(".editable[data-key]").forEach(el => {
    localStorage.setItem("junte_text_"+el.dataset.key, el.textContent.trim());
  });
  appData.villas.forEach((v,vi) => {
    const nameEl = document.querySelector(`[data-key="villa-name-${vi}"]`);
    if (nameEl) v.name = nameEl.textContent.trim();
    v.familias.forEach((f,fi) => {
      const fEl = document.querySelector(`[data-key="familia-${vi}-${fi}"]`);
      if (fEl) f.nombre = fEl.textContent.trim();
    });
  });
  saveData();
  renderMuralGrid();
}

function loadEditableTexts() {
  document.querySelectorAll(".editable[data-key]").forEach(el => {
    const saved = localStorage.getItem("junte_text_"+el.dataset.key);
    if (saved) el.textContent = saved;
  });
}

/* ══════════════════ REVEAL ANIMATION ═══════════════════════════════════ */
function initReveal() {
  const obs = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (e.isIntersecting) { e.target.classList.add("visible"); obs.unobserve(e.target); }
    });
  }, { threshold:.1 });
  document.querySelectorAll(".reveal").forEach(el => obs.observe(el));
}

function forceReveal() {
  document.querySelectorAll(".reveal:not(.visible)").forEach(el => el.classList.add("visible"));
}

/* ══════════════════ GLOBAL EXPORTS ══════════════════════════════════════ */
window.saveAdminData    = saveAdminData;
window.addVilla         = addVilla;
window.addFamilia       = addFamilia;
window.removeVilla      = removeVilla;
window.updateFamiliaHab = updateFamiliaHab;
window.addDish          = addDish;
window.removeDish       = removeDish;
window.updateDish       = updateDish;
window.openUploadModal  = openUploadModal;
window.openPhotoModal   = openPhotoModal;
window.setFilter        = setFilter;
window.removeFamilia    = removeFamilia;
window.addAgendaItem    = addAgendaItem;
window.removeAgendaItem = removeAgendaItem;
