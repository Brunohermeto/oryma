# RECONSTRUCAO DO HISTORICO — roda as mesmas etapas do ciclo diario (catchup.py)
# sobre um PERIODO inteiro, em janelas que cabem nos 60s da Vercel.
# Nasceu no incidente de 22/09/2026 (projeto Supabase excluido); serve tambem
# para reprocessar um periodo quando uma API corrige dados retroativos.
#
# Uso (PC ou GitHub Actions, workflow "backfill"):
#   python scripts/backfill.py --from 2026-01-01 --to 2026-09-22
#   python scripts/backfill.py --from 2026-06-01 --steps vendas,relink
#
# Etapas (mesma ordem e porques do catchup.py):
#   vendas   1 canal x janela de 2 dias (Amazon 1 dia: Orders API ~1 pag/min),
#            canais em PARALELO; janela que falha e refeita dia a dia
#   bling    NF-e de SAIDA (impostos galpao) em janelas de 30 dias + impostos por chave
#   ml       notas Full / frete / tarifas / ads (billing por MES)
#   amazon   taxas reais / servico / UF
#   shopee   chaves NF / impostos Full / custos / devolucoes
#   magalu   repasse (so se conectada)
#   estoque  Full ML / CD Shopee / FBA
#   relink   CMP por vigencia + margens, em janelas de 30 dias (completo dava 504)
#   audit    auditoria + vistoria de taxas + arquivamento
import json, time, urllib.request, urllib.error, datetime, os, argparse, threading

ap = argparse.ArgumentParser()
ap.add_argument("--from", dest="ini", default="2026-01-01")
ap.add_argument("--to", dest="fim", default=datetime.date.today().isoformat())
ap.add_argument("--steps", default="vendas,bling,ml,amazon,shopee,magalu,estoque,relink,audit")
ap.add_argument("--channels", default="mercado_livre,shopee,amazon,magalu")
args = ap.parse_args()
STEPS = set(args.steps.split(","))
CHANNELS = set(args.channels.split(","))
INI = datetime.date.fromisoformat(args.ini)
FIM = datetime.date.fromisoformat(args.fim)
TODAY = datetime.date.today()
N = (TODAY - INI).days + 1  # "days" relativo que cobre o periodo inteiro

BASE = os.environ.get("ORYMA_BASE", "https://www.oryma.com.br")
APP_PASSWORD = os.environ.get("APP_PASSWORD")
if not APP_PASSWORD:
    ENV = r"C:\Users\bruno.vinhas\OneDrive - BH BEER INDUSTRIA E COMERCIO DE BEBIDAS LTDA\Projetos Pessoais\Market_Intel\marketplace-intel\.env.local"
    env = dict(l.strip().split("=", 1) for l in open(ENV, encoding="utf-8") if "=" in l and not l.startswith("#"))
    APP_PASSWORD = env["APP_PASSWORD"]
HDRS = {"Cookie": f"mi_auth={APP_PASSWORD}", "Content-Type": "application/json"}

def log(msg): print(f"{datetime.datetime.now():%H:%M:%S} {msg}", flush=True)

def post(path, body=None, timeout=170):
    data = json.dumps(body).encode() if body is not None else b""
    for tent in range(3):
        try:
            req = urllib.request.Request(BASE + path, data=data, headers=HDRS, method="POST")
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError:
            raise
        except (urllib.error.URLError, OSError):
            if tent == 2: raise
            time.sleep(5 * (tent + 1))

def get(path):
    req = urllib.request.Request(BASE + path, headers=HDRS)
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read())

def safe(nome, fn):
    try:
        r = fn(); log(f"{nome}: {json.dumps(r, ensure_ascii=False)[:120]}"); return r
    except Exception as e:
        log(f"{nome}: ERRO {str(e)[:90]}"); return {}

def loop_rota(nome, path, body_base, max_rodadas=400, pausa=3):
    skip, total = [], 0
    for i in range(max_rodadas):
        try: r = post(path, {**body_base, "skip": skip})
        except Exception as e:
            log(f"{nome} {i}: ERRO {str(e)[:70]}"); time.sleep(15); continue
        feito = r.get("sales_updated") or r.get("sales_linked") or 0
        total += feito
        log(f"{nome} {i}: {feito} feitas, restam {r.get('remaining_orders')}")
        skip += r.get("processed_ids", [])
        if r.get("processed_orders", 0) == 0: break
        time.sleep(pausa)
    return total

