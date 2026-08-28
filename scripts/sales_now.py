# SYNC DE VENDAS INTRADIA — só o passo de vendas (todos os canais), ontem..hoje.
# Roda de 3 em 3h no GitHub Actions pra as vendas do dia aparecerem quase em
# tempo real. O ciclo pesado completo (impostos, tarifas, estoque) segue 1x de
# manhã pelo daily-sync.yml. Reusa a mesma auth do catchup.py.
import json, time, urllib.request, datetime, os

BASE = os.environ.get("ORYMA_BASE", "https://www.oryma.com.br")
APP_PASSWORD = os.environ.get("APP_PASSWORD")
if not APP_PASSWORD:
    ENV = r"C:\Users\bruno.vinhas\OneDrive - BH BEER INDUSTRIA E COMERCIO DE BEBIDAS LTDA\Projetos Pessoais\Market_Intel\marketplace-intel\.env.local"
    env = dict(l.strip().split("=", 1) for l in open(ENV, encoding="utf-8") if "=" in l and not l.startswith("#"))
    APP_PASSWORD = env["APP_PASSWORD"]
HDRS = {"Cookie": f"mi_auth={APP_PASSWORD}", "Content-Type": "application/json"}

TODAY = datetime.date.today()
HOJE = TODAY.isoformat()
ONTEM = (TODAY - datetime.timedelta(days=1)).isoformat()

def post(path):
    req = urllib.request.Request(BASE + path, data=b"", headers=HDRS, method="POST")
    with urllib.request.urlopen(req, timeout=170) as r:
        return json.loads(r.read())

def get(path):
    req = urllib.request.Request(BASE + path, headers=HDRS)
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read())

try:
    r = post(f"/api/sync/marketplaces?from={ONTEM}&to={HOJE}")
    sid = r.get("sync_id")
    print(f"vendas {ONTEM}..{HOJE}: {sid}", flush=True)
    for _ in range(18):
        time.sleep(10)
        st = get(f"/api/sync/marketplaces/status?id={sid}")
        if st.get("status") != "running":
            print("   ->", json.dumps(st, ensure_ascii=False)[:200], flush=True)
            break
except Exception as e:
    print(f"vendas: ERRO {str(e)[:120]}", flush=True)
