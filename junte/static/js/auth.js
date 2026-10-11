/* ════════════════════════════════════════════════════════════════════════
   JunteAuth — registro, login, estado de aprobación, claim de admin.
   Requiere firebase-init.js cargado antes.
   ════════════════════════════════════════════════════════════════════════ */
const JunteAuth = (() => {
  let listeners = [];
  let profileUnsub = null;
  let state = {
    loading: true,
    user: null,
    profile: null,       // doc de users/{uid}
    emailVerified: false,
    isAdmin: false,
    isApprovedVerified: false,
  };

  function slugify(s) {
    return String(s)
      .trim()
      .toLowerCase()
      .normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  function notify() {
    listeners.forEach(cb => cb({ ...state }));
  }

  function computeDerived() {
    state.isApprovedVerified =
      !!state.user && state.emailVerified && state.profile?.status === "approved";
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
      state = { loading: false, user: null, profile: null, emailVerified: false, isAdmin: false, isApprovedVerified: false };
      notify();
      return;
    }

    state.user = user;
    state.emailVerified = user.emailVerified;
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
      "auth/email-already-in-use": "Ese correo ya tiene una cuenta. Intenta iniciar sesión.",
      "auth/invalid-email": "El correo no es válido.",
      "auth/weak-password": "La contraseña debe tener al menos 6 caracteres.",
      "auth/wrong-password": "Contraseña incorrecta.",
      "auth/invalid-credential": "Correo o contraseña incorrectos.",
      "auth/user-not-found": "No existe una cuenta con ese correo.",
      "auth/too-many-requests": "Demasiados intentos. Espera un momento e intenta de nuevo.",
    };
    return map[err.code] || err.message || "Ocurrió un error inesperado.";
  }

  async function registerAccount({ nombre, familiaLabel, email, password }) {
    nombre = (nombre || "").trim();
    familiaLabel = (familiaLabel || "").trim();
    email = (email || "").trim();
    if (!nombre || !familiaLabel || !email || !password) {
      throw new Error("Completa todos los campos.");
    }

    let cred;
    try {
      cred = await fbAuth.createUserWithEmailAndPassword(email, password);
    } catch (err) {
      throw new Error(friendlyError(err));
    }

    const familiaSlug = slugify(familiaLabel);
    await fbDb.collection("users").doc(cred.user.uid).set({
      nombre,
      familia: familiaSlug,
      familiaLabel,
      email,
      status: "pending",
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });

    await cred.user.sendEmailVerification();
    return cred.user;
  }

  async function loginAccount({ email, password }) {
    try {
      const cred = await fbAuth.signInWithEmailAndPassword((email || "").trim(), password);
      return cred.user;
    } catch (err) {
      throw new Error(friendlyError(err));
    }
  }

  async function logoutAccount() {
    await fbAuth.signOut();
  }

  async function resendVerification() {
    if (!fbAuth.currentUser) throw new Error("No hay sesión activa.");
    await fbAuth.currentUser.sendEmailVerification();
  }

  async function refreshEmailVerified() {
    if (!fbAuth.currentUser) return false;
    await fbAuth.currentUser.reload();
    state.emailVerified = fbAuth.currentUser.emailVerified;
    computeDerived();
    notify();
    return state.emailVerified;
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
    subscribe,
    registerAccount,
    loginAccount,
    logoutAccount,
    resendVerification,
    refreshEmailVerified,
    callFunction,
  };
})();
