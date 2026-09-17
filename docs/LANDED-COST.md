# Export cost estimate (出口成本估算)

An optional planning comparison for Brazil and Paraguay. It is a **product +
freight + duty subtotal**, not the complete landed cost or a customs calculation.
The product form keeps it folded after the capture fields. No destination,
classification or duty is required to save a product or continue a booth visit.

## Calculation and limits

Per piece, in the company's functional currency:

```
supplier cost = product price, converted
freight = mode's rate per m³ × carton CBM ÷ pieces per carton, converted
duty estimate = (supplier cost + freight) × user-selected duty percentage
subtotal = supplier cost + freight + duty estimate
```

Cost plus freight is not labelled CIF because insurance is absent. The model
also excludes port/broker charges, local delivery, other import taxes, and
LCL minimums/fixed charges. These limitations appear beside the figures.

LCL uses the recorded per-volume quote. A 40HQ quote is divided by usable
volume (68 m³ by default). **FCL assumes that usable volume is filled**; its
per-piece share is not the cost of booking a container for a small shipment.
No shipment quantity, weight limit, route or tax-exception model is included.
The lower badge compares complete model estimates only, not booking options.

Missing price, volume, duty, freight or exchange rates produce `null` for the
dependent amounts and total. Known components still appear; missing ones show
a dash and a reason. Unknown duty stays `null` through save/review; an explicit
0% stays zero. Per-piece figures show up to four decimals so a small difference
is not hidden by cent rounding. Piece-derived carton volume uses the same
dimensions and packing allowance as product saving, and is labelled estimated.

## Inputs and review

- **HS/NCM:** a six-digit HS or eight-digit NCM suggestion. Dots/spaces in
  printed codes are normalized; malformed lengths or mixed text are rejected.
  Classification needs human verification.
- **Duty:** there is no live tariff lookup. AI figures stay separate as
  unverified suggestions and never automatically populate the saved rates.
  A person can enter a checked rate or explicitly choose “Use this estimate”.
  The latter is still an estimate, not a broker verification. Existing manual
  rates survive another photo reading. Blank is allowed; no rate is invented
  to complete the form. Changing a code is not a tariff lookup: review its
  duty rates separately.
- **Freight:** Settings holds an append-only history per destination and mode.
  The latest effective date **on or before the current UTC day** wins; ID
  breaks same-day ties. Future entries remain visible as scheduled and do not
  replace today's rate. Dates and storage bounds are validated. Failed saves
  keep the entire entered quote for retry.
- **Capture:** folding the export or measurement section preserves its values.
  Offline review preserves the destination and explicit 0% rates. Saving the
  next product clears product-specific duties and AI suggestions. The normal
  offline capture queue, same-supplier workflow and save controls remain.

## Data and deployment

Migration `0030` adds the four product columns and tenant-isolated
`shipping_rates` table. This review does not rewrite that migration or add
another one. The company CSV export includes shipping history; full database
backups discover the table automatically.

If an earlier draft build was used with real data, previously saved zero duties
cannot be distinguished from blanks affected by its coercion bug. Review those
records manually; this change does not guess which historical zeroes to erase.

## Verification

`npm test` covers missing inputs, explicit zeroes, invalid exchange/freight
values, effective dates, classification validation and offline draft defaults.
`npm run test:landed-cost` runs against a disposable seeded database and the
production app: scheduled quotes, injected save failure/retry, mounted form
values, per-piece estimates, partial totals, offline next-product reset,
destination/zero-duty review, and English/Chinese phone layouts. CI retains
screenshots. The golden path also verifies that choosing an AI duty suggestion
persists only that destination's rate. Existing field-capture tests still gate CI.
