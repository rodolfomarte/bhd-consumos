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

test("muralPhotos: un aprobado de la MISMA familia puede sustituir la foto (url/descripción), conservando likes/comentarios", async () => {
  await seedUser("bob", { nombre: "Bob", familia: "perez", familiaLabel: "Pérez", email: "bob@test.com", status: "approved" });
  await seedMuralPhoto("perez_2025", {
    familia: "perez", familiaLabel: "Pérez", anio: "2025", url: "x", description: "vieja",
    uploaderUid: "alice", uploaderEmail: "alice@test.com", createdAt: new Date(),
    likes: [{ uid: "carol", nombre: "Carol" }], comments: [],
  });
  const bob = testEnv.authenticatedContext("bob", { email: "bob@test.com" });
  await assertSucceeds(
    bob.firestore().collection("muralPhotos").doc("perez_2025").update({
      url: "y", description: "nueva", uploaderUid: "bob", uploaderEmail: "bob@test.com", createdAt: new Date(),
    })
  );
});

test("muralPhotos: un aprobado de OTRA familia NO puede sustituir la foto", async () => {
  await seedUser("carol", { nombre: "Carol", familia: "gomez", familiaLabel: "Gómez", email: "carol@test.com", status: "approved" });
  await seedMuralPhoto("perez_2025", { familia: "perez", familiaLabel: "Pérez", anio: "2025", url: "x", uploaderUid: "alice", likes: [], comments: [] });
  const carol = testEnv.authenticatedContext("carol", { email: "carol@test.com" });
  await assertFails(
    carol.firestore().collection("muralPhotos").doc("perez_2025").update({ url: "y", uploaderUid: "carol" })
  );
});

test("muralPhotos: sustituir la foto NO puede cambiar de familia ni de año (sería otra casilla)", async () => {
  await seedUser("bob", { nombre: "Bob", familia: "perez", familiaLabel: "Pérez", email: "bob@test.com", status: "approved" });
  await seedMuralPhoto("perez_2025", { familia: "perez", familiaLabel: "Pérez", anio: "2025", url: "x", uploaderUid: "alice", likes: [], comments: [] });
  const bob = testEnv.authenticatedContext("bob", { email: "bob@test.com" });
  const bobDb = bob.firestore();
  await assertFails(
    bobDb.collection("muralPhotos").doc("perez_2025").update({ url: "y", familia: "cafe" })
  );
  await assertFails(
    bobDb.collection("muralPhotos").doc("perez_2025").update({ url: "y", anio: "2026" })
  );
});

