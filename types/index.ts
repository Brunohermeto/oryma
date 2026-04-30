// types/index.ts

export type Marketplace = 'mercado_livre' | 'shopee' | 'amazon'
export type FulfillmentType = 'galpao' | 'full_ml' | 'fba_amazon'
export type ProductOrigin = 'imported' | 'national'
export type ImportCostType = 'frete_maritimo' | 'seguro' | 'afrmm' | 'armazenagem' | 'frete_rodoviario' | 'despachante' | 'gru_inmetro' | 'siscomex' | 'outro'
export type OperationalExpenseCategory =
  | 'salarios' | 'inss_patronal' | 'fgts' | 'vale_transporte' | 'vale_alimentacao'
  | 'plano_saude' | 'ferias_13' | 'prolabore'
  | 'aluguel' | 'frete_operacional' | 'publicidade_marketing'
  | 'sistemas_software' | 'contabilidade_consultoria' | 'outras_despesas'
export type SyncSource = 'mercado_livre' | 'shopee' | 'amazon' | 'bling'
export type SyncStatus = 'success' | 'error' | 'running'
export type IntegrationId = 'mercado_livre' | 'shopee' | 'amazon' | 'bling'

export interface Credential {
  id: IntegrationId
  access_token: string | null
  refresh_token: string | null
  expires_at: string | null
  extra: Record<string, unknown> | null
  updated_at: string
}

export interface Product {
  id: string
  bling_id: string | null
  sku: string
  name: string
  category: string | null
  origin: ProductOrigin
  stock_quantity: number
  created_at: string
  updated_at: string
}

export interface ImportOrder {
  id: string
  nfe_number: string
  nfe_key: string | null
  supplier: string
  issue_date: string
  cfop: string | null
  total_nfe_value: number
  total_fob_value: number | null
  source: 'bling' | 'manual_upload'
  xml_storage_path: string | null
  costs_complete: boolean
  created_at: string
}

export interface ImportItem {
  id: string
  import_order_id: string
  product_id: string | null
  sku: string | null
  description: string | null
  quantity: number
  unit_fob_value: number
  total_fob_value: number
  unit_ii: number
  unit_ipi: number
  unit_pis_imp: number
  unit_cofins_imp: number
  unit_icms_gnre: number
  created_at: string
}

export interface ImportCost {
  id: string
  import_order_id: string
  type: ImportCostType
  description: string | null
  amount: number
  distribution_method: string
  created_at: string
}

export interface UnitCost {
  id: string
  import_item_id: string
  product_id: string
  import_order_id: string
  fob_unit_cost: number
  taxes_unit_cost: number
  additional_unit_cost: number
  total_unit_cost: number
  quantity_in_batch: number
  pis_credit_unit: number
  cofins_credit_unit: number
  icms_credit_unit: number
  calculated_at: string
}

export interface CmpCost {
  id: string
  product_id: string
  cmp_value: number
  total_stock_qty: number
  total_stock_value: number
  calculated_at: string
}

export interface Sale {
  id: string
  external_order_id: string
  marketplace: Marketplace
  fulfillment_type: FulfillmentType
  product_id: string | null
  sku: string | null
  sale_date: string
  quantity: number
  gross_price: number
  shipping_received: number
  marketplace_commission: number
  marketplace_shipping_fee: number
  ads_cost: number
  cancellation: number
  discounts: number
  nfe_saida_key: string | null
  synced_at: string
}

export interface SaleTax {
  id: string
  sale_id: string
  nfe_key: string | null
  pis: number
  cofins: number
  icms: number
  icms_difal: number
  ipi: number
  uf_destino: string | null
  total_taxes: number
}

export interface SaleCost {
  id: string
  sale_id: string
  cmp_cost_id: string | null
  unit_cost_applied: number
  total_cost: number
  margin_value: number | null
  margin_pct: number | null
  created_at: string
}

export interface OperationalExpense {
  id: string
  period: string
  dre_category: OperationalExpenseCategory
  subcategory: string | null
  description: string | null
  supplier: string | null
  amount: number
  payment_date: string | null
  created_at: string
}

export interface TaxApuration {
  id: string
  period: string
  pis_debito: number
  pis_credito_compras: number
  pis_credito_importacao: number
  pis_saldo: number
  cofins_debito: number
  cofins_credito_compras: number
  cofins_credito_importacao: number
  cofins_saldo: number
  icms_debito: number
  icms_credito_entradas: number
  icms_credito_gnre: number
  icms_difal: number
  icms_saldo: number
  lucro_base: number
  irpj: number
  irpj_adicional: number
  csll: number
  calculated_at: string
}

export interface SyncLog {
  id: string
  source: SyncSource
  sync_type: string
  status: SyncStatus
  records_synced: number
  error_message: string | null
  started_at: string
  finished_at: string | null
}

// Composed types for UI
export interface SaleWithDetails extends Sale {
  product?: Product
  taxes?: SaleTax
  cost?: SaleCost
}

export interface ProductWithCmp extends Product {
  current_cmp?: number
  latest_unit_cost?: UnitCost
}

export interface DRERow {
  label: string
  isHeader?: boolean
  isTotal?: boolean
  isHighlight?: boolean
  mercado_livre: number
  shopee: number
  amazon: number
  total: number
}

export interface VelocityData {
  product_id: string
  product_name: string
  sku: string
  marketplace: Marketplace
  units_per_day: number
  units_last_30: number
  units_prev_30: number
  trend: 'up' | 'stable' | 'down'
  days_of_stock: number | null
  stock_quantity: number
}

export interface PricingSimulation {
  product_id: string
  product_name: string
  sku: string
  current_cmp: number
  marketplace: Marketplace
  current_avg_price: number
  avg_commission_pct: number
  target_margin_pct: number
  min_price: number
  price_gap: number
  cost_slack: number
}

export const EXPENSE_CATEGORY_LABELS: Record<OperationalExpenseCategory, string> = {
  salarios: 'Salários',
  inss_patronal: 'INSS Patronal',
  fgts: 'FGTS',
  vale_transporte: 'Vale Transporte',
  vale_alimentacao: 'Vale Alimentação',
  plano_saude: 'Plano de Saúde',
  ferias_13: 'Férias / 13º',
  prolabore: 'Pró-labore',
  aluguel: 'Aluguel / Storage',
  frete_operacional: 'Frete Operacional',
  publicidade_marketing: 'Publicidade e Marketing',
  sistemas_software: 'Sistemas e Software',
  contabilidade_consultoria: 'Contabilidade e Consultoria',
  outras_despesas: 'Outras Despesas',
}

export const MARKETPLACE_LABELS: Record<Marketplace, string> = {
  mercado_livre: 'Mercado Livre',
  shopee: 'Shopee',
  amazon: 'Amazon',
}

export const IMPORT_COST_LABELS: Record<ImportCostType, string> = {
  frete_maritimo: 'Frete Marítimo Internacional',
  seguro: 'Seguro Internacional',
  afrmm: 'AFRMM',
  armazenagem: 'Armazenagem Portuária',
  frete_rodoviario: 'Frete Rodoviário (Santos→BH)',
  despachante: 'Honorários Despachante + LI',
  gru_inmetro: 'Taxa GRU INMETRO',
  siscomex: 'SISCOMEX',
  outro: 'Outro',
}
