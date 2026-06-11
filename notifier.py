"""
Resumen diario BHD → Zapier Webhook → WhatsApp
Uso: python3 notifier.py
Cron: 0 21 * * * cd /Users/rodolfomarte/Documents/Codex/tarjeta && python3 notifier.py
"""
import os, sys, json, urllib.request, urllib.parse
from datetime import date

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from dotenv import load_dotenv
load_dotenv()

from src.database import get_all_df

ZAPIER_WEBHOOK = os.getenv("ZAPIER_WEBHOOK_URL", "")


def build_summary(hoy: str) -> dict:
    df = get_all_df()
    if df.empty:
        return None

    hoy_df = df[df["fecha"] == hoy]

    if hoy_df.empty:
        return {
            "message": f"📊 *Resumen BHD — {hoy}*\n\nSin transacciones registradas hoy.",
            "total_tx": 0,
            "total_rd": 0,
        }

    rd = hoy_df[hoy_df["moneda"] == "RD"]
    us = hoy_df[hoy_df["moneda"] == "US"]
    total_rd = rd["monto"].sum()
    total_us = us["monto"].sum()
    alertas = hoy_df[hoy_df["alertas"].str.len() > 0]

    # Top 5 comercios del día
    top = (
        hoy_df.groupby("comercio")["monto"]
        .sum()
        .sort_values(ascending=False)
        .head(5)
    )
    detalles = "\n".join(
        f"  • {com[:25]:<25}  RD$ {monto:>10,.2f}"
        for com, monto in top.items()
    )

    # Resumen por categoría
    cats = (
        rd.groupby("categoria")["monto"]
        .sum()
        .sort_values(ascending=False)
        .head(4)
    )
    cat_txt = "  ".join(f"{cat[:12]}: RD${monto:,.0f}" for cat, monto in cats.items())

    alerta_txt = f"\n⚠️ {len(alertas)} alerta(s) hoy" if len(alertas) > 0 else ""

    message = (
        f"💳 *Resumen BHD — {hoy}*\n"
        f"{'─' * 30}\n"
        f"📊 Transacciones: *{len(hoy_df)}*\n"
        f"💰 Total RD$: *{total_rd:,.2f}*"
        + (f"\n💵 Total USD: *{total_us:.2f}*" if total_us > 0 else "")
        + f"\n\n🏪 *Top comercios:*\n{detalles}"
        + (f"\n\n🏷️ {cat_txt}" if cat_txt else "")
        + alerta_txt
        + f"\n{'─' * 30}\n_Tarjeta ****0163_"
    )

    return {
        "message": message,
        "fecha": hoy,
        "total_tx": len(hoy_df),
        "total_rd": round(total_rd, 2),
        "total_us": round(total_us, 2),
        "alertas": len(alertas),
    }


def send_to_zapier(payload: dict):
    if not ZAPIER_WEBHOOK:
        print("⚠️  ZAPIER_WEBHOOK_URL no configurado en .env")
        return False

    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        ZAPIER_WEBHOOK,
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=15) as resp:
        status = resp.getcode()
        print(f"✅ Enviado a Zapier — HTTP {status}")
        return status == 200


if __name__ == "__main__":
    from datetime import datetime
    hoy = datetime.now().strftime("%d/%m/%Y")
    print(f"📅 Generando resumen para {hoy}...")

    payload = build_summary(hoy)
    if not payload:
        print("⚠️  Base de datos vacía — nada que enviar.")
        sys.exit(0)

    print("\n" + payload["message"] + "\n")
    send_to_zapier(payload)