test("muralPhotos: sustituir no puede colarse y tocar likes/comments en la misma escritura", async () => {
  await seedUser("bob", { nombre: "Bob", familia: "perez", familiaLabel: "Pérez", email: "bob@test.com", status: "approved" });
  await seedMuralPhoto("perez_2025", { familia: "perez", familiaLabel: "Pérez", anio: "2025", url: "x", uploaderUid: "alice", likes: [], comments: [] });
  const bob = testEnv.authenticatedContext("bob", { email: "bob@test.com" });
  await assertFails(
    bob.firestore().collection("muralPhotos").doc("perez_2025").update({ url: "y", likes: [{ uid: "bob", nombre: "Bob" }] })
  );
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

test("villaPuntosAjustes: admin y aprobados pueden leer; solo admin escribe", async () => {
  await seedUser("alice", { nombre: "Alice", familia: "perez", familiaLabel: "Pérez", email: "alice@test.com", status: "approved" });
  const alice = testEnv.authenticatedContext("alice", { email: "alice@test.com" });
  const aliceDb = alice.firestore();
  const admin = testEnv.authenticatedContext("admin1", { email: "admin@test.com", admin: true });
  await assertSucceeds(admin.firestore().collection("villaPuntosAjustes").doc("ajuste1").set({ villa: "perez", motivo: "Espíritu de equipo", puntos: 50 }));
  await assertSucceeds(aliceDb.collection("villaPuntosAjustes").doc("ajuste1").get());
  await assertFails(aliceDb.collection("villaPuntosAjustes").doc("ajuste2").set({ villa: "perez", motivo: "me lo invento", puntos: 999 }));
});

/* ═══════════════════ "Pide tu canción" ═══════════════════════════════ */
function cancionBase(overrides = {}) {
  return {
    titulo: "Mi canción", artista: "Un artista", generoSlug: "bachata",
    spotifyUrl: "", dedicatoria: "", familia: "perez", nombre: "Alice",
    uid: "alice", estado: "activa", ocultaInapropiado: false,
    etiquetaContenido: "", ordenCola: 0, creadoEn: new Date(),
    ...overrides,
  };
}

test("cancionesPedidas: visitante (sin sesión) no puede leer ni crear", async () => {
  const anonDb = testEnv.unauthenticatedContext().firestore();
  await assertFails(anonDb.collection("cancionesPedidas").doc("c1").get());
  await assertFails(anonDb.collection("cancionesPedidas").doc("c1").set(cancionBase()));
});

test("cancionesPedidas: usuario pendiente de aprobación no puede leer ni proponer", async () => {
  await seedUser("alice", { nombre: "Alice", familia: "perez", familiaLabel: "Pérez", email: "alice@test.com", status: "pending" });
  const aliceDb = testEnv.authenticatedContext("alice", { email: "alice@test.com" }).firestore();
  await assertFails(aliceDb.collection("cancionesPedidas").doc("c1").get());
  await assertFails(aliceDb.collection("cancionesPedidas").doc("c1").set(cancionBase()));
});

test("cancionesPedidas: aprobado SÍ puede proponer con su propia familia y nombre", async () => {
  await seedUser("alice", { nombre: "Alice", familia: "perez", familiaLabel: "Pérez", email: "alice@test.com", status: "approved" });
  const aliceDb = testEnv.authenticatedContext("alice", { email: "alice@test.com" }).firestore();
  await assertSucceeds(aliceDb.collection("cancionesPedidas").doc("c1").set(cancionBase()));
});

test("cancionesPedidas: NO puede suplantar la familia o el nombre de otra persona", async () => {
  await seedUser("alice", { nombre: "Alice", familia: "perez", familiaLabel: "Pérez", email: "alice@test.com", status: "approved" });
  const aliceDb = testEnv.authenticatedContext("alice", { email: "alice@test.com" }).firestore();
  await assertFails(aliceDb.collection("cancionesPedidas").doc("c1").set(cancionBase({ familia: "cafe" })));
  await assertFails(aliceDb.collection("cancionesPedidas").doc("c2").set(cancionBase({ nombre: "Otra Persona" })));
  await assertFails(aliceDb.collection("cancionesPedidas").doc("c3").set(cancionBase({ uid: "bob" })));
});

test("cancionesPedidas: un invitado NO puede crearla ya en cola, ni con voto automático", async () => {
  await seedUser("alice", { nombre: "Alice", familia: "perez", familiaLabel: "Pérez", email: "alice@test.com", status: "approved" });
  const aliceDb = testEnv.authenticatedContext("alice", { email: "alice@test.com" }).firestore();
  await assertFails(aliceDb.collection("cancionesPedidas").doc("c1").set(cancionBase({ estado: "en-cola" })));
  await assertFails(aliceDb.collection("cancionesPedidas").doc("c2").set(cancionBase({ ordenCola: 5 })));
});

test("cancionesPedidas: género inválido o campos fuera de lo permitido se rechazan", async () => {
  await seedUser("alice", { nombre: "Alice", familia: "perez", familiaLabel: "Pérez", email: "alice@test.com", status: "approved" });
  const aliceDb = testEnv.authenticatedContext("alice", { email: "alice@test.com" }).firestore();
  await assertFails(aliceDb.collection("cancionesPedidas").doc("c1").set(cancionBase({ generoSlug: "rock" })));
  await assertFails(aliceDb.collection("cancionesPedidas").doc("c2").set(cancionBase({ dedicatoria: "x".repeat(200) })));
  await assertFails(aliceDb.collection("cancionesPedidas").doc("c3").set({ ...cancionBase(), votos: 999 }));
});

test("cancionesPedidas: el género 'otro' SÍ es válido", async () => {
  await seedUser("alice", { nombre: "Alice", familia: "perez", familiaLabel: "Pérez", email: "alice@test.com", status: "approved" });
  const aliceDb = testEnv.authenticatedContext("alice", { email: "alice@test.com" }).firestore();
  await assertSucceeds(aliceDb.collection("cancionesPedidas").doc("c1").set(cancionBase({ generoSlug: "otro" })));
});

test("cancionesPedidas: admin/encargado pueden agregar directo a la cola como 'Organización'", async () => {
  const adminDb = testEnv.authenticatedContext("admin1", { email: "admin@test.com", admin: true }).firestore();
  await assertSucceeds(adminDb.collection("cancionesPedidas").doc("c1").set(
    cancionBase({ familia: "organizacion", nombre: "Organización", uid: "admin1", estado: "en-cola" })
  ));

  await seedUser("mario", { nombre: "Mario", familia: "cafe", familiaLabel: "Café", email: "mario@test.com", status: "approved" });
  const marioDb = testEnv.authenticatedContext("mario", { email: "mario@test.com", encargadoMusica: true }).firestore();
  await assertSucceeds(marioDb.collection("cancionesPedidas").doc("c2").set(
    cancionBase({ familia: "organizacion", nombre: "Organización", uid: "mario", estado: "activa" })
  ));
  // Ni el encargado ni nadie puede suplantar una familia que no es la suya.
  await assertFails(marioDb.collection("cancionesPedidas").doc("c3").set(
    cancionBase({ familia: "perez", nombre: "Mario", uid: "mario" })
  ));
});

test("cancionesPedidas: un usuario normal no puede editar ni borrar (ni la suya propia)", async () => {
  await seedUser("alice", { nombre: "Alice", familia: "perez", familiaLabel: "Pérez", email: "alice@test.com", status: "approved" });
  await testEnv.withSecurityRulesDisabled(async ctx => {
    await ctx.firestore().collection("cancionesPedidas").doc("c1").set(cancionBase());
  });
  const aliceDb = testEnv.authenticatedContext("alice", { email: "alice@test.com" }).firestore();
  await assertFails(aliceDb.collection("cancionesPedidas").doc("c1").update({ titulo: "Cambiada" }));
  await assertFails(aliceDb.collection("cancionesPedidas").doc("c1").delete());
});

test("cancionesPedidas: admin puede borrar/editar; encargado también, pero sin cambiar a quién pertenece", async () => {
  await testEnv.withSecurityRulesDisabled(async ctx => {
    const seedDb = ctx.firestore();
    await seedDb.collection("cancionesPedidas").doc("c1").set(cancionBase());
    await seedDb.collection("cancionesPedidas").doc("c2").set(cancionBase());
  });
  await seedUser("mario", { nombre: "Mario", familia: "cafe", familiaLabel: "Café", email: "mario@test.com", status: "approved" });
  const marioDb = testEnv.authenticatedContext("mario", { email: "mario@test.com", encargadoMusica: true }).firestore();
  await assertSucceeds(marioDb.collection("cancionesPedidas").doc("c1").update({ estado: "en-cola", ordenCola: 1 }));
  await assertFails(marioDb.collection("cancionesPedidas").doc("c1").update({ familia: "cafe" }));

  const adminDb = testEnv.authenticatedContext("admin1", { email: "admin@test.com", admin: true }).firestore();
  await assertSucceeds(adminDb.collection("cancionesPedidas").doc("c2").delete());
});

test("cancionesPedidas: el encargado de música NO gana acceso a otros módulos (ni users, ni villaPuntos, ni retoCaptains)", async () => {
  await seedUser("mario", { nombre: "Mario", familia: "cafe", familiaLabel: "Café", email: "mario@test.com", status: "approved" });
  const marioDb = testEnv.authenticatedContext("mario", { email: "mario@test.com", encargadoMusica: true }).firestore();
  await assertFails(marioDb.collection("users").doc("alice").update({ status: "approved" }));
  await assertFails(marioDb.collection("villaPuntos").doc("perez").set({ total: 100 }));
  await assertFails(marioDb.collection("retoCaptains").doc("perez").set({ uid: "mario" }));
});

test("cancionVotos: aprobado puede votar por sí mismo; no puede votar como otro ni suplantar familia", async () => {
  await seedUser("alice", { nombre: "Alice", familia: "perez", familiaLabel: "Pérez", email: "alice@test.com", status: "approved" });
  await testEnv.withSecurityRulesDisabled(async ctx => {
    await ctx.firestore().collection("cancionesPedidas").doc("c1").set(cancionBase());
  });
  const aliceDb = testEnv.authenticatedContext("alice", { email: "alice@test.com" }).firestore();
  await assertSucceeds(aliceDb.collection("cancionVotos").doc("c1_alice").set({ cancionId: "c1", uid: "alice", familia: "perez", creadoEn: new Date() }));
  await assertFails(aliceDb.collection("cancionVotos").doc("c1_bob").set({ cancionId: "c1", uid: "bob", familia: "perez", creadoEn: new Date() }));
  await assertFails(aliceDb.collection("cancionVotos").doc("c1_alice2").set({ cancionId: "c1", uid: "alice", familia: "cafe", creadoEn: new Date() }));
});

test("cancionVotos: un segundo voto en el MISMO documento (doble clic/dos pestañas) no duplica nada", async () => {
  await seedUser("alice", { nombre: "Alice", familia: "perez", familiaLabel: "Pérez", email: "alice@test.com", status: "approved" });
  await testEnv.withSecurityRulesDisabled(async ctx => {
    await ctx.firestore().collection("cancionesPedidas").doc("c1").set(cancionBase());
  });
  const aliceDb = testEnv.authenticatedContext("alice", { email: "alice@test.com" }).firestore();
  await assertSucceeds(aliceDb.collection("cancionVotos").doc("c1_alice").set({ cancionId: "c1", uid: "alice", familia: "perez", creadoEn: new Date() }));
  // El doc ya existe: esto deja de evaluarse como "create" y cae en "update", que no está permitido.
  await assertFails(aliceDb.collection("cancionVotos").doc("c1_alice").set({ cancionId: "c1", uid: "alice", familia: "perez", creadoEn: new Date() }));
});

test("cancionVotos: no se puede votar por una canción que no existe, ni por una ya 'reproducida'", async () => {
  await seedUser("alice", { nombre: "Alice", familia: "perez", familiaLabel: "Pérez", email: "alice@test.com", status: "approved" });
  await testEnv.withSecurityRulesDisabled(async ctx => {
    await ctx.firestore().collection("cancionesPedidas").doc("c2").set(cancionBase({ estado: "reproducida" }));
  });
  const aliceDb = testEnv.authenticatedContext("alice", { email: "alice@test.com" }).firestore();
  await assertFails(aliceDb.collection("cancionVotos").doc("c1_alice").set({ cancionId: "c1", uid: "alice", familia: "perez", creadoEn: new Date() }));
  await assertFails(aliceDb.collection("cancionVotos").doc("c2_alice").set({ cancionId: "c2", uid: "alice", familia: "perez", creadoEn: new Date() }));
});

test("cancionVotos: cada quien retira solo su propio voto; admin/encargado pueden retirar cualquiera (fusión de duplicados)", async () => {
  await seedUser("alice", { nombre: "Alice", familia: "perez", familiaLabel: "Pérez", email: "alice@test.com", status: "approved" });
  await seedUser("bob", { nombre: "Bob", familia: "cafe", familiaLabel: "Café", email: "bob@test.com", status: "approved" });
  await testEnv.withSecurityRulesDisabled(async ctx => {
    const seedDb = ctx.firestore();
    await seedDb.collection("cancionesPedidas").doc("c1").set(cancionBase());
    await seedDb.collection("cancionVotos").doc("c1_alice").set({ cancionId: "c1", uid: "alice", familia: "perez", creadoEn: new Date() });
    await seedDb.collection("cancionVotos").doc("c1_bob").set({ cancionId: "c1", uid: "bob", familia: "cafe", creadoEn: new Date() });
  });
  const aliceDb = testEnv.authenticatedContext("alice", { email: "alice@test.com" }).firestore();
  await assertFails(aliceDb.collection("cancionVotos").doc("c1_bob").delete());
  await assertSucceeds(aliceDb.collection("cancionVotos").doc("c1_alice").delete());

  const adminDb = testEnv.authenticatedContext("admin1", { email: "admin@test.com", admin: true }).firestore();
  await assertSucceeds(adminDb.collection("cancionVotos").doc("c1_bob").delete());
});

test("cancionVotos: admin/encargado SÍ pueden crear un voto a nombre de otra persona (fusión de duplicados); un usuario normal no", async () => {
  await seedUser("alice", { nombre: "Alice", familia: "perez", familiaLabel: "Pérez", email: "alice@test.com", status: "approved" });
  await seedUser("bob", { nombre: "Bob", familia: "cafe", familiaLabel: "Café", email: "bob@test.com", status: "approved" });
  await seedUser("mario", { nombre: "Mario", familia: "cafe", familiaLabel: "Café", email: "mario@test.com", status: "approved" });
  await testEnv.withSecurityRulesDisabled(async ctx => {
    await ctx.firestore().collection("cancionesPedidas").doc("c1").set(cancionBase());
  });
  const aliceDb = testEnv.authenticatedContext("alice", { email: "alice@test.com" }).firestore();
  const marioDb = testEnv.authenticatedContext("mario", { email: "mario@test.com", encargadoMusica: true }).firestore();
  // Alice (usuaria normal) NO puede crear un voto a nombre de Bob.
  await assertFails(aliceDb.collection("cancionVotos").doc("c1_bob").set({ cancionId: "c1", uid: "bob", familia: "cafe", creadoEn: new Date() }));
  // El encargado SÍ puede (es exactamente lo que hace mover un voto al fusionar).
  await assertSucceeds(marioDb.collection("cancionVotos").doc("c1_bob").set({ cancionId: "c1", uid: "bob", familia: "cafe", creadoEn: new Date() }));
});

test("cancionModeracionLog: solo admin/encargado leen y escriben; un usuario normal no", async () => {
  await seedUser("alice", { nombre: "Alice", familia: "perez", familiaLabel: "Pérez", email: "alice@test.com", status: "approved" });
  await seedUser("mario", { nombre: "Mario", familia: "cafe", familiaLabel: "Café", email: "mario@test.com", status: "approved" });
  const aliceDb = testEnv.authenticatedContext("alice", { email: "alice@test.com" }).firestore();
  const marioDb = testEnv.authenticatedContext("mario", { email: "mario@test.com", encargadoMusica: true }).firestore();
  await assertFails(aliceDb.collection("cancionModeracionLog").doc("l1").set({ accion: "borrar", cancionId: "c1", titulo: "x", detalle: "", uid: "alice", creadoEn: new Date() }));
  await assertSucceeds(marioDb.collection("cancionModeracionLog").doc("l2").set({ accion: "borrar", cancionId: "c1", titulo: "x", detalle: "", uid: "mario", creadoEn: new Date() }));
  await assertFails(aliceDb.collection("cancionModeracionLog").doc("l2").get());
});

test("config/musica: admin y encargado pueden pausar; un usuario aprobado normal no", async () => {
  await seedUser("alice", { nombre: "Alice", familia: "perez", familiaLabel: "Pérez", email: "alice@test.com", status: "approved" });
  await seedUser("mario", { nombre: "Mario", familia: "cafe", familiaLabel: "Café", email: "mario@test.com", status: "approved" });
  const aliceDb = testEnv.authenticatedContext("alice", { email: "alice@test.com" }).firestore();
  const marioDb = testEnv.authenticatedContext("mario", { email: "mario@test.com", encargadoMusica: true }).firestore();
  await assertFails(aliceDb.collection("config").doc("musica").set({ propuestasPausadas: true }));
  await assertSucceeds(marioDb.collection("config").doc("musica").set({ propuestasPausadas: true }));
  await assertSucceeds(aliceDb.collection("config").doc("musica").get());
});

test("cancionesPedidas: con propuestas pausadas, un invitado NO puede proponer, pero el encargado SÍ puede agregar directo", async () => {
  await seedUser("alice", { nombre: "Alice", familia: "perez", familiaLabel: "Pérez", email: "alice@test.com", status: "approved" });
  await seedUser("mario", { nombre: "Mario", familia: "cafe", familiaLabel: "Café", email: "mario@test.com", status: "approved" });
  await testEnv.withSecurityRulesDisabled(async ctx => {
    await ctx.firestore().collection("config").doc("musica").set({ propuestasPausadas: true });
  });
  const aliceDb = testEnv.authenticatedContext("alice", { email: "alice@test.com" }).firestore();
  await assertFails(aliceDb.collection("cancionesPedidas").doc("c1").set(cancionBase()));

  const marioDb = testEnv.authenticatedContext("mario", { email: "mario@test.com", encargadoMusica: true }).firestore();
  await assertSucceeds(marioDb.collection("cancionesPedidas").doc("c2").set(
    cancionBase({ familia: "organizacion", nombre: "Organización", uid: "mario", estado: "en-cola" })
  ));
});

test("cancionVotos: con votación pausada, nadie puede votar (ni para quitar una pausa a medias)", async () => {
  await seedUser("alice", { nombre: "Alice", familia: "perez", familiaLabel: "Pérez", email: "alice@test.com", status: "approved" });
  await testEnv.withSecurityRulesDisabled(async ctx => {
    const seedDb = ctx.firestore();
    await seedDb.collection("cancionesPedidas").doc("c1").set(cancionBase());
    await seedDb.collection("config").doc("musica").set({ votacionPausada: true });
  });
  const aliceDb = testEnv.authenticatedContext("alice", { email: "alice@test.com" }).firestore();
  await assertFails(aliceDb.collection("cancionVotos").doc("c1_alice").set({ cancionId: "c1", uid: "alice", familia: "perez", creadoEn: new Date() }));
});

/* ═══ Singleton "qué está Sonando" (config/cancionSonando) ══════════════ */
test("config/cancionSonando: admin y encargado pueden escribirlo; un usuario normal no", async () => {
  await seedUser("alice", { nombre: "Alice", familia: "perez", familiaLabel: "Pérez", email: "alice@test.com", status: "approved" });
  await seedUser("mario", { nombre: "Mario", familia: "cafe", familiaLabel: "Café", email: "mario@test.com", status: "approved" });
  const aliceDb = testEnv.authenticatedContext("alice", { email: "alice@test.com" }).firestore();
  const marioDb = testEnv.authenticatedContext("mario", { email: "mario@test.com", encargadoMusica: true }).firestore();
  const adminDb = testEnv.authenticatedContext("admin1", { email: "admin@test.com", admin: true }).firestore();

  await assertFails(aliceDb.collection("config").doc("cancionSonando").set({ cancionId: "c1", actualizadoEn: new Date(), actualizadoPor: "alice" }));
  await assertSucceeds(marioDb.collection("config").doc("cancionSonando").set({ cancionId: "c1", actualizadoEn: new Date(), actualizadoPor: "mario" }));
  await assertSucceeds(adminDb.collection("config").doc("cancionSonando").set({ cancionId: "c2", actualizadoEn: new Date(), actualizadoPor: "admin1" }));
  await assertSucceeds(aliceDb.collection("config").doc("cancionSonando").get());
});

test("config/cancionSonando: no se puede suplantar quién hizo el cambio", async () => {
  await seedUser("mario", { nombre: "Mario", familia: "cafe", familiaLabel: "Café", email: "mario@test.com", status: "approved" });
  const marioDb = testEnv.authenticatedContext("mario", { email: "mario@test.com", encargadoMusica: true }).firestore();
  await assertFails(marioDb.collection("config").doc("cancionSonando").set({ cancionId: "c1", actualizadoEn: new Date(), actualizadoPor: "otra-persona" }));
});

/* ═══ familiaRegistros/{familiaSlug} ═══════════════════════════════════ */
test("familiaRegistros: visitante sin cuenta no puede leer ni escribir", async () => {
  const anonDb = testEnv.unauthenticatedContext().firestore();
  await assertFails(anonDb.collection("familiaRegistros").doc("perez").get());
  await assertFails(anonDb.collection("familiaRegistros").doc("perez").set({ registrados: 1 }));
});

test("familiaRegistros: cualquiera con cuenta (incluso pendiente) puede leer todas las familias", async () => {
  await seedUser("alice", { nombre: "Alice", familia: "perez", familiaLabel: "Pérez", email: "alice@test.com", status: "pending" });
  const aliceDb = testEnv.authenticatedContext("alice", { email: "alice@test.com" }).firestore();
  await testEnv.withSecurityRulesDisabled(async ctx => {
    await ctx.firestore().collection("familiaRegistros").doc("cafe").set({ registrados: 3, ultimaActividad: new Date() });
  });
  await assertSucceeds(aliceDb.collection("familiaRegistros").doc("cafe").get());
});

test("familiaRegistros: al crear tu primera cuenta, solo puedes sumar 1 a TU PROPIA familia", async () => {
  await seedUser("alice", { nombre: "Alice", familia: "perez", familiaLabel: "Pérez", email: "alice@test.com", status: "pending" });
  const aliceDb = testEnv.authenticatedContext("alice", { email: "alice@test.com" }).firestore();
  // Familia ajena: falla aunque el conteo sea válido.
  await assertFails(aliceDb.collection("familiaRegistros").doc("cafe").set({ registrados: 1, ultimaActividad: new Date() }));
  // Saltarse de 0 a un número distinto de 1 también falla.
  await assertFails(aliceDb.collection("familiaRegistros").doc("perez").set({ registrados: 5, ultimaActividad: new Date() }));
  // Su propia familia, sumando exactamente 1: OK.
  await assertSucceeds(aliceDb.collection("familiaRegistros").doc("perez").set({ registrados: 1, ultimaActividad: new Date() }));
});

test("familiaRegistros: un segundo registro de la misma familia solo puede sumar 1 más, nunca inventarse un salto", async () => {
  await seedUser("alice", { nombre: "Alice", familia: "perez", familiaLabel: "Pérez", email: "alice@test.com", status: "pending" });
  await seedUser("bob", { nombre: "Bob", familia: "perez", familiaLabel: "Pérez", email: "bob@test.com", status: "pending" });
  await testEnv.withSecurityRulesDisabled(async ctx => {
    await ctx.firestore().collection("familiaRegistros").doc("perez").set({ registrados: 1, ultimaActividad: new Date() });
  });
  const bobDb = testEnv.authenticatedContext("bob", { email: "bob@test.com" }).firestore();
  await assertFails(bobDb.collection("familiaRegistros").doc("perez").set({ registrados: 10, ultimaActividad: new Date() }));
  await assertSucceeds(bobDb.collection("familiaRegistros").doc("perez").set({ registrados: 2, ultimaActividad: new Date() }));
});

test("familiaRegistros: puedes actualizar solo 'ultimaActividad' (ping de inicio de sesión) sin tocar el conteo", async () => {
  await seedUser("alice", { nombre: "Alice", familia: "perez", familiaLabel: "Pérez", email: "alice@test.com", status: "approved" });
  await testEnv.withSecurityRulesDisabled(async ctx => {
    await ctx.firestore().collection("familiaRegistros").doc("perez").set({ registrados: 2, ultimaActividad: new Date("2020-01-01") });
  });
  const aliceDb = testEnv.authenticatedContext("alice", { email: "alice@test.com" }).firestore();
  await assertSucceeds(aliceDb.collection("familiaRegistros").doc("perez").set({ ultimaActividad: new Date() }, { merge: true }));
});

test("familiaRegistros: NO puedes tocar el conteo ni la actividad de otra familia", async () => {
  await seedUser("alice", { nombre: "Alice", familia: "perez", familiaLabel: "Pérez", email: "alice@test.com", status: "approved" });
  await testEnv.withSecurityRulesDisabled(async ctx => {
    await ctx.firestore().collection("familiaRegistros").doc("cafe").set({ registrados: 2, ultimaActividad: new Date("2020-01-01") });
  });
  const aliceDb = testEnv.authenticatedContext("alice", { email: "alice@test.com" }).firestore();
  await assertFails(aliceDb.collection("familiaRegistros").doc("cafe").set({ ultimaActividad: new Date() }, { merge: true }));
  await assertFails(aliceDb.collection("familiaRegistros").doc("cafe").set({ registrados: 999, ultimaActividad: new Date() }));
});

/* ═══ config/proximoEvento ═══════════════════════════════════════════ */
test("config/proximoEvento: cualquiera (incluso sin cuenta) puede leerlo; solo admin escribe", async () => {
  const anonDb = testEnv.unauthenticatedContext().firestore();
  await assertSucceeds(anonDb.collection("config").doc("proximoEvento").get());
  await assertFails(anonDb.collection("config").doc("proximoEvento").set({ mensaje: "Almuerzo", activo: true }));

  const adminDb = testEnv.authenticatedContext("admin1", { email: "admin@test.com", admin: true }).firestore();
  await assertSucceeds(adminDb.collection("config").doc("proximoEvento").set({ mensaje: "Almuerzo", fechaHora: new Date(), activo: true }));
});
