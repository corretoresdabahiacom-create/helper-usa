// Draft legal texts. Paragraphs are separated by blank lines; a line starting with "# " is a heading.
// These are TEMPLATES, not legal advice: an attorney must review them before production use.
type D = Record<string, string>;

const en: D = {
  'legal.draft': 'DRAFT: not legal advice. These texts are templates and must be reviewed by a qualified attorney before you rely on them.',
  'legal.aup': 'Acceptable use', 'legal.back': 'Back',
  'legal.terms.body': `# What this service is
Helper Connect is a private management tool for contractors: a helper directory, work scheduling, payment records and management reports. It is not a payroll provider, staffing agency, employer of record, bank, or payment processor, and it does not decide whether a worker is an employee or an independent contractor.

# Your responsibilities
You are responsible for the accuracy of what you enter, for complying with labor, tax, licensing and privacy laws that apply to you, and for having permission to contact the people you add. Helper Connect never moves money: it only records payments you made elsewhere.

# Financial reports
Reports are management information. They are not accounting, tax or legal advice. Have a CPA review them before using them for taxes or official statements.

# Availability and changes
The service is provided "as is" during the MVP stage, without warranties. We may change or suspend features and will try to give notice of material changes.

# Termination
You may delete your account at any time. We may suspend accounts that violate the acceptable use rules.`,
  'legal.privacy.body': `# What we store
Your account details, the helpers, schedules, payments, expenses and messages you enter, and basic security logs (session, IP-derived rate-limit data, audit events).

# Who can see it
Your business data is isolated to your account. Other contractors cannot see it. Platform administrators manage accounts and see only aggregate counts, and only with a time-limited, logged access grant that requires a reason.

# Helpers
Helpers have no account. They reach their private conversation through a personal link that you issue and can revoke. They can reply, stop messages, and export their conversation.

# Retention
Messages are hidden after 24 hours and their content is then erased by a scheduled job. Other data stays until you delete it or delete your account.

# Your rights
You can export your data and delete your account from Settings. Contact support for other requests.`,
  'legal.messaging.body': `# Consent
Only message people who agreed to be contacted about work. The app lets you record that consent and blocks messages to helpers who opted out or revoked it.

# Private by design
Each message, including bulk sends, creates a separate private conversation. Recipients never see each other.

# 24-hour retention
Messages expire 24 hours after sending. The server hides them immediately and erases their content on the next cleanup. Export a conversation before it expires if you need a copy.

# Not for sensitive data
Do not send passwords, full payment card numbers, government identification numbers or health information.`,
  'legal.financial.body': `# Exact amounts
Money is stored as exact integer cents. Each record has one currency, and currencies are never added together.

# Accrual vs cash
The income statement (DRE) can be viewed on an accrual basis (when the service happens) or a cash basis (when money moved). Cash flow shows only real money movements; unpaid receivables and payables never appear there.

# Helper payments
Only completed workdays are payable. Payments are records of money you paid outside the app and can be voided, never silently deleted.

# Limits
Management reporting only. Not payroll, tax filing or accounting. A CPA should review it.`,
  'legal.aup.body': `# Do not
Do not use the service to harass, spam or threaten anyone, send unsolicited bulk messages, store another person's data without a reason, attempt to access other accounts, or probe or disrupt the service.

# Enforcement
Abuse reports are reviewed by administrators. Violations may lead to suspension.`,
};

