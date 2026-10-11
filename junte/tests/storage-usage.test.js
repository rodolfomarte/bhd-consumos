/* ════════════════════════════════════════════════════════════════════════
   Pruebas unitarias de computeUsage() — sin credenciales, sin red.
   Corre con: npm run test:unit
   ════════════════════════════════════════════════════════════════════════ */
const test = require("node:test");
const assert = require("node:assert/strict");
const { computeUsage } = require("../netlify/functions/_lib/storageUsage");

const GIB = 1024 * 1024 * 1024;

test("0 bytes usados -> 0%, todo disponible", () => {
  const u = computeUsage(0, 10 * GIB);
  assert.equal(u.percent, 0);
  assert.equal(u.availableBytes, 10 * GIB);
  assert.equal(u.warnAt80, false);
});

test("al 50% no avisa", () => {
  const u = computeUsage(5 * GIB, 10 * GIB);
  assert.equal(u.percent, 50);
  assert.equal(u.warnAt80, false);
});

test("al cruzar 80% con la foto nueva, avisa (aunque el uso actual sea menor)", () => {
  const u = computeUsage(7.5 * GIB, 10 * GIB, 0.6 * GIB); // 7.5 -> 8.1 GiB proyectado = 81%
  assert.equal(u.warnAt80, true);
  assert.equal(u.fitsExtra, true);
});

test("bloquea una carga que excedería el límite disponible", () => {
  const u = computeUsage(9.8 * GIB, 10 * GIB, 0.5 * GIB); // 10.3 GiB > 10 GiB
  assert.equal(u.fitsExtra, false);
});

test("una carga que cabe exactamente en el límite no se bloquea", () => {
  const u = computeUsage(9 * GIB, 10 * GIB, 1 * GIB);
  assert.equal(u.fitsExtra, true);
});

test("el límite es configurable, no fijo", () => {
  const u = computeUsage(1 * GIB, 2 * GIB);
  assert.equal(u.percent, 50);
});

test("percent nunca pasa de 100 aunque el uso ya exceda el límite", () => {
  const u = computeUsage(15 * GIB, 10 * GIB);
  assert.equal(u.percent, 100);
  assert.equal(u.availableBytes, 0);
});
