import { sql } from "drizzle-orm";
import {
  pgTable,
  numeric,
  foreignKey,
  text,
  integer,
  serial,
  boolean,
  doublePrecision,
  index,
  uniqueIndex,
  primaryKey,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

/**
 * Timestamps are stored as text in SQLite's "YYYY-MM-DD HH:MM:SS" UTC shape,
 * carried over unchanged from the SQLite era: every formatter and comparison
 * in the app already speaks it, and rows migrated from the NAS database keep
 * their history byte-for-byte. Columns written by the app with
 * `new Date().toISOString()` mix in the ISO shape, which the formatters also
 * accept — same as before.
 */
const utcNow = sql`to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD HH24:MI:SS')`;

/**
 * One tenant. Every row of business data below belongs to exactly one
 * company, and every query filters on it — that filter is the wall between
 * two customers of the product. In self-hosted mode there is exactly one
 * company, created by the seed.
 */
export const companies = pgTable("companies", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  /**
   * The account owner — the person who registered the company. Owners are
   * admins that other admins cannot demote or deactivate. Nullable only
   * during creation, before the first user row exists.
   */
  ownerUserId: integer("owner_user_id").references((): AnyPgColumn => users.id),
  /** Monetization hook, unenforced for now: "free" until plans exist. */
  plan: text("plan").notNull().default("free"),
  /**
   * Seats bought on top of the plan's own cap, granted by hand from the
   * platform panel while billing stays manual. Survives plan changes.
   */
  extraSeats: integer("extra_seats").notNull().default(0),
  // Module visibility, flipped from the platform panel. Catalog and contacts
  // are the product's core and have no switch; these two are where premium
  // tiers will start. Off means the module's pages, actions and nav entries
  // do not exist for that company — not merely hidden buttons.
  moduleOrders: boolean("module_orders").notNull().default(true),
  moduleFinance: boolean("module_finance").notNull().default(true),
  /**
   * This company's shareable signup code, minted the first time its admin
   * opens the referral card. A /signup?ref=<code> link admits a new company
   * without the platform-wide SIGNUP_CODE — referrals are the growth loop.
   */
  referralCode: text("referral_code").unique(),
  /** Which company's link brought this one in; the referral graph. */
  referredByCompanyId: integer("referred_by_company_id").references(
    (): AnyPgColumn => companies.id,
  ),
  /**
   * Lifecycle, decided by the operator. "pending" = arrived through a
   * referral link and waits for approval; "active" = normal service;
   * "suspended" = frozen — every page yields to the suspended screen,
   * which keeps only the data-export door open (authz.ts requireUser).
   */
  status: text("status", { enum: ["pending", "active", "suspended"] })
    .notNull()
    .default("active"),
  createdAt: text("created_at").notNull().default(utcNow),
});

export const users = pgTable(
  "users",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id")
      .notNull()
      .references(() => companies.id),
    // Globally unique on purpose: an email belongs to one company. Sign-in
    // never asks which company you meant, and an invite to an address that
    // already has an account can say so plainly.
    email: text("email").notNull().unique(),
    passwordHash: text("password_hash").notNull(),
    name: text("name").notNull(),
    // Accounts are deactivated, never deleted: products and orders point at
    // this row, and removing it would erase who did what. An inactive user
    // cannot sign in but still gets credited on everything they entered.
    active: boolean("active").notNull().default(true),
    // "admin" sees everything; "collaborator" runs the daily loop (products,
    // contacts, orders) but cannot delete records, touch settings, manage the
    // team or read the finance report.
    role: text("role").$type<"admin" | "collaborator">().notNull().default("collaborator"),
    /**
     * Operator of the whole platform, not a tenant role: unlocks the hidden
     * cross-company panel. Granted only via PLATFORM_ADMIN_EMAIL at boot —
     * deliberately no UI can set it.
     */
    platformAdmin: boolean("platform_admin").notNull().default(false),
    /**
     * When the password last changed; null means never since this column
     * existed. Sessions issued BEFORE this instant are dead — a stolen
     * cookie stops working the moment the password is rotated.
     */
    passwordChangedAt: text("password_changed_at"),
    // Set when the address's owner clicks a verification link. Reset links
    // are only ever sent to the address on file, so verification is a trust
    // signal, not a login gate.
    emailVerifiedAt: text("email_verified_at"),
    createdAt: text("created_at").notNull().default(utcNow),
  },
  (table) => [
    index("users_company_idx").on(table.companyId),
    // Composite-FK target: lets referencing tables prove same-company-ness.
    uniqueIndex("users_company_id_uq").on(table.companyId, table.id),
  ],
);

export const categories = pgTable(
  "categories",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id")
      .notNull()
      .references(() => companies.id),
    nameEn: text("name_en").notNull(),
    nameZh: text("name_zh").notNull(),
  },
  (table) => [
    index("categories_company_idx").on(table.companyId),
    uniqueIndex("categories_company_id_uq").on(table.companyId, table.id),
  ],
);

