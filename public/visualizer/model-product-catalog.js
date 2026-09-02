export const MODEL_PRODUCT_CATALOG_SCHEMA = 'visualizer-model-product-catalog-v1';
export const MODEL_PRODUCT_CATALOG_VERSION = MODEL_PRODUCT_CATALOG_SCHEMA;

// This list is intentionally empty until exact model IDs have operator approval.
export const MODEL_PRODUCT_CATALOG = Object.freeze([]);
export const MODEL_PRODUCT_CATALOG_ENTRIES = MODEL_PRODUCT_CATALOG;
export const OPERATOR_APPROVED_MODEL_ENTRIES = MODEL_PRODUCT_CATALOG;
export const OPERATOR_APPROVED_MODELS = MODEL_PRODUCT_CATALOG;

export function modelProductCatalogSnapshot() {
  return Object.freeze({
    schema: MODEL_PRODUCT_CATALOG_SCHEMA,
    entries: MODEL_PRODUCT_CATALOG,
  });
}
