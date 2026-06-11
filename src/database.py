import sqlite3
import os
from dataclasses import dataclass
from typing import Optional
import pandas as pd
from dotenv import load_dotenv

load_dotenv()

DB_PATH = os.getenv("DATABASE_PATH", "data/consumos.db")


@dataclass
class Transaccion:
    fecha: str
    hora: str
    tarjeta: str
    moneda: str
    monto: float
    comercio: str
    estado: str
    tipo: str
    categoria: str
    alertas: str
    email_id: str


def get_connection() -> sqlite3.Connection:
    db_dir = os.path.dirname(DB_PATH)
    if db_dir:
        os.makedirs(db_dir, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    with get_connection() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS consumos (
                id        INTEGER PRIMARY KEY AUTOINCREMENT,
                fecha     TEXT NOT NULL,
                hora      TEXT NOT NULL,
                tarjeta   TEXT NOT NULL,
                moneda    TEXT NOT NULL,
                monto     REAL NOT NULL,
                comercio  TEXT NOT NULL,
                estado    TEXT,
                tipo      TEXT,
                categoria TEXT,
                alertas   TEXT,
                email_id  TEXT,
                UNIQUE (fecha, hora, monto, comercio, tarjeta)
            )
        """)
        conn.commit()


def insertar_transaccion(t: Transaccion) -> bool:
    """Inserta la transacción y devuelve True si fue nueva, False si era duplicada."""
    init_db()
    try:
        with get_connection() as conn:
            conn.execute(
                """
                INSERT INTO consumos
                    (fecha, hora, tarjeta, moneda, monto, comercio, estado, tipo, categoria, alertas, email_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    t.fecha, t.hora, t.tarjeta, t.moneda, t.monto,
                    t.comercio, t.estado, t.tipo, t.categoria,
                    t.alertas, t.email_id,
                ),
            )
            conn.commit()
        return True
    except sqlite3.IntegrityError:
        return False


def get_all_df() -> pd.DataFrame:
    init_db()
    with get_connection() as conn:
        df = pd.read_sql_query(
            "SELECT * FROM consumos ORDER BY fecha DESC, hora DESC", conn
        )
    if df.empty:
        return df
    df["fecha_dt"] = pd.to_datetime(df["fecha"], format="%d/%m/%Y", errors="coerce")
    return df


def get_filtered_df(
    fecha_inicio: Optional[str] = None,
    fecha_fin: Optional[str] = None,
    categoria: Optional[str] = None,
    comercio: Optional[str] = None,
    moneda: Optional[str] = None,
) -> pd.DataFrame:
    df = get_all_df()
    if df.empty:
        return df

    if fecha_inicio:
        df = df[df["fecha_dt"] >= pd.to_datetime(fecha_inicio, dayfirst=True)]
    if fecha_fin:
        df = df[df["fecha_dt"] <= pd.to_datetime(fecha_fin, dayfirst=True)]
    if categoria and categoria != "Todas":
        df = df[df["categoria"] == categoria]
    if comercio:
        df = df[df["comercio"].str.contains(comercio, case=False, na=False)]
    if moneda and moneda != "Todas":
        df = df[df["moneda"] == moneda]

    return df