export const products = pgTable(
  "products",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id")
      .notNull()
      .references(() => companies.id),
    sku: text("sku").notNull(),
    nameEn: text("name_en").notNull(),
    nameZh: text("name_zh").notNull(),
    // Composite FK below proves the category is this company's.
    categoryId: integer("category_id").notNull(),
    descriptionEn: text("description_en").notNull().default(""),
    descriptionZh: text("description_zh").notNull().default(""),
    price: numeric("price", { precision: 14, scale: 4, mode: "number" }).notNull(),
    // Default selling price for order lines. 0 means none set: the product
    // sells at the supplier price until a price is typed on the order.
    sellPrice: numeric("sell_price", { precision: 14, scale: 4, mode: "number" })
      .notNull()
      .default(0),
    currency: text("currency").notNull().default("USD"),
    moq: integer("moq").notNull().default(1),
    qtyPerBox: integer("qty_per_box").notNull().default(1),
    // Carton figures. These are what every order calculation reads, whether
    // they were measured or estimated from a single piece.
    lengthCm: doublePrecision("length_cm").notNull().default(0),
    widthCm: doublePrecision("width_cm").notNull().default(0),
    heightCm: doublePrecision("height_cm").notNull().default(0),
    weightKg: doublePrecision("weight_kg").notNull().default(0),
    cbm: doublePrecision("cbm").notNull().default(0),
    // Where the carton figures came from: "carton" when the supplier quoted
    // the export carton, "piece" when only the product itself was known and
    // the carton was estimated from it.
    dimensionSource: text("dimension_source")
      .$type<"carton" | "piece">()
      .notNull()
      .default("carton"),
    // What was entered in piece mode, kept so the form round-trips and the
    // estimate can be recalculated when pieces per carton changes.
    pieceLengthCm: doublePrecision("piece_length_cm").notNull().default(0),
    pieceWidthCm: doublePrecision("piece_width_cm").notNull().default(0),
    pieceHeightCm: doublePrecision("piece_height_cm").notNull().default(0),
    pieceWeightKg: doublePrecision("piece_weight_kg").notNull().default(0),
    packingAllowancePct: doublePrecision("packing_allowance_pct").notNull().default(15),
    // Which vendor sells this. Nullable: products registered before suppliers
    // existed have none, and a product can be catalogued before the card is.
    // Deleting a referenced contact is blocked in the action, mirroring how
    // clients with orders are protected. Composite FK below.
    supplierId: integer("supplier_id"),
    // The factory's own style/model number, read off the packaging or spec
    // card (e.g. "AA012604240"). Printed on order sheets so the supplier can
    // match each line against their catalog; distinct from our internal SKU.
    supplierCode: text("supplier_code").notNull().default(""),
    // A cropped shot of just the product, cut out of the booth photo by the
    // transcription pass. Shown in the order picker and on order sheets;
    // empty until a photo read produced one.
    thumbPath: text("thumb_path").notNull().default(""),
    // The product this one was duplicated from when comparison-shopping the
    // same item across booths. Write-only lineage for now: it lets offers for
    // one item be grouped later without re-entering anything.
    duplicatedFromId: integer("duplicated_from_id").references(
      (): AnyPgColumn => products.id,
      { onDelete: "set null" },
    ),
    active: boolean("active").notNull().default(true),
    // Who entered this product and who last changed it. Nullable because rows
    // written before attribution existed have nobody to credit. Composite
    // user FKs below keep attribution inside the company.
    createdBy: integer("created_by"),
    updatedBy: integer("updated_by"),
    createdAt: text("created_at").notNull().default(utcNow),
    updatedAt: text("updated_at").notNull().default(utcNow),
  },
  (table) => [
    // SKUs are unique within a company, not across the product's customers.
    uniqueIndex("products_company_sku_idx").on(table.companyId, table.sku),
    uniqueIndex("products_company_id_uq").on(table.companyId, table.id),
    index("products_company_category_idx").on(table.companyId, table.categoryId),
    index("products_company_active_idx").on(table.companyId, table.active),
    index("products_supplier_idx").on(table.supplierId),
    // Tenant walls: these references are only satisfiable inside the same
    // company, whatever id a form posts. The database is the last line.
    foreignKey({
      name: "products_company_category_fk",
      columns: [table.companyId, table.categoryId],
      foreignColumns: [categories.companyId, categories.id],
    }),
    foreignKey({
      name: "products_company_supplier_fk",
      columns: [table.companyId, table.supplierId],
      foreignColumns: [contacts.companyId, contacts.id],
    }),
    foreignKey({
      name: "products_company_created_by_fk",
      columns: [table.companyId, table.createdBy],
      foreignColumns: [users.companyId, users.id],
    }),
    foreignKey({
      name: "products_company_updated_by_fk",
      columns: [table.companyId, table.updatedBy],
      foreignColumns: [users.companyId, users.id],
    }),
  ],
);

/**
 * One product can carry several photos (colour variants of the same item),
 * ordered by sortOrder. The first is used as the catalog thumbnail.
 * Scoped through its product — every access path goes product-first.
 */
export const productImages = pgTable(
  "product_images",
  {
    id: serial("id").primaryKey(),
    // Carries the tenant so the composite FK below can prove the product is
    // this company's — a photo can never hang off another tenant's product.
    companyId: integer("company_id")
      .notNull()
      .references(() => companies.id),
    productId: integer("product_id").notNull(),
    path: text("path").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: text("created_at").notNull().default(utcNow),
  },
  (table) => [
    index("product_images_product_idx").on(table.productId),
    foreignKey({
      name: "product_images_company_product_fk",
      columns: [table.companyId, table.productId],
      foreignColumns: [products.companyId, products.id],
    }).onDelete("cascade"),
  ],
);

export const exchangeRates = pgTable(
  "exchange_rates",
  {
    companyId: integer("company_id")
      .notNull()
      .references(() => companies.id),
    currencyCode: text("currency_code").notNull(),
    rateToUsd: numeric("rate_to_usd", { precision: 18, scale: 8, mode: "number" }).notNull(),
    /** "auto" rows are refreshed daily from the provider; "manual" rows were typed. */
    source: text("source", { enum: ["manual", "auto"] })
      .notNull()
      .default("manual"),
    updatedAt: text("updated_at").notNull().default(utcNow),
  },
  (table) => [primaryKey({ columns: [table.companyId, table.currencyCode] })],
);

