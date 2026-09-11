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

# Fatiado por DIA e por CANAL (hoje e ontem): a janela com todos os canais estoura
# os 60s da Vercel em dia de pico e volta status=error. 1 dia × 1 canal cabe sempre.
for dia in (HOJE, ONTEM):
    for canal in ("mercado_livre", "shopee", "amazon", "magalu"):
        try:
            r = post(f"/api/sync/marketplaces?channel={canal}&from={dia}&to={dia}")
            sid = r.get("sync_id")
            st = {}
            for _ in range(12):
                time.sleep(6)
                st = get(f"/api/sync/marketplaces/status?id={sid}")
                if st.get("status") != "running":
                    break
            print(f"vendas {dia} {canal}: {json.dumps(st, ensure_ascii=False)[:110]}", flush=True)
        except Exception as e:
            print(f"vendas {dia} {canal}: ERRO {str(e)[:90]}", flush=True)
