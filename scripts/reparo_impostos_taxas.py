# Reparo dos buracos de 2026 apos a reconstrucao (27/09/2026): chaves de NF da
# Shopee, impostos (Full Shopee via API, galpao via XML do Bling), notas Full do
# ML, tarifas ML zeradas, taxas Amazon e recalculo das margens. Idempotente.
# Rodar: python scripts/reparo_impostos_taxas.py [--from 2026-01-01]
import json, time, urllib.request, urllib.error, datetime, os, sys, subprocess

BASE = os.environ.get("ORYMA_BASE", "https://www.oryma.com.br")
PW = os.environ.get("APP_PASSWORD")
if not PW:
    env = dict(l.strip().split("=", 1) for l in open(os.path.join(os.path.dirname(__file__), "..", ".env.local"), encoding="utf-8") if "=" in l and not l.startswith("#"))
    PW = env["APP_PASSWORD"].strip().strip('"')
H = {"Cookie": f"mi_auth={PW}", "Content-Type": "application/json"}
INI = datetime.date.fromisoformat(sys.argv[sys.argv.index("--from") + 1]) if "--from" in sys.argv else datetime.date(2026, 1, 1)
N = (datetime.date.today() - INI).days + 1

def log(m): print(f"{datetime.datetime.now():%H:%M:%S} {m}", flush=True)
def post(path, body=None, timeout=170):
    for t in range(3):
        try:
            r = urllib.request.urlopen(urllib.request.Request(BASE + path, data=json.dumps(body).encode() if body is not None else b"", headers=H, method="POST"), timeout=timeout)
            return json.loads(r.read())
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 502, 503, 504) and t < 2: time.sleep(20 * (t + 1)); continue
            raise
        except (urllib.error.URLError, OSError):
            if t == 2: raise
            time.sleep(10)

# 1. chaves de NF da Shopee (em lotes; offset avanca so pelos pedidos sem chave)
off, gravadas = 0, 0
while True:
    r = post(f"/api/sync/shopee/invoices?days={N}&limit=300&offset={off}")
    gravadas += r.get("chaves_gravadas", 0)
    log(f"1. shopee chaves: offset {off} processados {r.get('processados')} gravadas {r.get('chaves_gravadas')} (total {gravadas}) pendentes {r.get('pedidos_sem_nf')}")
    if not r.get("processados"): break
    off += r["processados"] - r.get("chaves_gravadas", 0)

# 2. impostos do Full Shopee pela API (lote de XML assincrono, retomavel por request_id)
reqid = None
for t in range(10):
    q = f"/api/sync/shopee/full-taxes?days={N}" + (f"&request_id={reqid}" if reqid else "")
    try:
        r = post(q); log(f"2. shopee full taxes t{t}: {json.dumps(r, ensure_ascii=False)[:160]}")
        if r.get("ok"): break
    except urllib.error.HTTPError as e:
        try: reqid = json.loads(e.read()).get("request_id") or reqid
        except Exception: pass
        log(f"2. shopee full taxes t{t}: {e.code} (retoma {reqid})")
    time.sleep(30)

# 3. impostos por chave (galpao Shopee/Magalu/ML: XML da NF no Bling)
parado = 0
for i in range(400):
    r = post(f"/api/sync/nfe-taxes?days={N}&limit=20")
    log(f"3. impostos por chave r{i}: {json.dumps(r, ensure_ascii=False)[:110]}")
    parado = parado + 1 if not r.get("updated") else 0
    if r.get("remaining", 0) <= 0 or parado >= 3: break
    time.sleep(2)

# 4-5. ML: notas Full e tarifas zeradas; 6. Amazon: taxas
subprocess.run([sys.executable, os.path.join(os.path.dirname(__file__), "backfill.py"), "--from", INI.isoformat(), "--steps", "ml_invoices,ml_tariffs,amazon"])

# 7. margens
subprocess.run([sys.executable, os.path.join(os.path.dirname(__file__), "backfill.py"), "--from", INI.isoformat(), "--steps", "relink"])
log("REPARO COMPLETO")
