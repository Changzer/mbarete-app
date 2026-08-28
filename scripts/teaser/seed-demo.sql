-- Demo data used by the teaser video (videos/mbarete-teaser).
-- Run against a freshly seeded self-hosted install (company id 1, user id 1):
--   psql "$DATABASE_URL" -f scripts/teaser/seed-demo.sql
-- Product photos must exist under uploads/c1/ with the filenames below
-- (they are kept in videos/mbarete-teaser/assets/, not in uploads/, because
-- uploads/ is gitignored).

INSERT INTO contacts (company_id, type, company_name, company_name_zh, contact_person, wechat, booth_location, created_at)
VALUES
 (1,'supplier','Yiwu Hongtai Housewares','义乌宏泰家居','Chen Wei','hongtai-chen','一区2楼C区9街4642店','2026-08-20T09:12:00.000Z'),
 (1,'supplier','Jinhua Bright Electronics','金华亮点电子','Li Na','brightli88','二区3楼D区12街8103店','2026-08-21T10:03:00.000Z'),
 (1,'supplier','Yiwu Meili Lighting','义乌美丽灯具','Zhao Min','meili-zhao','三区1楼A区2街1207店','2026-08-22T14:40:00.000Z'),
 (1,'supplier','Yiwu Qihui Stationery','义乌启慧文具','Wang Fang','qihui-wf','二区4楼B区6街5218店','2026-08-23T09:05:00.000Z'),
 (1,'supplier','Zhejiang Yueguang Beauty','浙江越光美妆','Xu Lei','yueguang-xl','四区2楼E区7街3310店','2026-08-23T13:30:00.000Z');

INSERT INTO products (company_id, sku, name_en, name_zh, category_id, price, sell_price, currency, moq, qty_per_box,
                      length_cm, width_cm, height_cm, weight_kg, cbm, supplier_id, supplier_code, created_by, created_at, updated_at)
VALUES
 (1,'000001','3-Tier Storage Drawer','三层收纳抽屉柜',8, 3.95, 6.50,'USD',30,6, 62,42,40, 8.5, 0.1042,
   (SELECT id FROM contacts WHERE company_id=1 AND company_name='Yiwu Hongtai Housewares'),'HT-D3607',1,'2026-08-24T09:31:00.000Z','2026-08-24T09:31:00.000Z'),
 (1,'000002','Handheld Mini Fan','手持小风扇',10, 9.80, 0,'CNY',100,50, 48,36,52, 11.0, 0.0899,
   (SELECT id FROM contacts WHERE company_id=1 AND company_name='Jinhua Bright Electronics'),'BE-F209',1,'2026-08-25T11:05:00.000Z','2026-08-25T11:05:00.000Z'),
 (1,'000003','Cordless LED Table Lamp','无线LED台灯',11, 6.20, 9.90,'USD',40,20, 56,38,44, 9.2, 0.0936,
   (SELECT id FROM contacts WHERE company_id=1 AND company_name='Yiwu Meili Lighting'),'ML-T118',1,'2026-08-26T08:47:00.000Z','2026-08-26T08:47:00.000Z'),
 (1,'000004','Silicone Utensil Set 5pc','硅胶厨具5件套',7, 4.20, 0,'USD',60,20, 54,34,36, 7.6, 0.0661,
   (SELECT id FROM contacts WHERE company_id=1 AND company_name='Yiwu Hongtai Housewares'),'HT-K5012',1,'2026-08-26T15:22:00.000Z','2026-08-26T15:22:00.000Z'),
 (1,'000005','Vacuum Insulated Bottle 500ml','保温水杯 500ml',7, 12.50, 0,'CNY',48,24, 52,34,30, 9.6, 0.0530,
   (SELECT id FROM contacts WHERE company_id=1 AND company_name='Yiwu Hongtai Housewares'),'HT-500A',1,'2026-08-27T09:12:00.000Z','2026-08-27T09:12:00.000Z'),
 (1,'000006','Violin Highlighter 3-Color Set','小提琴造型荧光笔3色装',2, 5.34, 0,'CNY',144,144, 58,40,38, 12.4, 0.0882,
   (SELECT id FROM contacts WHERE company_id=1 AND company_name='Yiwu Qihui Stationery'),'SC2279',1,'2026-08-27T10:44:00.000Z','2026-08-27T10:44:00.000Z'),
 (1,'000007','Gel Eye Mask & Brush Set','冰敷眼罩洗头刷套装',5, 7.20, 0,'CNY',60,60, 50,36,42, 8.8, 0.0756,
   (SELECT id FROM contacts WHERE company_id=1 AND company_name='Zhejiang Yueguang Beauty'),'YG-HC02',1,'2026-08-27T15:58:00.000Z','2026-08-27T15:58:00.000Z');

INSERT INTO product_images (company_id, product_id, path, sort_order)
SELECT 1, p.id, v.path, 0 FROM (VALUES
 ('000001','/uploads/c1/storage-drawer-01.webp'),
 ('000002','/uploads/c1/mini-fan-01.webp'),
 ('000003','/uploads/c1/table-lamp-01.webp'),
 ('000004','/uploads/c1/utensil-set-01.webp'),
 ('000005','/uploads/c1/bottle-01.webp'),
 ('000006','/uploads/c1/violin-highlighter-01.webp'),
 ('000007','/uploads/c1/eye-mask-set-01.webp')) AS v(sku,path)
JOIN products p ON p.company_id=1 AND p.sku=v.sku;

INSERT INTO product_suppliers (company_id, product_id, supplier_id, price, currency, moq, quoted_on, created_by)
SELECT 1, p.id, c.id, v.price, v.currency, v.moq, v.quoted_on, 1
FROM (VALUES
 ('000001','Yiwu Hongtai Housewares', 3.95,'USD',30,'2026-08-24'),
 ('000001','Jinhua Bright Electronics', 4.30,'USD',24,'2026-08-25'),
 ('000002','Jinhua Bright Electronics', 9.80,'CNY',100,'2026-08-25'),
 ('000002','Yiwu Hongtai Housewares', 10.50,'CNY',60,'2026-08-26'),
 ('000003','Yiwu Meili Lighting', 6.20,'USD',40,'2026-08-26'),
 ('000004','Yiwu Hongtai Housewares', 4.20,'USD',60,'2026-08-26'),
 ('000005','Yiwu Hongtai Housewares', 12.50,'CNY',48,'2026-08-27'),
 ('000005','Jinhua Bright Electronics', 13.80,'CNY',24,'2026-08-27'),
 ('000006','Yiwu Qihui Stationery', 5.34,'CNY',144,'2026-08-27'),
 ('000007','Zhejiang Yueguang Beauty', 7.20,'CNY',60,'2026-08-27')) AS v(sku,supplier,price,currency,moq,quoted_on)
JOIN products p ON p.company_id=1 AND p.sku=v.sku
JOIN contacts c ON c.company_id=1 AND c.company_name=v.supplier;
