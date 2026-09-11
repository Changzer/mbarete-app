import type { Locale } from "@/i18n/routing";

type Policy = { title: string; intro: string; sections: { title: string; body: string }[] };
type PublicPolicies = { back: string; updated: string; contactTitle: string; contactBody: string; contactLink: string; privacy: Policy; terms: Policy };

// Public service notices, separate from the internal app's message fallback.
// Keep these factual: no unverified provider promises, retention deadlines,
// governing-law clauses or claims that deployment configuration guarantees safety.
const policies: Record<Locale, PublicPolicies> = {
  en: {
    back: "Back to Mbarete", updated: "Updated 11 September 2026 · v2",
    contactTitle: "Questions and requests", contactBody: "For questions about a project, or to request access, correction or deletion of your information, contact Mbarete. Include the email used for your enquiry so we can locate it; do not send passwords or identity documents through the form.", contactLink: "Contact Mbarete",
    privacy: {
      title: "Privacy notice",
      intro: "Mbarete is the sourcing and export service of Yiwu Mbarete Import & Export Co., Ltd. (义乌市玻芮进出口有限公司), based in Yiwu, China. This notice describes enquiries sent through this website and the separate workspace used by our authorised team.",
      sections: [
        { title: "What you share", body: "The enquiry form requires your name, email and a description of your project. Your company, preferred contact, quantity, destination, target price and up to four photos are optional. Please send product references only, without unrelated personal, payment or identity information." },
        { title: "Why we use it", body: "We use your details to understand and respond to your request, clarify requirements and prepare a possible quotation. Sending an enquiry does not create an account, place an order or subscribe you to a newsletter. The form does not automatically send its text or photos to an AI provider." },
        { title: "Who can access it", body: "Enquiries and their photos are stored for Mbarete's operator to review. Uploaded enquiry photos are not a public gallery and require operator authentication. Our team in China handles enquiries; website hosting and the email or messaging services used to reply also process information. Work agreed with you may require relevant specifications to be shared with suppliers or logistics partners." },
        { title: "Storage and retention", body: "Enquiries and attachments remain stored for follow-up; this website does not currently apply an automatic deletion schedule. You can ask us to review, correct or delete your information. We assess requests individually, including any records that must be kept for an ongoing transaction or applicable obligations. Copies may also remain in backups until those backups expire." },
        { title: "Website operation", body: "The website uses your language preference and, when you sign in, authentication cookies. IP-based request limits help prevent abuse; the hosting service may keep technical access logs. The landing page has no advertising pixels or third-party analytics scripts. Uploaded enquiry images are re-encoded before storage, removing embedded photo metadata." },
        { title: "Internal workspace", body: "Staff accounts are issued by an administrator. The workspace stores operational product, supplier, client, order and document records, with authenticated access and activity records. Staff photo transcription can send selected images to the configured Moonshot or Anthropic service; staff must check extracted results. This internal workflow is separate from submitting a public enquiry." },
      ],
    },
    terms: {
      title: "Website and service terms",
      intro: "This website introduces Mbarete's sourcing and export services. It lets you discuss a project with Yiwu Mbarete Import & Export Co., Ltd.; it does not sell access to our internal software.",
      sections: [
        { title: "An enquiry starts a conversation", body: "Submitting the form is a request for contact, not an accepted order, a binding quotation or a commitment to pay. We first review the product, quantity, destination and requirements with you." },
        { title: "Agree the work in writing", body: "The scope, fees, product specifications, samples, quality checks, payment arrangements, delivery terms and responsibilities for a project must be agreed separately in writing before work or purchasing is authorised. Any quotation is subject to its stated conditions and validity." },
        { title: "Product references and availability", body: "Website product images illustrate the kinds of enquiries we can discuss. They are not stock listings, confirmed supplier offers, certifications or evidence of completed projects. Availability, minimum quantities, prices and timelines need confirmation for the specific project." },
        { title: "Materials you send", body: "Only send information and images you are authorised to share. Tell us about relevant product, packaging and destination requirements. Do not submit unlawful content, unsolicited advertising or files intended to disrupt the website." },
        { title: "Staff access", body: "The workspace is for authorised users only. Public company registration is closed. Staff must protect their credentials and verify operational records and AI-assisted readings before using them for commercial decisions." },
        { title: "Project agreements", body: "This page explains use of the website. It does not replace the signed or otherwise agreed documents for a particular project, or limit rights that cannot be excluded under applicable law. Updates are published here with a revision date." },
      ],
    },
  },
  "pt-BR": {
    back: "Voltar à Mbarete", updated: "Atualizado em 11 de setembro de 2026 · v2",
    contactTitle: "Dúvidas e solicitações", contactBody: "Para falar sobre um projeto ou solicitar acesso, correção ou exclusão dos seus dados, entre em contato com a Mbarete. Informe o e-mail usado na consulta para localizarmos o registro; não envie senhas nem documentos de identidade pelo formulário.", contactLink: "Falar com a Mbarete",
    privacy: {
      title: "Aviso de privacidade",
      intro: "Mbarete é o serviço de sourcing e exportação da Yiwu Mbarete Import & Export Co., Ltd. (义乌市玻芮进出口有限公司), em Yiwu, China. Este aviso descreve as consultas enviadas pelo site e o ambiente separado utilizado pela nossa equipe autorizada.",
      sections: [
        { title: "O que você compartilha", body: "O formulário exige nome, e-mail e uma descrição do projeto. Empresa, contato preferido, quantidade, destino, preço-alvo e até quatro fotos são opcionais. Envie apenas referências dos produtos, sem dados pessoais, de pagamento ou de identificação que não sejam necessários." },
        { title: "Como usamos os dados", body: "Usamos seus dados para entender e responder à consulta, esclarecer requisitos e preparar uma possível cotação. O envio não cria uma conta, não faz um pedido e não inscreve você em uma newsletter. O formulário não envia automaticamente textos ou fotos a um provedor de IA." },
        { title: "Quem tem acesso", body: "Consultas e fotos são armazenadas para análise pelo operador da Mbarete. As fotos não formam uma galeria pública e exigem autenticação do operador. Nossa equipe na China atende às consultas; os serviços de hospedagem e de e-mail ou mensagens usados para responder também processam informações. O trabalho acordado com você pode exigir o compartilhamento de especificações relevantes com fornecedores ou parceiros logísticos." },
        { title: "Armazenamento e retenção", body: "Consultas e anexos ficam armazenados para acompanhamento; o site ainda não aplica um prazo automático de exclusão. Você pode pedir a revisão, correção ou exclusão dos seus dados. Avaliamos cada solicitação, considerando registros necessários para operações em andamento ou obrigações aplicáveis. Cópias também podem permanecer em backups até que estes expirem." },
        { title: "Funcionamento do site", body: "O site utiliza sua preferência de idioma e, ao entrar na área interna, cookies de autenticação. Limites por IP ajudam a prevenir abusos; a hospedagem pode manter registros técnicos de acesso. A página pública não tem pixels de publicidade nem scripts de análise de terceiros. As fotos enviadas são recodificadas antes do armazenamento, removendo metadados incorporados." },
        { title: "Ambiente interno", body: "As contas da equipe são fornecidas por um administrador. O sistema armazena registros operacionais de produtos, fornecedores, clientes, pedidos e documentos, com acesso autenticado e registro de atividades. A transcrição de fotos pela equipe pode enviar imagens selecionadas ao serviço Moonshot ou Anthropic configurado; os resultados precisam ser conferidos. Esse fluxo é separado do envio de uma consulta pública." },
      ],
    },
    terms: {
      title: "Termos do site e dos serviços",
      intro: "Este site apresenta os serviços de sourcing e exportação da Mbarete. Aqui você pode conversar sobre um projeto com a Yiwu Mbarete Import & Export Co., Ltd.; não vendemos acesso ao nosso software interno.",
      sections: [
        { title: "Uma consulta inicia uma conversa", body: "Enviar o formulário é solicitar contato, não confirmar um pedido, aceitar uma cotação vinculante ou assumir um compromisso de pagamento. Primeiro, alinhamos com você o produto, a quantidade, o destino e os requisitos." },
        { title: "O trabalho é acordado por escrito", body: "Escopo, taxas, especificações, amostras, verificações de qualidade, pagamentos, condições de entrega e responsabilidades devem ser acordados separadamente por escrito antes da autorização de serviços ou compras. Cada cotação está sujeita às condições e ao prazo de validade nela indicados." },
        { title: "Referências e disponibilidade", body: "As imagens do site ilustram os tipos de produto que podemos discutir. Não representam estoque disponível, ofertas confirmadas de fornecedores, certificações nem projetos concluídos. Disponibilidade, quantidades mínimas, preços e prazos precisam ser confirmados para cada projeto." },
        { title: "Materiais enviados", body: "Envie apenas informações e imagens que você tem autorização para compartilhar. Informe os requisitos relevantes do produto, da embalagem e do destino. Não envie conteúdo ilegal, publicidade não solicitada ou arquivos destinados a prejudicar o site." },
        { title: "Acesso da equipe", body: "O ambiente interno é restrito a usuários autorizados. O cadastro público de empresas está encerrado. A equipe deve proteger suas credenciais e conferir os registros operacionais e as leituras assistidas por IA antes de tomar decisões comerciais." },
        { title: "Acordos do projeto", body: "Esta página explica o uso do site. Ela não substitui os documentos assinados ou acordados para cada projeto nem limita direitos que não possam ser excluídos pela legislação aplicável. Atualizações serão publicadas aqui com a data da revisão." },
      ],
    },
  },
  es: {
    back: "Volver a Mbarete", updated: "Actualizado el 11 de septiembre de 2026 · v2",
    contactTitle: "Consultas y solicitudes", contactBody: "Para hablar de un proyecto o solicitar acceso, corrección o eliminación de tus datos, contacta con Mbarete. Incluye el correo usado en tu consulta para localizar el registro; no envíes contraseñas ni documentos de identidad mediante el formulario.", contactLink: "Contactar con Mbarete",
    privacy: {
      title: "Aviso de privacidad",
      intro: "Mbarete es el servicio de sourcing y exportación de Yiwu Mbarete Import & Export Co., Ltd. (义乌市玻芮进出口有限公司), en Yiwu, China. Este aviso describe las consultas enviadas desde este sitio y el espacio separado que utiliza nuestro equipo autorizado.",
      sections: [
        { title: "Lo que compartes", body: "El formulario requiere tu nombre, correo y una descripción del proyecto. La empresa, contacto preferido, cantidad, destino, precio objetivo y hasta cuatro fotos son opcionales. Envía solo referencias de productos, sin información personal, de pago o de identidad que no sea necesaria." },
        { title: "Para qué lo usamos", body: "Usamos tus datos para entender y responder a la consulta, aclarar requisitos y preparar una posible cotización. Enviar el formulario no crea una cuenta, no realiza un pedido ni te suscribe a un boletín. El formulario no envía automáticamente textos ni fotos a un proveedor de IA." },
        { title: "Quién tiene acceso", body: "Las consultas y fotos se guardan para que el operador de Mbarete las revise. Las fotos no son una galería pública y requieren autenticación del operador. Nuestro equipo en China atiende las consultas; los servicios de alojamiento y de correo o mensajería usados para responder también procesan información. El trabajo acordado contigo puede requerir compartir especificaciones pertinentes con proveedores o socios logísticos." },
        { title: "Almacenamiento y conservación", body: "Las consultas y archivos se conservan para su seguimiento; este sitio todavía no aplica un plazo automático de eliminación. Puedes pedir que revisemos, corrijamos o eliminemos tus datos. Evaluamos cada solicitud, considerando los registros necesarios para operaciones en curso u obligaciones aplicables. También pueden quedar copias en respaldos hasta que estos caduquen." },
        { title: "Funcionamiento del sitio", body: "El sitio utiliza tu preferencia de idioma y, al iniciar sesión, cookies de autenticación. Los límites por IP ayudan a prevenir abusos; el alojamiento puede mantener registros técnicos de acceso. La página pública no tiene píxeles publicitarios ni scripts de analítica de terceros. Las fotos enviadas se recodifican antes de almacenarlas, eliminando sus metadatos incorporados." },
        { title: "Espacio interno", body: "Un administrador proporciona las cuentas del equipo. El sistema conserva registros operativos de productos, proveedores, clientes, pedidos y documentos, con acceso autenticado y registros de actividad. La transcripción de fotos del equipo puede enviar imágenes seleccionadas al servicio Moonshot o Anthropic configurado; los resultados deben revisarse. Este flujo es independiente del envío de una consulta pública." },
      ],
    },
    terms: {
      title: "Términos del sitio y del servicio",
      intro: "Este sitio presenta los servicios de sourcing y exportación de Mbarete. Permite conversar sobre un proyecto con Yiwu Mbarete Import & Export Co., Ltd.; no vende acceso a nuestro software interno.",
      sections: [
        { title: "Una consulta inicia una conversación", body: "Enviar el formulario es solicitar contacto, no confirmar un pedido, aceptar una cotización vinculante ni asumir un compromiso de pago. Primero revisamos contigo el producto, la cantidad, el destino y los requisitos." },
        { title: "El trabajo se acuerda por escrito", body: "El alcance, los honorarios, las especificaciones, las muestras, las verificaciones de calidad, los pagos, las condiciones de entrega y las responsabilidades deben acordarse por separado y por escrito antes de autorizar trabajos o compras. Cada cotización está sujeta a sus condiciones y plazo de validez." },
        { title: "Referencias y disponibilidad", body: "Las imágenes del sitio ilustran los tipos de productos que podemos analizar. No representan existencias, ofertas confirmadas, certificaciones ni proyectos realizados. La disponibilidad, las cantidades mínimas, los precios y los plazos deben confirmarse para cada proyecto." },
        { title: "Materiales que envías", body: "Envía únicamente información e imágenes que estés autorizado a compartir. Indica los requisitos pertinentes del producto, su empaque y el destino. No envíes contenido ilegal, publicidad no solicitada ni archivos destinados a perjudicar el sitio." },
        { title: "Acceso del equipo", body: "El espacio interno es exclusivo para usuarios autorizados. El registro público de empresas está cerrado. El equipo debe proteger sus credenciales y verificar los registros operativos y las lecturas asistidas por IA antes de tomar decisiones comerciales." },
        { title: "Acuerdos del proyecto", body: "Esta página explica el uso del sitio. No sustituye los documentos firmados o acordados para un proyecto ni limita derechos que no puedan excluirse según la legislación aplicable. Las actualizaciones se publican aquí con su fecha de revisión." },
      ],
    },
  },
  zh: {
    back: "返回 Mbarete", updated: "更新于 2026年9月11日 · v2",
    contactTitle: "咨询与信息请求", contactBody: "如需讨论项目，或申请查阅、更正、删除您的信息，请联系 Mbarete。请提供提交咨询时使用的邮箱，以便查找记录；请勿通过表单发送密码或身份证件。", contactLink: "联系 Mbarete",
    privacy: {
      title: "隐私说明",
      intro: "Mbarete 是义乌市玻芮进出口有限公司（Yiwu Mbarete Import & Export Co., Ltd.）的采购与出口服务，团队位于中国义乌。本说明涵盖网站咨询，以及授权团队使用的独立内部工作系统。",
      sections: [
        { title: "您提供的信息", body: "咨询表单需要您的姓名、邮箱和项目说明。公司、首选联系方式、数量、目的地、目标价格及最多四张照片均为选填。请仅提供产品参考资料，不要上传无关的个人、付款或身份证件信息。" },
        { title: "信息用途", body: "我们使用这些信息了解并回复您的需求、确认要求及准备可能的报价。提交咨询不会创建账户、下订单或订阅营销邮件。表单不会自动将文字或照片发送给 AI 服务商。" },
        { title: "访问与共享", body: "咨询及照片存储后由 Mbarete 运营人员查看。上传的照片不属于公开图库，访问需要运营人员身份验证。中国团队负责处理咨询；网站托管以及回复时使用的邮件或消息服务也会处理相关信息。与您约定的工作可能需要将必要的产品要求提供给供应商或物流合作方。" },
        { title: "存储与保留", body: "咨询与附件会保存以便跟进；网站目前没有自动删除期限。您可请求我们审查、更正或删除您的信息。我们逐项处理请求，并考虑正在进行的交易或适用义务所需保留的记录。备份中的副本也可能保留至该备份到期。" },
        { title: "网站运行", body: "网站使用您的语言偏好，并在登录时使用身份验证 Cookie。基于 IP 的请求限制用于防止滥用；托管服务可能保存技术访问日志。公开页面没有广告追踪像素或第三方分析脚本。咨询照片在存储前重新编码，移除嵌入的照片元数据。" },
        { title: "内部工作系统", body: "团队账户由管理员提供。系统保存产品、供应商、客户、订单及文件等业务记录，采用身份验证并记录操作活动。团队使用照片识别时，选定图片可能发送给已配置的 Moonshot 或 Anthropic 服务；识别结果需人工核对。此流程与公开咨询表单分开。" },
      ],
    },
    terms: {
      title: "网站与服务条款",
      intro: "本网站介绍 Mbarete 的采购与出口服务，方便您与义乌市玻芮进出口有限公司讨论项目。我们不通过本网站出售内部软件的使用权限。",
      sections: [
        { title: "咨询是沟通的开始", body: "提交表单是请求联系，不代表订单已被接受、报价已生效或产生付款承诺。我们会先与您确认产品、数量、目的地及具体要求。" },
        { title: "书面确认工作", body: "服务或采购获得授权前，工作范围、费用、产品规格、样品、质量检查、付款、交付条件及各方责任须另行书面约定。报价以其载明的条件和有效期为准。" },
        { title: "产品参考与供应情况", body: "网站产品图片用于说明可讨论的产品类型，不代表现货、已确认的供应商报价、认证或已完成项目。供应情况、起订量、价格及时间安排均需按具体项目确认。" },
        { title: "提交的资料", body: "请仅提交您有权分享的信息与图片，并告知相关产品、包装和目的地要求。不得提交违法内容、未经请求的广告或旨在干扰网站运行的文件。" },
        { title: "团队访问", body: "内部工作系统仅限授权人员使用，公开企业注册已关闭。团队成员须保护登录凭据，并在商业决策前核对业务记录及 AI 辅助识别结果。" },
        { title: "项目约定", body: "本页说明网站的使用方式，不替代具体项目已签署或另行达成的协议，也不限制适用法律规定不可排除的权利。条款更新将在本页标明修订日期。" },
      ],
    },
  },
};

export function publicPolicies(locale: string): PublicPolicies {
  return policies[locale as Locale] ?? policies.en;
}
