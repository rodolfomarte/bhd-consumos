/* ════════════════════════════════════════════════════════════════════════
   admin.js — login directo, pestañas de usuarios, toggle de galería y
   contador de almacenamiento. La protección real vive en firestore.rules /
   storage.rules / las funciones de servidor — esto es solo la UI.
   ════════════════════════════════════════════════════════════════════════ */
let usersUnsub = null;
let storagePollTimer = null;

document.addEventListener("DOMContentLoaded", () => {
  initLoginForm();
  initTabs();

  JunteAuth.subscribe(state => {
    document.getElementById("adminLoading").style.display = state.loading ? "block" : "none";
    if (state.loading) return;

    const loggedOut  = !state.user;
    const authorized = state.isAdmin;

    document.getElementById("adminLoginWrap").style.display = loggedOut ? "block" : "none";
    document.getElementById("adminDenied").style.display    = (!loggedOut && !authorized) ? "block" : "none";
    document.getElementById("adminContent").style.display   = authorized ? "block" : "none";

    if (authorized && !usersUnsub) {
      initGalleryToggle();
      watchUsers();
      initStorageWidget();
    }
    if (!authorized && usersUnsub) {
      usersUnsub(); usersUnsub = null;
      if (storagePollTimer) { clearInterval(storagePollTimer); storagePollTimer = null; }
    }
  });

  document.getElementById("btnAdminDeniedLogout").addEventListener("click", () => JunteAuth.logoutAccount());
});

/* ══════════════════ LOGIN DIRECTO EN /admin ═══════════════════════════════ */
function initLoginForm() {
  document.getElementById("adminLoginForm").addEventListener("submit", async e => {
    e.preventDefault();
    const err = document.getElementById("adminLoginError");
    err.style.display = "none";
    try {
      await JunteAuth.loginAccount({
        username: document.getElementById("adminLoginUsername").value,
        password: document.getElementById("adminLoginPassword").value,
      });
      // JunteAuth.subscribe ya reacciona solo: si es admin, muestra el panel;
      // si no, cae en "acceso restringido" — no hace falta redirigir a mano.
    } catch (ex) {
      err.textContent = ex.message;
      err.style.display = "block";
    }
  });
}

/* ══════════════════ PESTAÑAS ══════════════════════════════════════════════ */
function initTabs() {
  document.querySelectorAll(".admin-tab").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".admin-tab").forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".admin-tab-panel").forEach(p => p.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById(`tabPanel-${btn.dataset.tab}`).classList.add("active");
    });
  });
}

/* ══════════════════ CONTADOR DE ALMACENAMIENTO ═══════════════════════════ */
function initStorageWidget() {
  document.getElementById("btnRefreshStorage").addEventListener("click", () => loadStorageUsage());
  loadStorageUsage();
  if (storagePollTimer) clearInterval(storagePollTimer);
  storagePollTimer = setInterval(loadStorageUsage, 30000); // real, no simulado — solo polling
}

function formatBytes(bytes) {
  if (bytes >= 1024 ** 3) return (bytes / 1024 ** 3).toFixed(2) + " GB";
  if (bytes >= 1024 ** 2) return (bytes / 1024 ** 2).toFixed(1) + " MB";
  if (bytes >= 1024) return (bytes / 1024).toFixed(1) + " KB";
  return bytes + " B";
}

async function loadStorageUsage() {
  const msg = document.getElementById("storageWidgetMsg");
  const btn = document.getElementById("btnRefreshStorage");
  btn.disabled = true;
  try {
    const u = await JunteAuth.callFunction("storage-usage");
    document.getElementById("storageUsedLabel").textContent      = formatBytes(u.usedBytes);
    document.getElementById("storageLimitLabel").textContent     = formatBytes(u.limitBytes);
    document.getElementById("storageAvailableLabel").textContent = formatBytes(u.availableBytes);
    document.getElementById("storagePercentLabel").textContent   = u.percent + "%";
    const bar = document.getElementById("storageProgressBar");
    bar.style.width = u.percent + "%";
    bar.classList.toggle("storage-bar-warn", u.percent >= 80 && u.percent < 100);
    bar.classList.toggle("storage-bar-full", u.percent >= 100);
    msg.textContent = "Actualizado " + new Date().toLocaleTimeString("es-DO");
  } catch (err) {
    msg.textContent = "❌ " + err.message;
  } finally {
    btn.disabled = false;
  }
}

