const { Resend } = require("resend");

/**
 * Sends the "your account was approved" email with a sign-in link.
 * Required Netlify env vars:
 *   RESEND_API_KEY
 *   RESEND_FROM   e.g. "Junté Familiar <no-reply@tudominio.com>" (domain
 *                 must be verified in Resend)
 *   SITE_URL      e.g. "https://juntefamiliar.netlify.app"
 */
async function sendApprovalEmail({ to, nombre }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM;
  const siteUrl = process.env.SITE_URL;

  if (!apiKey || !from || !siteUrl) {
    throw new Error(
      "Faltan credenciales de correo: configura RESEND_API_KEY, RESEND_FROM " +
        "y SITE_URL como variables de entorno en Netlify (ver README de /junte)."
    );
  }

  const resend = new Resend(apiKey);
  const loginUrl = `${siteUrl.replace(/\/$/, "")}/cuenta.html?approved=1`;

  const { error } = await resend.emails.send({
    from,
    to,
    subject: "Tu cuenta de Junté Familiar fue aprobada ✅",
    html: `
      <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px">
        <h2 style="color:#1B5E20">¡Bienvenido${nombre ? ", " + nombre : ""}! 🎉</h2>
        <p>Tu cuenta de <strong>Junté Familiar CND 2026</strong> fue revisada y aprobada.</p>
        <p>Ya puedes iniciar sesión y empezar a compartir fotos de tu familia:</p>
        <p style="text-align:center;margin:28px 0">
          <a href="${loginUrl}"
             style="background:#1B5E20;color:#fff;padding:12px 28px;border-radius:24px;
                    text-decoration:none;font-weight:bold;display:inline-block">
            Iniciar sesión
          </a>
        </p>
        <p style="color:#777;font-size:.85rem">
          Si el botón no funciona, visita ${loginUrl}
        </p>
      </div>`,
  });

  if (error) {
    throw new Error(`Resend error: ${error.message || JSON.stringify(error)}`);
  }
}

module.exports = { sendApprovalEmail };