const pt: D = {
  'legal.draft': 'RASCUNHO: não é aconselhamento jurídico. Estes textos são modelos e devem ser revisados por um advogado qualificado antes de você confiar neles.',
  'legal.aup': 'Uso aceitável', 'legal.back': 'Voltar',
  'legal.terms.body': `# O que é este serviço
O Helper Connect é uma ferramenta privada de gestão para contratantes: diretório de ajudantes, agenda de trabalho, registro de pagamentos e relatórios gerenciais. Não é folha de pagamento, agência de empregos, empregador formal, banco ou processador de pagamentos, e não define se um trabalhador é empregado ou autônomo.

# Suas responsabilidades
Você responde pela exatidão do que registra, pelo cumprimento das leis trabalhistas, fiscais, de licenciamento e de privacidade aplicáveis, e por ter permissão para contatar as pessoas que cadastra. O Helper Connect nunca movimenta dinheiro: só registra pagamentos feitos por você em outro lugar.

# Relatórios financeiros
Os relatórios são informação gerencial. Não são aconselhamento contábil, fiscal ou jurídico. Peça a um contador (CPA) que os revise antes de usá-los em impostos ou demonstrações oficiais.

# Disponibilidade e mudanças
Na fase MVP o serviço é fornecido "como está", sem garantias. Podemos alterar ou suspender funções e tentaremos avisar sobre mudanças relevantes.

# Encerramento
Você pode excluir sua conta a qualquer momento. Podemos suspender contas que violem as regras de uso aceitável.`,
  'legal.privacy.body': `# O que guardamos
Dados da conta, ajudantes, agendas, pagamentos, despesas e mensagens que você registra, além de registros básicos de segurança (sessão, dados de limite de requisições derivados do IP, eventos de auditoria).

# Quem pode ver
Seus dados de negócio ficam isolados na sua conta. Outros contratantes não os veem. Administradores da plataforma gerenciam contas e veem apenas contagens agregadas, e só com uma concessão de acesso temporária, registrada e com motivo.

# Ajudantes
Ajudantes não têm conta. Acessam a conversa privada por um link pessoal que você emite e pode revogar. Podem responder, parar as mensagens e exportar a conversa.

# Retenção
As mensagens são ocultadas após 24 horas e o conteúdo é apagado por uma rotina agendada. Os demais dados ficam até você excluí-los ou excluir a conta.

# Seus direitos
Você pode exportar seus dados e excluir a conta em Ajustes. Fale com o suporte para outros pedidos.`,
  'legal.messaging.body': `# Consentimento
Envie mensagens apenas a quem concordou em ser contatado sobre trabalho. O app permite registrar esse consentimento e bloqueia mensagens a ajudantes que optaram por sair ou revogaram.

# Privado por padrão
Cada mensagem, inclusive em envio para vários, cria uma conversa privada separada. Os destinatários nunca veem uns aos outros.

# Retenção de 24 horas
As mensagens expiram 24 horas após o envio. O servidor as oculta imediatamente e apaga o conteúdo na próxima limpeza. Exporte a conversa antes de expirar se precisar de cópia.

# Sem dados sensíveis
Não envie senhas, números completos de cartão, documentos de identificação ou informações de saúde.`,
  'legal.financial.body': `# Valores exatos
O dinheiro é guardado em centavos inteiros. Cada registro tem uma moeda e moedas diferentes nunca são somadas.

# Competência x caixa
A DRE pode ser vista por competência (quando o serviço ocorre) ou por caixa (quando o dinheiro se move). O fluxo de caixa mostra só movimentações reais; contas a receber e a pagar não pagas nunca aparecem nele.

# Pagamentos a ajudantes
Só dias concluídos são pagáveis. Pagamentos são registros de dinheiro pago fora do app e podem ser anulados, nunca apagados silenciosamente.

# Limites
Apenas relatórios gerenciais. Não é folha de pagamento, declaração de impostos nem contabilidade. Um contador deve revisar.`,
  'legal.aup.body': `# Não faça
Não use o serviço para assediar, enviar spam ou ameaçar alguém, mandar mensagens em massa não solicitadas, guardar dados de terceiros sem motivo, tentar acessar outras contas, nem sondar ou prejudicar o serviço.

# Aplicação
Denúncias são analisadas por administradores. Violações podem levar à suspensão.`,
};

