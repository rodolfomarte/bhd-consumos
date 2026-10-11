const { db, auth } = require("./_lib/firebaseAdmin");

/**
 * One-time setup endpoint: grants the Firebase Auth "admin" custom claim to
 * the account whose email matches ADMIN_EMAIL, and marks its profile
 * approved. Run it ONCE after that account has registered through
 * /cuenta.html, then forget about it — it's gated by a secret only you have.
 *
 * curl -X POST https://<tu-sitio>.netlify.app/.netlify/functions/bootstrap-admin \
 *   -H "x-bootstrap-secret: <ADMIN_BOOTSTRAP_SECRET>"
 *
 * Required Netlify env vars: ADMIN_EMAIL, ADMIN_BOOTSTRAP_SECRET
 * (plus the FIREBASE_... and RESEND_... / SITE_URL ones the other functions need).
 */
exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  try {
    const secret = process.env.ADMIN_BOOTSTRAP_SECRET;
    const adminEmail = process.env.ADMIN_EMAIL;
    if (!secret || !adminEmail) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "Faltan ADMIN_EMAIL o ADMIN_BOOTSTRAP_SECRET en el servidor." }),
      };
    }

    const given = event.headers["x-bootstrap-secret"] || event.headers["X-Bootstrap-Secret"];
    if (given !== secret) {
      return { statusCode: 403, body: JSON.stringify({ error: "Secreto inválido." }) };
    }

    const userRecord = await auth().getUserByEmail(adminEmail);
    const userRef = db().collection("users").doc(userRecord.uid);
    const snap = await userRef.get();
    if (!snap.exists) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: "Esa cuenta existe en Firebase Auth pero no tiene perfil en Firestore — regístrate en /cuenta.html primero." }),
      };
    }

    await auth().setCustomUserClaims(userRecord.uid, {
      admin: true,
      approved: true,
      familia: snap.data().familia,
    });

    const admin = require("firebase-admin");
    await userRef.update({
      status: "approved",
      reviewedAt: admin.firestore.FieldValue.serverTimestamp(),
      reviewedBy: "bootstrap",
    });

    return {
      statusCode: 200,
      body: JSON.stringify({
        ok: true,
        message:
          `Listo: ${adminEmail} ahora tiene el rol admin. Debe cerrar sesión y volver a ` +
          `iniciar sesión (o esperar ~1h) para que el navegador reciba el nuevo token.`,
      }),
    };
  } catch (err) {
    console.error("bootstrap-admin error:", err);
    const notFound = err.code === "auth/user-not-found";
    return {
      statusCode: notFound ? 404 : 500,
      body: JSON.stringify({
        error: notFound
          ? "Ese correo aún no se ha registrado en /cuenta.html — regístrate primero."
          : err.message || "Error interno.",
      }),
    };
  }
};