/**
 * One row per currency per day per company, written whenever the auto-fetch
 * succeeds. The daily record backs "what was the rate when this happened"
 * questions and keeps FX history even after the live table moves on.
 */
export const exchangeRateHistory = pgTable(
  "exchange_rate_history",
  {
    companyId: integer("company_id")
      .notNull()
      .references(() => companies.id),
    /** ISO date, YYYY-MM-DD. */
    day: text("day").notNull(),
    currencyCode: text("currency_code").notNull(),
    rateToUsd: numeric("rate_to_usd", { precision: 18, scale: 8, mode: "number" }).notNull(),
    source: text("source").notNull().default("auto"),
  },
  (table) => [primaryKey({ columns: [table.companyId, table.day, table.currencyCode] })],
);

/**
 * The company's own details, as they appear at the top of a proforma invoice.
 *
 * One row per company, keyed by the company itself. A key/value table would
 * be more flexible and worse to read: every field here is wanted at once, on
 * one document.
 */
export const companyProfile = pgTable("company_profile", {
  companyId: integer("company_id")
    .primaryKey()
    .references(() => companies.id),
  companyName: text("company_name").notNull().default(""),
  addressLines: text("address_lines").notNull().default(""),
  phone: text("phone").notNull().default(""),
  email: text("email").notNull().default(""),
  website: text("website").notNull().default(""),
  taxId: text("tax_id").notNull().default(""),
  // The tenant's own mark, printed on their proforma letterhead — an uploads
  // path like every other tenant file. Empty = text-only letterhead. The
  // platform's logo never appears on a tenant's documents.
  logoPath: text("logo_path").notNull().default(""),
  // Payment details belong on a proforma: it is what the client pays against.
  bankName: text("bank_name").notNull().default(""),
  bankAccountName: text("bank_account_name").notNull().default(""),
  bankAccountNumber: text("bank_account_number").notNull().default(""),
  bankSwift: text("bank_swift").notNull().default(""),
  bankAddress: text("bank_address").notNull().default(""),
  // Defaults printed on every proforma unless the order says otherwise.
  paymentTerms: text("payment_terms").notNull().default(""),
  incoterms: text("incoterms").notNull().default(""),
  validityDays: integer("validity_days").notNull().default(30),
  footerNote: text("footer_note").notNull().default(""),
  updatedAt: text("updated_at").notNull().default(utcNow),
});

/**
 * Beneficiary accounts a proforma can be paid into. Different clients pay
 * through different rails — a Brazilian client wires USD, a local one
 * transfers RMB — so each order picks which of these prints on its invoice.
 * The default row is what a proforma shows when the order never chose.
 */
export const bankAccounts = pgTable(
  "bank_accounts",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id")
      .notNull()
      .references(() => companies.id),
    /** Short name shown in dropdowns, e.g. "Tailong Bank — RMB". */
    label: text("label").notNull(),
    bankName: text("bank_name").notNull().default(""),
    accountName: text("account_name").notNull().default(""),
    accountNumber: text("account_number").notNull().default(""),
    swift: text("swift").notNull().default(""),
    bankAddress: text("bank_address").notNull().default(""),
    /** Which currency this account receives, informational only. */
    currency: text("currency").notNull().default(""),
    isDefault: boolean("is_default").notNull().default(false),
    createdAt: text("created_at").notNull().default(utcNow),
  },
  (table) => [
    index("bank_accounts_company_idx").on(table.companyId),
    uniqueIndex("bank_accounts_company_id_uq").on(table.companyId, table.id),
  ],
);

export const contacts = pgTable(
  "contacts",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id")
      .notNull()
      .references(() => companies.id),
    type: text("type", { enum: ["supplier", "client"] }).notNull(),
    /** English (or latin-script) name — what the team reads day to day. */
    companyName: text("company_name").notNull(),
    /** As printed on the business card; empty when the card is latin-only. */
    companyNameZh: text("company_name_zh").notNull().default(""),
    // The fiscal registration an invoice must carry — RUC in Paraguay, CNPJ
    // in Brazil, 统一社会信用代码 in China. Free text: formats vary by country.
    taxId: text("tax_id").notNull().default(""),
    contactPerson: text("contact_person").notNull().default(""),
    phone: text("phone").notNull().default(""),
    email: text("email").notNull().default(""),
    whatsapp: text("whatsapp").notNull().default(""),
    wechat: text("wechat").notNull().default(""),
    // Where to physically find the vendor again — for market suppliers the
    // booth ("一区2楼C区9街4642店"), its own field because it is the retrieval
    // key on a revisit, not a footnote.
    boothLocation: text("booth_location").notNull().default(""),
    // Bank accounts as read off the card back. Free text, one account per
    // line. Always treated as unverified: finance checks the digits against
    // the stored card photo before any payment goes out.
    bankInfo: text("bank_info").notNull().default(""),
    notes: text("notes").notNull().default(""),
    // Deactivated, never deleted: orders and supplier offers point here, and
    // removing the row would erase who a deal was actually done with. An
    // inactive contact stops appearing in pickers and keeps its history.
    active: boolean("active").notNull().default(true),
    createdAt: text("created_at").notNull().default(utcNow),
  },
  (table) => [
    index("contacts_company_type_idx").on(table.companyId, table.type),
    uniqueIndex("contacts_company_id_uq").on(table.companyId, table.id),
  ],
);