const es: D = {
  'legal.draft': 'BORRADOR: no es asesoría legal. Estos textos son plantillas y deben ser revisados por un abogado calificado antes de confiar en ellos.',
  'legal.aup': 'Uso aceptable', 'legal.back': 'Volver',
  'legal.terms.body': `# Qué es este servicio
Helper Connect es una herramienta privada de gestión para contratistas: directorio de ayudantes, agenda de trabajo, registro de pagos y reportes de gestión. No es nómina, agencia de empleo, empleador de registro, banco ni procesador de pagos, y no determina si un trabajador es empleado o contratista independiente.

# Tus responsabilidades
Eres responsable de la exactitud de lo que registras, de cumplir las leyes laborales, fiscales, de licencias y de privacidad que te apliquen, y de tener permiso para contactar a las personas que agregas. Helper Connect nunca mueve dinero: solo registra pagos que hiciste en otro lugar.

# Reportes financieros
Los reportes son información de gestión. No son asesoría contable, fiscal ni legal. Pide a un contador (CPA) que los revise antes de usarlos para impuestos o estados oficiales.

# Disponibilidad y cambios
En la etapa MVP el servicio se ofrece "tal cual", sin garantías. Podemos cambiar o suspender funciones y intentaremos avisar de cambios importantes.

# Terminación
Puedes eliminar tu cuenta en cualquier momento. Podemos suspender cuentas que incumplan las reglas de uso aceptable.`,
  'legal.privacy.body': `# Qué guardamos
Datos de la cuenta, los ayudantes, agendas, pagos, gastos y mensajes que registras, y registros básicos de seguridad (sesión, datos de límite de solicitudes derivados de la IP, eventos de auditoría).

# Quién puede verlo
Tus datos de negocio están aislados en tu cuenta. Otros contratistas no los ven. Los administradores gestionan cuentas y solo ven conteos agregados, y solo con una autorización temporal, registrada y con motivo.

# Ayudantes
Los ayudantes no tienen cuenta. Acceden a su conversación privada mediante un enlace personal que tú emites y puedes revocar. Pueden responder, detener los mensajes y exportar la conversación.

# Retención
Los mensajes se ocultan tras 24 horas y su contenido se borra con una tarea programada. Los demás datos permanecen hasta que los elimines o elimines la cuenta.

# Tus derechos
Puedes exportar tus datos y eliminar la cuenta en Ajustes. Contacta a soporte para otras solicitudes.`,
  'legal.messaging.body': `# Consentimiento
Envía mensajes solo a quienes aceptaron ser contactados sobre trabajo. La app permite registrar ese consentimiento y bloquea mensajes a ayudantes que se dieron de baja o lo revocaron.

# Privado por diseño
Cada mensaje, incluso en envíos a varios, crea una conversación privada separada. Los destinatarios nunca se ven entre sí.

# Retención de 24 horas
Los mensajes vencen 24 horas después del envío. El servidor los oculta de inmediato y borra su contenido en la siguiente limpieza. Exporta la conversación antes de que venza si necesitas una copia.

# Sin datos sensibles
No envíes contraseñas, números completos de tarjeta, documentos de identidad ni información de salud.`,
  'legal.financial.body': `# Montos exactos
El dinero se guarda en centavos enteros. Cada registro tiene una moneda y las monedas distintas nunca se suman.

# Devengado vs caja
El estado de resultados puede verse en base devengada (cuando ocurre el servicio) o de caja (cuando se mueve el dinero). El flujo de caja muestra solo movimientos reales; las cuentas por cobrar y por pagar sin pagar nunca aparecen allí.

# Pagos a ayudantes
Solo los días completados son pagables. Los pagos son registros de dinero pagado fuera de la app y pueden anularse, nunca borrarse en silencio.

# Límites
Solo reportes de gestión. No es nómina, declaración de impuestos ni contabilidad. Un contador debe revisarlo.`,
  'legal.aup.body': `# No hagas
No uses el servicio para acosar, enviar spam o amenazar a nadie, enviar mensajes masivos no solicitados, guardar datos de terceros sin motivo, intentar acceder a otras cuentas ni sondear o perturbar el servicio.

# Aplicación
Los administradores revisan las denuncias. Las infracciones pueden causar suspensión.`,
};

export const legal = { en, pt, es };
