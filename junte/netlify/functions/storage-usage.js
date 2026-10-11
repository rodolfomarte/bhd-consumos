const { auth } = require("./_lib/firebaseAdmin");
const { computeUsage, getRealUsedBytes } = require("./_lib/storageUsage");

/**
 * GET /.netlify/functions/storage-usage
 * Authorization: Bearer <Firebase ID token of an admin>
 *
 * Powers the storage counter widget in /admin — real bytes, listed fresh
 * from Firebase Storage every call (no cached/simulated numbers).
 */
exports.handler = async (event) => {
  if (event.httpMethod !== "GET") {
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
      return { statusCode: 403, body: JSON.stringify({ error: "Solo un administrador puede ver el uso de almacenamiento." }) };
    }

    const usedBytes = await getRealUsedBytes();
    const usage = computeUsage(usedBytes);
    return { statusCode: 200, body: JSON.stringify(usage) };
  } catch (err) {
    console.error("storage-usage error:", err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message || "Error interno." }) };
  }
};