/**
 * Business-card photos attached to a contact. The photos are the system of
 * record: the WeChat QR on a card back can only be scanned from the image,
 * and bank digits are re-checked against it before paying.
 */
export const contactImages = pgTable(
  "contact_images",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id")
      .notNull()
      .references(() => companies.id),
    contactId: integer("contact_id").notNull(),
    // "card": a business-card photo. "qr": the WeChat QR cropped out of one,
    // shown next to the WeChat field so it can be scanned straight away.
    kind: text("kind", { enum: ["card", "qr"] }).notNull().default("card"),
    path: text("path").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: text("created_at").notNull().default(utcNow),
  },
  (table) => [
    index("contact_images_contact_idx").on(table.contactId),
    foreignKey({
      name: "contact_images_company_contact_fk",
      columns: [table.companyId, table.contactId],
      foreignColumns: [contacts.companyId, contacts.id],
    }).onDelete("cascade"),
  ],
);

/**
 * What one supplier will sell one product for.
 *
 * A sourcing company's real asset is this map: the same electric scooter
 * quoted by five factories at five prices. The product is the item — what it
 * is and what the company invoices it at. The offer is the deal — what it
 * costs, from whom, in what quantity, quoted when. Margin is the gap between
 * them, and it differs per supplier, which is exactly the comparison this
 * table exists to make possible.
 *
 * `supplierId` is nullable on purpose: products registered before offers
 * existed carry a known price from an unrecorded source, and saying so beats
 * inventing a supplier. Scoped through its product.
 */
export const productSuppliers = pgTable(
  "product_suppliers",
  {
    id: serial("id").primaryKey(),
    // Denormalised from the product on purpose: quotes join supplier names
    // straight into the catalog, so the row itself must carry the tenant for
    // the composite FKs to hold both ends inside one company.
    companyId: integer("company_id")
      .notNull()
      .references(() => companies.id),
    productId: integer("product_id").notNull(),
    supplierId: integer("supplier_id"),
    price: numeric("price", { precision: 14, scale: 4, mode: "number" }).notNull(),
    currency: text("currency").notNull().default("USD"),
    moq: integer("moq").notNull().default(1),
    // Optional: 0 means nobody recorded it. Never blocks saving an offer —
    // most China lead times are the same 30 days and not worth typing.
    leadTimeDays: integer("lead_time_days").notNull().default(0),
    /**
     * When this price was quoted, ISO date. Factory prices move, so a quote
     * has an age; the catalog ages stale ones visibly rather than letting a
     * two-year-old cost be mistaken for today's.
     */
    quotedOn: text("quoted_on").notNull(),
    note: text("note").notNull().default(""),
    active: boolean("active").notNull().default(true),
    createdBy: integer("created_by"),
    createdAt: text("created_at").notNull().default(utcNow),
    updatedAt: text("updated_at").notNull().default(utcNow),
  },
  (table) => [
    index("product_suppliers_product_idx").on(table.productId),
    index("product_suppliers_supplier_idx").on(table.supplierId),
    foreignKey({
      name: "product_suppliers_company_product_fk",
      columns: [table.companyId, table.productId],
      foreignColumns: [products.companyId, products.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "product_suppliers_company_supplier_fk",
      columns: [table.companyId, table.supplierId],
      foreignColumns: [contacts.companyId, contacts.id],
    }),
    foreignKey({
      name: "product_suppliers_company_created_by_fk",
      columns: [table.companyId, table.createdBy],
      foreignColumns: [users.companyId, users.id],
    }),
  ],
);

export const orders = pgTable(
  "orders",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id")
      .notNull()
      .references(() => companies.id),
    orderNumber: text("order_number").notNull(),
    // Composite FK below proves the client is this company's contact.
    clientId: integer("client_id").notNull(),
    status: text("status", {
      enum: ["draft", "confirmed", "shipped", "cancelled"],
    })
      .notNull()
      .default("draft"),
    // Quote currency (what the client is billed in) and the secondary currency
    // shown alongside it, so RMB cost and USD quote are visible together.
    displayCurrency: text("display_currency").notNull().default("USD"),
    secondaryCurrency: text("secondary_currency").notNull().default("CNY"),
    // The company's margin, charged on top of the goods subtotal.
    commissionPct: numeric("commission_pct", { precision: 7, scale: 3, mode: "number" })
      .notNull()
      .default(0),
    // Rates in force when the order was saved, so a stored quote does not move
    // when the rate table is later edited. JSON: {"CNY":0.14,"USD":1}
    ratesSnapshot: text("rates_snapshot").notNull().default("{}"),
    // Which bank account the proforma shows. Null means "the default one",
    // so orders that never chose keep following whatever Settings says.
    // Composite FK below; deleteBankAccount nulls references by hand first
    // (a composite SET NULL would null company_id too, so no FK action).
    bankAccountId: integer("bank_account_id"),
    notes: text("notes").notNull().default(""),
    // Optimistic concurrency: every mutation sends the version it read and
    // the UPDATE carries WHERE version = that — two people editing at once
    // produce a visible conflict, never silent last-write-wins.
    version: integer("version").notNull().default(1),
    // The parties as they stood when the order was CONFIRMED — client,
    // seller and bank block, JSON (see lib/parties-snapshot.ts). Confirmed
    // and shipped documents render from this, so editing a contact, the
    // company profile or a bank account can never rewrite an agreed
    // document. NULL on drafts and never-confirmed orders (they render
    // live); reopening to draft clears it, re-confirming re-freezes.
    partiesSnapshot: text("parties_snapshot"),
    // Composite user FKs below prove attribution stays inside the company.
    createdBy: integer("created_by").notNull(),
    updatedBy: integer("updated_by"),
    createdAt: text("created_at").notNull().default(utcNow),
    updatedAt: text("updated_at").notNull().default(utcNow),
  },
  (table) => [
    uniqueIndex("orders_company_number_idx").on(table.companyId, table.orderNumber),
    uniqueIndex("orders_company_id_uq").on(table.companyId, table.id),
    index("orders_company_status_idx").on(table.companyId, table.status),
    foreignKey({
      name: "orders_company_client_fk",
      columns: [table.companyId, table.clientId],
      foreignColumns: [contacts.companyId, contacts.id],
    }),
    foreignKey({
      name: "orders_company_bank_fk",
      columns: [table.companyId, table.bankAccountId],
      foreignColumns: [bankAccounts.companyId, bankAccounts.id],
    }),
    foreignKey({
      name: "orders_company_created_by_fk",
      columns: [table.companyId, table.createdBy],
      foreignColumns: [users.companyId, users.id],
    }),
    foreignKey({
      name: "orders_company_updated_by_fk",
      columns: [table.companyId, table.updatedBy],
      foreignColumns: [users.companyId, users.id],
    }),
  ],
);

