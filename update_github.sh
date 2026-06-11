#!/bin/zsh
# Sincroniza Gmail → regenera HTML → push a GitHub Pages
# Cron sugerido: 0 8,10,12,14,16,18,20,22 * * * /Users/rodolfomarte/Documents/Codex/tarjeta/update_github.sh >> /tmp/bhd_sync.log 2>&1

cd /Users/rodolfomarte/Documents/Codex/tarjeta

echo "--- $(date '+%d/%m/%Y %H:%M') ---"

# 1. Sincronizar Gmail
RESULT=$(/usr/bin/python3 -c "
import sys, os
sys.path.insert(0, '.')
from src.sync import sincronizar
n, o = sincronizar()
print(f'Nuevas={n} Omitidas={o}')
" 2>&1)
echo "Sync: $RESULT"

# 2. Regenerar HTML
/usr/bin/python3 -c "
import sqlite3, json, re, os
from dotenv import load_dotenv
load_dotenv()

db = os.getenv('DATABASE_PATH', 'data/consumos.db')
conn = sqlite3.connect(db)
rows = conn.execute('''
    SELECT fecha,hora,tarjeta,moneda,monto,comercio,estado,tipo,categoria,alertas
    FROM consumos
    ORDER BY substr(fecha,7,4)||chr(45)||substr(fecha,4,2)||chr(45)||substr(fecha,1,2) DESC, hora DESC
''').fetchall()
conn.close()

records = [{'fecha':r[0],'hora':r[1],'tarjeta':r[2],'moneda':r[3],'monto':r[4],
            'comercio':r[5],'estado':r[6],'tipo':r[7],'categoria':r[8],'alertas':r[9] or ''} for r in rows]

js_data = 'let DATA = ' + json.dumps(records, ensure_ascii=False, indent=2) + ';'

with open('simulador_bhd.html', 'r', encoding='utf-8') as f:
    html = f.read()
html = re.sub(r'let DATA = \[[\s\S]*?\];', js_data, html, count=1)
with open('simulador_bhd.html', 'w', encoding='utf-8') as f:
    f.write(html)
with open('index.html', 'w', encoding='utf-8') as f:
    f.write(html)
print(f'HTML generado: {len(records)} transacciones')
" 2>&1
echo "HTML: $?"

# 3. Push a GitHub si hay cambios
if [[ -n $(git status --porcelain index.html simulador_bhd.html) ]]; then
    FECHA=$(date '+%d/%m/%Y %H:%M')
    git add index.html simulador_bhd.html
    git commit -m "Auto-sync $FECHA"
    git push
    echo "GitHub: push OK"
else
    echo "GitHub: sin cambios"
fi
