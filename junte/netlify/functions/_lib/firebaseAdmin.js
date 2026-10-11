const admin = require("firebase-admin");

/**
 * Lazily initializes the Admin SDK from env vars so a missing/incomplete
 * config fails with a clear message instead of a cryptic SDK error.
 * Required Netlify env vars:
 *   FIREBASE_PROJECT_ID
 *   FIREBASE_CLIENT_EMAIL
 *   FIREBASE_PRIVATE_KEY   (paste with real newlines or literal \n)
 */
function getAdminApp() {
  if (admin.apps.length) return admin.apps[0];

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY;

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error(
      "Faltan credenciales del servidor: configura FIREBASE_PROJECT_ID, " +
        "FIREBASE_CLIENT_EMAIL y FIREBASE_PRIVATE_KEY como variables de " +
        "entorno en Netlify (ver README de /junte)."
    );
  }

  return admin.initializeApp({
    credential: admin.credential.cert({
      projectId,
      clientEmail,
      privateKey: privateKey.replace(/\\n/g, "\n"),
    }),
    // Matches storageBucket in static/js/firebase-init.js; override via env
    // var only if that ever changes (e.g. a different Firebase project).
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET || "junte-familiar.firebasestorage.app",
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
