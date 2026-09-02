-- Repair cartons whose stored CBM cannot be a carton (over 2 m³ — a pallet
-- is about 1.2) while their measured dimensions give the real figure. These
-- came from an AI reading that invented a CBM beside the dimensions it read
-- correctly, which the capture import then saved as the vendor's figure.
-- The reading and the import no longer do that; rows without dimensions
-- are left for a person to fix in the form, which now warns.
UPDATE "products"
SET "cbm" = ("length_cm" * "width_cm" * "height_cm") / 1000000.0
WHERE "dimension_source" = 'carton'
  AND "cbm" > 2
  AND "length_cm" > 0 AND "width_cm" > 0 AND "height_cm" > 0;
