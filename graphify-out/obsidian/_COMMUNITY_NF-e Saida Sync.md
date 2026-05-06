---
type: community
cohesion: 0.46
members: 8
---

# NF-e Saida Sync

**Cohesion:** 0.46 - moderately connected
**Members:** 8 nodes

## Members
- [[extractStr()]] - code - lib/bling/sync-nfe-saida.ts
- [[extractTag()]] - code - lib/bling/sync-nfe-saida.ts
- [[findSaleByOrderNumber()]] - code - lib/bling/sync-nfe-saida.ts
- [[isSerieValida()]] - code - lib/bling/sync-nfe-saida.ts
- [[parseInfoAdicionais()]] - code - lib/bling/sync-nfe-saida.ts
- [[sleep()_1]] - code - lib/bling/sync-nfe-saida.ts
- [[sync-nfe-saida.ts]] - code - lib/bling/sync-nfe-saida.ts
- [[syncNFeSaida()]] - code - lib/bling/sync-nfe-saida.ts

## Live Query (requires Dataview plugin)

```dataview
TABLE source_file, type FROM #community/NF-e_Saida_Sync
SORT file.name ASC
```

## Connections to other communities
- 3 edges to [[_COMMUNITY_Sync API Routes]]
- 1 edge to [[_COMMUNITY_Auth and Cron Routes]]
- 1 edge to [[_COMMUNITY_NF-e Import Pipeline]]

## Top bridge nodes
- [[sync-nfe-saida.ts]] - degree 9, connects to 2 communities
- [[syncNFeSaida()]] - degree 8, connects to 1 community
- [[extractTag()]] - degree 3, connects to 1 community