/* ══════════════════ GALERÍA GENERAL ═══════════════════════════════════════ */
function initGalleryToggle() {
  const toggle = document.getElementById("galleryToggle");
  const msg    = document.getElementById("gallerySettingMsg");

  fbDb.collection("config").doc("settings").onSnapshot(snap => {
    toggle.checked = !!(snap.exists && snap.data().galleryEnabledForUsers);
  });

  toggle.addEventListener("change", async () => {
    try {
      await fbDb.collection("config").doc("settings").set(
        { galleryEnabledForUsers: toggle.checked }, { merge: true }
      );
      msg.textContent = "✅ Guardado.";
    } catch (err) {
      msg.textContent = "❌ " + err.message;
      toggle.checked = !toggle.checked;
    }
  });
}

/* ══════════════════ USUARIOS (pestañas) ════════════════════════════════════ */
function watchUsers() {
  usersUnsub = fbDb.collection("users").orderBy("createdAt", "desc").onSnapshot(
    snap => {
      const byStatus = { pending: [], approved: [], rejected: [], suspended: [] };
      snap.forEach(doc => {
        const u = { uid: doc.id, ...doc.data() };
        (byStatus[u.status] || byStatus.pending).push(u);
      });
      Object.entries(byStatus).forEach(([status, list]) => renderGroup(status, list));
    },
    err => console.error("Users error:", err)
  );
}

function renderGroup(status, list) {
  const cap = status.charAt(0).toUpperCase() + status.slice(1);
  document.getElementById(`tabCount${cap}`).textContent = list.length;
  const wrap = document.getElementById(`list${cap}`);

  if (!list.length) {
    wrap.innerHTML = `<p class="admin-empty">— Ninguno —</p>`;
    return;
  }

  wrap.innerHTML = list.map(u => `
    <div class="admin-user-card">
      <div class="admin-user-info">
        <strong>${escAdmin(u.nombre)}</strong>
        <span>${escAdmin(u.familiaLabel || u.familia)}</span>
        <span class="admin-user-email">${escAdmin(u.email)}</span>
      </div>
      <div class="admin-user-actions">
        ${renderActions(status, u.uid)}
      </div>
    </div>`).join("");

  wrap.querySelectorAll("[data-action]").forEach(btn => {
    btn.addEventListener("click", () => handleAction(btn.dataset.action, btn.dataset.uid, btn));
  });
}

function renderActions(status, uid) {
  if (status === "pending") {
    return `
      <button class="btn-admin-sm" data-action="approve" data-uid="${uid}">✅ Aprobar</button>
      <button class="btn-admin-sm danger" data-action="reject" data-uid="${uid}">❌ Rechazar</button>`;
  }
  if (status === "approved") {
    return `<button class="btn-admin-sm danger" data-action="suspend" data-uid="${uid}">🚫 Suspender</button>`;
  }
  if (status === "rejected" || status === "suspended") {
    return `<button class="btn-admin-sm" data-action="approve" data-uid="${uid}">✅ Aprobar</button>`;
  }
  return "";
}

const ACTION_STATUS = { approve: "approved", reject: "rejected", suspend: "suspended" };

async function handleAction(action, uid, btn) {
  btn.disabled = true;
  const original = btn.textContent;
  btn.textContent = "…";
  try {
    await JunteAuth.callFunction("set-user-status", { method: "POST", body: { uid, status: ACTION_STATUS[action] } });
  } catch (err) {
    alert("Error: " + err.message);
    btn.disabled = false;
    btn.textContent = original;
  }
}

function escAdmin(s) {
  return String(s ?? "").replace(/[&<>"']/g, c =>
    ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}
