const { db, auth } = require("./_lib/firebaseAdmin");

const VALID = new Set(["approved", "rejected", "suspended"]);

/**
 * POST /.netlify/functions/set-user-status
 * Authorization: Bearer <Firebase ID token of an admin>
 * Body: { "uid": "<user to change>", "status": "approved" | "rejected" | "suspended" }
 *
 * This is the ONLY way a user's status changes — and the only step that
 * matters now that there's no verification email: approval is a single
 * manual decision by the admin. It mirrors the result onto the Auth custom
 * claims (approved/familia) so storage.rules — which can't read Firestore
 * (unsupported by the local emulator, so we don't rely on it) — can still
 * enforce per-family access.
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
      return { statusCode: 403, body: JSON.stringify({ error: "Solo un administrador puede cambiar el estado de un usuario." }) };
    }

    const { uid, status } = JSON.parse(event.body || "{}");
    if (!uid || typeof uid !== "string" || !VALID.has(status)) {
      return { statusCode: 400, body: JSON.stringify({ error: "Falta uid o el status no es válido (approved/rejected/suspended)." }) };
    }

    const userRef = db().collection("users").doc(uid);
    const snap = await userRef.get();
    if (!snap.exists) {
      return { statusCode: 404, body: JSON.stringify({ error: "Ese usuario no existe." }) };
    }
    const user = snap.data();

    const admin = require("firebase-admin");
    await userRef.update({
      status,
      reviewedAt: admin.firestore.FieldValue.serverTimestamp(),
      reviewedBy: decoded.uid,
    });

    // Mirror onto custom claims, preserving any existing claims (e.g. admin)
    // since setCustomUserClaims() REPLACES the whole claims object.
    const userRecord = await auth().getUser(uid);
    const existingClaims = userRecord.customClaims || {};
    await auth().setCustomUserClaims(uid, {
      ...existingClaims,
      approved: status === "approved",
      familia: user.familia,
    });

    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (err) {
    console.error("set-user-status error:", err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message || "Error interno." }) };
  }
};
