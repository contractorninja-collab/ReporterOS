/**
 * RetailOS CSV import field definitions.
 *
 * ALL_SKU_FIELDS        — superset of every known column (used by the parser to map any header).
 * NEW_ARRIVALS_IMPORT_FIELDS — columns for New Arrivals Intake.
 * REPORTING_IMPORT_FIELDS    — columns for Reporting Import (lighter: no product_name, price_tag, cost_price, import_date).
 */

export const ALL_SKU_FIELDS = [
  'barcode',
  'sku',
  'product_name',
  'size',
  'price_sold',
  'price_tag',
  'cost_price',
  'quantity',
  'sold_quantity',
  'import_date',
  'gender',
  'season',
  'category',
  'brand',
]

export const REPORTING_IMPORT_FIELDS = [
  'barcode',
  'sku',
  'size',
  'price_sold',
  'sold_quantity',
]

export const REPORTING_TEMPLATE_FILE_NAME = 'RetailOS_Reporting_Import_Template.csv'

export function getReportingHeaderLine() {
  return REPORTING_IMPORT_FIELDS.join(',')
}

export function buildReportingTemplateCsv() {
  const header = getReportingHeaderLine()
  const exampleValues = [
    '8001234567890',
    'SKU-EXAMPLE-001',
    '42',
    '99.00',
    '3',
  ]
  if (exampleValues.length !== REPORTING_IMPORT_FIELDS.length) {
    throw new Error('RetailOS template: reporting example row must match REPORTING_IMPORT_FIELDS length')
  }
  return `${header}\n${exampleValues.join(',')}\n`
}

/**
 * New arrivals / intake: no price_sold and no sold_quantity — ticket price + on-hand qty only; sold counts come later.
 */
export const NEW_ARRIVALS_IMPORT_FIELDS = [
  'barcode',
  'sku',
  'product_name',
  'size',
  'price_tag',
  'cost_price',
  'quantity',
  'import_date',
  'gender',
  'season',
  'category',
  'brand',
]

export const NEW_ARRIVALS_TEMPLATE_FILE_NAME = 'RetailOS_New_Arrivals_Intake_Template.csv'

export function getNewArrivalsHeaderLine() {
  return NEW_ARRIVALS_IMPORT_FIELDS.join(',')
}

export function buildNewArrivalsTemplateCsv() {
  const header = getNewArrivalsHeaderLine()
  const exampleValues = [
    '8001234567890',
    'SKU-EXAMPLE-001',
    'Example Product',
    '42',
    '89.99',
    '45.00',
    '10',
    '2026-03-01',
    'M',
    'SS26',
    'Footwear',
    'YourBrand',
  ]
  if (exampleValues.length !== NEW_ARRIVALS_IMPORT_FIELDS.length) {
    throw new Error('RetailOS template: new arrivals example row must match NEW_ARRIVALS_IMPORT_FIELDS length')
  }
  return `${header}\n${exampleValues.join(',')}\n`
}
