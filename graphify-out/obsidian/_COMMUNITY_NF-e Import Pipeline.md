---
type: community
cohesion: 0.29
members: 11
---

# NF-e Import Pipeline

**Cohesion:** 0.29 - loosely connected
**Members:** 11 nodes

## Members
- [[POST()_7]] - code - app/api/nfe/upload/route.ts
- [[extractSaleTaxes()]] - code - lib/nfe/sale-tax-extractor.ts
- [[import-processor.ts]] - code - lib/nfe/import-processor.ts
- [[num()]] - code - lib/nfe/parser.ts
- [[parseNFeXml()]] - code - lib/nfe/parser.ts
- [[parser.ts]] - code - lib/nfe/parser.ts
- [[processImportNFe()]] - code - lib/nfe/import-processor.ts
- [[resolveProductSku()]] - code - lib/nfe/import-processor.ts
- [[route.ts_13]] - code - app/api/nfe/upload/route.ts
- [[sale-tax-extractor.ts]] - code - lib/nfe/sale-tax-extractor.ts
- [[str()]] - code - lib/nfe/parser.ts

## Live Query (requires Dataview plugin)

```dataview
TABLE source_file, type FROM #community/NF-e_Import_Pipeline
SORT file.name ASC
```

## Connections to other communities
- 4 edges to [[_COMMUNITY_Sync API Routes]]
- 1 edge to [[_COMMUNITY_NF-e Saida Sync]]

## Top bridge nodes
- [[processImportNFe()]] - degree 5, connects to 1 community
- [[route.ts_13]] - degree 4, connects to 1 community
- [[POST()_7]] - degree 4, connects to 1 community
- [[import-processor.ts]] - degree 3, connects to 1 community
- [[extractSaleTaxes()]] - degree 3, connects to 1 community