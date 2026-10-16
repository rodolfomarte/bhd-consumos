const { db, auth } = require("./_lib/firebaseAdmin");

/**
 * POST /.netlify/functions/set-music-manager
 * Authorization: Bearer <Firebase ID token of an admin>
 * Body: { "uid": "<user uid>" | null }
 *
 * Assigns (or, with uid: null, retires) the single "encargado de música" role.
 * Writes config/musicManager (the admin panel's view) AND mirrors the result
 * onto the user's Auth custom claim "encargadoMusica" — that claim, not the
 * Firestore doc, is what firestore.rules actually checks, so moderation
 * permission for "Pide tu canción" is enforced server-side no matter what
 * the client UI shows or hides. Only ONE user can hold this role at a time.
 */
exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  try {
    const authHeader = event.headers.authorization || event.headers.Authorization || "";
    const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!idToken) {
      return { statusCode: 401, body: JSON.stringify({ error: "Falta el token de autorización." }) };
    }

    const decoded = await auth().verifyIdToken(idToken);
    if (decoded.admin !== true) {
      return { statusCode: 403, body: JSON.stringify({ error: "Solo un administrador puede asignar al encargado de música." }) };
    }

    const { uid } = JSON.parse(event.body || "{}");

    const admin = require("firebase-admin");
    const managerRef = db().collection("config").doc("musicManager");
    const prevSnap = await managerRef.get();
    const prevUid = prevSnap.exists ? prevSnap.data().uid : null;

    async function clearClaim(targetUid) {
      const rec = await auth().getUser(targetUid);
      const claims = { ...(rec.customClaims || {}) };
      delete claims.encargadoMusica;
      await auth().setCustomUserClaims(targetUid, claims);
    }

    // Retiring the role (no new uid given)
    if (!uid) {
      if (prevUid) await clearClaim(prevUid);
      await managerRef.delete();
      return { statusCode: 200, body: JSON.stringify({ ok: true, manager: null }) };
    }

    if (typeof uid !== "string") {
      return { statusCode: 400, body: JSON.stringify({ error: "uid inválido." }) };
    }

    const userSnap = await db().collection("users").doc(uid).get();
    if (!userSnap.exists || userSnap.data().status !== "approved") {
      return { statusCode: 400, body: JSON.stringify({ error: "El usuario debe tener una cuenta aprobada." }) };
    }
    const user = userSnap.data();

    // If a different user held the role before, free up their claim first.
    if (prevUid && prevUid !== uid) await clearClaim(prevUid);

    const rec = await auth().getUser(uid);
    await auth().setCustomUserClaims(uid, { ...(rec.customClaims || {}), encargadoMusica: true });

    await managerRef.set({
      uid,
      nombre: user.nombre,
      familia: user.familia,
      familiaLabel: user.familiaLabel,
      assignedAt: admin.firestore.FieldValue.serverTimestamp(),
      assignedBy: decoded.uid,
    });

    return { statusCode: 200, body: JSON.stringify({ ok: true, manager: { uid, nombre: user.nombre } }) };
  } catch (err) {
    console.error("set-music-manager error:", err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message || "Error interno." }) };
  }
};
