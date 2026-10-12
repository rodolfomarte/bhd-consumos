/* ════════════════════════════════════════════════════════════════════════
   retos.js — "Retos por Villas": tarjetas bloqueadas por defecto, entrega
   del capitán (nombre de equipo + eslogan + una foto) y estado de revisión.
   Todo el HTML por defecto ya muestra "bloqueado" — este script solo
   intenta MEJORAR esa vista si hay datos reales en Firestore. Si algo
   falla, el bloqueo por defecto se queda tal cual (nunca deja la tarjeta
   vacía). Sin IntersectionObserver, sin animaciones obligatorias.

   El bloqueo real vive en firestore.rules / storage.rules (lee
   retoEvidencias, capitanVilla custom claim) — este archivo es solo la UI
   que refleja ese estado; nunca es la fuente de la protección. La
   aprobación, los puntos y el cambio de imagen de la villa los decide
   netlify/functions/review-evidencia.js (admin), nunca este archivo.
   ════════════════════════════════════════════════════════════════════════ */
const VILLA_SLUGS = ["palmera", "perez", "cafe", "cereza", "bosque"];

let authState          = { loading: true };
let retosCache          = {};  // slug -> datos del reto (solo si no está bloqueado)
let evidenciaCache      = {};  // slug -> datos de retoEvidencias/<slug>_<retoId>
let villaImagenesCache  = {};  // slug -> datos de villaImagenes/<slug>
let evidenciaUnsub      = null;
let currentDetailVilla  = null;
let selectedEvidFile    = null;

document.addEventListener("DOMContentLoaded", () => {
  const steps = [
    ["cuenta regresiva",     initRetosCountdown],
    ["retos publicados",     watchRetos],
    ["fotos de villas",      watchVillaImagenes],
    ["modal de detalle",     initDetailModal],
    ["zoom de fotos",        initPhotoZoom],
  ];
  for (const [label, fn] of steps) {
    try { fn(); } catch (err) { console.error(`Error iniciando ${label}:`, err); }
  }

  JunteAuth.subscribe(state => {
    authState = state;
    try { if (currentDetailVilla) renderDetailAccess(); } catch (err) { console.error("Error actualizando detalle:", err); }
  });
});

/* ══════════════════ CUENTA REGRESIVA ═════════════════════════════════════
   El mensaje "🔒 Los retos serán revelados..." ya está en el HTML sin
   depender de esto — esto solo agrega los números debajo. */
function initRetosCountdown() {
  const target = new Date("2026-10-16T07:00:00");
  const el = {
    dias:  document.getElementById("retos-cd-dias"),
    horas: document.getElementById("retos-cd-horas"),
    min:   document.getElementById("retos-cd-min"),
    seg:   document.getElementById("retos-cd-seg"),
  };
  if (!el.dias || !el.horas || !el.min || !el.seg) return; // el mensaje fijo ya cumple su función

  function tick() {
    try {
      const diff = target - new Date();
      if (diff <= 0) {
        const box = document.getElementById("retosCountdown");
        if (box) box.innerHTML = '<div class="cd-block"><span>🎉</span><small>¡Ya casi!</small></div>';
        return;
      }
      const d = Math.floor(diff/86400000);
      const h = Math.floor((diff%86400000)/3600000);
      const m = Math.floor((diff%3600000)/60000);
      const s = Math.floor((diff%60000)/1000);
      el.dias.textContent  = String(d).padStart(2,"0");
      el.horas.textContent = String(h).padStart(2,"0");
      el.min.textContent   = String(m).padStart(2,"0");
      el.seg.textContent   = String(s).padStart(2,"0");
    } catch (err) {
      console.error("Error en cuenta regresiva de retos:", err);
      // el mensaje "🔒 Los retos serán revelados..." sigue ahí, nada se vacía
    }
  }
  tick();
  setInterval(tick, 1000);
}

/* ══════════════════ RETOS DESDE FIRESTORE (opcional, best-effort) ═══════
   Colección "retos", un doc por villa (id = slug). Mientras no exista
   nada (o esté "bloqueado"), las tarjetas se quedan como están en el HTML.
   Las reglas de Firestore son las que de verdad bloquean el contenido —
   esto es solo la UI que refleja ese estado. */
