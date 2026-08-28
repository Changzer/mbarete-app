import { getTranslations } from "next-intl/server";
import { LegalPage, LegalSection } from "@/components/legal/legal-page";

/**
 * The privacy policy, long-form per locale (zh is the governing text for
 * mainland users; en is provided for convenience). Drafted as a v1 template
 * describing what the system actually does — reviewed against the code, not
 * against a lawyer. Before any public launch or regulatory filing it must be
 * reviewed by qualified counsel; see docs/COMPLIANCE.md.
 */
export default async function PrivacyPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations("legal");
  const contact = process.env.LEGAL_CONTACT_EMAIL || "";
  const zh = locale === "zh";

  return (
    <LegalPage title={t("privacyTitle")} updated={t("updated", { date: "2026-08-28", version: "v1" })} backLabel={t("back")}>
      {zh ? (
        <>
          <p>
            本隐私政策说明本平台（“我们”）在您使用采购管理服务时如何收集、使用、存储和保护个人信息。我们遵循合法、正当、必要和诚信原则，仅在实现产品功能所必需的范围内处理个人信息。
          </p>
          <LegalSection title="一、我们收集的信息">
            <p>1. 账户信息：注册时提供的姓名、电子邮箱、密码（仅存储加密散列，绝不存储明文）。</p>
            <p>2. 业务数据：您的企业在平台内录入的产品、供应商与客户联系人（可能包含姓名、电话、微信、邮箱、地址、税号）、订单、付款与费用记录及其凭证文件。</p>
            <p>3. 照片与文件：您主动拍摄或上传的产品照片、名片、付款凭证、单据等。</p>
            <p>4. 日志信息：登录时间、操作记录（谁创建/修改/删除了何种记录）、AI 使用量统计。</p>
            <p>我们不收集与服务无关的设备信息，不进行个性化广告追踪，不使用第三方统计脚本。</p>
          </LegalSection>
          <LegalSection title="二、信息的使用">
            <p>收集的信息仅用于：提供产品目录、订单、财务等核心功能；通过人工智能视觉模型从您上传的照片中提取产品与名片信息（提取结果需人工核对）；发送账户相关邮件（密码重置、验证、审批通知）；保障账户与数据安全；按您的指示导出或备份数据。</p>
          </LegalSection>
          <LegalSection title="三、数据的存储与隔离">
            <p>每个企业（租户）的数据在数据库层强制隔离：跨企业访问在数据库行级安全策略上被直接拒绝，并有自动化测试持续验证。平台运营方的管理面板仅显示计数与活跃度统计，不显示任何企业的金额或业务明细。</p>
          </LegalSection>
          <LegalSection title="四、受托处理方（子处理者）">
            <p>为实现上述功能，以下服务方在必要范围内受托处理数据：</p>
            <p>· 人工智能视觉服务：北京月之暗面科技有限公司（Moonshot AI / Kimi），用于境内部署的照片信息提取；境外部署可能使用 Anthropic PBC（美国）。照片仅在提取时传输，服务方不用于训练。</p>
            <p>· 邮件发送：腾讯企业邮（腾讯云计算（北京）有限责任公司），仅传输收件邮箱与邮件内容。</p>
            <p>· 云服务器托管：平台部署所在的云服务商（详见您所使用实例的服务协议）。</p>
            <p>· 汇率数据：open.er-api.com，仅获取公开汇率，不传输任何个人信息。</p>
          </LegalSection>
          <LegalSection title="五、保存期限与删除">
            <p>账户与业务数据在服务存续期间保存。企业管理员可随时在“设置”中一键导出全部数据；账户被暂停时导出功能仍然开放。删除联系人等记录会被审计日志记载。已完成交易的单据（形式发票、付款记录等）属于会计凭证，依照《会计档案管理办法》等规定在法定期限内留存，不因个人请求而删除。</p>
          </LegalSection>
          <LegalSection title="六、您的权利">
            <p>您有权查阅、更正、补充您的个人信息，有权在法律规定的范围内请求删除，有权获取数据副本。企业内的权利请求请首先联系您所属企业的管理员；平台层面的请求可联系下方邮箱，我们将在十五个工作日内答复。</p>
          </LegalSection>
          <LegalSection title="七、安全措施">
            <p>全站 HTTPS 传输加密；密码加盐散列存储；数据库行级安全强制隔离；上传文件经身份验证后方可访问；每日自动备份并校验完整性；异常登录与服务器错误实时告警。</p>
          </LegalSection>
          <LegalSection title="八、政策更新与联系方式">
            <p>本政策更新时将在本页面公布新版本并注明日期。{contact ? `联系邮箱：${contact}。` : "联系方式：请通过您所属企业的管理员或服务协议中载明的渠道联系平台运营方。"}</p>
          </LegalSection>
        </>
      ) : (
        <>
          <p>
            This privacy policy explains how this platform (&quot;we&quot;) collects, uses, stores and protects personal information when you use the sourcing-management service. We process personal information only to the extent necessary to provide the product, under the principles of lawfulness, legitimacy, necessity and good faith. The Chinese version of this policy governs for users in mainland China.
          </p>
          <LegalSection title="1. What we collect">
            <p>Account information: the name, email address and password you register with (only a salted hash of the password is stored, never the password itself).</p>
            <p>Business data: the products, supplier and client contacts (which may include names, phone numbers, WeChat IDs, emails, addresses, tax IDs), orders, payments, expenses and their receipt files your company records in the platform.</p>
            <p>Photos and files you deliberately take or upload: product photos, business cards, payment slips, documents.</p>
            <p>Logs: sign-in times, an audit trail of who created/changed/deleted records, and AI usage counts.</p>
            <p>We do not collect device information unrelated to the service, run advertising trackers, or embed third-party analytics scripts.</p>
          </LegalSection>
          <LegalSection title="2. How it is used">
            <p>Only to: provide the catalog, order and finance features; extract product and business-card fields from photos you submit using an AI vision model (results are labelled for human verification); send account emails (password resets, verification, approval notices); keep accounts and data secure; and export or back up data on your instruction.</p>
          </LegalSection>
          <LegalSection title="3. Storage and isolation">
            <p>Each company&apos;s (tenant&apos;s) data is isolated at the database layer: cross-tenant access is refused by row-level security policies, continuously verified by automated tests. The operator&apos;s panel shows counts and activity only — never any tenant&apos;s amounts or business details.</p>
          </LegalSection>
          <LegalSection title="4. Sub-processors">
            <p>The following providers process data on our behalf, strictly for the purposes above:</p>
            <p>· AI vision: Moonshot AI (Beijing Moonshot Technology Co., Ltd.) for mainland deployments; deployments outside the mainland may use Anthropic PBC (USA). Photos are transmitted only for extraction and are not used for training.</p>
            <p>· Email delivery: Tencent Exmail (Tencent Cloud), receiving only the recipient address and message content.</p>
            <p>· Cloud hosting: the cloud provider hosting your deployment (see your instance&apos;s service agreement).</p>
            <p>· Exchange rates: open.er-api.com — public rates only, no personal information is transmitted.</p>
          </LegalSection>
          <LegalSection title="5. Retention and deletion">
            <p>Account and business data are kept for the life of the service. A company administrator can export all company data from Settings at any time — including while the account is suspended. Deletions of records such as contacts are written to the audit log. Documents of completed transactions (proforma invoices, payment records) are accounting records retained for the statutory period under applicable accounting-archive regulations and are not deleted on individual request.</p>
          </LegalSection>
          <LegalSection title="6. Your rights">
            <p>You may access, correct and supplement your personal information, request deletion within the scope the law allows, and obtain a copy of your data. Direct requests concerning data inside a company to that company&apos;s administrator first; platform-level requests reach us at the contact below and are answered within fifteen working days.</p>
          </LegalSection>
          <LegalSection title="7. Security">
            <p>HTTPS everywhere; salted password hashing; enforced row-level security; authenticated file serving; daily integrity-checked backups; real-time alerts for anomalous sign-ins and server errors.</p>
          </LegalSection>
          <LegalSection title="8. Changes and contact">
            <p>Updates to this policy are published on this page with a new date. {contact ? `Contact: ${contact}.` : "Contact: through your company administrator or the channel named in your service agreement."}</p>
          </LegalSection>
        </>
      )}
    </LegalPage>
  );
}
