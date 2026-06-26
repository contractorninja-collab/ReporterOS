/**
 * RetailOS CSV import field definitions.
 *
 * ALL_SKU_FIELDS        — superset of every known column (used by the parser to map any header).
 * NEW_ARRIVALS_IMPORT_FIELDS — columns for New Arrivals Intake.
 * REPORTING_IMPORT_FIELDS    — columns for Reporting Import (lighter: no product_name, price_tag, cost_price, import_date).
 * sale_date — day the units were sold; **DD.MM.YY** in the template (e.g. 09.04.26). sold_quantity is units sold **on that day** (not lifetime cumulative).
 * price_sold (reporting): total money for that CSV row, not unit price. Example: sold_quantity 3 at €99 each => price_sold 297.00.
 * transaction_type (reporting): optional. Accepted values include SALE and RETURN. If omitted, the importer falls back to sold_quantity sign.
 *
 * gender (intake): **only** Male, Female, Kids, or Unisex (any case). Stored as M, F, K, U.
 *
 * price_sold, price_tag, cost_price: **preferred format** is `110752.29` (dot decimal, no thousand
 * separators). Other locales are normalized in csvParser.parseFlexibleNumber.
 *
 * **line_total** (optional): if present and &gt; 0, unit cost is `line_total / quantity` (use when the
 * sheet stores row line amount, not unit cost). Overrides parsed `cost_price` for that row.
 */

export const ALL_SKU_FIELDS = [
  'barcode',
  'sku',
  'product_name',
  'size',
  'price_sold',
  'price_tag',
  'cost_price',
  'line_total',
  'quantity',
  'sold_quantity',
  'import_date',
  'gender',
  'season',
  'category',
  'brand',
  'sale_date',
  'transaction_type',
]

/** If the canonical header is missing, accept these normalized names (see csvParser normalizeHeader). */
export const CSV_FIELD_ALIASES = {
  cost_price: [
    'import_price',
    'purchase_price',
    'unit_cost',
    'cost',
    'wholesale_price',
    'buy_price',
    'uco',
    'landed_cost',
  ],
  line_total: ['line_cost', 'extended_cost', 'row_total', 'total_line'],
  price_tag: ['retail_price', 'ticket_price', 'rrp'],
  price_sold: ['sale_price', 'avg_sale'],
  sale_date: ['sold_date', 'date_sold', 'sale_day'],
  transaction_type: ['transaction', 'type', 'event_type', 'movement_type'],
}

export const REPORTING_IMPORT_FIELDS = [
  'barcode',
  'sku',
  'size',
  'price_sold',
  'sold_quantity',
  'sale_date',
  'transaction_type',
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
    '297.00',
    '3',
    '09.04.26',
    'SALE',
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
    'Male',
    'SS26',
    'Footwear',
    'YourBrand',
  ]
  if (exampleValues.length !== NEW_ARRIVALS_IMPORT_FIELDS.length) {
    throw new Error('RetailOS template: new arrivals example row must match NEW_ARRIVALS_IMPORT_FIELDS length')
  }
  return `${header}\n${exampleValues.join(',')}\n`
}