export const orderItems = pgTable(
  "order_items",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id")
      .notNull()
      .references(() => companies.id),
    orderId: integer("order_id").notNull(),
    productId: integer("product_id").notNull(),
    quantity: integer("quantity").notNull(),
    unitPriceSnapshot: numeric("unit_price_snapshot", {
      precision: 14,
      scale: 4,
      mode: "number",
    }).notNull(),
    // The invoiced price per unit, frozen with the rest of the line. 0 on
    // rows saved before selling prices existed, which read as "at cost".
    sellPriceSnapshot: numeric("sell_price_snapshot", {
      precision: 14,
      scale: 4,
      mode: "number",
    })
      .notNull()
      .default(0),
    currencySnapshot: text("currency_snapshot").notNull(),
    moqSnapshot: integer("moq_snapshot").notNull(),
    lineTotal: numeric("line_total", { precision: 14, scale: 2, mode: "number" }).notNull(),
    lineCbm: doublePrecision("line_cbm").notNull(),
    lineWeightKg: doublePrecision("line_weight_kg").notNull(),
    // Cartons this line ships as, frozen at save time. Defaults to 0 for rows
    // written before this column existed; readers fall back to the product's
    // current pack size for those.
    cartonsSnapshot: integer("cartons_snapshot").notNull().default(0),
    // --- the line's own copy of the catalog facts it was quoted with ---
    // Identity for documents (a renamed product must not rewrite an old
    // proforma) and the carton inputs for recomputing logistics on a
    // quantity edit without ever consulting the live product. "" / 0 on
    // rows from before these columns; readers fall back to the product.
    skuSnapshot: text("sku_snapshot").notNull().default(""),
    nameEnSnapshot: text("name_en_snapshot").notNull().default(""),
    nameZhSnapshot: text("name_zh_snapshot").notNull().default(""),
    supplierCodeSnapshot: text("supplier_code_snapshot").notNull().default(""),
    qtyPerBoxSnapshot: integer("qty_per_box_snapshot").notNull().default(0),
    cartonCbmSnapshot: doublePrecision("carton_cbm_snapshot").notNull().default(0),
    cartonWeightSnapshot: doublePrecision("carton_weight_snapshot").notNull().default(0),
    // The currency the SELL price was quoted in, frozen at line creation.
    // The intentional catalog refresh may change the cost currency; it must
    // never relabel what the client was quoted.
    sellCurrencySnapshot: text("sell_currency_snapshot").notNull().default(""),
  },
  (table) => [
    index("order_items_order_idx").on(table.orderId),
    foreignKey({
      name: "order_items_company_order_fk",
      columns: [table.companyId, table.orderId],
      foreignColumns: [orders.companyId, orders.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "order_items_company_product_fk",
      columns: [table.companyId, table.productId],
      foreignColumns: [products.companyId, products.id],
    }),
  ],
);

/**
 * Files attached to an order — the supplier's invoice above all, but packing
 * lists, bills of lading and inspection reports all end up in the same file
 * in this business. Stored in the uploads volume next to product photos.
 */
export const orderDocuments = pgTable(
  "order_documents",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id")
      .notNull()
      .references(() => companies.id),
    orderId: integer("order_id").notNull(),
    kind: text("kind", {
      enum: ["supplier_invoice", "packing_list", "bill_of_lading", "inspection", "other"],
    })
      .notNull()
      .default("other"),
    /** Path under /uploads, uuid-named like product photos. */
    path: text("path").notNull(),
    /** The name the file arrived with, used when downloading it back. */
    originalName: text("original_name").notNull(),
    sizeBytes: integer("size_bytes").notNull().default(0),
    uploadedBy: integer("uploaded_by"),
    createdAt: text("created_at").notNull().default(utcNow),
  },
  (table) => [
    index("order_documents_order_idx").on(table.orderId),
    foreignKey({
      name: "order_documents_company_order_fk",
      columns: [table.companyId, table.orderId],
      foreignColumns: [orders.companyId, orders.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "order_documents_company_uploaded_by_fk",
      columns: [table.companyId, table.uploadedBy],
      foreignColumns: [users.companyId, users.id],
    }),
  ],
);

