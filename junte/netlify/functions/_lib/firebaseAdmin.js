const admin = require("firebase-admin");
// (redeploy trigger: pick up FIREBASE_SERVICE_ACCOUNT_BASE64 after it was added in Netlify)

/**
 * Lazily initializes the Admin SDK from env vars so a missing/incomplete
 * config fails with a clear message instead of a cryptic SDK error.
 *
 * Preferred: FIREBASE_SERVICE_ACCOUNT_BASE64 — the ENTIRE service account
 * JSON, base64-encoded, as one env var. This is the one to use: a single
 * line, no embedded newlines to get mangled by copy/paste or by Netlify's
 * env var UI (the classic "Invalid PEM formatted message" failure mode).
 *
 * Fallback: FIREBASE_PROJECT_ID + FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY
 * (the multi-line private key is the fragile one — only use this if you
 * can't set the base64 var for some reason).
 */
function getAdminApp() {
  if (admin.apps.length) return admin.apps[0];

  const storageBucket = process.env.FIREBASE_STORAGE_BUCKET || "junte-familiar.firebasestorage.app";

  const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;
  if (b64) {
    let serviceAccount;
    try {
      serviceAccount = JSON.parse(Buffer.from(b64.trim(), "base64").toString("utf8"));
    } catch (err) {
      throw new Error("FIREBASE_SERVICE_ACCOUNT_BASE64 no es un JSON base64 válido: " + err.message);
    }
    return admin.initializeApp({ credential: admin.credential.cert(serviceAccount), storageBucket });
  }

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY;

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error(
      "Faltan credenciales del servidor: configura FIREBASE_SERVICE_ACCOUNT_BASE64 " +
        "(recomendado) o FIREBASE_PROJECT_ID + FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY " +
        "como variables de entorno en Netlify (ver README de /junte)."
    );
  }

  return admin.initializeApp({
    credential: admin.credential.cert({
      projectId,
      clientEmail,
      privateKey: privateKey.replace(/\\n/g, "\n"),
    }),
    storageBucket,
  });
}

function db() {
  getAdminApp();
  return admin.firestore();
}

function auth() {
  getAdminApp();
  return admin.auth();
}

function storageBucket() {
  getAdminApp();
  return admin.storage().bucket();
}

module.exports = { getAdminApp, db, auth, storageBucket };
