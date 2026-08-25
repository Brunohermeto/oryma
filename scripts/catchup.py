# CICLO DIARIO ORYMA — roda tudo que o sistema precisa, na ordem certa.
# Executado pela tarefa agendada das 9h (enquanto o cron do Vercel estiver bloqueado).
# COBERTURA POR MARKETPLACE (regras canonicas em AGENTS.md):
#   ML:     vendas + NF via ML (Full) + NF Bling (galpao) + frete vendedor +
#           tarifas brutas/estorno/UF + Ads/rebates + estoque Full
#   Magalu: vendas (fulfillment_type real, chave NF direto da API, impostos do
#           fulfillment via XML da Magalu) + impostos galpao via Bling por chave (3b) +
#           repasse: reembolso de promocao coparticipada + frete do seller (8c)
#   Amazon: vendas (bruto = produto+imposto) + taxas reais/FBA/fixa (8b) +
#           DEVOLUCOES como cancellation (painel Amazon e liquido de devolucoes);
#           impostos: aguardando funcao restrita Faturamento de Impostos (NF-e)
#   Shopee: entra quando o app for aprovado
#
# Ordem e por quê:
#   1. Vendas marketplaces (ultimos 2 dias)
#   2. Produtos/estoque galpao do Bling (estoque muda todo dia)
#   3. NF-e de SAIDA do Bling → impostos vendas galpao (via start/process, a rota
#      sincrona /api/sync/bling vive estourando o timeout do Vercel)
#   4. NF-e de ENTRADA do Bling → custos de compras novas
#   5. Notas via ML → impostos vendas Full + vinculo produto por EAN
#   6. Frete do vendedor (/shipments/costs — disponivel na hora)
#   7. Tarifas/estorno/UF por pedido (extrato ML; atrasa 1-2 dias, pega o que houver)
#   8. Ads/rebates por periodo (extrato)
#   9. Estoque Full ML
#  10. Relink: CMP por vigencia de NF + margens
#  11. Auditoria automatica (alertas na Visao Geral)
import json, time, urllib.request, datetime, os

BASE = os.environ.get("ORYMA_BASE", "https://www.oryma.com.br")
# Senha: variavel de ambiente (nuvem/GitHub Actions) tem prioridade; senao le o
# .env.local (PC do Bruno). Assim o mesmo script roda nos dois lugares.
APP_PASSWORD = os.environ.get("APP_PASSWORD")
if not APP_PASSWORD:
    ENV = r"C:\Users\bruno.vinhas\OneDrive - BH BEER INDUSTRIA E COMERCIO DE BEBIDAS LTDA\Projetos Pessoais\Market_Intel\marketplace-intel\.env.local"
    env = dict(l.strip().split("=", 1) for l in open(ENV, encoding="utf-8") if "=" in l and not l.startswith("#"))
    APP_PASSWORD = env["APP_PASSWORD"]
HDRS = {"Cookie": f"mi_auth={APP_PASSWORD}", "Content-Type": "application/json"}

TODAY = datetime.date.today()
HOJE = TODAY.isoformat()
ANTEONTEM = (TODAY - datetime.timedelta(days=2)).isoformat()

def post(path, body=None, timeout=170):
    data = json.dumps(body).encode() if body is not None else b""
    req = urllib.request.Request(BASE + path, data=data, headers=HDRS, method="POST")
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read())

def get(path):
    req = urllib.request.Request(BASE + path, headers=HDRS)
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read())

def loop_rota(nome, path, body_base, max_rodadas=8, pausa=3):
    """Roda rota fatiada com skip ate esvaziar."""
    skip = []
    total = 0
    for i in range(max_rodadas):
        try:
            r = post(path, {**body_base, "skip": skip})
        except Exception as e:
            print(f"{nome} {i}: ERRO {str(e)[:70]}", flush=True)
            time.sleep(15)
            continue
        feito = r.get("sales_updated") or r.get("sales_linked") or 0
        total += feito
        print(f"{nome} {i}: {feito} feitas, restam {r.get('remaining_orders')}", flush=True)
        skip += r.get("processed_ids", [])
        if r.get("processed_orders", 0) == 0:
            break
        time.sleep(pausa)
    return total

# ── 1. vendas (anteontem..hoje) ──
try:
    r = post(f"/api/sync/marketplaces?from={ANTEONTEM}&to={HOJE}")
    sid = r.get("sync_id")
    print(f"1. vendas {ANTEONTEM}..{HOJE}: {sid}", flush=True)
    for _ in range(18):
        time.sleep(10)
        st = get(f"/api/sync/marketplaces/status?id={sid}")
        if st.get("status") != "running":
            print("   ->", json.dumps(st, ensure_ascii=False)[:150], flush=True)
            break
except Exception as e:
    print(f"1. vendas: ERRO {str(e)[:100]}", flush=True)

