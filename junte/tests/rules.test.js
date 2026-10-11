/* ════════════════════════════════════════════════════════════════════════
   Pruebas de firestore.rules — cuentas pendiente / aprobada / suspendida.

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
  const alice = testEnv.authenticatedContext("alice", { email: "alice@test.com", email_verified: true });
  await assertSucceeds(
    alice.firestore().collection("users").doc("alice").set({
      nombre: "Alice", familia: "perez", familiaLabel: "Pérez",
      email: "alice@test.com", status: "pending",
      createdAt: new Date(),
    })
  );
});

test("un usuario nuevo NO puede crearse ya aprobado", async () => {
  const alice = testEnv.authenticatedContext("alice", { email: "alice@test.com", email_verified: true });
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
  const alice = testEnv.authenticatedContext("alice", { email: "alice@test.com", email_verified: true });
  await assertFails(alice.firestore().collection("users").doc("alice").update({ status: "approved" }));
  // El rol admin no es un campo de Firestore: solo un custom claim que el
  // cliente no puede fijar, así que ni siquiera hay un "update" que probar.
});

test("un admin SÍ puede cambiar el status de cualquier usuario", async () => {
  await seedUser("alice", { nombre: "Alice", familia: "perez", familiaLabel: "Pérez", email: "alice@test.com", status: "pending" });
  const admin = testEnv.authenticatedContext("admin1", { email: "admin@test.com", email_verified: true, admin: true });
  await assertSucceeds(admin.firestore().collection("users").doc("alice").update({ status: "approved" }));
});

test("pendiente: no puede leer ni escribir fotos del Mural", async () => {
  await seedUser("alice", { nombre: "Alice", familia: "perez", familiaLabel: "Pérez", email: "alice@test.com", status: "pending" });
  await seedMuralPhoto("perez_2025", { familia: "perez", familiaLabel: "Pérez", anio: "2025", url: "x", uploaderUid: "alice", likes: [], comments: [] });

  const alice = testEnv.authenticatedContext("alice", { email: "alice@test.com", email_verified: true });
  const aliceDb = alice.firestore();
  await assertFails(aliceDb.collection("muralPhotos").doc("perez_2025").get());
  await assertFails(
    aliceDb.collection("muralPhotos").doc("perez_2026").set({
      familia: "perez", familiaLabel: "Pérez", anio: "2026", url: "y",
      uploaderUid: "alice", uploaderEmail: "alice@test.com", likes: [], comments: [],
    })
  );
});

test("aprobada + verificada: puede subir y leer SU PROPIA foto de familia", async () => {
  await seedUser("alice", { nombre: "Alice", familia: "perez", familiaLabel: "Pérez", email: "alice@test.com", status: "approved" });
  const alice = testEnv.authenticatedContext("alice", { email: "alice@test.com", email_verified: true });
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
  const alice = testEnv.authenticatedContext("alice", { email: "alice@test.com", email_verified: true });

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

  const alice = testEnv.authenticatedContext("alice", { email: "alice@test.com", email_verified: true });
  await assertFails(alice.firestore().collection("muralPhotos").doc("gomez_2025").get());
});

test("aprobada: SÍ puede leer fotos de otra familia si el admin habilitó la galería general", async () => {
  await seedUser("alice", { nombre: "Alice", familia: "perez", familiaLabel: "Pérez", email: "alice@test.com", status: "approved" });
  await seedMuralPhoto("gomez_2025", { familia: "gomez", familiaLabel: "Gómez", anio: "2025", url: "x", uploaderUid: "bob", likes: [], comments: [] });
  await seedSettings({ galleryEnabledForUsers: true });

  const alice = testEnv.authenticatedContext("alice", { email: "alice@test.com", email_verified: true });
  await assertSucceeds(alice.firestore().collection("muralPhotos").doc("gomez_2025").get());
});

test("suspendida: pierde el acceso aunque antes estuviera aprobada", async () => {
  await seedUser("alice", { nombre: "Alice", familia: "perez", familiaLabel: "Pérez", email: "alice@test.com", status: "suspended" });
  await seedMuralPhoto("perez_2025", { familia: "perez", familiaLabel: "Pérez", anio: "2025", url: "x", uploaderUid: "alice", likes: [], comments: [] });

  const alice = testEnv.authenticatedContext("alice", { email: "alice@test.com", email_verified: true });
  await assertFails(alice.firestore().collection("muralPhotos").doc("perez_2025").get());
});

test("correo no verificado: aunque esté aprobada, no tiene acceso", async () => {
  await seedUser("alice", { nombre: "Alice", familia: "perez", familiaLabel: "Pérez", email: "alice@test.com", status: "approved" });
  const alice = testEnv.authenticatedContext("alice", { email: "alice@test.com", email_verified: false });
  await assertFails(alice.firestore().collection("muralPhotos").doc("perez_2025").get());
});

test("solo el admin puede escribir el toggle de galería general", async () => {
  await seedUser("alice", { nombre: "Alice", familia: "perez", familiaLabel: "Pérez", email: "alice@test.com", status: "approved" });
  const alice = testEnv.authenticatedContext("alice", { email: "alice@test.com", email_verified: true });
  await assertFails(alice.firestore().collection("config").doc("settings").set({ galleryEnabledForUsers: true }));

  const admin = testEnv.authenticatedContext("admin1", { email: "admin@test.com", email_verified: true, admin: true });
  await assertSucceeds(admin.firestore().collection("config").doc("settings").set({ galleryEnabledForUsers: true }));
});
