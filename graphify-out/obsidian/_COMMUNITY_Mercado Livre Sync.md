---
type: community
cohesion: 0.39
members: 9
---

# Mercado Livre Sync

**Cohesion:** 0.39 - loosely connected
**Members:** 9 nodes

## Members
- [[getMercadoLivreSellerId()]] - code - lib/integrations/mercado-livre.ts
- [[getShippingCostForSeller()]] - code - lib/marketplace/sync-ml.ts
- [[getValidMercadoLivreToken()]] - code - lib/integrations/mercado-livre.ts
- [[isFulfillmentFull()]] - code - lib/marketplace/sync-ml.ts
- [[mercado-livre.ts]] - code - lib/integrations/mercado-livre.ts
- [[mlGet()]] - code - lib/integrations/mercado-livre.ts
- [[sleep()_2]] - code - lib/marketplace/sync-ml.ts
- [[sync-ml.ts]] - code - lib/marketplace/sync-ml.ts
- [[syncMercadoLivre()]] - code - lib/marketplace/sync-ml.ts

## Live Query (requires Dataview plugin)

```dataview
TABLE source_file, type FROM #community/Mercado_Livre_Sync
SORT file.name ASC
```

## Connections to other communities
- 2 edges to [[_COMMUNITY_Auth and Cron Routes]]
- 2 edges to [[_COMMUNITY_Sync API Routes]]
- 1 edge to [[_COMMUNITY_Amazon Integration]]

## Top bridge nodes
- [[syncMercadoLivre()]] - degree 7, connects to 2 communities
- [[sync-ml.ts]] - degree 7, connects to 1 community
- [[mercado-livre.ts]] - degree 5, connects to 1 community