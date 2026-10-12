const { auth, db } = require("./_lib/firebaseAdmin");
const { computeUsage, getRealUsedBytes } = require("./_lib/storageUsage");

/**
 * POST /.netlify/functions/check-storage-quota
 * Authorization: Bearer <Firebase ID token of an approved user>
 * Body: { "bytes": <size of the photo about to be uploaded> }
 *
 * Called by the client right before it uploads a photo straight to Firebase
 * Storage. This is an application-level budget check (10 GB by default, NOT
 * a Firebase/Blaze billing limit) — it warns at 80% and refuses to green-
 * light an upload that would push real usage past the limit. The client
 * still must respect the answer; the hard security boundary is
 * storage.rules, this is just the shared-budget guardrail.
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
      const snap = await db().collection("users").doc(decoded.uid).get();
      if (!snap.exists || snap.data().status !== "approved") {
        return { statusCode: 403, body: JSON.stringify({ error: "Tu cuenta no está aprobada." }) };
      }
    }

    const { bytes } = JSON.parse(event.body || "{}");
    const extraBytes = Number(bytes);
    if (!Number.isFinite(extraBytes) || extraBytes <= 0) {
      return { statusCode: 400, body: JSON.stringify({ error: "Falta el tamaño del archivo (bytes)." }) };
    }

    const usedBytes = await getRealUsedBytes();
    const usage = computeUsage(usedBytes, undefined, extraBytes);
    return { statusCode: 200, body: JSON.stringify({ ok: usage.fitsExtra, ...usage }) };
  } catch (err) {
    console.error("check-storage-quota error:", err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message || "Error interno." }) };
  }
};
