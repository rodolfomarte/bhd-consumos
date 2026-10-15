const { db, auth } = require("./_lib/firebaseAdmin");
const admin = require("firebase-admin");

const VALID_ACTIONS = new Set(["aprobar", "corregir", "revocar"]);

function httpError(statusCode, message) {
  const err = new Error(message);
  err.httpStatusCode = statusCode;
  return err;
}

/**
 * POST /.netlify/functions/review-evidencia
 * Authorization: Bearer <Firebase ID token of an admin>
 * Body: { villa, retoId, action: "aprobar"|"corregir"|"revocar", comentario?, puntos? }
 * "puntos" is REQUIRED for "aprobar" — the admin types in exactly what that
 * villa earned for this specific reto (varies per villa/reto: rank-based
 * scales like 150/120/100/80/60, or a direct tally), not a fixed per-reto
 * amount.
 *
 * The ONLY place that moves a reto evidence doc between estados, awards or
 * reverses points, and (for reto 1 only — "identidad-equipo") swaps/restores
 * the villa's representative photo. Everything happens inside one Firestore
 * transaction so a double click or two concurrent requests can never
 * double-award points or race each other — the transaction re-reads the
 * current estado and refuses an action that no longer applies (e.g.
 * approving something already approved).
 */
exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  try {
    const authHeader = event.headers.authorization || event.headers.Authorization || "";
    const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!idToken) {
      return { statusCode: 401, body: JSON.stringify({ error: "Falta el token de autorización." }) };
    }

    const decoded = await auth().verifyIdToken(idToken);
    if (decoded.admin !== true) {
      return { statusCode: 403, body: JSON.stringify({ error: "Solo un administrador puede revisar evidencias." }) };
    }

    const { villa, retoId, action, comentario, puntos: puntosRaw } = JSON.parse(event.body || "{}");
    if (!villa || !retoId || !VALID_ACTIONS.has(action)) {
      return { statusCode: 400, body: JSON.stringify({ error: "Faltan datos o la acción no es válida." }) };
    }
    const comentarioTrim = (comentario || "").trim();
    if ((action === "corregir" || action === "revocar") && !comentarioTrim) {
      return { statusCode: 400, body: JSON.stringify({ error: "El comentario es obligatorio para esta acción." }) };
    }
    let puntos = Number(puntosRaw);
    if (action === "aprobar" && (!Number.isFinite(puntos) || puntos < 0)) {
      return { statusCode: 400, body: JSON.stringify({ error: "Escribe el puntaje (0 o más) que le corresponde a esta villa." }) };
    }

    // Reto 1 ("identidad-equipo") es el único cuya foto se vuelve la imagen
    // representativa de la villa — los demás retos (juegos físicos) solo
    // suman puntos, la foto es evidencia, no reemplaza nada.
    const esRetoIdentidad = retoId === "identidad-equipo";

    const docId       = `${villa}_${retoId}`;
    const evidRef     = db().collection("retoEvidencias").doc(docId);
    const villaImgRef = db().collection("villaImagenes").doc(villa);
    const villaPtsRef = db().collection("villaPuntos").doc(villa);

    const result = await db().runTransaction(async (tx) => {
      const [evidSnap, villaImgSnap, villaPtsSnap] = await Promise.all([
        tx.get(evidRef), tx.get(villaImgRef), tx.get(villaPtsRef),
      ]);
      if (!evidSnap.exists) throw httpError(404, "Esa entrega ya no existe.");
      const evid = evidSnap.data();
      const now = admin.firestore.FieldValue.serverTimestamp();
      const historialBase = { por: decoded.uid, en: new Date(), comentario: comentarioTrim || null };

      if (action === "aprobar") {
        if (!["pendiente", "correccion"].includes(evid.estado)) {
          throw httpError(409, `No se puede aprobar: el estado actual es "${evid.estado}".`);
        }
        if (!evid.fotoUrl || !evid.nombreEquipo || !evid.eslogan) {
          throw httpError(400, "Faltan nombre de equipo, eslogan o foto para poder aprobar.");
        }
        const prevImg = villaImgSnap.exists ? villaImgSnap.data() : null;

        tx.update(evidRef, {
          estado: "aprobado",
          puntosOtorgados: puntos,
          imagenAnteriorUrl: esRetoIdentidad ? (prevImg?.url ?? null) : (evid.imagenAnteriorUrl ?? null),
          imagenAnteriorPath: esRetoIdentidad ? (prevImg?.path ?? null) : (evid.imagenAnteriorPath ?? null),
          comentarioAdmin: null,
          reviewedBy: decoded.uid,
          reviewedAt: now,
          updatedAt: now,
          historial: admin.firestore.FieldValue.arrayUnion({ ...historialBase, accion: "aprobado" }),
        });
        if (esRetoIdentidad) {
          tx.set(villaImgRef, {
            url: evid.fotoUrl,
            path: evid.fotoPath || null,
            fuente: "aprobado",
            evidenciaId: docId,
            updatedAt: now,
          });
        }
        const prevTotal = villaPtsSnap.exists ? (villaPtsSnap.data().total || 0) : 0;
        tx.set(villaPtsRef, { total: prevTotal + puntos, updatedAt: now }, { merge: true });

        return { ok: true, estado: "aprobado", puntos };
      }

      if (action === "corregir") {
        if (evid.estado !== "pendiente") {
          throw httpError(409, `Solo se puede pedir corrección a una entrega pendiente (estado actual: "${evid.estado}").`);
        }
        tx.update(evidRef, {
          estado: "correccion",
          comentarioAdmin: comentarioTrim,
          reviewedBy: decoded.uid,
          reviewedAt: now,
          updatedAt: now,
          historial: admin.firestore.FieldValue.arrayUnion({ ...historialBase, accion: "correccion_solicitada" }),
        });
        return { ok: true, estado: "correccion" };
      }

      // action === "revocar"
      if (evid.estado !== "aprobado") {
        throw httpError(409, `Solo se puede revocar una entrega aprobada (estado actual: "${evid.estado}").`);
      }
      const puntosARevertir = evid.puntosOtorgados || 0;
      tx.update(evidRef, {
        estado: "correccion",
        comentarioAdmin: comentarioTrim,
        puntosOtorgados: 0,
        reviewedBy: decoded.uid,
        reviewedAt: now,
        updatedAt: now,
        historial: admin.firestore.FieldValue.arrayUnion({ ...historialBase, accion: "revocado" }),
      });
      if (esRetoIdentidad) {
        tx.set(villaImgRef, {
          url: evid.imagenAnteriorUrl ?? null,
          path: evid.imagenAnteriorPath ?? null,
          fuente: evid.imagenAnteriorUrl ? "aprobado" : "default",
          evidenciaId: null,
          updatedAt: now,
        });
      }
      const prevTotal = villaPtsSnap.exists ? (villaPtsSnap.data().total || 0) : 0;
      tx.set(villaPtsRef, { total: Math.max(0, prevTotal - puntosARevertir), updatedAt: now }, { merge: true });

      return { ok: true, estado: "correccion" };
    });

    return { statusCode: 200, body: JSON.stringify(result) };
  } catch (err) {
    if (err.httpStatusCode) {
      return { statusCode: err.httpStatusCode, body: JSON.stringify({ error: err.message }) };
    }
    console.error("review-evidencia error:", err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message || "Error interno." }) };
  }
};
