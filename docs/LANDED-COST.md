# Landed cost (到岸成本)

What a product will cost once it has arrived in Brazil or Paraguay, shown on
the product form as it is registered, so a price at the booth can be judged
against what it becomes at the destination.

## The estimate

Per piece, in the company's functional currency, once for each shipping
mode so LCL and FCL can be compared side by side:

```
supplier cost  (the product's price, converted)
+ shipping     (the destination's freight rate per m³ for that mode × the carton's CBM ÷ pieces per carton)
= CIF          (the duty base; insurance is left out)
+ import duty  (CIF × the destination's ad valorem duty for the HS/NCM code)
= arriving cost
```

**LCL** (less than container load) shares a container with other shippers
and is usually quoted per m³. **FCL** (full container load) books a whole
container, usually quoted per 40HQ and spread here over its usable volume,
so the FCL figure is the per-piece share *if the container is filled*. The
lower of the two totals is marked when both rates are in force.

It is an estimate for comparing products, never an invoice. It leaves out
insurance, port and broker charges, and the destination's other import
taxes: Brazil's IPI, PIS/COFINS and ICMS, Paraguay's IVA. Anything missing
from the inputs is named under the figure rather than silently counted as
zero: no price, no freight rate for the destination, an unmeasured carton,
no duty rate, or a currency with no exchange rate.

## Where the inputs come from

- **HS / NCM code** — the AI proposes one from the photos (the 8-digit
  Mercosur NCM when confident, else the 6-digit HS subheading) and lists
  `hsCode` among the uncertain fields when two headings are plausible. A
  person keeps or corrects it; the field takes digits only.
- **Import duty** — the AI proposes the ad valorem rate Brazil (Imposto de
  Importação under the Mercosur TEC) and Paraguay (DAI) apply to that code.
  These are its best figures, not a tariff lookup, and are meant to be
  verified with the broker. Both destinations' rates are stored on the
  product; the dropdown chooses which one the estimate uses.
- **Shipping** — Settings → Shipping cost estimates. Each entry is a log
  line (destination, mode LCL or FCL, per m³ or per 40HQ container, amount,
  currency, effective date, note, who recorded it); the newest per
  destination *and mode* is the one in force, so Brazil can carry an LCL
  rate and an FCL rate at once. A container rate is spread over its usable
  volume (68 m³ by default). The history stays visible so the change over
  time can be read. Per-shipment minimums and fixed charges (LCL minimum
  CBM, document and handling fees) are not modelled.

## Data

- `products.hs_code`, `products.export_destination` ('' | BR | PY),
  `products.import_duty_pct_br`, `products.import_duty_pct_py`.
- `shipping_rates` — append-only, one log per (destination, mode),
  tenant-isolated like every business table.
