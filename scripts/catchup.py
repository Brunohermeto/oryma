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
#   Shopee: vendas + chaves NF + impostos Full (FBS via API) + impostos galpao
#           (XML da NF via Bling por chave, 3b) + custos liquidos (comissao/servico,
#           8d4) + devolucoes (8e) + estoque CD Full (9c). Frete e NEUTRO (comprador
#           paga, Shopee repassa a logistica). UF do galpao vem do XML da NF.
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
import json, time, urllib.request, urllib.error, datetime, os, sys

# Toda linha com "ERRO" é guardada: no fim o script sai com código 1 e o GitHub
# marca a execução como FALHA e manda e-mail ao Bruno (sem e-mail = tudo ok).
_ERROS = []
_print = print
def print(*a, **k):
    s = " ".join(map(str, a))
    if "ERRO" in s: _ERROS.append(s[:160])
    _print(*a, **k)

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
    # Retry so em erro de REDE (conexao resetada, timeout de SSL) — as rotas sao
    # idempotentes. HTTPError (401/400/500 real) sobe na hora, sem retry.
    for tent in range(3):
        try:
            req = urllib.request.Request(BASE + path, data=data, headers=HDRS, method="POST")
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError:
            raise
        except (urllib.error.URLError, OSError):
            if tent == 2:
                raise
            time.sleep(5 * (tent + 1))

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

# ── 1. vendas FATIADAS por DIA e por CANAL (D-0, D-1, D-2). Mesmo 1 dia com TODOS
#        os canais estoura os 60s da Vercel em dia de pico (ex: 09/09, 197 vendas).
#        1 dia × 1 canal cabe sempre. Amazon tem o backfill 1b (D-2..D-15). ──
for k in range(0, 3):  # D-0, D-1, D-2
    dia = (TODAY - datetime.timedelta(days=k)).isoformat()
    for canal in ("mercado_livre", "shopee", "amazon", "magalu", "tiktok"):
        try:
            r = post(f"/api/sync/marketplaces?channel={canal}&from={dia}&to={dia}")
            sid = r.get("sync_id")
            st = {}
            for _ in range(12):
                time.sleep(6)
                st = get(f"/api/sync/marketplaces/status?id={sid}")
                if st.get("status") != "running":
                    break
            if canal in ("shopee", "tiktok") and st.get("status") != "success":
                # dia de pico não coube nos 60s: refaz em 4 faixas de 6h (27/10/2026)
                for _h in range(0, 24, 6):
                    r = post(f"/api/sync/marketplaces?channel={canal}&from={dia}&to={dia}&h_ini={_h}&h_fim={_h + 6}")
                    for _ in range(15):
                        time.sleep(6)
                        st = get(f"/api/sync/marketplaces/status?id={r.get('sync_id')}")
                        if st.get("status") != "running":
                            break
                    print(f"1. vendas {dia} {canal} {_h}h-{_h + 6}h: {st.get('status')} {st.get('records_synced')}", flush=True)
                continue
            print(f"1. vendas {dia} {canal}: {json.dumps(st, ensure_ascii=False)[:90]}", flush=True)
        except Exception as e:
            print(f"1. vendas {dia} {canal}: ERRO {str(e)[:70]}", flush=True)

# ── 1b. backfill da Amazon FATIADO por DIA (pedidos publicados com atraso que a
#        janela de 2 dias perdia). Uma janela de 15 dias estoura os 60s da Vercel
#        (Orders API ~1 pag/min); 1 dia por chamada cabe. O loop roda no GitHub
#        Actions, que nao tem limite de tempo. ──
amz_ok = 0
for k in range(2, 16):  # dias D-2 a D-15 (D-0 e D-1 ja vieram na etapa 1)
    dia = (TODAY - datetime.timedelta(days=k)).isoformat()
    try:
        r = post(f"/api/sync/marketplaces?channel=amazon&from={dia}&to={dia}")
        sid = r.get("sync_id")
        for _ in range(10):
            time.sleep(6)
            st = get(f"/api/sync/marketplaces/status?id={sid}")
            if st.get("status") != "running":
                if st.get("status") == "success": amz_ok += 1
                break
    except Exception:
        pass
print(f"1b. amazon backfill por dia: {amz_ok}/14 dias ok", flush=True)

