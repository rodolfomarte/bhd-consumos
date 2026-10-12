/* ════════════════════════════════════════════════════════════════════════
   cuenta.js — login, registro (usuario + contraseña, sin correo) y
   pantalla de estado de la cuenta.
   ════════════════════════════════════════════════════════════════════════ */
document.addEventListener("DOMContentLoaded", () => {
  populateFamiliaSelect();
  initTabs();
  initForms();
  initStatusActions();

  JunteAuth.subscribe(renderState);
});

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
        username: document.getElementById("loginUsername").value,
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
        username:     document.getElementById("regUsername").value,
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
}

function renderState(state) {
  document.getElementById("authLoading").style.display = state.loading ? "block" : "none";
  if (state.loading) return;

  document.getElementById("authForms").style.display    = state.user ? "none" : "block";
  document.getElementById("accountStatus").style.display = state.user ? "block" : "none";
  if (!state.user) return;

  ["statusPending","statusRejected","statusSuspended","statusApproved"]
    .forEach(id => document.getElementById(id).style.display = "none");

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
