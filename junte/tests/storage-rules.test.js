/* ════════════════════════════════════════════════════════════════════════
   Pruebas de storage.rules — subir/leer fotos del Mural y de Live por familia.

   storage.rules es 100% claims-based (sin llamadas cruzadas a Firestore —
   el emulador local no las soporta, se verificó a mano), así que estas
   pruebas pasan directamente los custom claims (approved/familia/admin) en
   authenticatedContext, simulando lo que netlify/functions/set-user-status.js
   fija en producción. Sin paso de correo: la aprobación manual es el único
   filtro.
   ════════════════════════════════════════════════════════════════════════ */
const test = require("node:test");
const fs = require("node:fs");
const {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} = require("@firebase/rules-unit-testing");

let testEnv;
const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
);
const png = { contentType: "image/png" };

test.before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: "junte-familiar-test",
    storage: { rules: fs.readFileSync("storage.rules", "utf8") },
  });
});

test.after(async () => {
  await testEnv.cleanup();
});

test("sin sesión: no puede subir nada", async () => {
  const anon = testEnv.unauthenticatedContext();
  await assertFails(anon.storage().ref("mural/perez/2025").put(PNG_BYTES, png));
});

test("pendiente (sin claim approved): no puede subir foto al Mural", async () => {
  const alice = testEnv.authenticatedContext("alice", { email: "alice@junte.internal" });
  await assertFails(alice.storage().ref("mural/perez/2025").put(PNG_BYTES, png));
});

test("aprobada: puede subir foto a SU PROPIA carpeta de familia", async () => {
  const alice = testEnv.authenticatedContext("alice", {
    email: "alice@junte.internal", approved: true, familia: "perez",
  });
  await assertSucceeds(alice.storage().ref("mural/perez/2025").put(PNG_BYTES, png));
});

test("aprobada: NO puede subir foto a la carpeta de OTRA familia", async () => {
  const alice = testEnv.authenticatedContext("alice", {
    email: "alice@junte.internal", approved: true, familia: "perez",
  });
  await assertFails(alice.storage().ref("mural/gomez/2025").put(PNG_BYTES, png));
});

test("suspendida (claim approved=false): pierde el acceso de escritura", async () => {
  const alice = testEnv.authenticatedContext("alice", {
    email: "alice@junte.internal", approved: false, familia: "perez",
  });
  await assertFails(alice.storage().ref("mural/perez/2025").put(PNG_BYTES, png));
});

test("no puede subir un archivo que no sea imagen", async () => {
  const alice = testEnv.authenticatedContext("alice", {
    email: "alice@junte.internal", approved: true, familia: "perez",
  });
  await assertFails(
    alice.storage().ref("mural/perez/2025").put(Buffer.from("no soy una imagen"), { contentType: "text/plain" })
  );
});

test("admin: puede subir foto a la carpeta de CUALQUIER familia", async () => {
  const admin = testEnv.authenticatedContext("admin1", {
    email: "admin@junte.internal", admin: true,
  });
  await assertSucceeds(admin.storage().ref("mural/perez/2025").put(PNG_BYTES, png));
});

test("live/<id> (ruta vieja, sin familia): solo admin puede borrar", async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.storage().ref("live/abc123").put(PNG_BYTES, png);
    await ctx.storage().ref("live/xyz789").put(PNG_BYTES, png);
  });

  const alice = testEnv.authenticatedContext("alice", {
    email: "alice@junte.internal", approved: true, familia: "perez",
  });
  await assertFails(alice.storage().ref("live/abc123").delete());

  const admin = testEnv.authenticatedContext("admin1", { email: "admin@junte.internal", admin: true });
  await assertSucceeds(admin.storage().ref("live/xyz789").delete());
});

test("mural: un aprobado de la MISMA familia puede borrar, aunque no haya sido quien subió", async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.storage().ref("mural/perez/2025").put(PNG_BYTES, png);
  });
  const bob = testEnv.authenticatedContext("bob", { email: "bob@junte.internal", approved: true, familia: "perez" });
  await assertSucceeds(bob.storage().ref("mural/perez/2025").delete());
});

