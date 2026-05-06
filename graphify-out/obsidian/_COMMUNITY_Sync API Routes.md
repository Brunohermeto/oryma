---
type: community
cohesion: 0.09
members: 35
---

# Sync API Routes

**Cohesion:** 0.09 - loosely connected
**Members:** 35 nodes

## Members
- [[GET()_3]] - code - app/api/sales/live/route.ts
- [[GET()_4]] - code - app/api/sync/marketplaces/status/route.ts
- [[GET()]] - code - app/api/cron/sync/route.ts
- [[POST()_8]] - code - app/api/sync/bling/route.ts
- [[POST()_6]] - code - app/api/nfe/costs/route.ts
- [[POST()_3]] - code - app/api/despesas/route.ts
- [[POST()_5]] - code - app/api/landed-cost/recalculate/route.ts
- [[applyCmpToSale()]] - code - lib/landed-cost/calculator.ts
- [[calculator.ts]] - code - lib/landed-cost/calculator.ts
- [[createSupabaseServerClient()]] - code - lib/supabase/server.ts
- [[createSupabaseServiceClient()]] - code - lib/supabase/server.ts
- [[fmtR()_1]] - code - app/dashboard/despesas/page.tsx
- [[fmtR()_3]] - code - app/dashboard/precificacao/page.tsx
- [[fmtR()_4]] - code - app/dashboard/produtos/page.tsx
- [[getCurrentCmp()]] - code - lib/landed-cost/calculator.ts
- [[getDaysToSync()]] - code - app/api/cron/sync/route.ts
- [[page.tsx_3]] - code - app/dashboard/despesas/page.tsx
- [[page.tsx_6]] - code - app/dashboard/precificacao/page.tsx
- [[page.tsx_7]] - code - app/dashboard/produtos/page.tsx
- [[page.tsx_9]] - code - app/dashboard/velocidade/page.tsx
- [[recalculateCmp()]] - code - lib/landed-cost/calculator.ts
- [[recalculateLandedCost()]] - code - lib/landed-cost/calculator.ts
- [[route.ts_3]] - code - app/api/cron/sync/route.ts
- [[route.ts_4]] - code - app/api/despesas/route.ts
- [[route.ts_11]] - code - app/api/landed-cost/recalculate/route.ts
- [[route.ts_12]] - code - app/api/nfe/costs/route.ts
- [[route.ts_14]] - code - app/api/sales/live/route.ts
- [[route.ts_15]] - code - app/api/sync/bling/route.ts
- [[route.ts_16]] - code - app/api/sync/bling/status/route.ts
- [[route.ts_18]] - code - app/api/sync/marketplaces/status/route.ts
- [[server.ts]] - code - lib/supabase/server.ts
- [[sleep()]] - code - lib/bling/sync-nfe-entrada.ts
- [[stockColor()]] - code - app/dashboard/velocidade/page.tsx
- [[sync-nfe-entrada.ts]] - code - lib/bling/sync-nfe-entrada.ts
- [[syncNFeEntrada()]] - code - lib/bling/sync-nfe-entrada.ts

## Live Query (requires Dataview plugin)

```dataview
TABLE source_file, type FROM #community/Sync_API_Routes
SORT file.name ASC
```

## Connections to other communities
- 6 edges to [[_COMMUNITY_Amazon Integration]]
- 4 edges to [[_COMMUNITY_NF-e Import Pipeline]]
- 3 edges to [[_COMMUNITY_NF-e Saida Sync]]
- 2 edges to [[_COMMUNITY_Dashboard Forms]]
- 2 edges to [[_COMMUNITY_DRE Engine]]
- 2 edges to [[_COMMUNITY_Mercado Livre Sync]]
- 1 edge to [[_COMMUNITY_Products Page]]
- 1 edge to [[_COMMUNITY_Sync Controls UI]]
- 1 edge to [[_COMMUNITY_Pricing Simulator]]
- 1 edge to [[_COMMUNITY_Insights Panel]]
- 1 edge to [[_COMMUNITY_Auth and Cron Routes]]

## Top bridge nodes
- [[createSupabaseServiceClient()]] - degree 47, connects to 10 communities
- [[route.ts_15]] - degree 4, connects to 1 community
- [[sync-nfe-entrada.ts]] - degree 4, connects to 1 community