/**
 * Money moving on an order, in both directions: what the client pays in and
 * what goes out to the supplier. Amounts keep their own currency and are
 * converted for the summary the same way order totals are.
 */
export const orderPayments = pgTable(
  "order_payments",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id")
      .notNull()
      .references(() => companies.id),
    orderId: integer("order_id").notNull(),
    direction: text("direction", { enum: ["in", "out"] }).notNull(),
    amount: numeric("amount", { precision: 14, scale: 2, mode: "number" }).notNull(),
    currency: text("currency").notNull(),
    /** ISO date the money moved, not the date the row was typed in. */
    paidOn: text("paid_on").notNull(),
    /**
     * The rate table as it stood when this payment was recorded — the same
     * freezing orders do. What a client's dollars were worth on the day they
     * arrived must not drift when rates move later. Empty on legacy rows,
     * which fall back to the order's own snapshot.
     */
    ratesSnapshot: text("rates_snapshot").notNull().default("{}"),
    /** Which bank account the money touched, e.g. "USD" or "RMB". */
    account: text("account").notNull().default(""),
    /**
     * The payment slip: a photo or PDF of the transfer receipt, stored in the
     * uploads volume under a session-gated name. Empty when none was attached.
     */
    receiptPath: text("receipt_path").notNull().default(""),
    receiptName: text("receipt_name").notNull().default(""),
    note: text("note").notNull().default(""),
    createdBy: integer("created_by"),
    createdAt: text("created_at").notNull().default(utcNow),
  },
  (table) => [
    index("order_payments_order_idx").on(table.orderId),
    foreignKey({
      name: "order_payments_company_order_fk",
      columns: [table.companyId, table.orderId],
      foreignColumns: [orders.companyId, orders.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "order_payments_company_created_by_fk",
      columns: [table.companyId, table.createdBy],
      foreignColumns: [users.companyId, users.id],
    }),
  ],
);

/** Everything an order costs beyond the goods themselves. */
export const orderExpenses = pgTable(
  "order_expenses",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id")
      .notNull()
      .references(() => companies.id),
    orderId: integer("order_id").notNull(),
    category: text("category", {
      enum: ["freight", "customs", "inspection", "local_transport", "bank_fees", "other"],
    })
      .notNull()
      .default("other"),
    amount: numeric("amount", { precision: 14, scale: 2, mode: "number" }).notNull(),
    currency: text("currency").notNull(),
    spentOn: text("spent_on").notNull(),
    /** Same freezing as payments; see order_payments.rates_snapshot. */
    ratesSnapshot: text("rates_snapshot").notNull().default("{}"),
    /** Receipt for the expense, same shape as order_payments.receipt_path. */
    receiptPath: text("receipt_path").notNull().default(""),
    receiptName: text("receipt_name").notNull().default(""),
    note: text("note").notNull().default(""),
    createdBy: integer("created_by"),
    createdAt: text("created_at").notNull().default(utcNow),
  },
  (table) => [
    index("order_expenses_order_idx").on(table.orderId),
    foreignKey({
      name: "order_expenses_company_order_fk",
      columns: [table.companyId, table.orderId],
      foreignColumns: [orders.companyId, orders.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "order_expenses_company_created_by_fk",
      columns: [table.companyId, table.createdBy],
      foreignColumns: [users.companyId, users.id],
    }),
  ],
);

/**
 * The order's history: who did what to it, and when.
 *
 * Events store structured payloads rather than prose, so the changelog can be
 * rendered in whichever language the reader is using. Display values (names,
 * codes, amounts) are captured at write time — a later rename or deletion
 * must not rewrite what the log says happened. Scoped through its order.
 */
export const orderEvents = pgTable(
  "order_events",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id")
      .notNull()
      .references(() => companies.id),
    orderId: integer("order_id").notNull(),
    userId: integer("user_id"),
    kind: text("kind", {
      enum: [
        "created",
        "edited",
        "refreshed",
        "status",
        "payment_added",
        "payment_removed",
        "expense_added",
        "expense_removed",
        "document_added",
        "document_removed",
      ],
    }).notNull(),
    /** JSON payload; shape depends on kind. See src/lib/order-log.ts. */
    payload: text("payload").notNull().default("{}"),
    createdAt: text("created_at").notNull().default(utcNow),
  },
  (table) => [
    index("order_events_order_idx").on(table.orderId),
    foreignKey({
      name: "order_events_company_order_fk",
      columns: [table.companyId, table.orderId],
      foreignColumns: [orders.companyId, orders.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "order_events_company_user_fk",
      columns: [table.companyId, table.userId],
      foreignColumns: [users.companyId, users.id],
    }),
  ],
);

/**
 * The products/contacts counterpart of order_events: who created, edited or
 * deleted what, and which fields an edit touched. entityId is deliberately
 * not a foreign key — the log's whole job is to keep saying "deleted
 * supplier so-and-so" after the row it points at is gone. Carries its own
 * companyId for the same reason: with the row gone there is no parent left
 * to scope through.
 */
export const entityEvents = pgTable(
  "entity_events",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id")
      .notNull()
      .references(() => companies.id),
    entity: text("entity", { enum: ["product", "contact"] }).notNull(),
    entityId: integer("entity_id").notNull(),
    // Composite FK below: events can only credit this company's user.
    userId: integer("user_id"),
    kind: text("kind", { enum: ["created", "edited", "deleted"] }).notNull(),
    /** JSON payload; see src/lib/entity-log.ts. */
    payload: text("payload").notNull().default("{}"),
    createdAt: text("created_at").notNull().default(utcNow),
  },
  (table) => [
    index("entity_events_company_idx").on(table.companyId),
    index("entity_events_entity_idx").on(table.entity, table.entityId),
    foreignKey({
      name: "entity_events_company_user_fk",
      columns: [table.companyId, table.userId],
      foreignColumns: [users.companyId, users.id],
    }),
  ],
);

