---
type: community
cohesion: 0.22
members: 14
---

# Auth and Cron Routes

**Cohesion:** 0.22 - loosely connected
**Members:** 14 nodes

## Members
- [[GET()_1]] - code - app/api/integrations/ml/callback/route.ts
- [[GET()_2]] - code - app/api/integrations/ml/connect/route.ts
- [[bling.ts]] - code - lib/integrations/bling.ts
- [[blingAuthHeader()]] - code - lib/integrations/bling.ts
- [[blingGet()]] - code - lib/integrations/bling.ts
- [[exchangeBlingCode()]] - code - lib/integrations/bling.ts
- [[exchangeMercadoLivreCode()]] - code - lib/integrations/mercado-livre.ts
- [[getBlingAuthUrl()]] - code - lib/integrations/bling.ts
- [[getMercadoLivreAuthUrl()]] - code - lib/integrations/mercado-livre.ts
- [[getValidBlingToken()]] - code - lib/integrations/bling.ts
- [[route.ts_6]] - code - app/api/integrations/bling/callback/route.ts
- [[route.ts_7]] - code - app/api/integrations/bling/connect/route.ts
- [[route.ts_8]] - code - app/api/integrations/ml/callback/route.ts
- [[route.ts_9]] - code - app/api/integrations/ml/connect/route.ts

## Live Query (requires Dataview plugin)

```dataview
TABLE source_file, type FROM #community/Auth_and_Cron_Routes
SORT file.name ASC
```

## Connections to other communities
- 2 edges to [[_COMMUNITY_Mercado Livre Sync]]
- 1 edge to [[_COMMUNITY_Sync API Routes]]
- 1 edge to [[_COMMUNITY_NF-e Saida Sync]]

## Top bridge nodes
- [[blingGet()]] - degree 4, connects to 2 communities
- [[exchangeMercadoLivreCode()]] - degree 3, connects to 1 community
- [[getMercadoLivreAuthUrl()]] - degree 3, connects to 1 community