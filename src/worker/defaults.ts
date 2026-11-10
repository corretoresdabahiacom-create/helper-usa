import { newId } from './core';

export type DreClass =
  | 'revenue_services' | 'revenue_other' | 'financial_income'
  | 'deduction' | 'direct_cost' | 'operating' | 'financial_expense' | 'other_expense';

// [kind, dre_class, en, pt, es]
const DEFAULTS: [('revenue' | 'expense'), DreClass, string, string, string][] = [
  ['revenue', 'revenue_services', 'Construction services', 'Serviços de construção', 'Servicios de construcción'],
  ['revenue', 'revenue_services', 'Roofing services', 'Serviços de telhado', 'Servicios de techado'],
  ['revenue', 'revenue_services', 'Painting services', 'Serviços de pintura', 'Servicios de pintura'],
  ['revenue', 'revenue_services', 'Landscaping services', 'Serviços de paisagismo', 'Servicios de paisajismo'],
  ['revenue', 'revenue_services', 'Maintenance services', 'Serviços de manutenção', 'Servicios de mantenimiento'],
  ['revenue', 'revenue_services', 'Installation services', 'Serviços de instalação', 'Servicios de instalación'],
  ['revenue', 'revenue_services', 'Labor services', 'Serviços de mão de obra', 'Servicios de mano de obra'],
  ['revenue', 'revenue_services', 'Other services', 'Outros serviços', 'Otros servicios'],
  ['revenue', 'revenue_other', 'Other operating revenue', 'Outras receitas operacionais', 'Otros ingresos operativos'],
  ['revenue', 'financial_income', 'Interest income', 'Receita financeira', 'Ingresos financieros'],
  ['expense', 'deduction', 'Refunds and discounts', 'Reembolsos e descontos', 'Reembolsos y descuentos'],
  ['expense', 'direct_cost', 'Materials', 'Materiais', 'Materiales'],
  ['expense', 'direct_cost', 'Construction supplies', 'Suprimentos de obra', 'Suministros de construcción'],
  ['expense', 'direct_cost', 'Equipment rental', 'Aluguel de equipamentos', 'Alquiler de equipos'],
  ['expense', 'direct_cost', 'Subcontractors', 'Subempreiteiros', 'Subcontratistas'],
  ['expense', 'operating', 'Fuel', 'Combustível', 'Combustible'],
  ['expense', 'operating', 'Vehicle expenses', 'Despesas com veículos', 'Gastos de vehículos'],
  ['expense', 'operating', 'Vehicle maintenance', 'Manutenção de veículos', 'Mantenimiento de vehículos'],
  ['expense', 'operating', 'Equipment', 'Equipamentos', 'Equipos'],
  ['expense', 'operating', 'Tools', 'Ferramentas', 'Herramientas'],
  ['expense', 'operating', 'Transportation', 'Transporte', 'Transporte'],
  ['expense', 'operating', 'Accommodation', 'Hospedagem', 'Alojamiento'],
  ['expense', 'operating', 'Meals', 'Refeições', 'Comidas'],
  ['expense', 'operating', 'Insurance', 'Seguros', 'Seguros'],
  ['expense', 'operating', 'Licenses and permits', 'Licenças e permissões', 'Licencias y permisos'],
  ['expense', 'operating', 'Rent', 'Aluguel', 'Alquiler'],
  ['expense', 'operating', 'Utilities', 'Serviços públicos', 'Servicios públicos'],
  ['expense', 'operating', 'Telephone and internet', 'Telefone e internet', 'Teléfono e internet'],
  ['expense', 'operating', 'Software', 'Software', 'Software'],
  ['expense', 'operating', 'Marketing', 'Marketing', 'Marketing'],
  ['expense', 'operating', 'Professional services', 'Serviços profissionais', 'Servicios profesionales'],
  ['expense', 'operating', 'Administrative expenses', 'Despesas administrativas', 'Gastos administrativos'],
  ['expense', 'operating', 'Taxes and fees', 'Impostos e taxas', 'Impuestos y tasas'],
  ['expense', 'financial_expense', 'Bank charges', 'Tarifas bancárias', 'Cargos bancarios'],
  ['expense', 'financial_expense', 'Interest expense', 'Despesa de juros', 'Gastos por intereses'],
  ['expense', 'operating', 'Other expenses', 'Outras despesas', 'Otros gastos'],
];

export function defaultCategoryStatements(db: D1Database, ownerId: string, lang: 'en' | 'pt' | 'es') {
  const idx = lang === 'pt' ? 3 : lang === 'es' ? 4 : 2;
  return DEFAULTS.map((d) =>
    db.prepare('INSERT INTO financial_categories (id, owner_id, kind, name, dre_class) VALUES (?,?,?,?,?)')
      .bind(newId(), ownerId, d[0], d[idx] as string, d[1]));
}
