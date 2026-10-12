/* ════════════════════════════════════════════════════════════════════════
   retos.js — "Retos por Villas".
   Todo el HTML por defecto ya muestra "bloqueado" — este script solo
   intenta MEJORAR esa vista si hay datos reales en Firestore. Si algo
   falla, el bloqueo por defecto se queda tal cual (nunca deja la tarjeta
   vacía). Sin IntersectionObserver, sin animaciones obligatorias.

   El bloqueo real vive en firestore.rules / storage.rules (lee
   retoEvidencias, capitanVilla custom claim) — este archivo es solo la UI
   que refleja ese estado; nunca es la fuente de la protección.
   ════════════════════════════════════════════════════════════════════════ */
let authState        = { loading: true };
let retosCache        = {};  // slug -> datos del reto (solo si no está bloqueado)
let evidenciaCache     = {}; // slug -> datos de retoEvidencias/<slug>_<retoId>
let evidenciaUnsub     = null;
let currentDetailVilla = null;
let selectedEvidFile   = null;

document.addEventListener("DOMContentLoaded", () => {
  const steps = [
    ["cuenta regresiva",  initRetosCountdown],
    ["retos publicados",  watchRetos],
    ["modal de detalle",  initDetailModal],
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
  const villas = ["palmera","perez","cafe","cereza","bosque"];
  villas.forEach(slug => {
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

/* ══════════════════ MODAL DE DETALLE + ENTREGA DEL CAPITÁN ═══════════════ */
function initDetailModal() {
  const modal = document.getElementById("retoDetailModal");
  if (!modal) return; // si el HTML no trae el modal, nada se rompe

  document.getElementById("retoDetailModalBg").addEventListener("click", closeRetoDetail);
  document.getElementById("retoDetailClose").addEventListener("click", closeRetoDetail);

  const fileInput = document.getElementById("evidFileInput");
  fileInput.addEventListener("change", e => {
    selectedEvidFile = e.target.files[0] || null;
    document.getElementById("evidFileName").textContent = selectedEvidFile ? `📎 ${selectedEvidFile.name}` : "";
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

  selectedEvidFile = null;
  document.getElementById("evidFileInput").value = "";
  document.getElementById("evidFileName").textContent = "";
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
    document.getElementById("evidRespuesta").value    = evid?.respuesta || "";
    const statusLine = document.getElementById("evidCurrentStatus");
    if (evid) {
      statusLine.style.display = "block";
      statusLine.innerHTML = `Estado actual: <span class="reto-status-badge ${badgeClassFor(evid.estado)}">${badgeLabelFor(evid.estado)}</span>` +
        (evid.comentarioAdmin ? `<p class="reto-admin-comment">💬 ${escRetos(evid.comentarioAdmin)}</p>` : "");
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
        ${evid.archivoUrl ? `<p><a href="${evid.archivoUrl}" target="_blank" rel="noopener">Ver archivo enviado ↗</a></p>` : ""}
        ${evid.respuesta ? `<p>${escRetos(evid.respuesta)}</p>` : ""}
      `;
    }
  }
}

function badgeClassFor(estado) {
  if (estado === "aprobada") return "open";
  if (estado === "rechazada") return "locked";
  if (estado === "requiere_correccion") return "done";
  return "locked";
}
function badgeLabelFor(estado) {
  return {
    pendiente: "⏳ Pendiente de revisión",
    aprobada: "✅ Aprobada",
    requiere_correccion: "✏️ Requiere corrección",
    rechazada: "❌ Rechazada",
  }[estado] || "⏳ Pendiente";
}

function formatFechaLimite(fecha) {
  if (!fecha) return "Sin fecha límite";
  try {
    const d = fecha.toDate ? fecha.toDate() : new Date(fecha);
    return d.toLocaleString("es-DO", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  } catch { return "—"; }
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

  const nombreEquipo = document.getElementById("evidNombreEquipo").value.trim();
  const eslogan       = document.getElementById("evidEslogan").value.trim();
  const respuesta      = document.getElementById("evidRespuesta").value.trim();
  if (!nombreEquipo || !eslogan) {
    msg.textContent = "Completa el nombre del equipo y el eslogan.";
    return;
  }

  const btn = document.querySelector('#detailCaptainForm button[type="submit"]');
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

    const existing = evidenciaCache[slug] || null;
    let archivoUrl = existing?.archivoUrl || null;
    let tipo       = existing?.tipo || "respuesta";

    if (selectedEvidFile) {
      let fileToUpload = selectedEvidFile;
      if (selectedEvidFile.type.startsWith("image/")) {
        try { fileToUpload = await compressImage(selectedEvidFile); } catch { /* usa el original si falla */ }
        tipo = "foto";
      } else if (selectedEvidFile.type.startsWith("video/")) {
        tipo = "video";
      }
      const path = `retos/${slug}/${reto.retoId}/${Date.now()}_${fileToUpload.name}`;
      const ref  = fbStorage.ref(path);
      await ref.put(fileToUpload, { contentType: fileToUpload.type });
      archivoUrl = await ref.getDownloadURL();
    }

    const docId  = `${slug}_${reto.retoId}`;
    const payload = {
      villa: slug,
      retoId: reto.retoId,
      uid: authState.user.uid,
      nombreUsuario: authState.profile?.nombre || "",
      nombreEquipo,
      eslogan,
      tipo,
      archivoUrl,
      respuesta: respuesta || null,
      estado: "pendiente",
      comentarioAdmin: existing?.comentarioAdmin || null,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    };

    if (existing) {
      await fbDb.collection("retoEvidencias").doc(docId).update(payload);
    } else {
      await fbDb.collection("retoEvidencias").doc(docId).set({
        ...payload,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
    }

    selectedEvidFile = null;
    document.getElementById("evidFileInput").value = "";
    document.getElementById("evidFileName").textContent = "";
    msg.textContent = "✅ Entrega enviada. Rodolfo la revisará pronto.";
  } catch (err) {
    console.error("Error enviando evidencia:", err);
    msg.textContent = "❌ " + err.message;
  } finally {
    btn.disabled = false;
  }
}
