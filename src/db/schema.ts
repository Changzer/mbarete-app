import { sql } from "drizzle-orm";
import {
  sqliteTable,
  text,
  integer,
  real,
  index,
} from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: text("name").notNull(),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(current_timestamp)`),
});

export const categories = sqliteTable("categories", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  nameEn: text("name_en").notNull(),
  nameZh: text("name_zh").notNull(),
});

export const products = sqliteTable(
  "products",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sku: text("sku").notNull().unique(),
    nameEn: text("name_en").notNull(),
    nameZh: text("name_zh").notNull(),
    categoryId: integer("category_id")
      .notNull()
      .references(() => categories.id),
    descriptionEn: text("description_en").notNull().default(""),
    descriptionZh: text("description_zh").notNull().default(""),
    price: real("price").notNull(),
    currency: text("currency").notNull().default("USD"),
    moq: integer("moq").notNull().default(1),
    qtyPerBox: integer("qty_per_box").notNull().default(1),
    lengthCm: real("length_cm").notNull().default(0),
    widthCm: real("width_cm").notNull().default(0),
    heightCm: real("height_cm").notNull().default(0),
    weightKg: real("weight_kg").notNull().default(0),
    cbm: real("cbm").notNull().default(0),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(current_timestamp)`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(current_timestamp)`),
  },
  (table) => [
    index("products_category_idx").on(table.categoryId),
    index("products_active_idx").on(table.active),
  ],
);

/**
 * One product can carry several photos (colour variants of the same item),
 * ordered by sortOrder. The first is used as the catalog thumbnail.
 */
export const productImages = sqliteTable(
  "product_images",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    productId: integer("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    path: text("path").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(current_timestamp)`),
  },
  (table) => [index("product_images_product_idx").on(table.productId)],
);

export const exchangeRates = sqliteTable("exchange_rates", {
  currencyCode: text("currency_code").primaryKey(),
  rateToUsd: real("rate_to_usd").notNull(),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(current_timestamp)`),
});

export const contacts = sqliteTable(
  "contacts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    type: text("type", { enum: ["supplier", "client"] }).notNull(),
    companyName: text("company_name").notNull(),
    contactPerson: text("contact_person").notNull().default(""),
    phone: text("phone").notNull().default(""),
    email: text("email").notNull().default(""),
    whatsapp: text("whatsapp").notNull().default(""),
    wechat: text("wechat").notNull().default(""),
    notes: text("notes").notNull().default(""),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(current_timestamp)`),
  },
  (table) => [index("contacts_type_idx").on(table.type)],
);

export const orders = sqliteTable(
  "orders",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    orderNumber: text("order_number").notNull().unique(),
    clientId: integer("client_id")
      .notNull()
      .references(() => contacts.id),
    status: text("status", {
      enum: ["draft", "confirmed", "shipped", "cancelled"],
    })
      .notNull()
      .default("draft"),
    // Quote currency (what the client is billed in) and the secondary currency
    // shown alongside it, so RMB cost and USD quote are visible together.
    displayCurrency: text("display_currency").notNull().default("USD"),
    secondaryCurrency: text("secondary_currency").notNull().default("CNY"),
    // Mbarete's margin, charged on top of the goods subtotal.
    commissionPct: real("commission_pct").notNull().default(0),
    // Rates in force when the order was saved, so a stored quote does not move
    // when the rate table is later edited. JSON: {"CNY":0.14,"USD":1}
    ratesSnapshot: text("rates_snapshot").notNull().default("{}"),
    notes: text("notes").notNull().default(""),
    createdBy: integer("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(current_timestamp)`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(current_timestamp)`),
  },
  (table) => [index("orders_status_idx").on(table.status)],
);

export const orderItems = sqliteTable(
  "order_items",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    orderId: integer("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    productId: integer("product_id")
      .notNull()
      .references(() => products.id),
    quantity: integer("quantity").notNull(),
    unitPriceSnapshot: real("unit_price_snapshot").notNull(),
    currencySnapshot: text("currency_snapshot").notNull(),
    moqSnapshot: integer("moq_snapshot").notNull(),
    lineTotal: real("line_total").notNull(),
    lineCbm: real("line_cbm").notNull(),
    lineWeightKg: real("line_weight_kg").notNull(),
  },
  (table) => [index("order_items_order_idx").on(table.orderId)],
);
