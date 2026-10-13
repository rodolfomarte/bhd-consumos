/* ════════════════════════════════════════════════════════════════════════
   Pruebas de firestore.rules — cuentas pendiente / aprobada / suspendida.
   Sin paso de verificación de correo: la aprobación manual del admin
   (status == 'approved') es el único filtro.

   Requiere Java + Firebase CLI instalados localmente. Ejecutar con:
     npm install
     npm run test:rules
   (dispara los emuladores, corre los tests y los apaga — no toca datos reales)
   ════════════════════════════════════════════════════════════════════════ */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} = require("@firebase/rules-unit-testing");

let testEnv;

test.before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: "junte-familiar-test",
    firestore: { rules: fs.readFileSync("firestore.rules", "utf8") },
  });
});

test.after(async () => {
  await testEnv.cleanup();
});

test.beforeEach(async () => {
  await testEnv.clearFirestore();
});

async function seedUser(uid, data) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().collection("users").doc(uid).set(data);
  });
}

async function seedMuralPhoto(id, data) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().collection("muralPhotos").doc(id).set(data);
  });
}

async function seedSettings(data) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().collection("config").doc("settings").set(data);
  });
}

test("un usuario nuevo puede crear su propio perfil pendiente", async () => {
  const alice = testEnv.authenticatedContext("alice", { email: "alice@test.com" });
  await assertSucceeds(
    alice.firestore().collection("users").doc("alice").set({
      nombre: "Alice", familia: "perez", familiaLabel: "Pérez", username: "alice",
      email: "alice@test.com", status: "pending",
      createdAt: new Date(),
    })
  );
});

test("un usuario nuevo NO puede crearse sin campo username", async () => {
  const alice = testEnv.authenticatedContext("alice", { email: "alice@test.com" });
  await assertFails(
    alice.firestore().collection("users").doc("alice").set({
      nombre: "Alice", familia: "perez", familiaLabel: "Pérez",
      email: "alice@test.com", status: "pending",
      createdAt: new Date(),
    })
  );
});

test("un usuario nuevo NO puede crearse ya aprobado", async () => {
  const alice = testEnv.authenticatedContext("alice", { email: "alice@test.com" });
  await assertFails(
    alice.firestore().collection("users").doc("alice").set({
      nombre: "Alice", familia: "perez", familiaLabel: "Pérez",
      email: "alice@test.com", status: "approved",
      createdAt: new Date(),
    })
  );
});

test("un usuario NO puede auto-aprobarse ni auto-asignarse admin", async () => {
  await seedUser("alice", { nombre: "Alice", familia: "perez", familiaLabel: "Pérez", email: "alice@test.com", status: "pending" });
  const alice = testEnv.authenticatedContext("alice", { email: "alice@test.com" });
  await assertFails(alice.firestore().collection("users").doc("alice").update({ status: "approved" }));
  // El rol admin no es un campo de Firestore: solo un custom claim que el
  // cliente no puede fijar, así que ni siquiera hay un "update" que probar.
});

test("un admin SÍ puede cambiar el status de cualquier usuario", async () => {
  await seedUser("alice", { nombre: "Alice", familia: "perez", familiaLabel: "Pérez", email: "alice@test.com", status: "pending" });
  const admin = testEnv.authenticatedContext("admin1", { email: "admin@test.com", admin: true });
  await assertSucceeds(admin.firestore().collection("users").doc("alice").update({ status: "approved" }));
});

test("pendiente: no puede leer ni escribir fotos del Mural", async () => {
  await seedUser("alice", { nombre: "Alice", familia: "perez", familiaLabel: "Pérez", email: "alice@test.com", status: "pending" });
  await seedMuralPhoto("perez_2025", { familia: "perez", familiaLabel: "Pérez", anio: "2025", url: "x", uploaderUid: "alice", likes: [], comments: [] });

  const alice = testEnv.authenticatedContext("alice", { email: "alice@test.com" });
  const aliceDb = alice.firestore();
  await assertFails(aliceDb.collection("muralPhotos").doc("perez_2025").get());
  await assertFails(
    aliceDb.collection("muralPhotos").doc("perez_2026").set({
      familia: "perez", familiaLabel: "Pérez", anio: "2026", url: "y",
      uploaderUid: "alice", uploaderEmail: "alice@test.com", likes: [], comments: [],
    })
  );
});

