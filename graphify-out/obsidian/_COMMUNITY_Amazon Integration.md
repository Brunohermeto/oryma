---
type: community
cohesion: 0.15
members: 18
---

# Amazon Integration

**Cohesion:** 0.15 - loosely connected
**Members:** 18 nodes

## Members
- [[POST()_9]] - code - app/api/sync/marketplaces/route.ts
- [[POST()_4]] - code - app/api/integrations/shopee/save/route.ts
- [[amazon.ts]] - code - lib/integrations/amazon.ts
- [[amazonGet()]] - code - lib/integrations/amazon.ts
- [[amazonRequest()]] - code - lib/marketplace/sync-amazon.ts
- [[getValidAmazonToken()]] - code - lib/integrations/amazon.ts
- [[route.ts_5]] - code - app/api/integrations/amazon/save/route.ts
- [[route.ts_10]] - code - app/api/integrations/shopee/save/route.ts
- [[route.ts_17]] - code - app/api/sync/marketplaces/route.ts
- [[saveAmazonCredentials()]] - code - lib/integrations/amazon.ts
- [[saveShopeeCredentials()]] - code - lib/integrations/shopee.ts
- [[shopee.ts]] - code - lib/integrations/shopee.ts
- [[shopeeGet()]] - code - lib/integrations/shopee.ts
- [[shopeeSign()]] - code - lib/integrations/shopee.ts
- [[sync-amazon.ts]] - code - lib/marketplace/sync-amazon.ts
- [[sync-shopee.ts]] - code - lib/marketplace/sync-shopee.ts
- [[syncAmazon()]] - code - lib/marketplace/sync-amazon.ts
- [[syncShopee()]] - code - lib/marketplace/sync-shopee.ts

## Live Query (requires Dataview plugin)

```dataview
TABLE source_file, type FROM #community/Amazon_Integration
SORT file.name ASC
```

## Connections to other communities
- 6 edges to [[_COMMUNITY_Sync API Routes]]
- 1 edge to [[_COMMUNITY_Mercado Livre Sync]]

## Top bridge nodes
- [[route.ts_17]] - degree 5, connects to 2 communities
- [[sync-amazon.ts]] - degree 4, connects to 1 community
- [[sync-shopee.ts]] - degree 3, connects to 1 community
- [[syncAmazon()]] - degree 3, connects to 1 community
- [[syncShopee()]] - degree 3, connects to 1 community