# ── 1b. backfill largo da Amazon (pedidos que a API publica com atraso e que
#        a janela de 2 dias perdia; a Amazon Orders API e lenta ~1 pag/min, entao
#        so cabe no GitHub Actions, que nao tem o limite de 60s da Vercel) ──
try:
    d15 = (TODAY - datetime.timedelta(days=15)).isoformat()
    r = post(f"/api/sync/marketplaces?channel=amazon&from={d15}&to={HOJE}")
    sid = r.get("sync_id")
    for _ in range(24):
        time.sleep(10)
        st = get(f"/api/sync/marketplaces/status?id={sid}")
        if st.get("status") != "running":
            print(f"1b. amazon backfill 15d: {json.dumps(st, ensure_ascii=False)[:120]}", flush=True)
            break
except Exception as e:
    print(f"1b. amazon backfill: ERRO {str(e)[:80]}", flush=True)

# ── 2. produtos/estoque galpao (Bling) ──
try:
    r = post("/api/sync/bling/products", timeout=170)
    print(f"2. produtos bling: {json.dumps(r, ensure_ascii=False)[:100]}", flush=True)
except Exception as e:
    print(f"2. produtos bling: ERRO {str(e)[:70]}", flush=True)

# ── 3. NF-e SAIDA Bling (start/process — confiavel, sem timeout) ──
try:
    start = post("/api/sync/bling/start", {"daysTo": 5, "limit": 60})
    pend = start.get("pending", [])
    print(f"3. bling saida: {len(pend)} notas pendentes", flush=True)
    casadas = 0
    for nfe in pend:
        try:
            r = post("/api/sync/bling/process", {"nfe_id": nfe["id"], "nfe_chave_acesso": nfe.get("chaveAcesso")})
            if r.get("matched"): casadas += 1
        except Exception:
            pass
        time.sleep(0.3)
    print(f"   casadas: {casadas}", flush=True)
except Exception as e:
    print(f"3. bling saida: ERRO {str(e)[:70]}", flush=True)

# ── 3b. impostos por CHAVE (Magalu galpao: XML direto por /nfe/documento/{chave},
#        rota leve e fatiada — a antiga /api/sync/bling estourava timeout) ──
for _ in range(4):
    try:
        r = post("/api/sync/nfe-taxes?days=7&limit=20", timeout=170)
        print(f"3b. impostos por chave: {json.dumps(r, ensure_ascii=False)[:100]}", flush=True)
        if r.get("remaining", 0) <= 0: break
    except Exception as e:
        print(f"3b. impostos por chave: ERRO {str(e)[:70]}", flush=True)
        break
    time.sleep(2)

# ── 4. NF-e ENTRADA Bling (compras novas → custo) ──
try:
    r = post("/api/sync/bling/nfe-entrada?days=7", timeout=170)
    print(f"4. bling entrada: {json.dumps(r, ensure_ascii=False)[:100]}", flush=True)
except Exception as e:
    print(f"4. bling entrada: ERRO {str(e)[:70]}", flush=True)

# ── 5. notas via ML (impostos Full + vinculo por EAN) ──
loop_rota("5. invoices", "/api/sync/ml/invoices", {"days": 4, "limit": 20})

# ── 6. frete do vendedor ──
loop_rota("6. shipping", "/api/sync/ml/shipping", {"days": 4, "limit": 12}, pausa=1)

# ── 7. tarifas/estorno/UF por pedido (rate limit 5/min) ──
loop_rota("7. tariffs", "/api/sync/ml/tariffs", {"days": 4, "limit": 30}, pausa=14)

# ── 8. ads/rebates por periodo ──
try:
    r = post("/api/sync/ml/billing?days=4")
    print(f"8. billing: {json.dumps(r, ensure_ascii=False)[:130]}", flush=True)
except Exception as e:
    print(f"8. billing: ERRO {str(e)[:70]}", flush=True)

# ── 8b. taxas reais Amazon (Finances API; eventos atrasam dias — retenta ate sair) ──
# janela 90d (nao 30): ha pedidos que a Amazon so publica depois de 30 dias; com a
# janela curta eles saiam da fila e ficavam sem comissao para sempre. A fila ja
# prioriza os sem comissao, entao a janela maior nao deixa a rota mais lenta.
# Uma chamada basta: a fila prioriza os sem comissao e limit=60 cobre o pendente
# real (~40, o lag normal da Amazon). "pendentes_sem_comissao" e a metrica honesta.
try:
    r = post("/api/sync/amazon/fees?days=90&limit=60", timeout=170)
    print(f"8b. amazon fees: {json.dumps(r, ensure_ascii=False)[:120]}", flush=True)
except Exception as e:
    print(f"8b. amazon fees: ERRO {str(e)[:70]}", flush=True)

# ── 8d-pre. taxas de servico Amazon (postagem MFN exata por venda + VIGIA armazenagem) ──
try:
    r = post("/api/sync/amazon/service-fees?days=14", timeout=170)
    print(f"8d. amazon service-fees: {json.dumps(r, ensure_ascii=False)[:120]}", flush=True)
    if r.get("storage_fee_total", 0) > 0:
        print(f"!!! ATENCAO: Amazon COMECOU A COBRAR ARMAZENAGEM FBA: R$ {r['storage_fee_total']} — construir rateio por venda!", flush=True)
