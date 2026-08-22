import { db, one, pool } from "./index";
import { runWithTenant } from "./tenant-context";
import { categories, companies } from "./schema";
import { eq } from "drizzle-orm";

/**
 * One-time helper: adds a starter set of market categories, skipping any that
 * already exist. Run by hand, never on boot — a category deleted on purpose
 * must stay deleted, which is exactly what an automatic seed would undo.
 *
 *   docker compose exec mbarete-app npm run db:add-categories
 *
 * Matching is case-insensitive on either language, so a category you have
 * already named differently in Chinese is left alone rather than duplicated.
 */

/** Roughly how the Yiwu market itself is laid out. Trim to taste. */
const STARTER_CATEGORIES: { nameEn: string; nameZh: string }[] = [
  { nameEn: "Stationery", nameZh: "文具" },
  { nameEn: "Toys", nameZh: "玩具" },
  { nameEn: "Jewelry & Accessories", nameZh: "饰品" },
  { nameEn: "Cosmetics & Beauty Tools", nameZh: "美妆用品" },
  { nameEn: "Skincare", nameZh: "护肤品" },
  { nameEn: "Kitchenware", nameZh: "厨房用品" },
  { nameEn: "Home Goods", nameZh: "家居用品" },
  { nameEn: "Hardware & Tools", nameZh: "五金工具" },
  { nameEn: "Electronics", nameZh: "电子产品" },
  { nameEn: "Lighting", nameZh: "灯具" },
  { nameEn: "Watches & Eyewear", nameZh: "钟表眼镜" },
  { nameEn: "Bags & Luggage", nameZh: "箱包" },
  { nameEn: "Umbrellas & Rainwear", nameZh: "雨具" },
  { nameEn: "Socks & Hosiery", nameZh: "袜子" },
  { nameEn: "Apparel", nameZh: "服装" },
  { nameEn: "Shoes", nameZh: "鞋类" },
  { nameEn: "Sports & Outdoor", nameZh: "运动户外" },
  { nameEn: "Pet Supplies", nameZh: "宠物用品" },
  { nameEn: "Auto Accessories", nameZh: "汽车用品" },
  { nameEn: "Party & Festive", nameZh: "节庆用品" },
  { nameEn: "Artificial Flowers", nameZh: "仿真花" },
  { nameEn: "Packaging", nameZh: "包装材料" },
];

export async function addStarterCategories(list = STARTER_CATEGORIES) {
  // Run by hand on a self-hosted install: there is exactly one company.
  const company = await db.select().from(companies).limit(1).then(one);
  if (!company) throw new Error("no company yet — start the app once first");
  // Hand-run script, no signed-in request: adopt the install's one tenant so
  // the RLS-guarded categories table is reachable.
  return runWithTenant(company.id, () => addForCompany(company.id, list));
}

async function addForCompany(companyId: number, list: typeof STARTER_CATEGORIES) {
  const existing = await db
    .select()
    .from(categories)
    .where(eq(categories.companyId, companyId));
  const haveEn = new Set(existing.map((c) => c.nameEn.trim().toLowerCase()));
  const haveZh = new Set(existing.map((c) => c.nameZh.trim()));

  const added: string[] = [];
  const skipped: string[] = [];
  for (const candidate of list) {
    if (haveEn.has(candidate.nameEn.toLowerCase()) || haveZh.has(candidate.nameZh)) {
      skipped.push(candidate.nameEn);
      continue;
    }
    await db.insert(categories).values({ ...candidate, companyId });
    // Guards against duplicates inside the list itself, too.
    haveEn.add(candidate.nameEn.toLowerCase());
    haveZh.add(candidate.nameZh);
    added.push(`${candidate.nameEn} / ${candidate.nameZh}`);
  }
  return { added, skipped };
}

if (require.main === module) {
  addStarterCategories()
    .then(async ({ added, skipped }) => {
      for (const name of added) console.log(`  + ${name}`);
      console.log(
        `[categories] added ${added.length}, already present ${skipped.length}` +
          (skipped.length ? `: ${skipped.join(", ")}` : ""),
      );
      console.log("Manage them any time under Catalog -> Manage Categories.");
      await pool.end();
    })
    .catch(async (err) => {
      console.error("[categories] failed:", err);
      await pool.end();
      process.exit(1);
    });
}
