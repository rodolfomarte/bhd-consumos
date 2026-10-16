#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════════════════
   seed-catalogo-musica.js — carga (o completa) las "Sugerencias para el
   junte" en cancionesPedidas: 10 canciones reales y verificables por cada
   uno de los 6 géneros oficiales del catálogo (60 en total). NO son un
   ranking ("más escuchadas de tal mes") — son solo sugerencias para
   arrancar la lista, elegidas entre clásicos y éxitos ampliamente
   documentados de cada género.

   IDEMPOTENTE: usa el mismo ID determinístico que calcula musica.js al
   proponer una canción (slug de "título-artista"). Si el doc ya existe
   (porque ya se cargó antes, o porque un invitado ya la propuso) se omite
   sin tocarla — nunca pisa votos ni ediciones existentes, nunca duplica.

   USO — por defecto corre contra el EMULADOR LOCAL (nunca producción):
     firebase emulators:start --only auth,firestore   # en otra terminal
     node scripts/seed-catalogo-musica.js

   Para correr de verdad contra producción (acción real, pide confirmación
   explícita y requiere credenciales):
     GOOGLE_APPLICATION_CREDENTIALS=/ruta/al/service-account.json \
       node scripts/seed-catalogo-musica.js --produccion
   ════════════════════════════════════════════════════════════════════════ */
const fs = require("fs");
const path = require("path");
const readline = require("readline");

const PRODUCCION = process.argv.includes("--produccion");

if (!PRODUCCION) {
  // Nunca toca producción salvo que se pida explícitamente con --produccion
  // (y aun así, se pide confirmación abajo). Por defecto, todo esto se va
  // al emulador local.
  process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";
  process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || "junte-familiar";
  console.log(`Modo: EMULADOR LOCAL (${process.env.FIRESTORE_EMULATOR_HOST}) — no toca producción.\n`);
} else {
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    console.error(
      "Falta GOOGLE_APPLICATION_CREDENTIALS. Ejemplo:\n" +
      '  GOOGLE_APPLICATION_CREDENTIALS="/ruta/al/service-account.json" node scripts/seed-catalogo-musica.js --produccion'
    );
    process.exit(1);
  }
  console.log("⚠️  Modo: PRODUCCIÓN REAL — esto va a escribir en la base de datos real del Junte.\n");
}

const admin = require("firebase-admin");
admin.initializeApp(PRODUCCION ? { credential: admin.credential.applicationDefault() } : { projectId: "junte-familiar" });

function slugify(s) {
  return String(s)
    .trim()
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

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

  const catalogo = JSON.parse(fs.readFileSync(path.join(__dirname, "catalogo-musica.json"), "utf8"));
  const db = admin.firestore();

  let creadas = 0, omitidas = 0;
  const detalle = [];

  for (const song of catalogo) {
    const id = slugify(`${song.titulo}-${song.artista}`);
    const ref = db.collection("cancionesPedidas").doc(id);
    const snap = await ref.get();
    if (snap.exists) {
      omitidas++;
      detalle.push(`— omitida (ya existía): ${song.titulo} — ${song.artista}`);
      continue;
    }
    await ref.set({
      titulo: song.titulo,
      artista: song.artista,
      generoSlug: song.generoSlug,
      spotifyUrl: "",
      dedicatoria: "",
      familia: "organizacion",
      nombre: "Organización",
      uid: "sistema-catalogo",
      estado: "activa",
      ocultaInapropiado: false,
      etiquetaContenido: "",
      ordenCola: 0,
      creadoEn: admin.firestore.FieldValue.serverTimestamp(),
    });
    creadas++;
    detalle.push(`✔ creada: ${song.titulo} — ${song.artista} (${song.generoSlug})`);
  }

  console.log(detalle.join("\n"));
  console.log(`\nTotal en el archivo: ${catalogo.length} · creadas: ${creadas} · omitidas (ya existían): ${omitidas}`);

  const porGenero = {};
  catalogo.forEach(s => { porGenero[s.generoSlug] = (porGenero[s.generoSlug] || 0) + 1; });
  console.log("Por género en el archivo:", porGenero);
}

main().catch(err => {
  console.error("Error:", err.message);
  process.exit(1);
});