except Exception as e:
    print(f"8d. amazon service-fees: ERRO {str(e)[:70]}", flush=True)

# ── 8c. repasse Magalu (reembolso de promocao coparticipada + frete do seller) ──
try:
    r = post("/api/sync/magalu/finance?days=14", timeout=170)
    print(f"8c. magalu finance: {json.dumps(r, ensure_ascii=False)[:110]}", flush=True)
except Exception as e:
    print(f"8c. magalu finance: ERRO {str(e)[:70]}", flush=True)

# ── 8d2. chaves de NF da Shopee (invoice_data) ──
try:
    r = post("/api/sync/shopee/invoices?days=14", timeout=170)
    print(f"8d2. shopee chaves NF: {json.dumps(r, ensure_ascii=False)[:110]}", flush=True)
except Exception as e:
    print(f"8d2. shopee chaves NF: ERRO {str(e)[:70]}", flush=True)

# ── 8d3. impostos do Shopee Full (FBS) — 100% automático via API ──
try:
    r = post("/api/sync/shopee/full-taxes?days=20", timeout=170)
    print(f"8d3. shopee full taxes: {json.dumps(r, ensure_ascii=False)[:120]}", flush=True)
except Exception as e:
    print(f"8d3. shopee full taxes: ERRO {str(e)[:70]}", flush=True)

# ── 8e. devoluções Shopee → estorno ──
try:
    r = post("/api/sync/shopee/returns?days=30", timeout=170)
    print(f"8e. shopee returns: {json.dumps(r, ensure_ascii=False)[:110]}", flush=True)
except Exception as e:
    print(f"8e. shopee returns: ERRO {str(e)[:70]}", flush=True)

# ── 8f. UF de destino da Amazon (getOrderAddress, lote) ──
try:
    r = post("/api/sync/amazon/uf?limit=60", timeout=170)
    print(f"8f. amazon UF: {json.dumps(r, ensure_ascii=False)[:100]}", flush=True)
except Exception as e:
    print(f"8f. amazon UF: ERRO {str(e)[:70]}", flush=True)

# ── 9. estoque Full ──
try:
    r = post("/api/sync/ml/stock")
    print(f"9. stock full: {json.dumps(r, ensure_ascii=False)[:110]}", flush=True)
except Exception as e:
    print(f"9. stock: ERRO {str(e)[:70]}", flush=True)

# ── 9c. estoque CD Shopee (Full) ──
try:
    r = post("/api/sync/shopee/stock", timeout=170)
    print(f"9c. stock Shopee: {json.dumps(r, ensure_ascii=False)[:110]}", flush=True)
except Exception as e:
    print(f"9c. stock Shopee: ERRO {str(e)[:70]}", flush=True)

# ── 9b. estoque FBA Amazon ──
try:
    r = post("/api/sync/amazon/stock")
    print(f"9b. stock FBA: {json.dumps(r, ensure_ascii=False)[:110]}", flush=True)
except Exception as e:
    print(f"9b. stock FBA: ERRO {str(e)[:70]}", flush=True)

# ── 10. CMP + margens ──
try:
    r = post("/api/landed-cost/relink")
    print(f"10. relink: {json.dumps(r, ensure_ascii=False)[:120]}", flush=True)
except Exception as e:
    print(f"10. relink: ERRO {str(e)[:70]}", flush=True)

# ── 11. auditoria automatica ──
try:
    r = post("/api/audit/sales?days=45")
    print(f"11. auditoria: {json.dumps(r.get('por_regra', {}), ensure_ascii=False)[:150]}", flush=True)
except Exception as e:
    print(f"11. auditoria: ERRO {str(e)[:70]}", flush=True)

# ── 12. vistoria de taxas (comissao/fixa vs tabela oficial + frete vs padrao) ──
skip = 0
while skip < 400:
    try:
        r = post("/api/audit/fees", {"days": 30, "limit": 25, "skip": skip})
    except Exception as e:
        print(f"12. fees skip={skip}: ERRO {str(e)[:70]}", flush=True)
        break
    print(f"12. fees skip={skip}: items={r.get('processed_items')} achados={r.get('achados')} restam={r.get('remaining_items')}", flush=True)
    if not r.get("ok") or r.get("remaining_items", 0) <= 0:
        break
    skip += 25
    time.sleep(2)

# ── 13. arquivamento de SKUs mortos (sem venda 6m + sem estoque; desarquiva se reviver) ──
try:
    r = post("/api/products/archive-sweep")
    print(f"13. arquivo: arquivados={r.get('arquivados')} desarquivados={r.get('desarquivados')}", flush=True)
except Exception as e:
    print(f"13. arquivo: ERRO {str(e)[:70]}", flush=True)

print("CICLO DIARIO COMPLETO", flush=True)
