/**
 * Mainland China's provincial divisions, as a supplier's address and the
 * export declaration's 境内货源地 name them. Stored by the Chinese name; the
 * English is for people who do not read it. Standard (GB/T 2260) order.
 */
export const PROVINCES = [
  { zh: "北京市", en: "Beijing" },
  { zh: "天津市", en: "Tianjin" },
  { zh: "河北省", en: "Hebei" },
  { zh: "山西省", en: "Shanxi" },
  { zh: "内蒙古自治区", en: "Inner Mongolia" },
  { zh: "辽宁省", en: "Liaoning" },
  { zh: "吉林省", en: "Jilin" },
  { zh: "黑龙江省", en: "Heilongjiang" },
  { zh: "上海市", en: "Shanghai" },
  { zh: "江苏省", en: "Jiangsu" },
  { zh: "浙江省", en: "Zhejiang" },
  { zh: "安徽省", en: "Anhui" },
  { zh: "福建省", en: "Fujian" },
  { zh: "江西省", en: "Jiangxi" },
  { zh: "山东省", en: "Shandong" },
  { zh: "河南省", en: "Henan" },
  { zh: "湖北省", en: "Hubei" },
  { zh: "湖南省", en: "Hunan" },
  { zh: "广东省", en: "Guangdong" },
  { zh: "广西壮族自治区", en: "Guangxi" },
  { zh: "海南省", en: "Hainan" },
  { zh: "重庆市", en: "Chongqing" },
  { zh: "四川省", en: "Sichuan" },
  { zh: "贵州省", en: "Guizhou" },
  { zh: "云南省", en: "Yunnan" },
  { zh: "西藏自治区", en: "Tibet" },
  { zh: "陕西省", en: "Shaanxi" },
  { zh: "甘肃省", en: "Gansu" },
  { zh: "青海省", en: "Qinghai" },
  { zh: "宁夏回族自治区", en: "Ningxia" },
  { zh: "新疆维吾尔自治区", en: "Xinjiang" },
] as const;

export const PROVINCE_NAMES: readonly string[] = PROVINCES.map((p) => p.zh);

/**
 * A province as someone (or a card reading) wrote it — "浙江", "浙江省",
 * "Zhejiang", "zhejiang province" — as its stored Chinese name; "" when it
 * is not one. Shaanxi and Shanxi are told apart by their exact spelling.
 */
export function normalizeProvince(input: string): string {
  const value = input.trim();
  if (!value) return "";
  const latin = value.toLowerCase().replace(/\s+province$/, "").replace(/\s+/g, " ");
  for (const p of PROVINCES) {
    if (value === p.zh || latin === p.en.toLowerCase()) return p.zh;
  }
  // The short Chinese form: 浙江, 内蒙古, 广西 (two or three characters before the suffix).
  for (const p of PROVINCES) {
    const short = p.zh.replace(/(省|市|壮族自治区|回族自治区|维吾尔自治区|自治区)$/, "");
    if (value === short || (value.startsWith(short) && value.length <= p.zh.length)) return p.zh;
  }
  return "";
}

/**
 * The 境内货源地 a declaration prints for a supplier: province and city,
 * "浙江省义乌市". The city alone when the province is unknown; "" when neither.
 */
export function goodsOriginOf(province: string, city: string): string {
  const c = city.trim();
  const p = province.trim();
  // A municipality is its own city: 上海市 + 浦东新区, not 上海市上海市.
  if (p && c && (c === p || c.startsWith(p))) return c;
  return `${p}${c}`;
}