def ate_convergir(nome, path, chave="updated", max_rodadas=60, pausa=2):
    for i in range(max_rodadas):
        r = safe(f"{nome} r{i}", lambda: post(path))
        if not r or r.get(chave, 0) == 0: break
        time.sleep(pausa)

# ── vendas ───────────────────────────────────────────────────────────────────
def sync_janela(canal, a, b):
    sid = post(f"/api/sync/marketplaces?channel={canal}&from={a}&to={b}").get("sync_id")
    for _ in range(20):
        time.sleep(5)
        st = get(f"/api/sync/marketplaces/status?id={sid}")
        if st.get("status") != "running": return st
    return {"status": "timeout"}

def vendas_canal(canal, ini=None, fim_periodo=None):
    # Amazon: a Orders API aceita ~1 chamada/min (rajada de 20) — 1 dia a cada
    # 7s dava 429 em serie. Poucos pedidos/dia: janela de 7 dias + 65s de pausa,
    # e bloqueio = espera e repete a MESMA janela (nao adianta fatiar).
    win = 7 if canal == "amazon" else 2
    pausa = 65 if canal == "amazon" else 1
    cur, ok, falhas, tent = ini or INI, 0, [], 0
    FIM = fim_periodo or globals()["FIM"]
    while cur <= FIM:
        fim = min(cur + datetime.timedelta(days=win - 1), FIM)
        try: st = sync_janela(canal, cur.isoformat(), fim.isoformat())
        except Exception as e: st = {"status": "error", "error_message": str(e)[:80]}
        if st.get("status") == "success":
            ok += st.get("records_synced") or 0
            log(f"vendas {canal} {cur}..{fim}: {st.get('records_synced')}")
            cur = fim + datetime.timedelta(days=1); tent = 0
        elif canal == "amazon" and tent < 3:
            tent += 1; log(f"vendas amazon {cur}..{fim}: bloqueio da API, aguardando 2 min (tentativa {tent})")
            time.sleep(120); continue
        elif fim > cur:
            log(f"vendas {canal} {cur}..{fim}: {st.get('status')} — refazendo dia a dia")
            win = 1  # refaz a janela dia a dia (rota idempotente)
        else:
            log(f"vendas {canal} {cur}: FALHOU {str(st.get('error_message'))[:80]}")
            falhas.append(cur.isoformat()); cur = fim + datetime.timedelta(days=1); tent = 0
        time.sleep(pausa)
    log(f"vendas {canal}: {ok} vendas; dias com falha: {falhas or 'nenhum'}")

if "vendas" in STEPS:
    ths = [threading.Thread(target=vendas_canal, args=(c,)) for c in ("mercado_livre", "amazon", "magalu") if c in CHANNELS]
    # Shopee busca pedido a pedido (~1,3s cada, 35-60s por dia): 3 faixas do
    # periodo em paralelo, senao 9 meses levam ~3,5h
    passo = ((FIM - INI).days + 3) // 3
    for k in range(3):
        a = INI + datetime.timedelta(days=k * passo)
        b = min(a + datetime.timedelta(days=passo - 1), FIM)
        if a <= FIM and "shopee" in CHANNELS: ths.append(threading.Thread(target=vendas_canal, args=("shopee", a, b)))
    for t in ths: t.start()
    for t in ths: t.join()
    safe("cancelamentos ML/Magalu", lambda: post(f"/api/sync/cancellations?days={N}"))

# ── bling: NF-e de saida por janelas de 30 dias + impostos por chave ─────────
if "bling" in STEPS:
    safe("bling produtos", lambda: post("/api/sync/bling/products"))
    for d_from in range(0, N, 30):
        d_to, skip, casadas = min(d_from + 30, N), [], 0
        for _ in range(30):
            try: start = post("/api/sync/bling/start", {"daysFrom": d_from, "daysTo": d_to, "limit": 60, "skip": skip})
            except Exception as e: log(f"bling saida D-{d_to}..D-{d_from}: ERRO {str(e)[:70]}"); break
            pend = start.get("pending", [])
            if not pend: break
            for nfe in pend:
                try:
                    r = post("/api/sync/bling/process", {"nfe_id": nfe["id"], "nfe_chave_acesso": nfe.get("chaveAcesso")})
                    if r.get("matched"): casadas += 1
                except Exception: pass
                if nfe.get("chaveAcesso"): skip.append(nfe["chaveAcesso"])
                time.sleep(0.3)
        log(f"bling saida D-{d_to}..D-{d_from}: {casadas} casadas ({start.get('total_in_window')} na janela)")
    for _ in range(300):
        r = safe("impostos por chave", lambda: post(f"/api/sync/nfe-taxes?days={N}&limit=20"))
        if not r or r.get("remaining", 0) <= 0: break
        time.sleep(2)