/**
 * A product photographed at a booth before it was a catalog entry.
 *
 * The agent works where the network does not: a hall at the Canton Fair, a
 * lane in Yiwu, Tailscale dropping between towers. Saving there writes the
 * capture to the phone, and the phone ships it here as soon as anything
 * resembling a connection appears. This table is where a capture stops being
 * one device's problem — once a row exists the photos are on the server and a
 * lost, wiped or stolen phone costs nothing.
 *
 * A draft is deliberately not a product. `products` requires a name, a
 * category, an MOQ and a pack size (see src/lib/validators.ts), and a capture
 * that is three photos and nothing else has none of them. Drafts are held
 * here, read by the AI when there is a connection to read them with, and
 * promoted into the catalog by a human who has checked the price.
 */
/**
 * One row per user per day they touched the app — the platform's pulse.
 *
 * Written fire-and-forget from the session path with an in-memory throttle,
 * so tracking costs at most one small upsert a minute per user and can never
 * fail a request. Active seconds are the sum of gaps between consecutive
 * touches short enough to be one sitting; days active and last-seen fall out
 * of the same rows. Counts and timestamps only — deliberately nothing about
 * what the money columns hold.
 */
export const userActivityDays = pgTable(
  "user_activity_days",
  {
    companyId: integer("company_id")
      .notNull()
      .references(() => companies.id),
    userId: integer("user_id").notNull(),
    /** UTC day, YYYY-MM-DD. */
    day: text("day").notNull(),
    firstSeenAt: text("first_seen_at").notNull(),
    lastSeenAt: text("last_seen_at").notNull(),
    activeSeconds: integer("active_seconds").notNull().default(0),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.day] }),
    index("user_activity_company_idx").on(table.companyId),
    // Same-company proof, like entity_events: activity can only credit a
    // user of the company it is filed under.
    foreignKey({
      columns: [table.companyId, table.userId],
      foreignColumns: [users.companyId, users.id],
      name: "user_activity_company_user_fk",
    }),
  ],
);

/**
 * One row per AI scan — the spend ledger for photo transcription. Which
 * company, which flow (product/card), which provider and model, how many
 * photos, and the token bill the provider reported. The platform panel
 * aggregates it per tenant; the testing phase's pricing question is
 * unanswerable without it. Tenant-walled like every business table, with
 * the same platform read-through the panel's other metrics use.
 */
export const aiUsage = pgTable(
  "ai_usage",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    userId: integer("user_id"),
    /** "product" or "card" — the two transcription flows. */
    kind: text("kind").notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    images: integer("images").notNull(),
    inputTokens: integer("input_tokens").notNull(),
    outputTokens: integer("output_tokens").notNull(),
    createdAt: text("created_at").notNull().default(utcNow),
  },
  (table) => [index("ai_usage_company_idx").on(table.companyId, table.createdAt)],
);

/**
 * One row per closed accounting period — the accountant pack's
 * tamper-evidence anchor. pack_sha256 stores the pack's DETERMINISTIC data
 * digest (accountant-pack.ts closeDigest — sorted path:sha256 of ledgers
 * and files, no timestamps), so regenerating an untouched period matches
 * and an edited one visibly does not. Closing never blocks edits.
 */
export const periodCloses = pgTable(
  "period_closes",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id")
      .notNull()
      .references(() => companies.id),
    /** 'YYYY-MM', or 'YYYY-MM~YYYY-MM' when a multi-month range was closed. */
    period: text("period").notNull(),
    closedBy: integer("closed_by"),
    closedAt: text("closed_at").notNull(),
    packSha256: text("pack_sha256").notNull(),
  },
  (table) => [uniqueIndex("period_closes_company_period_uq").on(table.companyId, table.period)],
);

export const captureDrafts = pgTable(
  "capture_drafts",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id")
      .notNull()
      .references(() => companies.id),
    /**
     * The id the phone minted at capture time. Unique, which is the whole
     * mechanism: a delivery that succeeded but whose response never made it
     * back gets retried, and the retry lands on this constraint instead of
     * creating a second copy of the same booth. Globally unique is fine —
     * the phone mints UUIDs.
     */
    clientId: text("client_id").notNull().unique(),
    // Composite FK below: a draft can only credit this company's user.
    userId: integer("user_id"),
    /** What the capture will become: a catalog product, or a contact. */
    kind: text("kind", { enum: ["product", "contact"] })
      .notNull()
      .default("product"),
    status: text("status", {
      enum: [
        /** Arrived; the AI has not read the photos yet. */
        "pending",
        /** The AI read them; suggested fields are in `transcript`. */
        "read",
        /** Promoted into the catalog — `productId` says what it became. */
        "imported",
        /** Thrown away by hand. Kept so the photos can still be recovered. */
        "discarded",
      ],
    })
      .notNull()
      .default("pending"),
    /**
     * Whatever the agent had typed when they hit save, as posted by the form.
     * JSON of string values, the same names the product form uses, so a draft
     * can be poured straight back into that form for proofreading.
     */
    fields: text("fields").notNull().default("{}"),
    /** The AI's reading of the photos: JSON of TranscribedFields, or empty. */
    transcript: text("transcript").notNull().default("{}"),
    /** What the AI wanted to flag about the reading, shown with the draft. */
    transcriptNotes: text("transcript_notes").notNull().default(""),
    /** Why the last AI read failed, when one did. Empty otherwise. */
    transcriptError: text("transcript_error").notNull().default(""),
    /**
     * The product this draft became, once someone promoted it. Composite FK
     * below; deleteProduct clears these references by hand first (a
     * composite SET NULL would null company_id too, so no FK action).
     */
    productId: integer("product_id"),
    /** When the photo was taken, per the phone — not when it arrived here. */
    capturedAt: text("captured_at").notNull(),
    createdAt: text("created_at").notNull().default(utcNow),
    updatedAt: text("updated_at").notNull().default(utcNow),
  },
  (table) => [
    index("capture_drafts_company_status_idx").on(table.companyId, table.status),
    uniqueIndex("capture_drafts_company_id_uq").on(table.companyId, table.id),
    foreignKey({
      name: "capture_drafts_company_user_fk",
      columns: [table.companyId, table.userId],
      foreignColumns: [users.companyId, users.id],
    }),
    foreignKey({
      name: "capture_drafts_company_product_fk",
      columns: [table.companyId, table.productId],
      foreignColumns: [products.companyId, products.id],
    }),
  ],
);