function watchRetos() {
  if (typeof fbDb === "undefined") return; // Firebase no cargó — no pasa nada, queda el HTML fijo
  VILLA_SLUGS.forEach(slug => {
    fbDb.collection("retos").doc(slug).onSnapshot(
      snap => {
        try { applyRetoState(slug, snap.exists ? snap.data() : null); }
        catch (err) { console.error(`Error aplicando reto de ${slug}:`, err); }
      },
      err => console.error(`Error leyendo reto de ${slug}:`, err) // se queda bloqueado, no se rompe nada
    );
  });
}

function applyRetoState(slug, data) {
  const card = document.querySelector(`.reto-card[data-villa="${slug}"]`);
  if (!card || !data || !data.estado || data.estado === "bloqueado") { delete retosCache[slug]; return; } // sigue bloqueado tal cual

  retosCache[slug] = data;

  const statusEl = card.querySelector('[data-role="status"]');
  const msgEl    = card.querySelector('[data-role="msg"]');
  const btnEl    = card.querySelector('[data-role="btn"]');

  if (data.estado === "disponible") {
    statusEl.textContent = "✅ Reto disponible";
    statusEl.classList.remove("locked");
    statusEl.classList.add("open");
    msgEl.textContent = data.titulo || "¡Ya puedes ver tu reto!";
    btnEl.disabled = false;
    btnEl.textContent = "Ver reto";
  } else if (data.estado === "completado") {
    statusEl.textContent = "🏁 Reto completado";
    statusEl.classList.remove("locked");
    statusEl.classList.add("done");
    msgEl.textContent = data.titulo || "¡Villa completó su reto!";
    btnEl.disabled = false;
    btnEl.textContent = "Ver reto";
  }
  btnEl.onclick = () => openRetoDetail(slug);
}

/* ══════════════════ FOTO APROBADA DE CADA VILLA ══════════════════════════
   villaImagenes/<slug> — solo existe/tiene url cuando el admin aprobó una
   entrega. Mientras no haya nada, la tarjeta se queda con su ícono de
   siempre (nunca un hueco en blanco). */
function watchVillaImagenes() {
  if (typeof fbDb === "undefined") return;
  VILLA_SLUGS.forEach(slug => {
    fbDb.collection("villaImagenes").doc(slug).onSnapshot(
      snap => {
        villaImagenesCache[slug] = (snap.exists && snap.data().url) ? snap.data() : null;
        try { applyVillaImagen(slug); } catch (err) { console.error(`Error mostrando foto de ${slug}:`, err); }
        try { if (currentDetailVilla === slug) renderDetailPhoto(); } catch (err) { console.error(err); }
      },
      err => console.error(`Error leyendo foto de ${slug}:`, err) // se queda con el ícono, no pasa nada
    );
  });
}

function applyVillaImagen(slug) {
  const card = document.querySelector(`.reto-card[data-villa="${slug}"]`);
  if (!card) return;
  const icon  = card.querySelector('[data-role="icon"]');
  const photo = card.querySelector('[data-role="photo"]');
  if (!icon || !photo) return;
  const img = villaImagenesCache[slug];
  if (img && img.url) {
    photo.src = img.url;
    photo.style.display = "block";
    icon.style.display = "none";
  } else {
    photo.style.display = "none";
    icon.style.display = "";
  }
}

function renderDetailPhoto() {
  const el = document.getElementById("detailVillaPhoto");
  if (!el || !currentDetailVilla) return;
  const img = villaImagenesCache[currentDetailVilla];
  if (img && img.url) {
    el.src = img.url;
    el.style.display = "block";
  } else {
    el.style.display = "none";
  }
}

/* ══════════════════ ZOOM DE FOTOS (tarjetas + detalle) ═══════════════════ */
function initPhotoZoom() {
  const modal = document.getElementById("retoPhotoZoomModal");
  const img   = document.getElementById("retoPhotoZoomImg");
  if (!modal || !img) return;

  function open(src) {
    if (!src) return;
    img.src = src;
    modal.classList.add("open");
    document.body.style.overflow = "hidden";
  }
  function close() {
    modal.classList.remove("open");
    document.body.style.overflow = "";
  }

  document.getElementById("retoPhotoZoomModalBg").addEventListener("click", close);
  document.getElementById("retoPhotoZoomClose").addEventListener("click", close);

  document.querySelectorAll('.reto-card-photo[data-role="photo"]').forEach(el => {
    el.addEventListener("click", () => open(el.src));
  });
  const detailPhoto = document.getElementById("detailVillaPhoto");
  if (detailPhoto) detailPhoto.addEventListener("click", () => open(detailPhoto.src));
}

