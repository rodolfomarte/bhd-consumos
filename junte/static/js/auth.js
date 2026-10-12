/* ════════════════════════════════════════════════════════════════════════
   JunteAuth — registro y login con USUARIO + CONTRASEÑA (sin correo).
   Firebase Auth solo soporta email/password de forma nativa, así que cada
   usuario se mapea a un correo sintético interno (nunca se envía nada ahí,
   nunca se muestra al usuario) — esto además nos da unicidad de usuario
   gratis: Firebase ya rechaza correos duplicados.
   Requiere firebase-init.js cargado antes.
   ════════════════════════════════════════════════════════════════════════ */
const JunteAuth = (() => {
  const INTERNAL_DOMAIN = "junte.internal";

  let listeners = [];
  let profileUnsub = null;
  let state = {
    loading: true,
    user: null,
    profile: null,       // doc de users/{uid}
    isAdmin: false,
    isApproved: false,
  };

  function slugify(s) {
    return String(s)
      .trim()
      .toLowerCase()
      .normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  function normalizeUsername(u) {
    return String(u || "").trim().toLowerCase().replace(/[^a-z0-9._-]/g, "");
  }

  function usernameToEmail(u) {
    return `${normalizeUsername(u)}@${INTERNAL_DOMAIN}`;
  }

  function notify() {
    listeners.forEach(cb => cb({ ...state }));
  }

  function computeDerived() {
    state.isApproved = !!state.user && state.profile?.status === "approved";
  }

  function watchProfile(uid) {
    if (profileUnsub) profileUnsub();
    profileUnsub = fbDb.collection("users").doc(uid).onSnapshot(
      snap => {
        state.profile = snap.exists ? snap.data() : null;
        computeDerived();
        notify();
      },
      err => console.error("Perfil error:", err)
    );
  }

  fbAuth.onAuthStateChanged(async user => {
    state.loading = false;
    if (profileUnsub) { profileUnsub(); profileUnsub = null; }

    if (!user) {
      state = { loading: false, user: null, profile: null, isAdmin: false, isApproved: false };
      notify();
      return;
    }

    state.user = user;
    try {
      const tokenResult = await user.getIdTokenResult();
      state.isAdmin = tokenResult.claims.admin === true;
    } catch (err) {
      console.error("Token claims error:", err);
      state.isAdmin = false;
    }
    computeDerived();
    notify();
    watchProfile(user.uid);
  });

  function subscribe(cb) {
    listeners.push(cb);
    cb({ ...state });
    return () => { listeners = listeners.filter(l => l !== cb); };
  }

  function friendlyError(err) {
    const map = {
      "auth/email-already-in-use": "Ese usuario ya existe — elige otro.",
      "auth/invalid-email": "Usuario inválido (usa solo letras, números, puntos, guiones).",
      "auth/weak-password": "La contraseña debe tener al menos 6 caracteres.",
      "auth/wrong-password": "Usuario o contraseña incorrectos.",
      "auth/invalid-credential": "Usuario o contraseña incorrectos.",
      "auth/user-not-found": "No existe un usuario con ese nombre.",
      "auth/too-many-requests": "Demasiados intentos. Espera un momento e intenta de nuevo.",
    };
    return map[err.code] || err.message || "Ocurrió un error inesperado.";
  }

  async function registerAccount({ nombre, familiaLabel, username, password }) {
    nombre = (nombre || "").trim();
    familiaLabel = (familiaLabel || "").trim();
    const user = normalizeUsername(username);
    if (!nombre || !familiaLabel || !user || !password) {
      throw new Error("Completa todos los campos.");
    }
    if (user.length < 3) {
      throw new Error("El usuario debe tener al menos 3 caracteres.");
    }

    let cred;
    try {
      cred = await fbAuth.createUserWithEmailAndPassword(usernameToEmail(user), password);
    } catch (err) {
      throw new Error(friendlyError(err));
    }

    const familiaSlug = slugify(familiaLabel);
    await fbDb.collection("users").doc(cred.user.uid).set({
      nombre,
      familia: familiaSlug,
      familiaLabel,
      username: user,
      email: usernameToEmail(user), // interno — solo para que Firebase Auth funcione
      status: "pending",
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });

    return cred.user;
  }

  async function loginAccount({ username, password }) {
    const user = normalizeUsername(username);
    if (!user) throw new Error("Escribe tu usuario.");
    try {
      const cred = await fbAuth.signInWithEmailAndPassword(usernameToEmail(user), password);
      return cred.user;
    } catch (err) {
      throw new Error(friendlyError(err));
    }
  }

  async function logoutAccount() {
    await fbAuth.signOut();
  }

  // Shared caller for netlify/functions/* — attaches the current user's ID
  // token and throws a friendly Error on any non-2xx response.
  async function callFunction(name, { method = "GET", body } = {}) {
    if (!fbAuth.currentUser) throw new Error("No hay sesión activa.");
    const idToken = await fbAuth.currentUser.getIdToken();
    const res = await fetch(`/.netlify/functions/${name}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${idToken}`,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Error llamando a ${name}.`);
    return data;
  }

  return {
    slugify,
    normalizeUsername,
    subscribe,
    registerAccount,
    loginAccount,
    logoutAccount,
    callFunction,
  };
})();
