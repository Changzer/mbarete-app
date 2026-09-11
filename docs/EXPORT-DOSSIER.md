# Export rebate dossier (退税/免税单证包)

One folder per customs declaration, holding what the accountant files a VAT
rebate or exemption with. The app never files anything; it collects the
documents against the accountant's checklist, tells you what is missing or
risky, and exports the folder she asked for, named by the 报关单号.

## The rules it follows (effective 2026-01-01)

- 《财政部 税务总局关于出口业务增值税和消费税政策的公告》(2026年第11号) — policy;
  replaced 财税〔2012〕39号.
- 《出口业务增值税和消费税退（免）税管理办法》(国家税务总局公告2026年第5号) —
  procedure; replaced 2012年第24号 and absorbed 2022年第9号 on filing documents.
- Business declared on or before 2025-12-31 keeps the old rules.

What that means for a trading company (外贸企业, 免退税办法):

| Regime | Purchase fapiao for the goods | Effect |
|---|---|---|
| 出口退税 rebate | 增值税专用发票, 13% or 3% | Export free of VAT, input VAT refunded. A 3% special invoice caps the rebate at 3%. |
| 出口免税 exemption | 免税增值税普通发票 (any legal purchase voucher) | Export free of VAT, no refund, input VAT to cost. Must still be declared as exempt. |
| no fapiao | none | Not a regime. 2026年第11号 第七条 treats the export as a domestic sale (视同内销, 13% VAT on the sale). The card flags it as a risk. |

Deadlines, all from the export date on the declaration:

- Routine claim by 30 April of the following year, with the foreign exchange
  received by then for a rebate (contract-scheduled later receipt is allowed
  up to 36 months).
- Absolute limit 36 months: an export not declared as rebate or exemption by
  then is taxed as a domestic sale. An undecided regime with an export date
  set is therefore shown in red.
- Filing documents (备案单证: contracts, transport documents, customs agency
  documents) go on file within 15 days of the claim, with an index, and are
  kept **10 years** (was 5). Paper, imaged or digital retention is lawful; on
  inspection digital documents are printed, stamped and signed as consistent
  with the originals.
- Giving up a rebate or exemption locks the company out of re-applying for 36
  months, so the regime is a real decision.

## The checklist

The accountant's sheet, 《出口退税/免税-单证资料表》, item by item. The list
is identical for a rebate and an exemption; only item 6 changes.

| # | 目录 | Responsible | Notes |
|---|---|---|---|
| 1 | 报关单 | 货代 | |
| 2 | 委托报关协议 | 货代 | note quantity/weight and origin; broker stamp |
| 3 | 无纸化放行通知书 | 货代 | |
| 4 | 提单 | 货代 | |
| 5 | 出口发票 | 会计 | |
| 6 | 进项发票 | 工厂 | **退税: 13%/3% 专票 · 免税: 免税普票** — the only regime difference |
| 7 | 装箱单 | 货代/企业 | |
| 8 | 形式发票 | 系统 | generated from the order when the pack is exported; upload a signed copy to replace it |
| 9 | 外销合同 | 企业 | |
| 10 | 购货合同 | 工厂/企业 | |
| 11 | 国内运费发票 | 企业 | |
| 12 | 国际运费发票 | 货代 | |
| 13 | 运费明细 | 货代 | |
| 14 | 收汇结汇水单 | 企业 | 网银下载 |
| 15 | 运费水单 | 企业 | 网银下载 |
| 16 | 工厂付款水单 | 企业 | 网银下载 |
| 17 | 出入库单 | 企业 | |
| 18 | 贸易往来记录 | 企业 | optional supporting evidence |
| 19 | 视频 | 企业 | optional; mp4/mov/webm up to `DOSSIER_VIDEO_MAX_MB` (default 250) |

Header fields stored on the order: regime, 报关单号 (18 digits), 外销合同日期,
工厂合同日期, 入库日期, 出库日期(申报日期) = the export date.

## Where it lives

- **Order detail → Rebate dossier card.** Regime selector, header fields, the
  nineteen rows with a state and an upload each. Editable on any order
  status: these facts arrive after confirmation. Every header change is
  written to the order's history with old and new values.
- **Uploads** land in `order_documents` with the item's `kind`; the input
  invoice also carries `fapiao_type`. Videos go through
  `POST /api/orders/:id/dossier-video` because of their size.
- **Export**: `GET /api/export/dossier?order=<id>` (admin, finance module,
  10 per hour). The zip's root folder is the 报关单号 (else `order_<number>`):

  ```
  <报关单号>/
    00_单证目录.xlsx      the sheet, ticked ✓/✗, with the file names
    01_报关单_<original>  … numbered by item; missing items are absent
    08_形式发票_<order>.pdf   generated when no signed copy was uploaded
    README.txt            bilingual: regime, item 6 meaning, deadlines, 10-year retention
    manifest.json         SHA-256 per file and a digest over the numbered files
  ```

  The digest covers the numbered documents only, so regenerating the pack
  from the same files gives the same digest.

## Not built, on purpose

No 应退税额 estimate (专票不含税金额 × 退税率), no filing with the
电子税务局 or 单一窗口, no 9610/综试区 flows, no locking of a dossier after
export. The pack is evidence, not a submission.