# ── ML ───────────────────────────────────────────────────────────────────────
if "ml" in STEPS:
    loop_rota("ml invoices", "/api/sync/ml/invoices", {"days": N, "limit": 20})
    loop_rota("ml shipping", "/api/sync/ml/shipping", {"days": N, "limit": 12}, pausa=1)
    loop_rota("ml tariffs", "/api/sync/ml/tariffs", {"days": N, "limit": 30}, pausa=14)
    mes = INI.replace(day=1)
    while mes <= FIM:
        safe(f"ml billing {mes:%Y-%m}", lambda: post(f"/api/sync/ml/billing?period={mes.isoformat()}"))
        mes = (mes + datetime.timedelta(days=32)).replace(day=1)
        time.sleep(3)

# ── Amazon ───────────────────────────────────────────────────────────────────
if "amazon" in STEPS:
    ultimo = None
    for i in range(40):
        r = safe(f"amazon fees r{i}", lambda: post(f"/api/sync/amazon/fees?days={N}&limit=60"))
        pend = r.get("pendentes_sem_comissao")
        if not r or pend == ultimo: break
        ultimo = pend; time.sleep(2)
    safe("amazon service-fees", lambda: post(f"/api/sync/amazon/service-fees?days={N}"))
    ate_convergir("amazon uf", "/api/sync/amazon/uf?limit=60")

# ── Shopee ───────────────────────────────────────────────────────────────────
if "shopee" in STEPS:
    safe("shopee chaves NF", lambda: post(f"/api/sync/shopee/invoices?days={N}"))
    reqid = None
    for tent in range(8):
        q = f"/api/sync/shopee/full-taxes?days={N}" + (f"&request_id={reqid}" if reqid else "")
        try:
            r = post(q); log(f"shopee full taxes t{tent}: {json.dumps(r, ensure_ascii=False)[:120]}")
            if r.get("ok"): break
        except urllib.error.HTTPError as e:
            try: reqid = json.loads(e.read()).get("request_id") or reqid
            except Exception: pass
            log(f"shopee full taxes t{tent}: {e.code} (retoma req {reqid})")
        except Exception as e: log(f"shopee full taxes t{tent}: ERRO {str(e)[:70]}")
        time.sleep(25)
    ate_convergir("shopee custos", f"/api/sync/shopee/costs?days={N}&limit=40", max_rodadas=150)
    safe("shopee returns", lambda: post(f"/api/sync/shopee/returns?days={N}"))

if "magalu" in STEPS:
    safe("magalu finance", lambda: post(f"/api/sync/magalu/finance?days={N}"))

if "estoque" in STEPS:
    safe("stock full ML", lambda: post("/api/sync/ml/stock"))
    safe("stock CD Shopee", lambda: post("/api/sync/shopee/stock"))
    safe("stock FBA", lambda: post("/api/sync/amazon/stock"))

# ── relink em janelas de 30 dias (days = inicio da janela, until = fim) ──────
if "relink" in STEPS:
    cur = INI
    while cur <= FIM:
        fim = min(cur + datetime.timedelta(days=29), FIM)
        safe(f"relink {cur}..{fim}", lambda: post("/api/landed-cost/relink", {"days": (TODAY - cur).days + 1, "until": fim.isoformat()}))
        cur = fim + datetime.timedelta(days=1)

if "audit" in STEPS:
    safe("auditoria", lambda: post(f"/api/audit/sales?days={N}"))
    skip = 0
    while skip < 2000:
        r = safe(f"fees skip={skip}", lambda: post("/api/audit/fees", {"days": N, "limit": 25, "skip": skip}))
        if not r.get("ok") or r.get("remaining_items", 0) <= 0: break
        skip += 25; time.sleep(2)
    safe("arquivo", lambda: post("/api/products/archive-sweep"))

log(f"BACKFILL {INI}..{FIM} COMPLETO")
