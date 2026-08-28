import { getTranslations } from "next-intl/server";
import { LegalPage, LegalSection } from "@/components/legal/legal-page";

/**
 * Terms of service, v1 template — same caveat as the privacy policy:
 * describes what the system actually does, needs counsel review before a
 * public launch. zh governs for mainland users.
 */
export default async function TermsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations("legal");
  const zh = locale === "zh";

  return (
    <LegalPage title={t("termsTitle")} updated={t("updated", { date: "2026-08-28", version: "v1" })} backLabel={t("back")}>
      {zh ? (
        <>
          <p>欢迎使用本采购管理平台。注册或使用本服务即表示您同意以下条款。</p>
          <LegalSection title="一、服务内容">
            <p>本平台为贸易企业提供产品目录、供应商与客户管理、订单与报价、财务记录以及基于人工智能的照片信息提取等功能。服务目前处于测试阶段，功能可能调整。</p>
          </LegalSection>
          <LegalSection title="二、账户与准入">
            <p>注册需通过平台邀请码或现有企业的推荐链接。经推荐注册的企业需经平台运营方审核后开通。您应妥善保管账户凭据，并对账户下的操作负责。</p>
          </LegalSection>
          <LegalSection title="三、您的数据">
            <p>您在平台录入的业务数据归您的企业所有。企业管理员可随时导出全部数据；账户暂停期间导出功能保持开放。您保证录入的数据（包括联系人个人信息）来源合法，并已就向本平台的提供取得必要授权。</p>
          </LegalSection>
          <LegalSection title="四、人工智能功能">
            <p>照片信息提取由人工智能模型完成，结果可能存在错误或遗漏，仅供参考，页面已作“AI 提取，请核对”提示。以提取结果直接对外报价或签约前，您应自行核对。平台对未经核对的 AI 输出造成的损失不承担责任。</p>
          </LegalSection>
          <LegalSection title="五、行为规范">
            <p>不得利用本平台从事违法活动、侵犯他人权利、上传违法或侵权内容、探测或攻击系统、绕过隔离或计费机制。违反者平台可暂停或终止服务；暂停期间数据导出仍然开放。</p>
          </LegalSection>
          <LegalSection title="六、服务变更与责任限制">
            <p>测试阶段服务按“现状”提供，平台将尽合理努力保障可用性与数据安全（含每日备份），但不对不可抗力、第三方服务中断等造成的损失承担超出法律强制规定的责任。</p>
          </LegalSection>
          <LegalSection title="七、其他">
            <p>本条款更新将在本页公布。与隐私相关的事项以《隐私政策》为准。本条款适用中华人民共和国法律（境内部署）或服务协议约定的法律（境外部署）。</p>
          </LegalSection>
        </>
      ) : (
        <>
          <p>Welcome. By registering for or using this sourcing-management platform you agree to these terms. The Chinese version governs for users in mainland China.</p>
          <LegalSection title="1. The service">
            <p>The platform provides product catalogs, supplier and client management, orders and quoting, finance records, and AI-based extraction of information from photos, for trading companies. The service is in a testing phase and features may change.</p>
          </LegalSection>
          <LegalSection title="2. Accounts and admission">
            <p>Registration requires a platform code or a referral link from an existing company. Referred companies are activated after operator approval. You are responsible for safeguarding your credentials and for activity under your account.</p>
          </LegalSection>
          <LegalSection title="3. Your data">
            <p>Business data you record belongs to your company. An administrator may export all of it at any time — including while the account is suspended. You warrant that data you record (including contacts&apos; personal information) was obtained lawfully and that you hold the authorisations needed to provide it to the platform.</p>
          </LegalSection>
          <LegalSection title="4. AI features">
            <p>Photo extraction is performed by an AI model and may contain errors or omissions; results are reference only and are labelled for verification. Check extracted figures before quoting or contracting on them. The platform is not liable for losses caused by unverified AI output.</p>
          </LegalSection>
          <LegalSection title="5. Acceptable use">
            <p>No unlawful activity, infringement of others&apos; rights, unlawful or infringing content, probing or attacking the system, or circumventing isolation or metering. Violations may lead to suspension or termination; data export remains open during suspension.</p>
          </LegalSection>
          <LegalSection title="6. Changes and liability">
            <p>During testing the service is provided as-is. We make reasonable efforts to keep it available and the data safe (including daily backups), but accept no liability beyond what law mandates for force majeure or third-party service interruptions.</p>
          </LegalSection>
          <LegalSection title="7. Miscellaneous">
            <p>Updates are published on this page. Privacy matters are governed by the Privacy Policy. These terms are governed by PRC law for mainland deployments, or the law named in your service agreement otherwise.</p>
          </LegalSection>
        </>
      )}
    </LegalPage>
  );
}