test("rechazada: no puede leer ni escribir fotos del Mural", async () => {
  await seedUser("alice", { nombre: "Alice", familia: "perez", familiaLabel: "Pérez", email: "alice@test.com", status: "rejected" });
  await seedMuralPhoto("perez_2025", { familia: "perez", familiaLabel: "Pérez", anio: "2025", url: "x", uploaderUid: "alice", likes: [], comments: [] });

  const alice = testEnv.authenticatedContext("alice", { email: "alice@test.com" });
  await assertFails(alice.firestore().collection("muralPhotos").doc("perez_2025").get());
});

test("aprobada: puede subir y leer SU PROPIA foto de familia (sin necesitar correo verificado)", async () => {
  await seedUser("alice", { nombre: "Alice", familia: "perez", familiaLabel: "Pérez", email: "alice@test.com", status: "approved" });
  const alice = testEnv.authenticatedContext("alice", { email: "alice@test.com" });
  const aliceDb = alice.firestore();

  await assertSucceeds(
    aliceDb.collection("muralPhotos").doc("perez_2025").set({
      familia: "perez", familiaLabel: "Pérez", anio: "2025", url: "y",
      uploaderUid: "alice", uploaderEmail: "alice@test.com", likes: [], comments: [],
    })
  );
  await assertSucceeds(aliceDb.collection("muralPhotos").doc("perez_2025").get());
});

test("aprobada: NO puede subir foto a otra familia", async () => {
  await seedUser("alice", { nombre: "Alice", familia: "perez", familiaLabel: "Pérez", email: "alice@test.com", status: "approved" });
  const alice = testEnv.authenticatedContext("alice", { email: "alice@test.com" });

  await assertFails(
    alice.firestore().collection("muralPhotos").doc("gomez_2025").set({
      familia: "gomez", familiaLabel: "Gómez", anio: "2025", url: "y",
      uploaderUid: "alice", uploaderEmail: "alice@test.com", likes: [], comments: [],
    })
  );
});

test("aprobada: NO puede leer fotos de otra familia si la galería general está apagada", async () => {
  await seedUser("alice", { nombre: "Alice", familia: "perez", familiaLabel: "Pérez", email: "alice@test.com", status: "approved" });
  await seedMuralPhoto("gomez_2025", { familia: "gomez", familiaLabel: "Gómez", anio: "2025", url: "x", uploaderUid: "bob", likes: [], comments: [] });
  await seedSettings({ galleryEnabledForUsers: false });

  const alice = testEnv.authenticatedContext("alice", { email: "alice@test.com" });
  await assertFails(alice.firestore().collection("muralPhotos").doc("gomez_2025").get());
});

test("aprobada: SÍ puede leer fotos de otra familia si el admin habilitó la galería general", async () => {
  await seedUser("alice", { nombre: "Alice", familia: "perez", familiaLabel: "Pérez", email: "alice@test.com", status: "approved" });
  await seedMuralPhoto("gomez_2025", { familia: "gomez", familiaLabel: "Gómez", anio: "2025", url: "x", uploaderUid: "bob", likes: [], comments: [] });
  await seedSettings({ galleryEnabledForUsers: true });

  const alice = testEnv.authenticatedContext("alice", { email: "alice@test.com" });
  await assertSucceeds(alice.firestore().collection("muralPhotos").doc("gomez_2025").get());
});

test("muralPhotos: un aprobado de la MISMA familia puede borrar, aunque no haya sido quien subió la foto", async () => {
  await seedUser("bob", { nombre: "Bob", familia: "perez", familiaLabel: "Pérez", email: "bob@test.com", status: "approved" });
  await seedMuralPhoto("perez_2025", { familia: "perez", familiaLabel: "Pérez", anio: "2025", url: "x", uploaderUid: "alice", likes: [], comments: [] });
  const bob = testEnv.authenticatedContext("bob", { email: "bob@test.com" });
  await assertSucceeds(bob.firestore().collection("muralPhotos").doc("perez_2025").delete());
});

test("muralPhotos: un aprobado de OTRA familia NO puede borrar (de verdad, no solo CSS)", async () => {
  await seedUser("carol", { nombre: "Carol", familia: "gomez", familiaLabel: "Gómez", email: "carol@test.com", status: "approved" });
  await seedMuralPhoto("perez_2025", { familia: "perez", familiaLabel: "Pérez", anio: "2025", url: "x", uploaderUid: "alice", likes: [], comments: [] });
  const carol = testEnv.authenticatedContext("carol", { email: "carol@test.com" });
  await assertFails(carol.firestore().collection("muralPhotos").doc("perez_2025").delete());
});

