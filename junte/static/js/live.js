/* ════════════════════════════════════════════════════════════════════════
   Junte Familiar CND 2026 — live.js  v3 (Firebase Auth + Firestore + Storage)
   Fotos compartidas en tiempo real, con acceso por familia aprobada.
   ════════════════════════════════════════════════════════════════════════ */

const DEFAULT_ACTIVITIES = [
  { id:"camino",     label:"De camino a las Guazaras",  icon:"🚌" },
  { id:"habitac",    label:"Esperando habitaciones",    icon:"🏡" },
  { id:"desayuno",   label:"Desayuno",                  icon:"☕" },
  { id:"comida",     label:"Comida",                    icon:"🍽️" },
  { id:"cena",       label:"Cena",                      icon:"🌙" },
  { id:"deportiva",  label:"Actividad deportiva",       icon:"⚽" },
  { id:"piscina",    label:"En la piscina",             icon:"🏊" },
  { id:"sebastian",  label:"Cumpleaños de Sebastián",   icon:"🎂" },
  { id:"karaoke",    label:"Karaoke",                   icon:"🎤" },
  { id:"espuma",     label:"Fiesta de espuma",          icon:"🫧" },
  { id:"senderismo", label:"Senderismo",                icon:"🥾" },
  { id:"otros",      label:"Otros",                     icon:"✨" },
];

let authState      = { loading: true };
let activities      = [];
let photos          = [];
let galleryEnabled   = false;
let activeActivity   = null;
let liveFile         = null;
let currentPhotoId   = null;
let photosUnsub = null, settingsUnsub = null, activitiesUnsub = null;

/* ══════════════════ INIT ═════════════════════════════════════════════════ */
document.addEventListener("DOMContentLoaded", () => {
  renderFilterBar();
  renderFeed();
  initUploadModal();
  initPhotoModal();

  JunteAuth.subscribe(onAuthState);
});

function onAuthState(state) {
  authState = state;
  document.body.classList.toggle("admin-mode", state.isAdmin);
  document.getElementById("adminBadge").style.display = state.isAdmin ? "flex" : "none";

  watchSettings();
  watchActivities(); // re-suscribe: logueado/aprobado puede ganar acceso que antes no tenía
  watchPhotos();
  renderLiveGate();
  renderFilterBar();
  renderFeed();
  updateHeroCount();
}

/* ══════════════════ HELPERS ══════════════════════════════════════════════ */
function escHtml(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}

function timeAgo(isoStr) {
  const diff = Date.now() - new Date(isoStr).getTime();
  const min  = Math.floor(diff / 60000);
  if (min < 1)  return "ahora mismo";
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24)   return `hace ${h}h`;
  return `hace ${Math.floor(h / 24)}d`;
}

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function getActivity(id) {
  return activities.find(a => a.id === id) || { label: id, icon: "📷" };
}

function myFamiliaSlug()  { return authState.profile?.familia || null; }
function myFamiliaLabel() { return authState.profile?.familiaLabel || null; }

/* ══════════════════ ACTIVIDADES (admin-managed, Firestore) ═══════════════ */
function watchActivities() {
  if (activitiesUnsub) { activitiesUnsub(); activitiesUnsub = null; }
  activitiesUnsub = fbDb.collection("liveActivities").onSnapshot(async snap => {
    if (snap.empty) {
      activities = DEFAULT_ACTIVITIES.slice();
      renderActivitySelect();
      renderFilterBar();
      if (authState.isAdmin) await seedDefaultActivities();
      return;
    }
    activities = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderActivitySelect();
    renderFilterBar();
  }, err => {
    console.error("Activities error:", err);
    activities = DEFAULT_ACTIVITIES.slice();
    renderActivitySelect();
  });
}

async function seedDefaultActivities() {
  const batch = fbDb.batch();
  DEFAULT_ACTIVITIES.forEach(a => {
    batch.set(fbDb.collection("liveActivities").doc(a.id), { label: a.label, icon: a.icon });
  });
  try { await batch.commit(); } catch (err) { console.error("Seed activities error:", err); }
}

/* ══════════════════ GATE / SETTINGS ═══════════════════════════════════════ */
function watchSettings() {
  if (settingsUnsub) { settingsUnsub(); settingsUnsub = null; }
  settingsUnsub = fbDb.collection("config").doc("settings").onSnapshot(
    snap => {
      const next = !!(snap.exists && snap.data().galleryEnabledForUsers);
      if (next !== galleryEnabled) { galleryEnabled = next; watchPhotos(); }
      renderFeed();
    },
    () => { galleryEnabled = false; }
  );
}

