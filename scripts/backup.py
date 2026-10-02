"""Backup diário do banco do Oryma para FORA do Supabase (via /api/backup).

Gera backup/<tabela>.json.gz para cada tabela; o workflow guarda a pasta como
artifact do GitHub por 90 dias. Restaurar: recriar o schema pelas migrations
(supabase/migrations) e reimportar cada JSON na tabela de mesmo nome.
Sai com código 1 se alguma tabela falhar (GitHub avisa por e-mail).
"""
import gzip, json, os, sys, time, urllib.request

BASE = os.environ.get("ORYMA_BASE", "https://www.oryma.com.br")
H = {"Cookie": f"mi_auth={os.environ['APP_PASSWORD']}"}

def get(q):
    for t in range(4):
        try:
            return json.loads(urllib.request.urlopen(urllib.request.Request(BASE + q, headers=H), timeout=90).read())
        except Exception as e:
            if t == 3: raise
            time.sleep(10)

os.makedirs("backup", exist_ok=True)
falhas = []
for tab in get("/api/backup?list=1")["tabelas"]:
    try:
        rows, off = [], 0
        while True:
            r = get(f"/api/backup?table={tab}&offset={off}")["rows"]
            rows += r; off += 1000
            if len(r) < 1000: break
        with gzip.open(f"backup/{tab}.json.gz", "wt", encoding="utf-8") as f:
            json.dump(rows, f, ensure_ascii=False)
        print(f"{tab}: {len(rows)} linhas", flush=True)
    except Exception as e:
        falhas.append(tab); print(f"{tab}: ERRO {str(e)[:100]}", flush=True)

if falhas:
    print("tabelas com falha:", ", ".join(falhas)); sys.exit(1)
print("BACKUP COMPLETO")
