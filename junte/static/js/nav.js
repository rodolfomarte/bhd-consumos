/* ════════════════════════════════════════════════════════════════════════
   nav.js — menú móvil compartido por TODAS las páginas (index, live, cuenta,
   admin, retos). Antes cada página tenía su propio initNav() minimalista
   (algunas ni lo llamaban — el botón de admin.html no hacía nada); ahora es
   uno solo, cargado antes del script propio de cada página, con todo lo que
   pide un menú móvil correcto: cierra con el botón, tocando fuera o con
   Escape, bloquea el scroll de fondo mientras está abierto, se desplaza
   internamente si las opciones no caben, y cierra solo al elegir una opción.
   ════════════════════════════════════════════════════════════════════════ */
document.addEventListener("DOMContentLoaded", () => {
  try {
    const toggle = document.getElementById("navToggle");
    const links  = document.getElementById("navLinks");
    if (!toggle || !links) return;

    const ICON_OPEN  = "☰"; // ☰
    const ICON_CLOSE = "×"; // ×
    let lastFocused = null;
    let savedScrollY = 0;

    // Bloquear el scroll de fondo con solo "overflow:hidden" en el body NO
    // funciona de forma confiable en iOS Safari: el arrastre se filtra a la
    // página de atrás en vez de desplazar el menú, y algunas opciones nunca
    // llegan a verse. Fijar el body en su posición actual sí bloquea el
    // arrastre de verdad en iOS — y al cerrar se restaura el scroll exacto.
    function openMenu() {
      links.classList.add("open");
      toggle.innerHTML = ICON_CLOSE;
      toggle.setAttribute("aria-expanded", "true");
      savedScrollY = window.scrollY || window.pageYOffset || 0;
      document.body.classList.add("nav-open-lock");
      document.body.style.top = `-${savedScrollY}px`;
      lastFocused = document.activeElement;
      document.addEventListener("keydown", onKeydown);
      document.addEventListener("click", onOutsideClick, true);
    }

    function closeMenu() {
      links.classList.remove("open");
      toggle.innerHTML = ICON_OPEN;
      toggle.setAttribute("aria-expanded", "false");
      document.body.classList.remove("nav-open-lock");
      document.body.style.top = "";
      window.scrollTo(0, savedScrollY);
      document.removeEventListener("keydown", onKeydown);
      document.removeEventListener("click", onOutsideClick, true);
      if (lastFocused && lastFocused.focus) lastFocused.focus();
    }

    function onKeydown(e) {
      if (e.key === "Escape") closeMenu();
    }

    function onOutsideClick(e) {
      if (links.contains(e.target) || toggle.contains(e.target)) return;
      closeMenu();
    }

    toggle.setAttribute("aria-expanded", "false");
    toggle.addEventListener("click", () => {
      links.classList.contains("open") ? closeMenu() : openMenu();
    });
    links.querySelectorAll("a").forEach(a => a.addEventListener("click", closeMenu));
  } catch (err) {
    console.error("Error iniciando nav:", err);
  }

  // El enlace "Administrador" solo aparece si la sesión activa tiene el
  // custom claim admin — el panel /admin igual exige login ahí mismo,
  // esto es solo para no mostrar el enlace a quien no lo necesita.
  // Los enlaces [data-gated] (Itinerario/Villas/Mapa/Menú/Historia) llevan
  // a secciones que en index.html están display:none hasta que hay cuenta
  // — se ocultan también aquí para no dejar enlaces que no llevan a nada.
  try {
    if (typeof JunteAuth !== "undefined") {
      JunteAuth.subscribe(state => {
        const adminLink = document.getElementById("navAdminLink");
        if (adminLink) adminLink.style.display = state.isAdmin ? "" : "none";
        const authed = !!state.user;
        document.querySelectorAll('#navLinks [data-gated="true"]').forEach(li => {
          li.style.display = authed ? "" : "none";
        });
      });
    }
  } catch (err) {
    console.error("Error iniciando enlaces condicionales en nav:", err);
  }
});