test("mural: un aprobado de OTRA familia NO puede borrar", async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.storage().ref("mural/perez/2025").put(PNG_BYTES, png);
  });
  const carol = testEnv.authenticatedContext("carol", { email: "carol@junte.internal", approved: true, familia: "gomez" });
  await assertFails(carol.storage().ref("mural/perez/2025").delete());
});

test("live/<familia>/<id> (ruta nueva): un aprobado de la MISMA familia puede subir y borrar", async () => {
  const alice = testEnv.authenticatedContext("alice", { email: "alice@junte.internal", approved: true, familia: "perez" });
  await assertSucceeds(alice.storage().ref("live/perez/abc123").put(PNG_BYTES, png));
  const bob = testEnv.authenticatedContext("bob", { email: "bob@junte.internal", approved: true, familia: "perez" });
  await assertSucceeds(bob.storage().ref("live/perez/abc123").delete());
});

test("live/<familia>/<id> (ruta nueva): un aprobado de OTRA familia NO puede borrar ni subir ahí", async () => {
  const carol = testEnv.authenticatedContext("carol", { email: "carol@junte.internal", approved: true, familia: "gomez" });
  await assertFails(carol.storage().ref("live/perez/abc123").put(PNG_BYTES, png));
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.storage().ref("live/perez/abc123").put(PNG_BYTES, png);
  });
  await assertFails(carol.storage().ref("live/perez/abc123").delete());
});

test("retos: el capitán de la villa SÍ puede subir evidencia a SU villa", async () => {
  const alice = testEnv.authenticatedContext("alice", {
    email: "alice@junte.internal", approved: true, familia: "perez", capitanVilla: "perez",
  });
  await assertSucceeds(alice.storage().ref("retos/perez/identidad-equipo/foto.png").put(PNG_BYTES, png));
});

test("retos: el capitán NO puede subir evidencia a OTRA villa (de verdad, no solo CSS)", async () => {
  const bob = testEnv.authenticatedContext("bob", {
    email: "bob@junte.internal", approved: true, familia: "cafe", capitanVilla: "cafe",
  });
  await assertFails(bob.storage().ref("retos/perez/identidad-equipo/foto.png").put(PNG_BYTES, png));
});

test("retos: un aprobado que NO es capitán de ninguna villa no puede subir evidencia", async () => {
  const carol = testEnv.authenticatedContext("carol", {
    email: "carol@junte.internal", approved: true, familia: "perez",
  });
  await assertFails(carol.storage().ref("retos/perez/identidad-equipo/foto.png").put(PNG_BYTES, png));
});

test("retos: admin puede subir evidencia a cualquier villa", async () => {
  const admin = testEnv.authenticatedContext("admin1", { email: "admin@junte.internal", admin: true });
  await assertSucceeds(admin.storage().ref("retos/bosque/identidad-equipo/foto.png").put(PNG_BYTES, png));
});

test("retos: un video YA NO se acepta como evidencia — solo una foto", async () => {
  const alice = testEnv.authenticatedContext("alice", {
    email: "alice@junte.internal", approved: true, familia: "perez", capitanVilla: "perez",
  });
  await assertFails(
    alice.storage().ref("retos/perez/identidad-equipo/video.mp4").put(PNG_BYTES, { contentType: "video/mp4" })
  );
});

test("retos: cualquier aprobado puede LEER la evidencia (pero no escribirla)", async () => {
  await testEnv.withSecurityRulesDisabled(async ctx => {
    await ctx.storage().ref("retos/perez/identidad-equipo/foto.png").put(PNG_BYTES, png);
  });
  const dave = testEnv.authenticatedContext("dave", {
    email: "dave@junte.internal", approved: true, familia: "cafe",
  });
  await assertSucceeds(dave.storage().ref("retos/perez/identidad-equipo/foto.png").getMetadata());
});
