"""
Orquesta la lectura de Gmail, el parseo, la clasificación, las alertas
y la inserción en base de datos. Devuelve el número de registros nuevos.
"""
import pandas as pd
from .gmail_reader import obtener_emails_bhd
from .parser import parsear_email
from .classifier import clasificar
from .alerts import generar_alertas
from .database import Transaccion, insertar_transaccion, get_all_df, init_db


def sincronizar() -> tuple[int, int]:
    """
    Lee correos BHD y guarda los nuevos en la base de datos.
    Retorna (nuevos, omitidos).
    """
    init_db()
    df_existente = get_all_df()

    nuevos = 0
    omitidos = 0

    for email in obtener_emails_bhd():
        datos = parsear_email(
            email["payload"], email["email_id"], email["subject"]
        )
        if datos is None:
            omitidos += 1
            continue

        categoria = clasificar(datos.comercio)
        alertas = generar_alertas(
            fecha=datos.fecha,
            hora=datos.hora,
            moneda=datos.moneda,
            monto=datos.monto,
            comercio=datos.comercio,
            categoria=categoria,
            tipo=datos.tipo,
            df_existente=df_existente,
        )

        transaccion = Transaccion(
            fecha=datos.fecha,
            hora=datos.hora,
            tarjeta=datos.tarjeta,
            moneda=datos.moneda,
            monto=datos.monto,
            comercio=datos.comercio,
            estado=datos.estado,
            tipo=datos.tipo,
            categoria=categoria,
            alertas=alertas,
            email_id=email["email_id"],
        )

        fue_nuevo = insertar_transaccion(transaccion)
        if fue_nuevo:
            nuevos += 1
            # Añadir al df en memoria para que las reglas de alerta del día se acumulen
            nueva_fila = pd.DataFrame([{
                "fecha": datos.fecha,
                "hora": datos.hora,
                "tarjeta": datos.tarjeta,
                "moneda": datos.moneda,
                "monto": datos.monto,
                "comercio": datos.comercio,
                "estado": datos.estado,
                "tipo": datos.tipo,
                "categoria": categoria,
                "alertas": alertas,
                "email_id": email["email_id"],
            }])
            df_existente = pd.concat([df_existente, nueva_fila], ignore_index=True)
        else:
            omitidos += 1

    return nuevos, omitidos
