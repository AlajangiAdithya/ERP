-- Rename product category "Tooling" → "Hand Tools & Fastners" across all
-- places where the literal value is stored. Schema is unchanged (still a
-- free-text String? column); this only rewrites stored values so dropdowns
-- and filters line up with the new label. Existing SKUs (TOOL-NNNN) are
-- left as-is since the prefix mapping still resolves "Hand Tools & Fastners"
-- to "TOOL".

UPDATE "Product"
   SET "category" = 'Hand Tools & Fastners'
 WHERE "category" = 'Tooling';

UPDATE "PurchaseRequestItem"
   SET "materialType" = 'Hand Tools & Fastners'
 WHERE "materialType" = 'Tooling';