/** The photos of a capture, in the order they were taken. */
export const captureDraftImages = pgTable(
  "capture_draft_images",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id")
      .notNull()
      .references(() => companies.id),
    draftId: integer("draft_id").notNull(),
    // Which slot the photo belongs to. Products only have "image"; contacts
    // keep card photos and the cropped WeChat QR apart, mirroring
    // contact_images.kind, so promoting a draft can tell them apart too.
    role: text("role", { enum: ["image", "card", "qr"] })
      .notNull()
      .default("image"),
    path: text("path").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: text("created_at").notNull().default(utcNow),
  },
  (table) => [
    index("capture_draft_images_draft_idx").on(table.draftId),
    foreignKey({
      name: "capture_draft_images_company_draft_fk",
      columns: [table.companyId, table.draftId],
      foreignColumns: [captureDrafts.companyId, captureDrafts.id],
    }).onDelete("cascade"),
  ],
);

/**
 * Team invite links. An admin mints a link, shares it over WeChat/WhatsApp,
 * and whoever opens it creates their own account in the admin's company with
 * the invited role — no email delivery needed. Auth-bootstrap table like
 * users and companies: the accept page reads it before any session exists,
 * so it stays OUTSIDE row-level security and is company-scoped in the app
 * layer instead.
 *
 * Only the token's sha256 lands here — a database leak must not hand out
 * live invite links. Links are single-use and expire.
 */
export const invites = pgTable(
  "invites",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id")
      .notNull()
      .references(() => companies.id),
    tokenHash: text("token_hash").notNull().unique(),
    role: text("role").$type<"admin" | "collaborator">().notNull().default("collaborator"),
    createdBy: integer("created_by").notNull(),
    createdAt: text("created_at").notNull().default(utcNow),
    expiresAt: text("expires_at").notNull(),
    usedAt: text("used_at"),
    usedByUserId: integer("used_by_user_id"),
  },
  (table) => [
    index("invites_company_idx").on(table.companyId),
    foreignKey({
      name: "invites_company_created_by_fk",
      columns: [table.companyId, table.createdBy],
      foreignColumns: [users.companyId, users.id],
    }),
    foreignKey({
      name: "invites_company_used_by_fk",
      columns: [table.companyId, table.usedByUserId],
      foreignColumns: [users.companyId, users.id],
    }),
  ],
);

/**
 * Single-use account tokens: password resets and email verification. Like
 * invites, an auth-bootstrap table — reset links are opened by people with
 * no session — so it sits outside row-level security; rows are reachable
 * only through their token's sha256 anyway.
 */
export const authTokens = pgTable(
  "auth_tokens",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
    kind: text("kind").$type<"reset" | "verify">().notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    createdAt: text("created_at").notNull().default(utcNow),
    expiresAt: text("expires_at").notNull(),
    usedAt: text("used_at"),
  },
  (table) => [index("auth_tokens_user_idx").on(table.userId, table.kind)],
);

/**
 * Pre-launch waiting list, filled from the public landing page. Platform
 * data like "companies", not tenant data — rows exist before any company
 * does, so no company_id and no RLS. Uniqueness on lower(email) lives in
 * the migration (an expression index Drizzle's builder can't express);
 * the action treats a conflict as "already on the list".
 */
export const waitlistSignups = pgTable("waitlist_signups", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  companyName: text("company_name").notNull(),
  email: text("email").notNull(),
  preferredContact: text("preferred_contact"),
  locale: text("locale").notNull(),
  createdAt: text("created_at").notNull().default(utcNow),
});

/**
 * What the platform operator did, to whom. Platform data, no RLS: the
 * operator acts across tenants by definition, and the panel reads it back
 * under platform scope. Every cross-tenant write from the panel and every
 * reset link minted there leaves a row here — the panel is a support tool
 * with reach into every tenant, and support access nobody can see
 * afterwards is not something a company should have to take on trust.
 */
export const platformEvents = pgTable(
  "platform_events",
  {
    id: serial("id").primaryKey(),
    operatorUserId: integer("operator_user_id")
      .notNull()
      .references(() => users.id),
    action: text("action").notNull(),
    targetCompanyId: integer("target_company_id"),
    targetUserId: integer("target_user_id"),
    detail: text("detail").notNull().default(""),
    createdAt: text("created_at").notNull().default(utcNow),
  },
  (table) => [index("platform_events_created_idx").on(table.createdAt)],
);