test("muralPhotos: una cuenta pendiente de la misma familia NO puede borrar", async () => {
  await seedUser("dave", { nombre: "Dave", familia: "perez", familiaLabel: "Pérez", email: "dave@test.com", status: "pending" });
  await seedMuralPhoto("perez_2025", { familia: "perez", familiaLabel: "Pérez", anio: "2025", url: "x", uploaderUid: "alice", likes: [], comments: [] });
  const dave = testEnv.authenticatedContext("dave", { email: "dave@test.com" });
  await assertFails(dave.firestore().collection("muralPhotos").doc("perez_2025").delete());
});

test("livePhotos: un aprobado de la MISMA familia puede borrar, aunque no haya sido quien subió la foto", async () => {
  await seedUser("bob", { nombre: "Bob", familia: "perez", familiaLabel: "Pérez", email: "bob@test.com", status: "approved" });
  await testEnv.withSecurityRulesDisabled(async ctx => {
    await ctx.firestore().collection("livePhotos").doc("live1").set({ familia: "perez", familiaLabel: "Pérez", uploaderUid: "alice", likes: [], comments: [] });
  });
  const bob = testEnv.authenticatedContext("bob", { email: "bob@test.com" });
  await assertSucceeds(bob.firestore().collection("livePhotos").doc("live1").delete());
});

test("livePhotos: un aprobado de OTRA familia NO puede borrar", async () => {
  await seedUser("carol", { nombre: "Carol", familia: "gomez", familiaLabel: "Gómez", email: "carol@test.com", status: "approved" });
  await testEnv.withSecurityRulesDisabled(async ctx => {
    await ctx.firestore().collection("livePhotos").doc("live1").set({ familia: "perez", familiaLabel: "Pérez", uploaderUid: "alice", likes: [], comments: [] });
  });
  const carol = testEnv.authenticatedContext("carol", { email: "carol@test.com" });
  await assertFails(carol.firestore().collection("livePhotos").doc("live1").delete());
});

test("suspendida: pierde el acceso aunque antes estuviera aprobada", async () => {
  await seedUser("alice", { nombre: "Alice", familia: "perez", familiaLabel: "Pérez", email: "alice@test.com", status: "suspended" });
  await seedMuralPhoto("perez_2025", { familia: "perez", familiaLabel: "Pérez", anio: "2025", url: "x", uploaderUid: "alice", likes: [], comments: [] });

  const alice = testEnv.authenticatedContext("alice", { email: "alice@test.com" });
  await assertFails(alice.firestore().collection("muralPhotos").doc("perez_2025").get());
});

test("solo el admin puede escribir el toggle de galería general", async () => {
  await seedUser("alice", { nombre: "Alice", familia: "perez", familiaLabel: "Pérez", email: "alice@test.com", status: "approved" });
  const alice = testEnv.authenticatedContext("alice", { email: "alice@test.com" });
  await assertFails(alice.firestore().collection("config").doc("settings").set({ galleryEnabledForUsers: true }));

  const admin = testEnv.authenticatedContext("admin1", { email: "admin@test.com", admin: true });
  await assertSucceeds(admin.firestore().collection("config").doc("settings").set({ galleryEnabledForUsers: true }));
});

test("publicContent (villas/agenda/menú): cualquiera puede leerlo, incluso sin sesión", async () => {
  await testEnv.withSecurityRulesDisabled(async ctx => {
    await ctx.firestore().collection("publicContent").doc("main").set({ villas: [] });
  });
  const anon = testEnv.unauthenticatedContext();
  await assertSucceeds(anon.firestore().collection("publicContent").doc("main").get());
});

test("publicContent: solo el admin puede escribirlo (ni siquiera un usuario aprobado)", async () => {
  await seedUser("alice", { nombre: "Alice", familia: "perez", familiaLabel: "Pérez", email: "alice@test.com", status: "approved" });
  const alice = testEnv.authenticatedContext("alice", { email: "alice@test.com" });
  await assertFails(alice.firestore().collection("publicContent").doc("main").set({ villas: [] }));

  const admin = testEnv.authenticatedContext("admin1", { email: "admin@test.com", admin: true });
  await assertSucceeds(admin.firestore().collection("publicContent").doc("main").set({ villas: [] }));
});

