const { db, auth } = require("./_lib/firebaseAdmin");
const { VILLA_SLUGS, FAMILIA_TO_VILLA } = require("./_lib/familiesRoster");

/**
 * POST /.netlify/functions/set-captain
 * Authorization: Bearer <Firebase ID token of an admin>
 * Body: { "villa": "<villa slug>", "uid": "<user uid>" | null }
 *
 * Assigns (or, with uid: null, retires) the captain of one villa. Writes
 * retoCaptains/{villa} (the admin panel's view) AND mirrors the result onto
 * the user's Auth custom claim "capitanVilla" — that claim, not the
 * Firestore doc, is what firestore.rules / storage.rules actually check,
 * so evidence upload permission is enforced server-side no matter what the
 * client UI shows or hides.
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
      return { statusCode: 403, body: JSON.stringify({ error: "Solo un administrador puede asignar capitanes." }) };
    }

    const { villa, uid } = JSON.parse(event.body || "{}");
    if (!villa || !VILLA_SLUGS.includes(villa)) {
      return { statusCode: 400, body: JSON.stringify({ error: "Villa inválida." }) };
    }

    const admin = require("firebase-admin");
    const captainRef = db().collection("retoCaptains").doc(villa);
    const prevSnap = await captainRef.get();
    const prevUid = prevSnap.exists ? prevSnap.data().uid : null;

    async function clearClaim(targetUid) {
      const rec = await auth().getUser(targetUid);
      const claims = { ...(rec.customClaims || {}) };
      delete claims.capitanVilla;
      await auth().setCustomUserClaims(targetUid, claims);
    }

    // Retiring the captain (no new uid given)
    if (!uid) {
      if (prevUid) await clearClaim(prevUid);
      await captainRef.delete();
      return { statusCode: 200, body: JSON.stringify({ ok: true, captain: null }) };
    }

    if (typeof uid !== "string") {
      return { statusCode: 400, body: JSON.stringify({ error: "uid inválido." }) };
    }

    const userSnap = await db().collection("users").doc(uid).get();
    if (!userSnap.exists || userSnap.data().status !== "approved") {
      return { statusCode: 400, body: JSON.stringify({ error: "El usuario debe tener una cuenta aprobada." }) };
    }
    const user = userSnap.data();
    if (FAMILIA_TO_VILLA[user.familia] !== villa) {
      return { statusCode: 400, body: JSON.stringify({ error: "Ese usuario no pertenece a esta villa." }) };
    }

    // If a different user was captain before, free up their claim first.
    if (prevUid && prevUid !== uid) await clearClaim(prevUid);

    const rec = await auth().getUser(uid);
    await auth().setCustomUserClaims(uid, { ...(rec.customClaims || {}), capitanVilla: villa });

    await captainRef.set({
      uid,
      nombre: user.nombre,
      familia: user.familia,
      familiaLabel: user.familiaLabel,
      assignedAt: admin.firestore.FieldValue.serverTimestamp(),
      assignedBy: decoded.uid,
    });

    return { statusCode: 200, body: JSON.stringify({ ok: true, captain: { uid, nombre: user.nombre } }) };
  } catch (err) {
    console.error("set-captain error:", err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message || "Error interno." }) };
  }
};
