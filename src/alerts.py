import os
import pandas as pd
from dotenv import load_dotenv

load_dotenv()

ALERT_MAX_AMOUNT = float(os.getenv("ALERT_MAX_AMOUNT", "5000"))
ALERT_MAX_DAILY = int(os.getenv("ALERT_MAX_DAILY", "5"))

TIPOS_HOLD = {"reserva de fondos", "hold"}


def generar_alertas(
    fecha: str,
    hora: str,
    moneda: str,
    monto: float,
    comercio: str,
    categoria: str,
    tipo: str,
    df_existente: pd.DataFrame,
) -> str:
    """
    Evalúa las reglas de alerta para una transacción y devuelve
    una cadena con todas las alertas detectadas, separadas por ' | '.
    Si no hay alertas devuelve cadena vacía.
    """
    alertas: list[str] = []

    # 1. Monto alto
    if moneda == "RD" and monto > ALERT_MAX_AMOUNT:
        alertas.append(f"Monto alto (>{ALERT_MAX_AMOUNT:,.0f} RD$)")

    # 2. Más de N consumos en el mismo día
    if not df_existente.empty and "fecha" in df_existente.columns:
        consumos_dia = (df_existente["fecha"] == fecha).sum()
        if consumos_dia >= ALERT_MAX_DAILY:
            alertas.append(f"Más de {ALERT_MAX_DAILY} consumos en el día")

    # 3. Categoría Otros
    if categoria == "Otros":
        alertas.append("Comercio sin categoría (Otros)")

    # 4. Transacción en dólares
    if moneda.upper() in ("USD", "US"):
        alertas.append("Transacción en USD")

    # 5. Tipo Reserva de Fondos / Hold
    if tipo.lower() in TIPOS_HOLD:
        alertas.append("Reserva de Fondos / Hold")

    # 6. Consumo repetido (mismo comercio y monto en el mismo día)
    if not df_existente.empty:
        duplicado = (
            (df_existente["fecha"] == fecha)
            & (df_existente["comercio"] == comercio)
            & (df_existente["monto"] == monto)
        ).any()
        if duplicado:
            alertas.append("Posible duplicado (mismo comercio, monto y día)")

    return " | ".join(alertas)


def get_alertas_df(df: pd.DataFrame) -> pd.DataFrame:
    """Filtra el DataFrame devolviendo solo filas con al menos una alerta."""
    if df.empty:
        return df
    return df[df["alertas"].notna() & (df["alertas"] != "")].copy()
