"""
Servidor local BHD — sirve el simulador y expone endpoints de datos y sincronización.
Uso: python3 server.py
Acceso local:  http://localhost:8080
Acceso red:    http://<IP-MAC>:8080
"""
import os, sys
from flask import Flask, jsonify, send_file, request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from src.database import get_all_df

BASE = os.path.dirname(os.path.abspath(__file__))
app  = Flask(__name__)


@app.route("/")
def index():
    return send_file(os.path.join(BASE, "simulador_bhd.html"))


@app.route("/api/data")
def api_data():
    df = get_all_df()
    if df.empty:
        return jsonify([])
    records = []
    for _, r in df.iterrows():
        records.append({
            "fecha":     str(r["fecha"]),
            "hora":      str(r["hora"]),
            "tarjeta":   str(r["tarjeta"]),
            "moneda":    str(r["moneda"]),
            "monto":     float(r["monto"]),
            "comercio":  str(r["comercio"]),
            "estado":    str(r["estado"]),
            "tipo":      str(r["tipo"]),
            "categoria": str(r["categoria"]),
            "alertas":   str(r["alertas"]) if r["alertas"] else "",
        })
    return jsonify(records)


@app.route("/api/sync", methods=["POST"])
def api_sync():
    try:
        from src.sync import sincronizar
        nuevos, omitidos = sincronizar()
        return jsonify({"ok": True, "nuevos": nuevos, "omitidos": omitidos})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


if __name__ == "__main__":
    ip = os.popen("ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null").read().strip()
    print(f"\n  ✅  Servidor BHD corriendo")
    print(f"  Mac:         http://localhost:8080")
    print(f"  iPad/iPhone: http://{ip}:8080\n")
    app.run(host="0.0.0.0", port=8080, debug=False)
