# Customs pack (报关资料)

The workbook a Chinese customs broker files an export with, generated from a
confirmed or shipped order: **Order page → Customs pack (Excel)**. It mirrors
the files Mbarete has filed with, sheet for sheet, so the broker reads it
without relearning anything.

| Sheet | What it is |
| --- | --- |
| 出货清单 | Shipment summary: contract no., invoicing factories, consignee, goods origin, marks, loading date, port of destination, one line per product with Chinese and English names, quantity, unit, price, amount, factory, cartons, gross/net weight, CBM, its own 境内货源地, and totals. |
| inv | Commercial invoice, English, with the marks, quantities, unit price and amount in the order's quote currency. |
| pck | Packing list, English: the marks, cartons, G.W., N.W., MEAS per line and in total. |
| 合同 | Sales contract: buyer, seller, contract no. and date, goods, shipping marks, shipment date, ±5 % quantity, ports, the order's notes as freight and other terms, payment. |
| 报关单 | Draft export declaration: ports, dates, 运抵国, 境内货源地, 成交方式, packages, weights, factories, 标记唛码, and per line China's 10-digit code (商品编号), Chinese name, its 境内货源地, quantity and unit, 最终目的国, price, amount, currency, then each line's 申报要素. |
| 委托书 | 代理报关委托书 and 委托报关协议, the letter a forwarder needs before declaring in the company's name (dossier item 02), in the brokers' association wording. The seller's half is filled — company, main goods and code, total, export date, 一般贸易, origin, phone; the forwarder's half, the service choices and the stamps are left for the people who sign. |

**Carton labels (PDF)**, next to the pack: one label per carton, two to an A4
sheet — the marks, a boxed 报关件 (the forwarder's sign that the box is
declared separately, not in a consolidated declaration), the product in both
languages, the pieces inside (full cartons, the last holding the rest) and
`C/NO. n / total`, numbered across the order in line order. Lines without a
carton count get no label.

## Where each fact comes from

- **Order:** number (contract and invoice no.), lines, quantities, prices in the
  quote currency, cartons, gross weight and CBM as frozen on the order, notes.
- **Dossier card on the order (editable on any status, logged):** export date
  (loading, invoice and shipment date), contract date, customs declaration no.,
  and the shipment block: port of loading, port of destination, country of
  destination, goods origin (境内货源地) and the shipping marks (唛头, one per
  line — usually the forwarder's customer code, the order number and the
  destination; blank prints N/M, and the labels then lead with the order
  number and destination).
- **Supplier (contact form):** province (fixed list of 31) and city. Each
  line's 境内货源地 is its supplier's, read live like the product codes; the
  declaration header uses the order's own goods origin when one is typed,
  else the supplier origin carrying the most money, and the dossier card says
  which. Suppliers with a Yiwu market booth start as 浙江省义乌市 (customs
  takes the place of the earliest purchase when the factory is unknown), and a
  business card reading fills province and city from the factory address.
- **Product (Export estimate section of the product form):** China's 10-digit
  export code, the declaration elements (申报要素) and the declared unit
  (个 / 套 / 双). The photo reader proposes the code and the elements; "Suggest
  customs codes from photos" fills them on an existing product. Both are
  approximations for the broker to confirm.
- **Company profile:** company name (split on "|" into the Chinese name for the
  declaration and the English name for the contract and invoice), address,
  phone, incoterms (成交方式), payment terms. Confirmed orders use the parties
  frozen at confirmation, like every other document.
- **Fixed defaults:** 水路运输, 一般贸易 0110, 一般征税, 纸箱, 照章征税, N/M
  when there are no marks.

## What prints blank

Anything the order does not hold: a product without China's code or elements,
an unset port or country, an origin neither the order nor any supplier gives,
the export date before it is known, container and bill-of-lading numbers. The button lists the gaps before the
download. **Net weight is not recorded separately and prints equal to the
gross weight**, as in the files filed so far; correct it in the workbook when
the factory gives a net figure.
