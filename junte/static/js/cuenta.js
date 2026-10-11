/* ════════════════════════════════════════════════════════════════════════
   cuenta.js — login, registro y pantalla de estado de la cuenta.
   ════════════════════════════════════════════════════════════════════════ */
document.addEventListener("DOMContentLoaded", () => {
  initNav();
  populateFamiliaSelect();
  initTabs();
  initForms();
  initStatusActions();

  JunteAuth.subscribe(renderState);

  if (new URLSearchParams(location.search).get("approved") === "1") {
    const hint = document.createElement("p");
    hint.className = "account-msg";
    hint.textContent = "🎉 Tu cuenta fue aprobada — inicia sesión para continuar.";
    document.getElementById("loginForm").prepend(hint);
  }
});

function initNav() {
  const toggle = document.getElementById("navToggle");
  const links  = document.getElementById("navLinks");
  if (toggle) toggle.addEventListener("click", () => links.classList.toggle("open"));
}

function populateFamiliaSelect() {
  const sel = document.getElementById("regFamilia");
  getAllFamiliasRoster().forEach(f => {
    const o = document.createElement("option");
    o.value = f.nombre;
    o.textContent = `${f.nombre} (${f.villa})`;
    sel.appendChild(o);
  });
}

function initTabs() {
  const tabLogin    = document.getElementById("tabLogin");
  const tabRegister = document.getElementById("tabRegister");
  const loginForm   = document.getElementById("loginForm");
  const registerForm = document.getElementById("registerForm");

  tabLogin.addEventListener("click", () => {
    tabLogin.classList.add("active"); tabRegister.classList.remove("active");
    loginForm.style.display = "flex"; registerForm.style.display = "none";
  });
  tabRegister.addEventListener("click", () => {
    tabRegister.classList.add("active"); tabLogin.classList.remove("active");
    registerForm.style.display = "flex"; loginForm.style.display = "none";
  });
}

function initForms() {
  document.getElementById("loginForm").addEventListener("submit", async e => {
    e.preventDefault();
    const err = document.getElementById("loginError");
    err.style.display = "none";
    try {
      await JunteAuth.loginAccount({
        email: document.getElementById("loginEmail").value,
        password: document.getElementById("loginPassword").value,
      });
    } catch (ex) {
      err.textContent = ex.message;
      err.style.display = "block";
    }
  });

  document.getElementById("registerForm").addEventListener("submit", async e => {
    e.preventDefault();
    const err = document.getElementById("registerError");
    err.style.display = "none";
    try {
      await JunteAuth.registerAccount({
        nombre:       document.getElementById("regNombre").value,
        familiaLabel: document.getElementById("regFamilia").value,
        email:        document.getElementById("regEmail").value,
        password:     document.getElementById("regPassword").value,
      });
    } catch (ex) {
      err.textContent = ex.message;
      err.style.display = "block";
    }
  });
}

function initStatusActions() {
  document.getElementById("btnLogout").addEventListener("click", () => JunteAuth.logoutAccount());

  document.getElementById("btnResendVerify").addEventListener("click", async () => {
    const msg = document.getElementById("verifyMsg");
    try {
      await JunteAuth.resendVerification();
      msg.textContent = "✅ Correo reenviado.";
    } catch (ex) {
      msg.textContent = "❌ " + ex.message;
    }
  });

  document.getElementById("btnCheckVerify").addEventListener("click", async () => {
    const msg = document.getElementById("verifyMsg");
    const verified = await JunteAuth.refreshEmailVerified();
    msg.textContent = verified ? "" : "Aún no se detecta la verificación. Revisa tu correo.";
  });
}

function renderState(state) {
  document.getElementById("authLoading").style.display = state.loading ? "block" : "none";
  if (state.loading) return;

  document.getElementById("authForms").style.display    = state.user ? "none" : "block";
  document.getElementById("accountStatus").style.display = state.user ? "block" : "none";
  if (!state.user) return;

  ["statusVerify","statusPending","statusRejected","statusSuspended","statusApproved"]
    .forEach(id => document.getElementById(id).style.display = "none");

  if (!state.emailVerified) {
    document.getElementById("statusVerify").style.display = "block";
    return;
  }
  if (!state.profile) return; // doc aún no escrito (instante justo tras el registro)

  const status = state.profile.status;
  if (status === "pending") {
    document.getElementById("pendingNombre").textContent  = state.profile.nombre;
    document.getElementById("pendingFamilia").textContent = state.profile.familiaLabel;
    document.getElementById("statusPending").style.display = "block";
  } else if (status === "rejected") {
    document.getElementById("statusRejected").style.display = "block";
  } else if (status === "suspended") {
    document.getElementById("statusSuspended").style.display = "block";
  } else if (status === "approved") {
    document.getElementById("approvedNombre").textContent = state.profile.nombre;
    document.getElementById("statusApproved").style.display = "block";
  }
}
