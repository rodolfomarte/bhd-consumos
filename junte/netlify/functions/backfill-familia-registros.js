const { db, auth } = require("./_lib/firebaseAdmin");

/**
 * POST /.netlify/functions/backfill-familia-registros
 * Authorization: Bearer <Firebase ID token de un admin>
 *
 * Recalcula familiaRegistros/{familiaSlug}.registrados a partir de la
 * verdad real (la colección users/), para que las cuentas creadas ANTES de
 * que existiera esta función también cuenten. Solo toca el campo
 * "registrados" — nunca "ultimaActividad" (eso lo sigue poniendo cada
 * quien al entrar). Seguro de llamar las veces que sea: siempre recalcula
 * desde cero, nunca duplica ni sobre-cuenta.
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
      return { statusCode: 403, body: JSON.stringify({ error: "Solo un administrador puede recalcular esto." }) };
    }

    const database = db();
    const usersSnap = await database.collection("users").get();

    const porFamilia = {};
    usersSnap.forEach(doc => {
      const familia = doc.data().familia;
      if (familia) porFamilia[familia] = (porFamilia[familia] || 0) + 1;
    });

    const familias = Object.keys(porFamilia);
    let batch = database.batch();
    let enBatch = 0;
    for (const slug of familias) {
      const ref = database.collection("familiaRegistros").doc(slug);
      batch.set(ref, { registrados: porFamilia[slug] }, { merge: true });
      enBatch++;
      if (enBatch === 400) { await batch.commit(); batch = database.batch(); enBatch = 0; }
    }
    if (enBatch > 0) await batch.commit();

    return { statusCode: 200, body: JSON.stringify({ ok: true, familias: porFamilia }) };
  } catch (err) {
    console.error("backfill-familia-registros error:", err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message || "Error interno." }) };
  }
};