test("retos: aprobada NO puede leer un reto bloqueado (de verdad, no solo CSS)", async () => {
  await seedUser("alice", { nombre: "Alice", familia: "perez", familiaLabel: "Pérez", email: "alice@test.com", status: "approved" });
  await testEnv.withSecurityRulesDisabled(async ctx => {
    await ctx.firestore().collection("retos").doc("palmera").set({ estado: "bloqueado", titulo: "secreto" });
  });
  const alice = testEnv.authenticatedContext("alice", { email: "alice@test.com" });
  await assertFails(alice.firestore().collection("retos").doc("palmera").get());
});

test("retos: aprobada SÍ puede leer un reto ya publicado (disponible)", async () => {
  await seedUser("alice", { nombre: "Alice", familia: "perez", familiaLabel: "Pérez", email: "alice@test.com", status: "approved" });
  await testEnv.withSecurityRulesDisabled(async ctx => {
    await ctx.firestore().collection("retos").doc("palmera").set({ estado: "disponible", titulo: "Busca el tesoro" });
  });
  const alice = testEnv.authenticatedContext("alice", { email: "alice@test.com" });
  await assertSucceeds(alice.firestore().collection("retos").doc("palmera").get());
});

test("retos: pendiente NO puede leer ni un reto publicado", async () => {
  await seedUser("alice", { nombre: "Alice", familia: "perez", familiaLabel: "Pérez", email: "alice@test.com", status: "pending" });
  await testEnv.withSecurityRulesDisabled(async ctx => {
    await ctx.firestore().collection("retos").doc("palmera").set({ estado: "disponible", titulo: "Busca el tesoro" });
  });
  const alice = testEnv.authenticatedContext("alice", { email: "alice@test.com" });
  await assertFails(alice.firestore().collection("retos").doc("palmera").get());
});

test("retos: admin SIEMPRE puede leer, incluso bloqueado; solo admin puede escribir", async () => {
  await testEnv.withSecurityRulesDisabled(async ctx => {
    await ctx.firestore().collection("retos").doc("palmera").set({ estado: "bloqueado" });
  });
  const admin = testEnv.authenticatedContext("admin1", { email: "admin@test.com", admin: true });
  const adminDb = admin.firestore();
  await assertSucceeds(adminDb.collection("retos").doc("palmera").get());
  await assertSucceeds(adminDb.collection("retos").doc("palmera").update({ estado: "disponible" }));

  await seedUser("alice", { nombre: "Alice", familia: "perez", familiaLabel: "Pérez", email: "alice@test.com", status: "approved" });
  const alice = testEnv.authenticatedContext("alice", { email: "alice@test.com" });
  await assertFails(alice.firestore().collection("retos").doc("palmera").update({ estado: "disponible" }));
});

test("retoCaptains: solo el admin puede leer o escribir, ni siquiera el propio capitán", async () => {
  await testEnv.withSecurityRulesDisabled(async ctx => {
    await ctx.firestore().collection("retoCaptains").doc("perez").set({ uid: "alice", nombre: "Alice" });
  });
  const alice = testEnv.authenticatedContext("alice", { email: "alice@test.com", approved: true, capitanVilla: "perez" });
  const aliceDb = alice.firestore();
  await assertFails(aliceDb.collection("retoCaptains").doc("perez").get());
  await assertFails(aliceDb.collection("retoCaptains").doc("perez").set({ uid: "bob" }));

  const admin = testEnv.authenticatedContext("admin1", { email: "admin@test.com", admin: true });
  await assertSucceeds(admin.firestore().collection("retoCaptains").doc("perez").get());
});

function evidenciaBase(overrides = {}) {
  return {
    villa: "perez", retoId: "identidad-equipo", uid: "alice",
    nombreEquipo: "Los Pérez", eslogan: "Unidos somos más",
    fotoUrl: "https://example.com/foto.jpg", fotoPath: "retos/perez/identidad-equipo/foto.jpg",
    estado: "pendiente", puntosOtorgados: 0,
    imagenAnteriorUrl: null, imagenAnteriorPath: null, comentarioAdmin: null,
    ...overrides,
  };
}

