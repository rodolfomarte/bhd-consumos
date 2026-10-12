#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════════════════
   bootstrap-admin-local.js — one-time, local admin account provisioning.

   Creates (or resets) the admin account directly with the Admin SDK —
   username + password, no email involved anywhere. No secrets typed or
   pasted, nothing shown in chat or in this script's own output: it talks to
   Firebase with the service account JSON you already downloaded, via the
   GOOGLE_APPLICATION_CREDENTIALS env var (Node/Google's standard
   mechanism). The generated password is written ONLY to a local file
   outside the repo (never printed to the terminal, never logged, never
   committed).

   Usage:
     GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json \
       node scripts/bootstrap-admin-local.js rodolfo

   (username arg optional — defaults to "rodolfo")
   Must match INTERNAL_DOMAIN in static/js/auth.js.
   ════════════════════════════════════════════════════════════════════════ */
const admin = require("firebase-admin");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const INTERNAL_DOMAIN = "junte.internal";
const rawUsername = process.argv[2] || "rodolfo";
const username = rawUsername.trim().toLowerCase().replace(/[^a-z0-9._-]/g, "");
if (username.length < 3) {
  console.error("Usuario inválido (mínimo 3 caracteres, solo letras/números/._-).");
  process.exit(1);
}
const syntheticEmail = `${username}@${INTERNAL_DOMAIN}`;

if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  console.error(
    "Falta GOOGLE_APPLICATION_CREDENTIALS. Ejemplo:\n" +
      '  GOOGLE_APPLICATION_CREDENTIALS="/ruta/al/service-account.json" node scripts/bootstrap-admin-local.js ' +
      username
  );
  process.exit(1);
}

admin.initializeApp({ credential: admin.credential.applicationDefault() });

function generatePassword() {
  return crypto.randomBytes(18).toString("base64").replace(/\+/g, "A").replace(/\//g, "b") + "!9";
}

async function main() {
  const newPassword = generatePassword();

  let userRecord;
  try {
    userRecord = await admin.auth().getUserByEmail(syntheticEmail);
    await admin.auth().updateUser(userRecord.uid, { password: newPassword });
  } catch (err) {
    if (err.code !== "auth/user-not-found") throw err;
    userRecord = await admin.auth().createUser({ email: syntheticEmail, password: newPassword });
  }

  await admin.auth().setCustomUserClaims(userRecord.uid, {
    admin: true,
    approved: true,
    familia: null,
  });

  await admin.firestore().collection("users").doc(userRecord.uid).set(
    {
      nombre: "Administrador",
      familia: null,
      familiaLabel: "Administración",
      username,
      email: syntheticEmail,
      status: "approved",
      reviewedAt: admin.firestore.FieldValue.serverTimestamp(),
      reviewedBy: "bootstrap-local",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  const outPath = path.join(os.homedir(), "junte-admin-credenciales.txt");
  fs.writeFileSync(
    outPath,
    `Junté Familiar — acceso de administrador\n` +
      `Usuario:     ${username}\n` +
      `Contraseña:  ${newPassword}\n` +
      `Generada:    ${new Date().toLocaleString("es-DO")}\n\n` +
      `Entra en /admin con este usuario y contraseña.\n` +
      `Guarda esto en tu gestor de contraseñas y borra este archivo.\n`,
    { mode: 0o600 }
  );
  fs.chmodSync(outPath, 0o600);

  console.log(`Listo: usuario "${username}" (uid ${userRecord.uid}) es admin y está aprobado.`);
  console.log(`Contraseña generada y guardada en: ${outPath}`);
  console.log("(permisos 600 — solo tu usuario puede leerlo; no se imprimió aquí ni queda en este script)");
}

main().catch(err => {
  console.error("Error:", err.message);
  process.exit(1);
});