function renderLiveGate() {
  const wrap = document.getElementById("liveGateWrap");
  if (!wrap) return;
  const unlocked = authState.isAdmin || authState.isApproved;
  wrap.style.display = unlocked ? "none" : "block";
  document.getElementById("liveFeedSection").style.display = unlocked ? "" : "none";
  document.getElementById("btnOpenLiveUpload").style.display = unlocked ? "" : "none";
  if (unlocked) return;

  if (!authState.user) {
    wrap.innerHTML = gateHtml("👪 Inicia sesión para ver Junte en Vivo", "El feed en vivo es solo para familias registradas y aprobadas.");
  } else if (authState.profile?.status === "pending") {
    wrap.innerHTML = gateHtml("⏳ Pendiente de aprobación de Rodolfo", "Tu cuenta está esperando revisión. Te avisaremos cuando esté lista.");
  } else if (authState.profile?.status === "rejected") {
    wrap.innerHTML = gateHtml("❌ Solicitud rechazada", "Contacta al administrador del Junte si crees que es un error.", true);
  } else if (authState.profile?.status === "suspended") {
    wrap.innerHTML = gateHtml("🚫 Cuenta suspendida", "Tu acceso fue suspendido. Contacta al administrador del Junte.", true);
  } else {
    wrap.innerHTML = gateHtml("👪 Feed exclusivo para familias", "Inicia sesión con tu cuenta aprobada para continuar.");
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

/* ══════════════════ FOTOS (Firestore) ═════════════════════════════════════ */
function watchPhotos() {
  if (photosUnsub) { photosUnsub(); photosUnsub = null; }
  photos = [];
  if (!authState.isApproved && !authState.isAdmin) { renderFeed(); return; }

  const canSeeAll = authState.isAdmin || galleryEnabled;
  const query = (canSeeAll
    ? fbDb.collection("livePhotos")
    : fbDb.collection("livePhotos").where("familia", "==", myFamiliaSlug())
  ).orderBy("fecha", "desc");

  photosUnsub = query.onSnapshot(snapshot => {
    photos = snapshot.docs.map(d => {
      const data = d.data();
      return {
        id: d.id,
        familia: data.familia || "",
        familiaLabel: data.familiaLabel || data.familia || "",
        actividadId: data.actividadId || "",
        comentario: data.comentario || "",
        url: data.url || "",
        fecha: data.fecha?.toDate?.()?.toISOString() || new Date().toISOString(),
        likes: data.likes || [],
        comments: data.comments || [],
      };
    });
    renderFilterBar();
    renderFeed();
    updateHeroCount();
    if (currentPhotoId) {
      const modal = document.getElementById("livePhotoModal");
      if (modal?.classList.contains("open")) { renderLiveLikes(); renderLiveComments(); }
    }
  }, err => console.error("Firestore error:", err));
}

/* ══════════════════ ACTIVITY SELECT ══════════════════════════════════════ */
function renderActivitySelect() {
  const sel = document.getElementById("liveActividadSelect");
  if (sel) sel.innerHTML = activities.map(a =>
    `<option value="${escHtml(a.id)}">${a.icon} ${escHtml(a.label)}</option>`
  ).join("");
}

/* ══════════════════ FILTER BAR ══════════════════════════════════════════ */
function renderFilterBar() {
  const bar = document.getElementById("liveFilterBar");
  if (!bar) return;

  let html = `<button class="filter-btn ${!activeActivity ? 'active' : ''}" onclick="setLiveFilter(null)">
    Todas <span class="filter-count">${photos.length}</span>
  </button>`;

  activities.forEach(a => {
    const count = photos.filter(p => p.actividadId === a.id).length;
    if (count > 0 || authState.isAdmin) {
      html += `<button class="filter-btn ${activeActivity === a.id ? 'active' : ''}"
                 onclick="setLiveFilter('${a.id}')">
        ${a.icon} ${escHtml(a.label)}
        ${count > 0 ? `<span class="filter-count">${count}</span>` : ''}
      </button>`;
    }
  });

  bar.innerHTML = html;
}

function setLiveFilter(actId) {
  activeActivity = actId;
  renderFilterBar();
  renderFeed();
}

/* ══════════════════ FEED ═════════════════════════════════════════════════ */
function renderFeed() {
  const feed  = document.getElementById("liveFeed");
  const empty = document.getElementById("liveFeedEmpty");
  if (!authState.isAdmin && !authState.isApproved) { feed.innerHTML = ""; empty.style.display = "none"; return; }

  let list = [...photos];
  if (activeActivity) list = list.filter(p => p.actividadId === activeActivity);

  if (!list.length) {
    feed.innerHTML = "";
    empty.style.display = "block";
    return;
  }
  empty.style.display = "none";
  feed.innerHTML = list.map(p => renderCard(p)).join("");
}

function renderCard(photo) {
  const act      = getActivity(photo.actividadId);
  const likes    = photo.likes    ? photo.likes.length    : 0;
  const comments = photo.comments ? photo.comments.length : 0;

  return `
    <div class="live-photo-card" onclick="openLivePhotoModal('${photo.id}')">
      <div class="live-card-img-wrap">
        <img src="${photo.url}" alt="${escHtml(photo.familiaLabel)}" loading="lazy" />
        <div class="live-card-act-badge">${act.icon} ${escHtml(act.label)}</div>
        ${canDeletePhoto(photo)
          ? `<button class="live-card-delete"
               onclick="event.stopPropagation();quickDeletePhoto('${photo.id}')"
               title="Eliminar">🗑️</button>`
          : ''}
      </div>
      <div class="live-card-body">
        <div class="live-card-familia">👨‍👩‍👧 ${escHtml(photo.familiaLabel)}</div>
        ${photo.comentario
          ? `<p class="live-card-comment">${escHtml(photo.comentario)}</p>`
          : ''}
        <div class="live-card-meta">
          <span class="live-card-time">${timeAgo(photo.fecha)}</span>
          <span class="live-card-stats">❤️ ${likes} &nbsp;💬 ${comments}</span>
        </div>
      </div>
    </div>`;
}

function updateHeroCount() {
  const el = document.getElementById("liveHeroCount");
  if (!el) return;
  const n = photos.length;
  el.textContent = n > 0 ? `${n} foto${n === 1 ? '' : 's'} compartida${n === 1 ? '' : 's'}` : '';
}

/* ══════════════════ UPLOAD MODAL ═════════════════════════════════════════ */
function initUploadModal() {
  document.getElementById("btnOpenLiveUpload").addEventListener("click", () => {
    if (!authState.isApproved) { alert("Necesitas una cuenta aprobada para subir fotos. Ve a Mi Cuenta."); return; }
    openLiveUploadModal(null);
  });
  document.getElementById("btnCancelLiveUpload").addEventListener("click", closeLiveUploadModal);
  document.getElementById("liveUploadModalBg").addEventListener("click", closeLiveUploadModal);
  document.getElementById("btnDoLiveUpload").addEventListener("click", doLiveUpload);
  document.getElementById("livePhotoInput").addEventListener("change", async e => {
    const original = e.target.files[0];
    if (!original) return;
    const status = document.getElementById("liveStatusMsg");
    status.textContent = "Comprimiendo imagen... ⏳";
    try {
      liveFile = await compressImage(original);
    } catch (err) {
      console.error("Compress error:", err);
      liveFile = original;
    }
    status.textContent = "";
    const prev = document.getElementById("liveImgPreview");
    prev.src = URL.createObjectURL(liveFile);
    prev.style.display = "block";
  });
}

function openLiveUploadModal(actId) {
  liveFile = null;
  const prev = document.getElementById("liveImgPreview");
  prev.src = ""; prev.style.display = "none";
  document.getElementById("livePhotoInput").value      = "";
  document.getElementById("liveCommentInput").value    = "";
  document.getElementById("liveStatusMsg").textContent = "";
  document.getElementById("btnDoLiveUpload").disabled  = false;
  document.getElementById("liveFamiliaLabel").textContent = myFamiliaLabel() || "";
  if (actId) document.getElementById("liveActividadSelect").value = actId;
  document.getElementById("liveUploadModal").classList.add("open");
  document.body.style.overflow = "hidden";
}

function closeLiveUploadModal() {
  document.getElementById("liveUploadModal").classList.remove("open");
  document.body.style.overflow = "";
}

async function doLiveUpload() {
  const actividadId = document.getElementById("liveActividadSelect").value;
  const comentario  = document.getElementById("liveCommentInput").value.trim();
  const status      = document.getElementById("liveStatusMsg");
  const btn         = document.getElementById("btnDoLiveUpload");

  if (!actividadId)  { status.textContent = "⚠️ Selecciona la actividad."; return; }
  if (!liveFile)     { status.textContent = "⚠️ Selecciona una imagen.";   return; }

  status.textContent = "Verificando espacio disponible... ⏳";
  btn.disabled = true;

  let quota;
  try {
    quota = await JunteAuth.callFunction("check-storage-quota", { method: "POST", body: { bytes: liveFile.size } });
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
    const id = genId();
    const storageRef = fbStorage.ref(`live/${myFamiliaSlug()}/${id}`);
    await storageRef.put(liveFile, { contentType: liveFile.type });
    const url = await storageRef.getDownloadURL();

    await fbDb.collection("livePhotos").doc(id).set({
      familia:       myFamiliaSlug(),
      familiaLabel:  myFamiliaLabel(),
      actividadId,
      comentario,
      url,
      uploaderUid:   authState.user.uid,
      uploaderEmail: authState.user.email,
      fecha:    firebase.firestore.FieldValue.serverTimestamp(),
      likes:    [],
      comments: [],
    });

    closeLiveUploadModal();
  } catch(err) {
    console.error("Upload error:", err);
    status.textContent = "❌ Error al subir: " + err.message;
  } finally {
    btn.disabled = false;
  }
}

/* ══════════════════ PHOTO VIEW MODAL ════════════════════════════════════ */
function initPhotoModal() {
  document.getElementById("livePhotoModalBg").addEventListener("click",    closeLivePhotoModal);
  document.getElementById("livePhotoModalClose").addEventListener("click", closeLivePhotoModal);
  document.getElementById("liveBtnLike").addEventListener("click",    doLiveLike);
  document.getElementById("liveBtnComment").addEventListener("click",  doLiveComment);
}

function openLivePhotoModal(id) {
  currentPhotoId = id;
  const photo = photos.find(p => p.id === id);
  if (!photo) return;

  const act = getActivity(photo.actividadId);

  document.getElementById("liveModalImg").src               = photo.url;
  document.getElementById("liveModalFamilia").textContent   = photo.familiaLabel;
  document.getElementById("liveModalActividad").textContent = `${act.icon} ${act.label}`;
  document.getElementById("liveModalDesc").textContent      = photo.comentario || "";
  document.getElementById("liveModalFecha").textContent     = new Date(photo.fecha).toLocaleString("es-DO");
  document.getElementById("liveModalDownload").href         = photo.url;
  document.getElementById("liveModalDownload").download     =
    `${photo.familiaLabel.replace(/ /g, "_")}_${act.label.replace(/ /g, "_")}.jpg`;

  renderLiveLikes();
  renderLiveComments();
  document.getElementById("liveCommentTexto").value  = "";

  const del = document.getElementById("liveAdminDelete");
  if (del) del.style.display = canDeletePhoto(photo) ? "block" : "none";

  document.getElementById("livePhotoModal").classList.add("open");
  document.body.style.overflow = "hidden";
}

function closeLivePhotoModal() {
  document.getElementById("livePhotoModal").classList.remove("open");
  document.body.style.overflow = "";
  currentPhotoId = null;
}

function renderLiveLikes() {
  const photo = photos.find(p => p.id === currentPhotoId);
  if (!photo) return;
  const likes = photo.likes || [];
  document.getElementById("liveBtnLike").innerHTML = `❤️ ${likes.length} ${likes.length === 1 ? "like" : "likes"}`;
  document.getElementById("liveLikeNames").innerHTML = likes.length
    ? `<div class="like-names">${likes.slice(-5).map(l => `<span>${escHtml(l.nombre)}</span>`).join(" ")}</div>`
    : "";
}

function renderLiveComments() {
  const photo = photos.find(p => p.id === currentPhotoId);
  const list  = document.getElementById("liveCommentsList");
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

async function doLiveLike() {
  if (!authState.isApproved) return;
  const photo = photos.find(p => p.id === currentPhotoId);
  if (!photo) return;
  if ((photo.likes || []).some(l => l.uid === authState.user.uid)) { alert("¡Ya diste like!"); return; }

  try {
    await fbDb.collection("livePhotos").doc(currentPhotoId).update({
      likes: firebase.firestore.FieldValue.arrayUnion({ uid: authState.user.uid, nombre: authState.profile.nombre }),
    });
  } catch(err) {
    console.error("Like error:", err);
    alert("Error al guardar: " + err.message);
  }
}

async function doLiveComment() {
  if (!authState.isApproved) return;
  const texto = document.getElementById("liveCommentTexto").value.trim();
  if (!texto) { alert("Escribe un comentario."); return; }

  const comment = { uid: authState.user.uid, nombre: authState.profile.nombre, texto, fecha: new Date().toLocaleString("es-DO") };

  try {
    await fbDb.collection("livePhotos").doc(currentPhotoId).update({
      comments: firebase.firestore.FieldValue.arrayUnion(comment),
    });
    document.getElementById("liveCommentTexto").value = "";
  } catch(err) {
    console.error("Comment error:", err);
    alert("Error al guardar: " + err.message);
  }
}

/* ══════════════════ ADMIN ════════════════════════════════════════════════ */
function addActivity() {
  if (!authState.isAdmin) return;
  const label = prompt("Nombre de la nueva actividad:");
  if (!label) return;
  const icon = prompt("Emoji para la actividad (ej: 🎵):", "📷") || "📷";
  const id   = JunteAuth.slugify(label).slice(0, 20) || genId();
  fbDb.collection("liveActivities").doc(id).set({ label: label.trim(), icon: icon.trim() })
    .catch(err => alert("Error: " + err.message));
}

function showActivityManager() {
  const div = document.getElementById("activityManager");
  div.style.display = "block";
  div.innerHTML = `
    <h4 style="margin-bottom:10px;color:var(--green-dark);font-size:.95rem">Actividades (${activities.length})</h4>
    <div style="display:flex;flex-direction:column;gap:6px;max-height:240px;overflow-y:auto">
      ${activities.map(a => {
        const count = photos.filter(p => p.actividadId === a.id).length;
        return `<div style="display:flex;align-items:center;gap:8px;padding:4px 0;border-bottom:1px solid #f0f0f0">
          <span style="flex:1;font-size:.85rem">${a.icon} ${escHtml(a.label)}</span>
          <span style="font-size:.75rem;color:#aaa">${count} foto${count !== 1 ? 's' : ''}</span>
          <button class="btn-admin-sm danger" onclick="removeActivity('${a.id}')">🗑️</button>
        </div>`;
      }).join("")}
    </div>`;
}

async function removeActivity(id) {
  const act   = activities.find(a => a.id === id);
  const count = photos.filter(p => p.actividadId === id).length;
  const msg   = count > 0
    ? `¿Eliminar "${act.label}"?\nTiene ${count} foto(s) — seguirán visibles bajo su nombre.`
    : `¿Eliminar la actividad "${act.label}"?`;
  if (!confirm(msg)) return;
  try {
    await fbDb.collection("liveActivities").doc(id).delete();
    showActivityManager();
  } catch (err) { alert("Error: " + err.message); }
}

function canDeletePhoto(photo) {
  return authState.isAdmin || (authState.isApproved && photo.familia === myFamiliaSlug());
}

async function quickDeletePhoto(id) {
  const photo = photos.find(p => p.id === id);
  if (!photo || !canDeletePhoto(photo)) return;
  if (!confirm("¿Eliminar esta foto?")) return;
  try {
    await fbDb.collection("livePhotos").doc(id).delete();
    // Las fotos nuevas viven en live/<familia>/<id>; las de antes del
    // 2026-10-13 en live/<id> (sin familia) — se intenta la ruta nueva y,
    // si no existe ahí, la vieja, sin romper nada si ninguna aplica.
    try { await fbStorage.ref(`live/${photo.familia}/${id}`).delete(); }
    catch { try { await fbStorage.ref(`live/${id}`).delete(); } catch {} }
  } catch(err) {
    console.error("Delete error:", err);
    alert("Error al eliminar: " + err.message);
  }
}

function deleteLivePhoto() {
  const id = currentPhotoId;
  closeLivePhotoModal();
  quickDeletePhoto(id);
}

/* ══════════════════ GLOBAL EXPORTS ══════════════════════════════════════ */
window.setLiveFilter        = setLiveFilter;
window.openLiveUploadModal  = openLiveUploadModal;
window.openLivePhotoModal   = openLivePhotoModal;
window.addActivity          = addActivity;
window.showActivityManager  = showActivityManager;
window.removeActivity       = removeActivity;
window.quickDeletePhoto     = quickDeletePhoto;
window.deleteLivePhoto      = deleteLivePhoto;