/* ══════════════════ MODAL DE DETALLE + ENTREGA DEL CAPITÁN ═══════════════ */
function initDetailModal() {
  const modal = document.getElementById("retoDetailModal");
  if (!modal) return; // si el HTML no trae el modal, nada se rompe

  document.getElementById("retoDetailModalBg").addEventListener("click", closeRetoDetail);
  document.getElementById("retoDetailClose").addEventListener("click", closeRetoDetail);

  const fileInput = document.getElementById("evidFileInput");
  fileInput.addEventListener("change", e => {
    selectedEvidFile = e.target.files[0] || null;
    const preview = document.getElementById("evidFotoPreview");
    if (selectedEvidFile) {
      preview.src = URL.createObjectURL(selectedEvidFile);
      preview.style.display = "block";
    }
  });

  document.getElementById("detailCaptainForm").addEventListener("submit", e => {
    e.preventDefault();
    submitEvidencia();
  });
}

function villaNombreDesdeSlug(slug) {
  const card = document.querySelector(`.reto-card[data-villa="${slug}"] .villa-name`);
  return card ? card.textContent : slug;
}

function openRetoDetail(slug) {
  const reto = retosCache[slug];
  if (!reto) return;
  currentDetailVilla = slug;

  document.getElementById("detailVillaName").textContent = villaNombreDesdeSlug(slug);
  document.getElementById("detailTitulo").textContent    = reto.titulo || "";
  document.getElementById("detailObjetivo").textContent  = reto.objetivo || "";
  document.getElementById("detailPuntos").textContent    = (reto.puntos != null) ? `${reto.puntos} pts` : "—";
  document.getElementById("detailFecha").textContent     = formatFechaLimite(reto.fechaLimite);
  renderDetailPhoto();

  selectedEvidFile = null;
  document.getElementById("evidFileInput").value = "";
  document.getElementById("evidFotoPreview").style.display = "none";
  document.getElementById("evidUploadProgressWrap").style.display = "none";
  document.getElementById("detailEvidMsg").textContent = "";

  watchEvidenciaFor(slug, reto.retoId);
  renderDetailAccess();

  document.getElementById("retoDetailModal").classList.add("open");
  document.body.style.overflow = "hidden";
}

function closeRetoDetail() {
  document.getElementById("retoDetailModal").classList.remove("open");
  document.body.style.overflow = "";
  if (evidenciaUnsub) { evidenciaUnsub(); evidenciaUnsub = null; }
  currentDetailVilla = null;
}

function watchEvidenciaFor(slug, retoId) {
  if (evidenciaUnsub) { evidenciaUnsub(); evidenciaUnsub = null; }
  if (typeof fbDb === "undefined") return;
  const docId = `${slug}_${retoId}`;
  evidenciaUnsub = fbDb.collection("retoEvidencias").doc(docId).onSnapshot(
    snap => {
      evidenciaCache[slug] = snap.exists ? snap.data() : null;
      try { renderDetailAccess(); } catch (err) { console.error("Error mostrando evidencia:", err); }
    },
    err => console.error(`Error leyendo evidencia de ${slug}:`, err)
  );
}

// Una entrega se puede editar mientras no exista todavía, o mientras el
// admin pidió corrección — nunca mientras está pendiente o ya aprobada.
function isEditable(evid) {
  return !evid || evid.estado === "correccion";
}