test("retoEvidencias: el capitán de la villa SÍ puede crear la entrega de SU villa (con foto)", async () => {
  await seedUser("alice", { nombre: "Alice", familia: "perez", familiaLabel: "Pérez", email: "alice@test.com", status: "approved" });
  const alice = testEnv.authenticatedContext("alice", { email: "alice@test.com", approved: true, capitanVilla: "perez" });
  await assertSucceeds(
    alice.firestore().collection("retoEvidencias").doc("perez_identidad-equipo").set(evidenciaBase())
  );
});

test("retoEvidencias: NO se puede crear sin foto (la foto es obligatoria)", async () => {
  await seedUser("alice", { nombre: "Alice", familia: "perez", familiaLabel: "Pérez", email: "alice@test.com", status: "approved" });
  const alice = testEnv.authenticatedContext("alice", { email: "alice@test.com", approved: true, capitanVilla: "perez" });
  await assertFails(
    alice.firestore().collection("retoEvidencias").doc("perez_identidad-equipo").set(evidenciaBase({ fotoUrl: "" }))
  );
});

test("retoEvidencias: un capitán NO puede crear la entrega de OTRA villa (de verdad, no solo CSS)", async () => {
  await seedUser("bob", { nombre: "Bob", familia: "cafe", familiaLabel: "Café", email: "bob@test.com", status: "approved" });
  const bob = testEnv.authenticatedContext("bob", { email: "bob@test.com", approved: true, capitanVilla: "cafe" });
  await assertFails(
    bob.firestore().collection("retoEvidencias").doc("perez_identidad-equipo").set(evidenciaBase({ uid: "bob", nombreEquipo: "Intrusos", eslogan: "x" }))
  );
});

test("retoEvidencias: un aprobado SIN ser capitán NO puede crear ni editar evidencia, pero SÍ puede leerla", async () => {
  await testEnv.withSecurityRulesDisabled(async ctx => {
    await ctx.firestore().collection("retoEvidencias").doc("perez_identidad-equipo").set(evidenciaBase({ estado: "correccion" }));
  });
  await seedUser("carol", { nombre: "Carol", familia: "cafe", familiaLabel: "Café", email: "carol@test.com", status: "approved" });
  const carol = testEnv.authenticatedContext("carol", { email: "carol@test.com", approved: true, capitanVilla: null });
  const carolDb = carol.firestore();
  await assertSucceeds(carolDb.collection("retoEvidencias").doc("perez_identidad-equipo").get());
  await assertFails(carolDb.collection("retoEvidencias").doc("perez_identidad-equipo").update({ eslogan: "hackeado" }));
  await assertFails(
    carolDb.collection("retoEvidencias").doc("cafe_identidad-equipo").set(evidenciaBase({ villa: "cafe", uid: "carol", nombreEquipo: "x", eslogan: "x" }))
  );
});

test("retoEvidencias: no aprobado NO puede leer evidencias", async () => {
  await testEnv.withSecurityRulesDisabled(async ctx => {
    await ctx.firestore().collection("retoEvidencias").doc("perez_identidad-equipo").set(evidenciaBase());
  });
  const dave = testEnv.authenticatedContext("dave", { email: "dave@test.com", approved: false });
  await assertFails(dave.firestore().collection("retoEvidencias").doc("perez_identidad-equipo").get());
});

test("retoEvidencias: el capitán NO puede editar mientras está 'pendiente' (ya no, solo mientras está 'correccion')", async () => {
  await seedUser("alice", { nombre: "Alice", familia: "perez", familiaLabel: "Pérez", email: "alice@test.com", status: "approved" });
  await testEnv.withSecurityRulesDisabled(async ctx => {
    await ctx.firestore().collection("retoEvidencias").doc("perez_identidad-equipo").set(evidenciaBase({ estado: "pendiente" }));
  });
  const alice = testEnv.authenticatedContext("alice", { email: "alice@test.com", approved: true, capitanVilla: "perez" });
  await assertFails(
    alice.firestore().collection("retoEvidencias").doc("perez_identidad-equipo")
      .update({ nombreEquipo: "Los Pérez FC" })
  );
});