# ── 1c. CONFERÊNCIA de completude (pedido do Bruno 27/10/2026): para cada canal e
#        cada um dos últimos 7 dias, compara os pedidos válidos do marketplace com
#        o Oryma; faltou → re-sincroniza o dia (em faixas de 6h); continuou
#        faltando → ERRO (o e-mail de falha avisa). Origem: 10/10 da Shopee pela metade.
def _sync_dia(canal, dia, faixas):
    for _h in range(0, 24, 24 // faixas):
        _f = _h + 24 // faixas
        if canal in ("shopee", "tiktok"):
            q = f"channel={canal}&from={dia}&to={dia}&h_ini={_h}&h_fim={_f}"
        elif canal == "mercado_livre" and faixas > 1:
            q = f"channel=mercado_livre&from={dia}T{_h:02d}:00:00&to={dia}T{_f - 1:02d}:59:59"
        else:
            q = f"channel={canal}&from={dia}&to={dia}"
        try:
            r = post(f"/api/sync/marketplaces?{q}")
            for _ in range(15):
                time.sleep(6)
                if get(f"/api/sync/marketplaces/status?id={r.get('sync_id')}").get("status") != "running":
                    break
        except Exception as e:
            print(f"1c. re-sync {canal} {dia} {_h}h: falhou ({str(e)[:50]})", flush=True)
        if canal in ("amazon", "magalu"):
            break  # sem fatia por hora: o dia inteiro de uma vez

for canal in ("mercado_livre", "shopee", "amazon", "magalu", "tiktok"):
    for k in range(0, 7):
        dia = (TODAY - datetime.timedelta(days=k)).isoformat()
        try:
            c = get(f"/api/sync/conferencia?canal={canal}&dia={dia}")
            for tentativa in (1, 4):  # 1ª: dia inteiro; 2ª: 4 faixas de 6h
                if not c.get("faltando"):
                    break
                print(f"1c. conferência {canal} {dia}: faltam {c['faltando']} de {c['no_canal']} → re-sincronizando", flush=True)
                _sync_dia(canal, dia, tentativa)
                c = get(f"/api/sync/conferencia?canal={canal}&dia={dia}")
            if c.get("faltando"):
                print(f"1c. conferência {canal} {dia}: ERRO ainda faltam {c['faltando']} pedidos: {c.get('pedidos_faltando', [])[:5]}", flush=True)
            elif k == 0 or c.get("no_canal"):
                print(f"1c. conferência {canal} {dia}: ok ({c.get('no_canal')} pedidos)", flush=True)
        except Exception as e:
            print(f"1c. conferência {canal} {dia}: ERRO {str(e)[:80]}", flush=True)
            break  # canal fora do ar (ex.: Magalu desconectada) — não insiste nos outros dias

# ── 1d. NFs da Amazon (Faturador) guardadas à espera do pedido — liga as que já têm venda ──
try:
    r = post("/api/sync/amazon/nfe-vendas?pendentes=1", timeout=170)
    print(f"1d. NFs Amazon pendentes: {json.dumps(r, ensure_ascii=False)[:120]}", flush=True)
except Exception as e:
    print(f"1d. NFs Amazon pendentes: ERRO {str(e)[:70]}", flush=True)

# ── 2. produtos/estoque galpao (Bling) ──
try:
    r = post("/api/sync/bling/products", timeout=170)
    print(f"2. produtos bling: {json.dumps(r, ensure_ascii=False)[:100]}", flush=True)
except Exception as e:
    print(f"2. produtos bling: ERRO {str(e)[:70]}", flush=True)

# ── 3. NF-e SAIDA Bling (start/process — confiavel, sem timeout) ──
try:
    # 15 dias: venda que entra atrasada (conferência 1c) também acha a NF (27/10/2026)
    start = post("/api/sync/bling/start", {"daysTo": 15, "limit": 80})
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
# 15 dias: a rota só pega quem está SEM NF/frete; venda que entra atrasada (1c) também é coberta
loop_rota("5. invoices", "/api/sync/ml/invoices", {"days": 15, "limit": 20}, max_rodadas=20)

# ── 6. frete do vendedor ──
loop_rota("6. shipping", "/api/sync/ml/shipping", {"days": 15, "limit": 12}, max_rodadas=20, pausa=1)

# ── 7. tarifas/estorno/UF por pedido (rate limit 5/min) ──
# days=12: a rota reconfere toda venda dos últimos 10 dias (o ML lança estorno/
# bônus de campanha em ondas). Com days=4 o rebate que chegava no 5º-10º dia
# nunca entrava (14/10/2026)
loop_rota("7. tariffs", "/api/sync/ml/tariffs", {"days": 12, "limit": 30}, max_rodadas=25, pausa=14)

# ── 7b. cupom de cada pedido do ML (painel Marketing → Cupons; Shopee vem no 8d4) ──
for _i in range(15):
    try:
        r = post("/api/sync/ml/coupons?limit=60", timeout=170)
        print(f"7b. ml cupons r{_i}: {r.get('processed')} pedidos, {r.get('com_cupom')} com cupom, restam {r.get('restantes')}", flush=True)
        if not r.get("processed"):
            break
    except Exception as e:
        print(f"7b. ml cupons: ERRO {str(e)[:70]}", flush=True)
        break

# ── 8. Mercado Ads por anúncio e por dia (API de publicidade) → rateio por venda
#       do mesmo anúncio no dia (lib/marketing/allocate-ads). Relê 7 dias porque o
#       ML consolida as métricas com atraso. Substitui o rateio pelo extrato (billing).
try:
    _h = datetime.date.today()
    for _ini, _fim in ((_h - datetime.timedelta(days=6), _h - datetime.timedelta(days=4)), (_h - datetime.timedelta(days=3), _h)):
        r = post(f"/api/sync/ml/ads?from={_ini}&to={_fim}")
        print(f"8. ml ads {_ini}..{_fim}: {json.dumps([(d['dia'], d['gasto']) for d in r.get('dias', [])], ensure_ascii=False)}", flush=True)
except Exception as e:
    print(f"8. ml ads: ERRO {str(e)[:70]}", flush=True)

# ── 8b. taxas reais Amazon (Finances API; eventos atrasam dias — retenta ate sair) ──
# janela 90d (nao 30): ha pedidos que a Amazon so publica depois de 30 dias; com a
# janela curta eles saiam da fila e ficavam sem comissao para sempre. A fila ja
# prioriza os sem comissao, entao a janela maior nao deixa a rota mais lenta.
# Lotes de 20 andando pela fila com offset (limit=60 numa chamada passava dos 60s
# com qualquer lentidao da Amazon — 0,6s/pedido). Ate 12 lotes cobre ~240
# pendentes. "pendentes_sem_comissao" e a metrica honesta.
# Só avança o offset quando o lote não resolveu nada: quem ganha comissão sai da
# fila de pendentes e os de trás sobem (avançar sempre pulava ~20 por lote).
_off = 0
for _i in range(20):
    try:
        r = post(f"/api/sync/amazon/fees?days=90&limit=20&offset={_off}", timeout=170)
        print(f"8b. amazon fees off{_off}: {json.dumps(r, ensure_ascii=False)[:110]}", flush=True)
        if not r.get("updated"): _off += 20
        if _off >= (r.get("pendentes_sem_comissao") or 0): break
    except Exception as e:
        print(f"8b. amazon fees off{_off}: ERRO {str(e)[:70]}", flush=True)
        _off += 20

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
#        A Shopee gera o lote de XMLs de forma assíncrona; em dias lentos passa
#        dos ~39s que a rota espera e volta 504. Repete até 3x (rota idempotente,
#        cada tentativa é uma invocação nova de 60s + pausa dá tempo de gerar).
#        Janelas de até 5 dias que NUNCA cruzam a virada do mês: período que
#        abrange 2 meses faz a Shopee "perder" o lote (ERR_DATA_NOT_FOUND para o
#        request_id que ela acabou de criar — 30/07–08/08, 29/08–02/09, 27/09–01/10).
#        Nesse erro gera lote NOVO; janela sem venda Full também dá esse erro (normal).
_hoje = datetime.date.today()
_dias = [_hoje - datetime.timedelta(days=i) for i in range(20)]
_janelas = []
for _d in _dias:
    if _janelas and _janelas[-1][0].month == _d.month and len(_janelas[-1]) < 5:
        _janelas[-1].append(_d)
    else:
        _janelas.append([_d])
for _j in _janelas:
    _ate, _de = _j[0], _j[-1]
    reqid = None
    for tent in range(3):
        q = f"/api/sync/shopee/full-taxes?from={_de}&to={_ate}" + (f"&request_id={reqid}" if reqid else "")
        try:
            r = post(q, timeout=170)
            print(f"8d3. shopee full taxes {_de}..{_ate} t{tent}: {json.dumps(r, ensure_ascii=False)[:110]}", flush=True)
            if r.get("ok"): break
        except urllib.error.HTTPError as e:
            body = e.read().decode(errors="replace")
            try: reqid = None if "ERR_DATA_NOT_FOUND" in body else (json.loads(body).get("request_id") or reqid)
            except Exception: reqid = None
            print(f"8d3. shopee full taxes {_de}..{_ate} t{tent}: {e.code} {'sem lote (janela vazia ou perdido)' if reqid is None else f'retoma req {reqid}'}", flush=True)
        except Exception as e:
            print(f"8d3. shopee full taxes {_de}..{_ate} t{tent}: ERRO {str(e)[:70]}", flush=True)
        if tent < 2:
            time.sleep(15)

# ── 8d4. custos Shopee (comissão/serviço brutos + rebate) — reprocessa 20d conforme
#        a Shopee finaliza o financeiro (o sync só relê 2 dias). Percorre a fila
#        TODA por offset: parar no 1º "updated=0" deixava pedidos já com comissão
#        sem o rebate, que só aparece quando a Shopee fecha o pedido (14/10/2026) ──
# lotes de 25; lote que estoura os 60s tenta de novo e segue (22/10/2026: o
# cupom novo deixou cada lote mais pesado e um 504 derrubava a etapa inteira)
for off in range(0, 2000, 25):
    r = None
    for _t in range(2):
        try:
            r = post(f"/api/sync/shopee/costs?days=20&limit=25&offset={off}", timeout=170)
            break
        except Exception as e:
            # só a 2ª falha conta como ERRO (o ciclo acusa falha em qualquer "ERRO")
            print(f"8d4. shopee custos off{off} t{_t}: {'ERRO' if _t else 'repetindo'} {str(e)[:70]}", flush=True)
            time.sleep(10)
    if r is None:
        continue
    print(f"8d4. shopee custos off{off}: {json.dumps(r, ensure_ascii=False)[:100]}", flush=True)
    if r.get("processed", 0) < 25:
        break
    time.sleep(2)

# ── 8h. TikTok Shop: extrato por pedido (comissão, tarifas, devolução, repasse) —
#        sai depois da entrega; a fila é só de pedidos ainda sem repasse ──
_off = 0
for _i in range(20):
    try:
        r = post(f"/api/sync/tiktok/fees?days=45&limit=30&offset={_off}", timeout=170)
        print(f"8h. tiktok extrato off{_off}: {r.get('processed')} pedidos, {r.get('updated')} vendas, sem extrato {r.get('sem_extrato')} {r.get('erros') or ''}", flush=True)
        if r.get("processed", 0) < 30:
            break
        _off += r.get("pulados", 0)  # os resolvidos saem da fila; avança só pelos que ficaram
    except Exception as e:
        print(f"8h. tiktok extrato: ERRO {str(e)[:70]}", flush=True)
        break

# ── 8e. devoluções Shopee → estorno ──
try:
    r = post("/api/sync/shopee/returns?days=60", timeout=170)  # 60d: a Shopee aceita a devolução semanas depois do pedido
    print(f"8e. shopee returns: {json.dumps(r, ensure_ascii=False)[:110]}", flush=True)
except Exception as e:
    print(f"8e. shopee returns: ERRO {str(e)[:70]}", flush=True)

# ── 8g. cancelamentos ML + Magalu → cancellation (Shopee=8e, Amazon=8b) ──
# devolução pós-entrega do ML vira pedido "cancelled" semanas depois da compra:
# 90 dias, em 2 janelas (uma só passaria dos 60s)
_h = datetime.date.today()
for _de, _ate in ((_h - datetime.timedelta(days=45), _h), (_h - datetime.timedelta(days=90), _h - datetime.timedelta(days=46))):
    try:
        r = post(f"/api/sync/cancellations?from={_de}&to={_ate}&canal=mercado_livre,magalu", timeout=170)
        print(f"8g. cancelamentos ML/Magalu {_de}..{_ate}: {json.dumps(r, ensure_ascii=False)[:120]}", flush=True)
    except Exception as e:
        print(f"8g. cancelamentos: ERRO {str(e)[:70]}", flush=True)
# Shopee (cancelado depois de pago / devolução) em janelas de 15 dias, 90 dias pra trás
for _k in range(6):
    _ate = _h - datetime.timedelta(days=15 * _k); _de = _ate - datetime.timedelta(days=14)
    try:
        r = post(f"/api/sync/cancellations?from={_de}&to={_ate}&canal=shopee", timeout=170)
        print(f"8g. cancelamentos Shopee {_de}..{_ate}: marcadas {r.get('shopee_vendas_marcadas')}", flush=True)
    except Exception as e:
        print(f"8g. cancelamentos Shopee: ERRO {str(e)[:70]}", flush=True)

# ── 8f. UF de destino da Amazon (getOrderAddress, lote) ──
# lotes de 25 (60 × (0,7s + API + gravação) passava de 60s); até 6 lotes/dia
for _i in range(6):
    try:
        r = post("/api/sync/amazon/uf?limit=25", timeout=170)
        print(f"8f. amazon UF: {json.dumps(r, ensure_ascii=False)[:100]}", flush=True)
        if not r.get("remaining") or not r.get("updated"): break
    except Exception as e:
        print(f"8f. amazon UF: ERRO {str(e)[:70]}", flush=True); break

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

# ── 10. CMP + margens (INCREMENTAL: só vendas recentes — o relink completo de
#        ~9600 vendas estourava os 60s da Vercel (504) e deixava as margens sem
#        recalcular. days=45 cobre o que muda; recálculo completo roda manual. ──
#        90 dias numa chamada só dava 504 com o banco novo (~200 ms por consulta):
#        fatia em janelas de 5 dias (15 dava 504 em setembro — 15/10/2026).
_hoje = datetime.date.today()
for _ini in range(89, -1, -5):
    _de, _ate = _hoje - datetime.timedelta(days=_ini), min(_hoje - datetime.timedelta(days=_ini - 4), _hoje)
    try:
        r = post("/api/landed-cost/relink", {"days": _ini + 1, "until": _ate.isoformat(), "skipOrders": True}, timeout=170)
        print(f"10. relink {_de}..{_ate}: {json.dumps(r, ensure_ascii=False)[:100]}", flush=True)
    except Exception:
        # bloco estourou os 60s (dia cheio): refaz dia a dia antes de acusar erro (20/10/2026)
        for _d in range(5):
            _dia = _de + datetime.timedelta(days=_d)
            if _dia > _ate:
                break
            try:
                post("/api/landed-cost/relink", {"from": _dia.isoformat(), "until": _dia.isoformat(), "skipOrders": True}, timeout=170)
                print(f"10. relink {_dia} (dia a dia): ok", flush=True)
            except Exception as e:
                print(f"10. relink {_dia}: ERRO {str(e)[:70]}", flush=True)

# ── 11. vistoria de taxas (comissao/fixa vs tabela oficial + frete vs padrao) ──
skip = 0
while skip < 400:
    try:
        r = post("/api/audit/fees", {"days": 30, "limit": 25, "skip": skip})
    except Exception as e:
        print(f"11. fees skip={skip}: ERRO {str(e)[:70]}", flush=True)
        break
    print(f"11. fees skip={skip}: items={r.get('processed_items')} achados={r.get('achados')} restam={r.get('remaining_items')}", flush=True)
    if not r.get("ok") or r.get("remaining_items", 0) <= 0:
        break
    skip += 25
    time.sleep(2)

# ── 12. auditoria automatica (DEPOIS da vistoria: ela conserta comissao e
#        recalcula a margem — auditar antes gerava alerta do estado velho) ──
try:
    r = post("/api/audit/sales?days=45")
    print(f"12. auditoria: {json.dumps(r.get('por_regra', {}), ensure_ascii=False)[:150]}", flush=True)
except Exception as e:
    print(f"12. auditoria: ERRO {str(e)[:70]}", flush=True)

# ── 13. arquivamento de SKUs mortos (sem venda 6m + sem estoque; desarquiva se reviver) ──
try:
    r = post("/api/products/archive-sweep")
    print(f"13. arquivo: arquivados={r.get('arquivados')} desarquivados={r.get('desarquivados')}", flush=True)
except Exception as e:
    print(f"13. arquivo: ERRO {str(e)[:70]}", flush=True)

print("CICLO DIARIO COMPLETO", flush=True)
if _ERROS:
    _print(f"\n{len(_ERROS)} etapa(s) com erro:", *_ERROS, sep="\n- ", flush=True)
    sys.exit(1)
