# Junté Familiar CND 2026 — Acceso y aprobación manual

Sitio estático en Netlify (`junte/`) + Firebase (Auth, Firestore, Storage) +
Netlify Functions para las acciones que requieren servidor.

## Cómo funciona el acceso

1. Cualquiera se registra en **/cuenta** con nombre, familia, correo y contraseña
   (Firebase Authentication). Queda **"Pendiente de aprobación"**.
2. Firebase envía automáticamente el correo de verificación — verificarlo
   **no** da acceso por sí solo.
3. El administrador aprueba/rechaza/suspende cuentas en **/admin**.
4. Al aprobar, se envía un correo con el enlace para iniciar sesión (ver
   "Correo de aprobación" abajo — requiere Resend configurado).
5. Solo una cuenta con correo verificado **y** estado `approved` puede ver o
   subir fotos de su propia familia (Mural y Live). Ver fotos de *otras*
   familias (la "galería general") solo se habilita cuando el admin activa el
   interruptor en `/admin`.
6. Todo esto está forzado por `firestore.rules` y `storage.rules` — no son
   solo botones ocultos en la UI.
7. El panel `/admin` muestra cuánto espacio real ya se usó en Firebase
   Storage, con una barra de progreso y un **límite de 10 GB propio de la
   app** (no del plan de Firebase/Blaze — ver sección de almacenamiento
   abajo). Antes de subir una foto, el cliente le pregunta al servidor si
   hay espacio: si se pasaría del límite, bloquea la subida; si llega al
   80%, avisa pero deja continuar. Las fotos además se comprimen en el
   navegador (apuntando a ~1MB) antes de subirse, para que el presupuesto
   rinda más.

`firestore.rules` lee el estado directo de Firestore (`users/{uid}.status`).
`storage.rules` **no puede** hacer eso — el Emulator Suite local no soporta
llamadas cruzadas Storage→Firestore (se verificó a mano) — así que en vez de
confiar en una capacidad que no podíamos probar, el estado de aprobación y la
familia se *espejan* a los custom claims del token (`approved`, `familia`)
cada vez que `netlify/functions/set-user-status.js` cambia el estado de
alguien. Por eso **aprobar/rechazar/suspender pasan siempre por el
servidor** — ya no hay escritura directa de Firestore desde el panel admin
para esto.

## Credenciales que debes configurar (no vienen en el repo)

Variables de entorno en **Netlify → Site settings → Environment variables**:

| Variable | Para qué | Dónde se obtiene |
|---|---|---|
| `FIREBASE_PROJECT_ID` | Admin SDK (Netlify Functions) | Firebase Console → Project settings |
| `FIREBASE_CLIENT_EMAIL` | Admin SDK | Firebase Console → Project settings → Service accounts → **Generate new private key** (descarga un JSON) |
| `FIREBASE_PRIVATE_KEY` | Admin SDK | Mismo JSON de arriba — pega el valor de `private_key` (puedes dejar los `\n` literales, el código los normaliza) |
| `RESEND_API_KEY` | Enviar el correo de aprobación | Cuenta en [resend.com](https://resend.com) → API Keys |
| `RESEND_FROM` | Remitente del correo, ej. `Junté Familiar <no-reply@tudominio.com>` | Debes verificar el dominio en Resend primero |
| `SITE_URL` | Para armar el enlace de login en el correo | La URL pública del sitio en Netlify |
| `ADMIN_EMAIL` | Qué cuenta recibe el rol admin al hacer bootstrap | El correo que decidiste: `rodolfomarte@gmail.com` |
| `ADMIN_BOOTSTRAP_SECRET` | Protege el endpoint de bootstrap | Invéntate un valor largo y aleatorio, solo tú lo necesitas |
| `APP_STORAGE_LIMIT_BYTES` | Límite interno de la app para el contador de almacenamiento | Opcional — por defecto son 10 GiB (`10737418240`). Cámbialo solo si quieres otro tope; no tiene relación con lo que Firebase te cobre. |
| `FIREBASE_STORAGE_BUCKET` | Bucket de Storage que lee el contador | Opcional — ya trae por defecto `junte-familiar.firebasestorage.app` (el mismo del sitio) |

**Sin `FIREBASE_*`**: nada de lo anterior tiene efecto en el servidor — el
sitio sigue funcionando para registro/login, pero **aprobar, rechazar y
suspender** devuelven "faltan credenciales del servidor" (las tres pasan por
`set-user-status.js`, que necesita el Admin SDK para fijar los custom claims).
**Sin `RESEND_*`/`SITE_URL`**: aprobar sigue funcionando (el usuario pasa a
`approved` y su claim se fija igual), pero el correo de aviso no se envía —
el admin lo ve reportado en el panel.

## Dar el rol admin por primera vez

El rol admin es un *custom claim* de Firebase Auth — nadie puede
otorgárselo a sí mismo desde el navegador, ni siquiera editando Firestore.
Para dárselo a la primera cuenta (`rodolfomarte@gmail.com`):

1. Esa cuenta debe registrarse normalmente en `/cuenta` primero.
2. Con `ADMIN_EMAIL` y `ADMIN_BOOTSTRAP_SECRET` ya configurados en Netlify:
   ```bash
   curl -X POST https://<tu-sitio>.netlify.app/.netlify/functions/bootstrap-admin \
     -H "x-bootstrap-secret: <el valor que pusiste en ADMIN_BOOTSTRAP_SECRET>"
   ```
3. Esa cuenta cierra sesión y vuelve a iniciar sesión (los custom claims se
   cargan en el token al autenticarse) y ya verá `/admin`.

## Contador de almacenamiento (panel admin)

- `netlify/functions/storage-usage.js` (solo admin): lista **todos** los
  archivos del bucket con el Admin SDK (`bucket.getFiles()`, paginado) y suma
  sus tamaños reales — nada simulado. Lo consume `/admin` para pintar la
  barra de progreso (usado / límite / disponible / %).
- `netlify/functions/check-storage-quota.js` (cualquier usuario aprobado):
  el cliente lo llama justo antes de subir una foto, con el tamaño del
  archivo ya comprimido. Si subirla superaría el límite, la bloquea del lado
  del cliente con un mensaje; si la deja en 80% o más, avisa pero permite
  continuar. Esto es un **control de presupuesto de la aplicación**, no un
  límite de seguridad — el límite de seguridad real (quién puede escribir
  dónde) lo sigue imponiendo `storage.rules`.
- Ambas funciones comparten `netlify/functions/_lib/storageUsage.js`, cuya
  función de cálculo (`computeUsage`) es pura y tiene **7 pruebas unitarias
  reales** (`npm run test:unit`) sin necesitar credenciales ni red.
- El panel se refresca solo cada 30s mientras está abierto, más un botón
  "🔄 Actualizar" manual — no hay forma barata de empujar el número en
  tiempo real a una pestaña de /admin abierta cuando otra familia sube una
  foto desde /, así que se optó por polling en vez de añadir Cloud Functions.

### ¿Por qué Blaze?

El plan Spark (gratis) de Firebase Storage trae una cuota gratuita de **5GB**
de almacenamiento — menor que el presupuesto de 10GB que quieres manejar.
Blaze (pago por uso) quita ese techo; con el volumen de fotos de un evento
familiar el costo real debería ser mínimo, pero es *pago por uso real*, no
una suscripción fija. El límite de 10GB de arriba sigue siendo tuyo — Blaze
simplemente permite que la app lo alcance sin que Firebase la frene antes.

## Desplegar las reglas de seguridad

Las reglas (`firestore.rules`, `storage.rules`) **no** se despliegan solas
con Netlify — hay que subirlas a Firebase aparte:

```bash
npm install -g firebase-tools   # o usa npx firebase-tools
firebase login
firebase deploy --only firestore:rules,storage
```
(`storage` a secas, no `storage:rules` — ese sufijo solo aplica si defines
*targets* nombrados en `firebase.json`, que no es nuestro caso de un solo
bucket por defecto; con `storage:rules` la CLI lo confunde con un nombre de
target y falla con "Could not find rules for the following storage
targets: rules").

## Probar localmente antes de publicar (emuladores)

Requiere **Java** (para los emuladores de Firebase) y Firebase CLI. Si no
tienes Java instalado y no quieres usar Homebrew/sudo, un JDK portátil sirve
igual — no necesita permisos de administrador:

```bash
mkdir -p ~/.local-jdks && cd ~/.local-jdks
curl -fL -o jdk.tar.gz "https://api.adoptium.net/v3/binary/latest/21/ga/mac/aarch64/jdk/hotspot/normal/eclipse"
tar -xzf jdk.tar.gz && rm jdk.tar.gz
export JAVA_HOME="$HOME/.local-jdks/jdk-21*/Contents/Home"
export PATH="$JAVA_HOME/bin:$PATH"
```
(cambia `aarch64` por `x64` si no es Apple Silicon). Luego:

```bash
npm install
npm run emulators       # Auth + Firestore + Storage emulados, nada real
npm run test:rules      # corre tests/rules.test.js Y tests/storage-rules.test.js
npm run test:unit       # corre tests/storage-usage.test.js (sin emulador, sin red)
```

**Esto ya se corrió en este repo, de verdad — no es solo código escrito y
confiado:**
- `tests/rules.test.js`: **12/12 ✓** (emulador) — pendiente, aprobada,
  rechazada, suspendida, correo no verificado, lectura cruzada de familia
  con/sin la galería general habilitada, y que nadie pueda auto-aprobarse ni
  auto-asignarse admin.
- `tests/storage-rules.test.js`: **9/9 ✓** (emulador) — mismos escenarios
  sobre `storage.rules` (sin sesión, pendiente, aprobada propia familia,
  otra familia, correo no verificado, suspendida, archivo no-imagen, admin,
  borrado solo-admin).
- `tests/storage-usage.test.js`: **7/7 ✓** (sin emulador) — el cálculo de
  uso/porcentaje/aviso-80%/bloqueo del contador de almacenamiento.
- **28/28 en total.**

`test:rules:firestore` y `test:rules:storage` corren en sesiones de emulador
**separadas** a propósito — combinarlas en un solo proceso de `node --test`
causó fallos intermitentes por contaminación de estado entre archivos de
prueba (una rareza de `@firebase/rules-unit-testing`, no de las reglas).

Lo que **no** se ha probado todavía (requiere tu cuenta real, no algo que yo
pueda simular): el flujo completo en el navegador (registro → correo de
verificación real → aprobación → correo de Resend → login), las reglas
contra el proyecto de Firebase real desplegado (solo se probaron contra el
emulador), `storage-usage.js`/`check-storage-quota.js` contra un bucket real
(necesitan Storage activo + credenciales), y la compresión de imágenes en
`static/js/image-compress.js` (usa `<canvas>`, no corre en Node — solo se
puede verificar en un navegador real). Antes de anunciarlo a la familia, haz
al menos un registro de prueba end-to-end con una cuenta tuya, y sube una
foto de prueba para ver el contador moverse de verdad.