// Decide si se muestra el formulario del capitán o la vista de solo lectura,
// y rellena ambas con lo que haya en evidenciaCache — se llama cada vez que
// cambia el estado de auth o llega una actualización de la evidencia.
function renderDetailAccess() {
  if (!currentDetailVilla) return;
  const slug  = currentDetailVilla;
  const evid  = evidenciaCache[slug] || null;
  const isCaptain = authState.capitanVilla === slug;

  document.getElementById("detailCaptainForm").style.display = isCaptain ? "flex" : "none";
  document.getElementById("detailViewOnly").style.display    = isCaptain ? "none" : "block";

  if (isCaptain) {
    document.getElementById("evidNombreEquipo").value = evid?.nombreEquipo || "";
    document.getElementById("evidEslogan").value      = evid?.eslogan || "";
    const preview = document.getElementById("evidFotoPreview");
    if (!selectedEvidFile && evid?.fotoUrl) {
      preview.src = evid.fotoUrl;
      preview.style.display = "block";
    }

    const editable = isEditable(evid);
    const form = document.getElementById("detailCaptainForm");
    form.querySelectorAll("input, button[type=submit]").forEach(el => { el.disabled = !editable; });
    form.querySelector(".file-label").style.opacity = editable ? "1" : ".5";
    form.querySelector(".file-label").style.pointerEvents = editable ? "" : "none";

    const statusLine = document.getElementById("evidCurrentStatus");
    if (evid) {
      statusLine.style.display = "block";
      let extra = "";
      if (!editable && evid.estado === "pendiente") extra = "<p class=\"account-hint\">Tu entrega está en revisión — no se puede editar hasta que el administrador responda.</p>";
      if (!editable && evid.estado === "aprobado")  extra = "<p class=\"account-hint\">¡Tu entrega fue aprobada! Ya no se puede editar.</p>";
      statusLine.innerHTML = `Estado actual: <span class="reto-status-badge ${badgeClassFor(evid.estado)}">${badgeLabelFor(evid.estado)}</span>` +
        (evid.tardia ? ' <span class="evidencia-badge-tardia">Tardía</span>' : "") +
        (evid.comentarioAdmin ? `<p class="reto-admin-comment">💬 ${escRetos(evid.comentarioAdmin)}</p>` : "") + extra;
    } else {
      statusLine.style.display = "none";
      statusLine.innerHTML = "";
    }
  } else {
    const viewWrap = document.getElementById("detailViewOnly");
    if (!evid) {
      viewWrap.innerHTML = `<p class="account-hint">Esta villa aún no ha enviado su entrega.</p>`;
    } else {
      viewWrap.innerHTML = `
        <h4>Entrega de la villa</h4>
        <p><strong>${escRetos(evid.nombreEquipo || "—")}</strong></p>
        <p class="reto-detail-objetivo">${escRetos(evid.eslogan || "")}</p>
        <span class="reto-status-badge ${badgeClassFor(evid.estado)}">${badgeLabelFor(evid.estado)}</span>
        ${evid.tardia ? '<span class="evidencia-badge-tardia">Tardía</span>' : ""}
        ${evid.fotoUrl ? `<img src="${evid.fotoUrl}" alt="Foto del equipo" class="reto-detail-photo" style="margin-top:10px;cursor:zoom-in" onclick="document.getElementById('retoPhotoZoomImg').src=this.src;document.getElementById('retoPhotoZoomModal').classList.add('open');document.body.style.overflow='hidden';" />` : ""}
      `;
    }
  }
}

function badgeClassFor(estado) {
  if (estado === "aprobado") return "open";
  if (estado === "correccion") return "done";
  return "locked"; // pendiente
}
function badgeLabelFor(estado) {
  return {
    pendiente: "⏳ Pendiente de validación",
    correccion: "✏️ Corrección solicitada",
    aprobado: "✅ Aprobado",
  }[estado] || "⏳ Pendiente de validación";
}

