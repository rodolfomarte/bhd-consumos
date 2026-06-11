from __future__ import annotations

import base64
import re
from datetime import datetime
from email.utils import parsedate_to_datetime
from typing import Any
from dataclasses import dataclass

from .classifier import clasificar


# ── Expresiones regulares ────────────────────────────────────────────────────
DATE_TIME_RE = re.compile(
    r"(?P<date>\d{1,2}/\d{1,2}/\d{4})\s+(?P<time>\d{1,2}:\d{2})\s*(?P<ampm>am|pm|a\.m\.|p\.m\.)?",
    re.IGNORECASE,
)
CARD_RE = re.compile(
    r"(?:tarjeta|card|terminada|ending|finaliza)[^\d]*(?P<digits>\d{4})", re.IGNORECASE
)
AMOUNT_RE = re.compile(
    r"(?P<currency>RD|US|USD|DOP|US\$|RD\$)?\s*\$?\s*(?P<amount>\d{1,3}(?:,\d{3})*(?:\.\d{2})|\d+(?:\.\d{2})?)",
    re.IGNORECASE,
)


@dataclass
class DatosTransaccion:
    fecha: str        # DD/MM/YYYY
    hora: str         # HH:MM am/pm (texto original)
    tarjeta: str      # últimos 4 dígitos
    moneda: str       # RD | US
    monto: float
    comercio: str
    estado: str
    tipo: str


# ── Decodificación del cuerpo ────────────────────────────────────────────────

def _decode_b64(data: str) -> str:
    padded = data + "=" * (-len(data) % 4)
    return base64.urlsafe_b64decode(padded).decode("utf-8", errors="replace")


def _decode_payload(payload: dict[str, Any]) -> str:
    """Extrae todo el texto del mensaje (soporta multipart recursivo)."""
    bodies: list[str] = []

    def collect(part: dict[str, Any]) -> None:
        mime = part.get("mimeType", "")
        data = part.get("body", {}).get("data")
        if data and mime in {"text/plain", "text/html"}:
            bodies.append(_decode_b64(data))
        for child in part.get("parts") or []:
            collect(child)

    root_data = payload.get("body", {}).get("data")
    if root_data:
        bodies.append(_decode_b64(root_data))
    for part in payload.get("parts") or []:
        collect(part)

    combined = "\n".join(bodies)
    # Limpiar HTML básico
    combined = re.sub(r"<[^>]+>", "\n", combined)
    combined = re.sub(r"&nbsp;?", " ", combined)
    return re.sub(r"\n{2,}", "\n", combined).strip()


# ── Helpers de extracción ────────────────────────────────────────────────────

def _parse_time(value: str, ampm: str | None) -> str:
    if ampm:
        normalized = ampm.lower().replace(".", "")
        try:
            return datetime.strptime(f"{value} {normalized}", "%I:%M %p").strftime("%I:%M %p")
        except ValueError:
            return f"{value} {normalized}"
    return value


def _extract_card(text: str) -> str:
    m = CARD_RE.search(text)
    if m:
        return m.group("digits")
    # Fallback: cualquier grupo de 4 dígitos que no sea un año
    candidates = re.findall(r"\b(\d{4})\b", text)
    for c in reversed(candidates):
        if not re.match(r"20\d{2}", c):
            return c
    return "0000"


def _normalize_currency(value: str) -> str:
    upper = (value or "").upper().replace("$", "").strip()
    if upper in {"USD", "US"}:
        return "US"
    if upper in {"DOP", "RD"}:
        return "RD"
    return upper or "RD"


def _prev_currency(lines: list[str], idx: int) -> str:
    for line in reversed(lines[:idx]):
        if line.upper() in {"RD", "US", "USD", "DOP"}:
            return line
    return ""


def _extract_amount(lines: list[str]) -> tuple[str, float | None, int]:
    for i, line in enumerate(lines):
        m = AMOUNT_RE.search(line)
        if m and ("$" in line or m.group("currency")):
            amount = float(m.group("amount").replace(",", ""))
            currency = m.group("currency") or _prev_currency(lines, i)
            return currency, amount, i
    return "", None, -1


def _safe(lines: list[str], idx: int) -> str:
    return lines[idx].strip() if 0 <= idx < len(lines) else ""


def _labeled(text: str, label: str) -> str:
    m = re.search(rf"{label}\s*\n\s*(.+)", text, re.IGNORECASE)
    return m.group(1).strip() if m else ""


def _line_idx(lines: list[str], text: str) -> int:
    for i, l in enumerate(lines):
        if text in l:
            return i
    return -1


# ── Parser principal ─────────────────────────────────────────────────────────

def parsear_email(
    payload: dict[str, Any],
    email_id: str,
    subject: str = "",
) -> DatosTransaccion | None:
    body = _decode_payload(payload)
    if not body:
        return None

    lines = [l.strip() for l in body.splitlines() if l.strip()]
    joined = "\n".join(lines)

    # Fecha y hora
    dm = DATE_TIME_RE.search(joined)
    if not dm:
        return None

    try:
        fecha = datetime.strptime(dm.group("date"), "%d/%m/%Y").strftime("%d/%m/%Y")
    except ValueError:
        return None

    hora = _parse_time(dm.group("time"), dm.group("ampm"))

    # Valores después de la línea con la fecha
    start = _line_idx(lines, dm.group(0))
    value_lines = lines[start:] if start >= 0 else lines

    tarjeta = _extract_card(joined) or _extract_card(subject)
    currency_raw, monto, monto_idx = _extract_amount(value_lines)

    if monto is None:
        return None

    moneda = _normalize_currency(currency_raw)

    comercio = _safe(value_lines, monto_idx + 1)
    estado = _safe(value_lines, monto_idx + 2)
    tipo = _safe(value_lines, monto_idx + 3)

    # Corrección si los valores son etiquetas en vez de datos reales
    if not comercio or comercio.lower() in {"estado", "tipo", "comercio"}:
        comercio = _labeled(joined, "Comercio") or comercio
    if not estado or estado.lower() == "tipo":
        estado = _labeled(joined, "Estado") or estado
    if not tipo:
        tipo = _labeled(joined, "Tipo") or ""

    return DatosTransaccion(
        fecha=fecha,
        hora=hora,
        tarjeta=tarjeta or "0000",
        moneda=moneda,
        monto=monto,
        comercio=comercio or "DESCONOCIDO",
        estado=estado or "Desconocido",
        tipo=tipo or "Compra",
    )
