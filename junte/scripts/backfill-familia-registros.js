#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════════════════
   backfill-familia-registros.js — recalcula familiaRegistros/{slug}.registrados
   a partir de la verdad real (la colección users/), para que las cuentas
   creadas ANTES de que existiera esta función también cuenten. Seguro de
   correr las veces que sea: siempre recalcula desde cero, nunca duplica ni
   sobre-cuenta. No toca "ultimaActividad" de nadie (eso lo sigue poniendo
   cada quien al entrar).

   USO — por defecto corre contra el EMULADOR LOCAL (nunca producción):
     firebase emulators:start --only auth,firestore   # en otra terminal
     node scripts/backfill-familia-registros.js

   Contra producción de verdad:
     GOOGLE_APPLICATION_CREDENTIALS=/ruta/al/service-account.json \
       node scripts/backfill-familia-registros.js --produccion
   ════════════════════════════════════════════════════════════════════════ */
const readline = require("readline");
const PRODUCCION = process.argv.includes("--produccion");

if (!PRODUCCION) {
  process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";
  process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || "junte-familiar";
  console.log(`Modo: EMULADOR LOCAL (${process.env.FIRESTORE_EMULATOR_HOST}) — no toca producción.\n`);
} else {
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    console.error(
      "Falta GOOGLE_APPLICATION_CREDENTIALS. Ejemplo:\n" +
      '  GOOGLE_APPLICATION_CREDENTIALS="/ruta/al/service-account.json" node scripts/backfill-familia-registros.js --produccion'
    );
    process.exit(1);
  }
  console.log("⚠️  Modo: PRODUCCIÓN REAL — esto va a recalcular conteos en la base de datos real del Junte.\n");
}

const admin = require("firebase-admin");
admin.initializeApp(PRODUCCION ? { credential: admin.credential.applicationDefault() } : { projectId: "junte-familiar" });

async function confirmarProduccion() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const respuesta = await new Promise(resolve =>
    rl.question('Vas a escribir en PRODUCCIÓN. Escribe "si" para continuar: ', resolve)
  );
  rl.close();
  if (respuesta.trim().toLowerCase() !== "si") {
    console.log("Cancelado — no se escribió nada.");
    process.exit(0);
  }
}

async function main() {
  if (PRODUCCION) await confirmarProduccion();

  const db = admin.firestore();
  const usersSnap = await db.collection("users").get();

  const porFamilia = {};
  usersSnap.forEach(doc => {
    const familia = doc.data().familia;
    if (familia) porFamilia[familia] = (porFamilia[familia] || 0) + 1;
  });

  const familias = Object.keys(porFamilia);
  if (!familias.length) {
    console.log("No hay cuentas con familia asignada — nada que recalcular.");
    return;
  }

  let batch = db.batch();
  let enBatch = 0;
  for (const slug of familias) {
    const ref = db.collection("familiaRegistros").doc(slug);
    batch.set(ref, { registrados: porFamilia[slug] }, { merge: true });
    enBatch++;
    console.log(`→ ${slug}: ${porFamilia[slug]} registrado(s)`);
    if (enBatch === 400) { await batch.commit(); batch = db.batch(); enBatch = 0; }
  }
  if (enBatch > 0) await batch.commit();

  console.log(`\nListo: ${familias.length} familia(s) actualizadas con su conteo real de registrados.`);
}

main().catch(err => {
  console.error("Error:", err.message);
  process.exit(1);
});