function formatFechaLimite(fecha) {
  if (!fecha) return "Sin fecha límite";
  try {
    const d = fecha.toDate ? fecha.toDate() : new Date(fecha);
    return d.toLocaleString("es-DO", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  } catch { return "—"; }
}

function fechaLimiteMillis(fecha) {
  if (!fecha) return null;
  try { return (fecha.toDate ? fecha.toDate() : new Date(fecha)).getTime(); } catch { return null; }
}

function escRetos(s) {
  return String(s ?? "").replace(/[&<>"']/g, c =>
    ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}

async function submitEvidencia() {
  const slug = currentDetailVilla;
  const msg  = document.getElementById("detailEvidMsg");
  if (!slug || authState.capitanVilla !== slug) {
    msg.textContent = "Solo el capitán de esta villa puede enviar la entrega.";
    return;
  }
  const reto = retosCache[slug];
  if (!reto) { msg.textContent = "Este reto ya no está disponible."; return; }

  const existing = evidenciaCache[slug] || null;
  if (!isEditable(existing)) {
    msg.textContent = "Esta entrega no se puede modificar en su estado actual.";
    return;
  }

  const nombreEquipo = document.getElementById("evidNombreEquipo").value.trim();
  const eslogan      = document.getElementById("evidEslogan").value.trim();
  if (!nombreEquipo || !eslogan) {
    msg.textContent = "Completa el nombre del equipo y el eslogan.";
    return;
  }
  if (!selectedEvidFile && !existing?.fotoUrl) {
    msg.textContent = "La foto del equipo es obligatoria.";
    return;
  }
  if (selectedEvidFile && !selectedEvidFile.type.startsWith("image/")) {
    msg.textContent = "El archivo debe ser una foto (imagen).";
    return;
  }
  if (selectedEvidFile && selectedEvidFile.size > 25 * 1024 * 1024) {
    msg.textContent = "La foto es demasiado grande (máximo 25 MB).";
    return;
  }

  const btn = document.querySelector('#detailCaptainForm button[type="submit"]');
  const progressWrap = document.getElementById("evidUploadProgressWrap");
  const progressFill = document.getElementById("evidUploadProgressFill");
  btn.disabled = true;
  msg.textContent = "Enviando… ⏳";

  try {
    // Token fresco: si Rodolfo acaba de asignar el capitán, el claim podría
    // no haber llegado aún a la sesión abierta de esta persona.
    await JunteAuth.refreshClaims();
    if (authState.capitanVilla !== slug) {
      msg.textContent = "Tu cuenta no está registrada como capitán de esta villa todavía.";
      btn.disabled = false;
      return;
    }

    let fotoUrl  = existing?.fotoUrl || null;
    let fotoPath = existing?.fotoPath || null;

    if (selectedEvidFile) {
      let fileToUpload = selectedEvidFile;
      try { fileToUpload = await compressImage(selectedEvidFile); } catch { /* usa el original si falla */ }

      const path = `retos/${slug}/${reto.retoId}/${Date.now()}_${fileToUpload.name}`;
      const ref  = fbStorage.ref(path);
      progressWrap.style.display = "block";
      progressFill.style.width = "0%";

      await new Promise((resolve, reject) => {
        const task = ref.put(fileToUpload, { contentType: fileToUpload.type });
        task.on("state_changed",
          snap => {
            const pct = Math.round((snap.bytesTransferred / snap.totalBytes) * 100);
            progressFill.style.width = pct + "%";
            msg.textContent = `Subiendo foto… ${pct}%`;
          },
          err => reject(err),
          () => resolve()
        );
      });
      fotoUrl  = await ref.getDownloadURL();
      fotoPath = path;
    }

    const tardia = (() => {
      const limite = fechaLimiteMillis(reto.fechaLimite);
      return limite ? Date.now() > limite : false;
    })();

    const docId = `${slug}_${reto.retoId}`;
    const nombreCapitan = authState.profile?.nombre || "";
    const historialEntry = {
      accion: existing ? "reenviado" : "enviado",
      por: authState.user.uid,
      porNombre: nombreCapitan,
      en: new Date(),
      comentario: null,
    };

    if (existing) {
      // Reenvío: solo se tocan los campos que el capitán puede cambiar —
      // villa/retoId/uid/puntosOtorgados/comentarioAdmin/imagenAnterior*
      // se quedan tal cual (así lo exige la regla de Firestore).
      await fbDb.collection("retoEvidencias").doc(docId).update({
        nombreEquipo, eslogan, fotoUrl, fotoPath, tardia,
        estado: "pendiente",
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        historial: firebase.firestore.FieldValue.arrayUnion(historialEntry),
      });
    } else {
      await fbDb.collection("retoEvidencias").doc(docId).set({
        villa: slug,
        retoId: reto.retoId,
        uid: authState.user.uid,
        nombreUsuario: nombreCapitan,
        nombreEquipo, eslogan, fotoUrl, fotoPath, tardia,
        estado: "pendiente",
        puntosOtorgados: 0,
        imagenAnteriorUrl: null,
        imagenAnteriorPath: null,
        comentarioAdmin: null,
        historial: [historialEntry],
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
    }

    selectedEvidFile = null;
    document.getElementById("evidFileInput").value = "";
    progressWrap.style.display = "none";
    msg.textContent = "✅ Entrega enviada. Rodolfo la revisará pronto.";
  } catch (err) {
    console.error("Error enviando evidencia:", err);
    msg.textContent = "❌ " + err.message;
  } finally {
    btn.disabled = false;
  }
}