test("retoEvidencias: el capitán SÍ puede reenviar mientras está en 'correccion', y vuelve a 'pendiente'", async () => {
  await seedUser("alice", { nombre: "Alice", familia: "perez", familiaLabel: "Pérez", email: "alice@test.com", status: "approved" });
  await testEnv.withSecurityRulesDisabled(async ctx => {
    await ctx.firestore().collection("retoEvidencias").doc("perez_identidad-equipo").set(evidenciaBase({ estado: "correccion", comentarioAdmin: "Pon el eslogan más grande" }));
  });
  const alice = testEnv.authenticatedContext("alice", { email: "alice@test.com", approved: true, capitanVilla: "perez" });
  await assertSucceeds(
    alice.firestore().collection("retoEvidencias").doc("perez_identidad-equipo")
      .update({ nombreEquipo: "Los Pérez FC", eslogan: "Unidos somos más y mejor", fotoUrl: "https://example.com/foto2.jpg", estado: "pendiente" })
  );
});

test("retoEvidencias: el capitán NO puede tocar puntosOtorgados, comentarioAdmin ni la villa al reenviar", async () => {
  await seedUser("alice", { nombre: "Alice", familia: "perez", familiaLabel: "Pérez", email: "alice@test.com", status: "approved" });
  await testEnv.withSecurityRulesDisabled(async ctx => {
    await ctx.firestore().collection("retoEvidencias").doc("perez_identidad-equipo").set(evidenciaBase({ estado: "correccion" }));
  });
  const alice = testEnv.authenticatedContext("alice", { email: "alice@test.com", approved: true, capitanVilla: "perez" });
  const aliceDb = alice.firestore();
  await assertFails(aliceDb.collection("retoEvidencias").doc("perez_identidad-equipo").update({ estado: "pendiente", puntosOtorgados: 999 }));
  await assertFails(aliceDb.collection("retoEvidencias").doc("perez_identidad-equipo").update({ estado: "pendiente", comentarioAdmin: "me lo invento" }));
  await assertFails(aliceDb.collection("retoEvidencias").doc("perez_identidad-equipo").update({ estado: "pendiente", villa: "cafe" }));
  await assertFails(aliceDb.collection("retoEvidencias").doc("perez_identidad-equipo").update({ estado: "aprobado" })); // no puede auto-aprobarse
});

test("retoEvidencias: el admin (vía su función de servidor, que usa Admin SDK) puede escribir sin las restricciones del capitán", async () => {
  await testEnv.withSecurityRulesDisabled(async ctx => {
    await ctx.firestore().collection("retoEvidencias").doc("perez_identidad-equipo").set(evidenciaBase());
  });
  const admin = testEnv.authenticatedContext("admin1", { email: "admin@test.com", admin: true });
  await assertSucceeds(
    admin.firestore().collection("retoEvidencias").doc("perez_identidad-equipo").update({ estado: "aprobado", puntosOtorgados: 100 })
  );
});

test("villaImagenes: admin y aprobados pueden leer; solo admin escribe", async () => {
  await seedUser("alice", { nombre: "Alice", familia: "perez", familiaLabel: "Pérez", email: "alice@test.com", status: "approved" });
  const alice = testEnv.authenticatedContext("alice", { email: "alice@test.com" });
  const aliceDb = alice.firestore();
  const admin = testEnv.authenticatedContext("admin1", { email: "admin@test.com", admin: true });
  await assertSucceeds(admin.firestore().collection("villaImagenes").doc("perez").set({ url: "https://x", fuente: "aprobado" }));
  await assertSucceeds(aliceDb.collection("villaImagenes").doc("perez").get());
  await assertFails(aliceDb.collection("villaImagenes").doc("perez").set({ url: "https://hackeado" }));
});

test("villaPuntos: admin y aprobados pueden leer; solo admin escribe", async () => {
  await seedUser("alice", { nombre: "Alice", familia: "perez", familiaLabel: "Pérez", email: "alice@test.com", status: "approved" });
  const alice = testEnv.authenticatedContext("alice", { email: "alice@test.com" });
  const aliceDb = alice.firestore();
  const admin = testEnv.authenticatedContext("admin1", { email: "admin@test.com", admin: true });
  await assertSucceeds(admin.firestore().collection("villaPuntos").doc("perez").set({ total: 100 }));
  await assertSucceeds(aliceDb.collection("villaPuntos").doc("perez").get());
  await assertFails(aliceDb.collection("villaPuntos").doc("perez").set({ total: 999999 }));
});
