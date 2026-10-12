/* ════════════════════════════════════════════════════════════════════════
   retos.js — pantalla de expectativa de "Retos por Villas".
   Todo el HTML por defecto ya muestra "bloqueado" — este script solo
   intenta MEJORAR esa vista si hay datos reales en Firestore. Si algo
   falla, el bloqueo por defecto se queda tal cual (nunca deja la tarjeta
   vacía). Sin IntersectionObserver, sin animaciones obligatorias.
   ════════════════════════════════════════════════════════════════════════ */
document.addEventListener("DOMContentLoaded", () => {
  const steps = [
    ["nav",              initNav],
    ["cuenta regresiva", initRetosCountdown],
    ["retos publicados", watchRetos],
  ];
  for (const [label, fn] of steps) {
    try { fn(); } catch (err) { console.error(`Error iniciando ${label}:`, err); }
  }
});

function initNav() {
  const toggle = document.getElementById("navToggle");
  const links  = document.getElementById("navLinks");
  if (toggle) toggle.addEventListener("click", () => links.classList.toggle("open"));
}

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
  if (!card || !data || !data.estado || data.estado === "bloqueado") return; // sigue bloqueado tal cual

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
}
