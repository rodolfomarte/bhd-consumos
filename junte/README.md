# Junté Familiar CND 2026 — Acceso y aprobación manual

Sitio estático en Netlify (`junte/`) + Firebase (Auth, Firestore, Storage) +
Netlify Functions para las acciones que requieren servidor.

## Cómo funciona el acceso

1. Cualquiera se registra en **/cuenta** con nombre, familia, **usuario** y
   contraseña — sin correo electrónico en ningún lado. Queda **"Pendiente de
   aprobación de Rodolfo"**.
2. No se envía ningún correo (ni de verificación ni de aviso) — la
   aprobación manual del administrador es el único filtro.
3. El administrador entra directo en **/admin** con su propio usuario y
   contraseña (login embebido en esa misma página) y aprueba o rechaza
   cuentas desde las pestañas **Pendientes** / **Aprobados**.
4. Al aprobar, la familia puede iniciar sesión en `/cuenta` y ya ve/sube
   fotos de su propia familia (Mural y Live). Ver fotos de *otras* familias
   (la "galería general") solo se habilita cuando el admin activa el
   interruptor en `/admin`.
5. Todo esto está forzado por `firestore.rules` y `storage.rules` — no son
   solo botones ocultos en la UI.

### Usuario en vez de correo

Firebase Authentication solo soporta nativamente login por correo+contraseña,
así que cada usuario se mapea internamente a un correo sintético
(`<usuario>@junte.internal`) que nadie ve ni recibe nada en — ver
`usernameToEmail()` en `static/js/auth.js`. Esto además da **unicidad de
usuario gratis**: Firebase ya rechaza correos duplicados, así que un usuario
repetido falla solo con `auth/email-already-in-use` (mapeado a "Ese usuario
ya existe" en la UI).

### Por qué `storage.rules` usa custom claims y no Firestore directo

`firestore.rules` lee el estado directo de Firestore (`users/{uid}.status`).
`storage.rules` **no puede** hacer eso — el Emulator Suite local no soporta
llamadas cruzadas Storage→Firestore (se verificó a mano) — así que en vez de
confiar en una capacidad que no podíamos probar, el estado de aprobación y la
familia se *espejan* a los custom claims del token (`approved`, `familia`)
cada vez que `netlify/functions/set-user-status.js` cambia el estado de
alguien. Por eso **aprobar/rechazar pasan siempre por el servidor** — nunca
hay escritura directa de Firestore desde el panel admin para esto.

## Dar el rol admin (una sola vez, 100% local)

No hay ningún endpoint público para esto — se eliminó a propósito. El único
camino es un script que corres localmente con la clave de servicio de
Firebase (nunca sube a GitHub, nunca pasa por el navegador):

```bash
GOOGLE_APPLICATION_CREDENTIALS="/ruta/a/tu-service-account.json" \
  node scripts/bootstrap-admin-local.js <usuario-elegido>
```

Esto crea (o resetea) la cuenta de administrador directo con el Admin SDK:
genera una contraseña aleatoria, se la asigna, fija el custom claim `admin`,
y aprueba el perfil — todo en un solo paso, sin necesidad de registrarte
primero en `/cuenta`. La contraseña **nunca se imprime en la terminal**: se
escribe solo en `~/junte-admin-credenciales.txt` (permisos `600`, fuera del
repo). Ábrelo, guarda la contraseña en tu gestor de contraseñas, y borra el
archivo.

Vuelve a correr el mismo comando cuando quieras rotar la contraseña del
admin — es idempotente.

## Credenciales que debes configurar (no vienen en el repo)

Variables de entorno en **Netlify → Site settings → Environment variables**:

| Variable | Para qué | Dónde se obtiene |
|---|---|---|
| `FIREBASE_PROJECT_ID` | Admin SDK (Netlify Functions) | Firebase Console → Project settings |
| `FIREBASE_CLIENT_EMAIL` | Admin SDK | Firebase Console → Project settings → Service accounts → **Generate new private key** (descarga un JSON) |
| `FIREBASE_PRIVATE_KEY` | Admin SDK | Mismo JSON de arriba — pega el valor de `private_key` (puedes dejar los `\n` literales, el código los normaliza) |
| `APP_STORAGE_LIMIT_BYTES` | Límite interno de la app para el contador de almacenamiento | Opcional — por defecto son 10 GiB (`10737418240`). No tiene relación con lo que Firebase te cobre. |
| `FIREBASE_STORAGE_BUCKET` | Bucket de Storage que lee el contador | Opcional — ya trae por defecto `junte-familiar.firebasestorage.app` |

**Sin `FIREBASE_*`**: el sitio sigue funcionando para registro/login, pero
**aprobar y rechazar** devuelven "faltan credenciales del servidor" (pasan
por `set-user-status.js`, que necesita el Admin SDK para fijar los custom
claims), y el contador de almacenamiento tampoco funciona.

Si configuraste `RESEND_API_KEY`, `RESEND_FROM`, `SITE_URL`, `ADMIN_EMAIL` o
`ADMIN_BOOTSTRAP_SECRET` en una versión anterior, ya **no se usan para
nada** — el correo y el endpoint de bootstrap por HTTP se eliminaron. Puedes
borrarlas de Netlify si quieres, aunque dejarlas no hace daño (nada las lee).

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
  "🔄 Actualizar" manual.

### ¿Por qué Blaze?

El plan Spark (gratis) de Firebase Storage trae una cuota gratuita de **5GB**
de almacenamiento — menor que el presupuesto de 10GB que quieres manejar.
Blaze (pago por uso) quita ese techo; el límite de 10GB de arriba sigue
siendo tuyo — Blaze simplemente permite que la app lo alcance sin que
Firebase la frene antes.

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
bucket por defecto).

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
- `tests/rules.test.js`: **13/13 ✓** (emulador) — pendiente, rechazada,
  aprobada, suspendida, lectura cruzada de familia con/sin la galería
  general habilitada, que nadie pueda auto-aprobarse ni auto-asignarse
  admin, y que el perfil requiera `username`.
- `tests/storage-rules.test.js`: **8/8 ✓** (emulador) — mismos escenarios
  sobre `storage.rules` (sin sesión, pendiente, aprobada propia familia,
  otra familia, suspendida, archivo no-imagen, admin, borrado solo-admin).
- `tests/storage-usage.test.js`: **7/7 ✓** (sin emulador) — el cálculo de
  uso/porcentaje/aviso-80%/bloqueo del contador de almacenamiento.
- **28/28 en total.**

Lo que **no** se ha probado todavía (requiere tu navegador real, no algo que
yo pueda simular): el flujo completo de principio a fin — registrar una
familia en `/cuenta`, aprobarla desde las pestañas de `/admin`, confirmar que
puede subir una foto y que otra cuenta pendiente no puede. Antes de
anunciarlo a la familia, prueba ese recorrido una vez con una cuenta tuya de
prueba.
