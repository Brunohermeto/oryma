# Graph Report - .  (2026-05-05)

## Corpus Check
- Corpus is ~35,841 words - fits in a single context window. You may not need a graph.

## Summary
- 239 nodes · 302 edges · 40 communities (37 shown, 3 thin omitted)
- Extraction: 88% EXTRACTED · 12% INFERRED · 0% AMBIGUOUS · INFERRED: 35 edges (avg confidence: 0.78)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Sync API Routes|Sync API Routes]]
- [[_COMMUNITY_UI Component Library|UI Component Library]]
- [[_COMMUNITY_Dashboard Forms|Dashboard Forms]]
- [[_COMMUNITY_Amazon Integration|Amazon Integration]]
- [[_COMMUNITY_Auth and Cron Routes|Auth and Cron Routes]]
- [[_COMMUNITY_NF-e Import Pipeline|NF-e Import Pipeline]]
- [[_COMMUNITY_Project Config and Docs|Project Config and Docs]]
- [[_COMMUNITY_Mercado Livre Sync|Mercado Livre Sync]]
- [[_COMMUNITY_DRE Engine|DRE Engine]]
- [[_COMMUNITY_NF-e Saida Sync|NF-e Saida Sync]]
- [[_COMMUNITY_Sync Controls UI|Sync Controls UI]]
- [[_COMMUNITY_Vendas ao Vivo Feed|Vendas ao Vivo Feed]]
- [[_COMMUNITY_Oryma AI Intelligence|Oryma AI Intelligence]]

## God Nodes (most connected - your core abstractions)
1. `createSupabaseServiceClient()` - 47 edges
2. `cn()` - 10 edges
3. `syncNFeSaida()` - 8 edges
4. `buildDRE()` - 8 edges
5. `recalculateLandedCost()` - 7 edges
6. `syncMercadoLivre()` - 7 edges
7. `parseNFeXml()` - 7 edges
8. `MarketIntel Next.js Project` - 7 edges
9. `processImportNFe()` - 5 edges
10. `POST()` - 4 edges

## Surprising Connections (you probably didn't know these)
- `POST()` --calls--> `createSupabaseServiceClient()`  [INFERRED]
  app/api/sync/marketplaces/route.ts → lib/supabase/server.ts
- `POST()` --calls--> `createSupabaseServiceClient()`  [INFERRED]
  app/api/despesas/route.ts → lib/supabase/server.ts
- `POST()` --calls--> `recalculateLandedCost()`  [INFERRED]
  app/api/landed-cost/recalculate/route.ts → lib/landed-cost/calculator.ts
- `POST()` --calls--> `createSupabaseServiceClient()`  [INFERRED]
  app/api/nfe/upload/route.ts → lib/supabase/server.ts
- `GET()` --calls--> `createSupabaseServiceClient()`  [INFERRED]
  app/api/sales/live/route.ts → lib/supabase/server.ts

## Communities (40 total, 3 thin omitted)

### Community 0 - "Sync API Routes"
Cohesion: 0.09
Nodes (15): POST(), sleep(), syncNFeEntrada(), POST(), POST(), applyCmpToSale(), getCurrentCmp(), recalculateCmp() (+7 more)

### Community 2 - "Dashboard Forms"
Cohesion: 0.14
Nodes (7): LandedCostForm(), Input(), SelectContent(), SelectItem(), SelectTrigger(), SelectValue(), SalesFilters()

### Community 3 - "Amazon Integration"
Cohesion: 0.15
Nodes (11): amazonGet(), getValidAmazonToken(), saveAmazonCredentials(), saveShopeeCredentials(), shopeeGet(), shopeeSign(), amazonRequest(), syncAmazon() (+3 more)

### Community 4 - "Auth and Cron Routes"
Cohesion: 0.22
Nodes (9): GET(), GET(), blingAuthHeader(), blingGet(), exchangeBlingCode(), getBlingAuthUrl(), getValidBlingToken(), exchangeMercadoLivreCode() (+1 more)

### Community 5 - "NF-e Import Pipeline"
Cohesion: 0.29
Nodes (7): processImportNFe(), resolveProductSku(), num(), parseNFeXml(), str(), extractSaleTaxes(), POST()

### Community 6 - "Project Config and Docs"
Cohesion: 0.2
Nodes (11): Next.js Breaking Changes Warning, Next.js Agent Rules, Next.js Internal Docs Reference, CLAUDE.md References AGENTS.md, App Entry Point (app/page.tsx), create-next-app Bootstrap Tool, Development Server (localhost:3000), next/font Geist Font Optimization (+3 more)

### Community 7 - "Mercado Livre Sync"
Cohesion: 0.39
Nodes (7): getMercadoLivreSellerId(), getValidMercadoLivreToken(), mlGet(), getShippingCostForSeller(), isFulfillmentFull(), sleep(), syncMercadoLivre()

### Community 8 - "DRE Engine"
Cohesion: 0.43
Nodes (6): add(), buildDRE(), headerRow(), subtract(), toRow(), zero()

### Community 9 - "NF-e Saida Sync"
Cohesion: 0.46
Nodes (7): extractStr(), extractTag(), findSaleByOrderNumber(), isSerieValida(), parseInfoAdicionais(), sleep(), syncNFeSaida()

### Community 14 - "Oryma AI Intelligence"
Cohesion: 0.6
Nodes (3): getPageContext(), handleKey(), sendMessage()

## Knowledge Gaps
- **7 isolated node(s):** `Next.js Internal Docs Reference`, `CLAUDE.md References AGENTS.md`, `create-next-app Bootstrap Tool`, `Development Server (localhost:3000)`, `App Entry Point (app/page.tsx)` (+2 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **3 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `createSupabaseServiceClient()` connect `Sync API Routes` to `Dashboard Forms`, `Amazon Integration`, `NF-e Import Pipeline`, `Mercado Livre Sync`, `DRE Engine`, `NF-e Saida Sync`, `Pricing Simulator`, `Sync Controls UI`, `Products Page`, `Insights Panel`?**
  _High betweenness centrality (0.441) - this node is a cross-community bridge._
- **Why does `cn()` connect `UI Component Library` to `Dashboard Forms`?**
  _High betweenness centrality (0.117) - this node is a cross-community bridge._
- **Are the 19 inferred relationships involving `createSupabaseServiceClient()` (e.g. with `getDaysToSync()` and `POST()`) actually correct?**
  _`createSupabaseServiceClient()` has 19 INFERRED edges - model-reasoned connections that need verification._
- **Are the 3 inferred relationships involving `recalculateLandedCost()` (e.g. with `POST()` and `POST()`) actually correct?**
  _`recalculateLandedCost()` has 3 INFERRED edges - model-reasoned connections that need verification._
- **What connects `Next.js Internal Docs Reference`, `CLAUDE.md References AGENTS.md`, `create-next-app Bootstrap Tool` to the rest of the system?**
  _7 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Sync API Routes` be split into smaller, more focused modules?**
  _Cohesion score 0.09 - nodes in this community are weakly interconnected._
- **Should `UI Component Library` be split into smaller, more focused modules?**
  _Cohesion score 0.09 - nodes in this community are weakly interconnected._