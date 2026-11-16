// Configuração pública do app (a chave publicável do Supabase é feita para ficar no front-end;
// a proteção dos dados é feita por login + RLS + funções com checagem de perfil no banco).
export const SUPABASE_URL = 'https://swledaccsxcqpffjvtdh.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_CP90sN-553zB3BfUW05NTA_S5ZVPNrP';
export const SCHEMA = 'klinik';
export const EMPRESA = 'KLINIK';
export const PREVISAO_DIAS = 7;

// Dados que saem no PDF do orçamento. Edite aqui quando algo mudar.
export const EMPRESA_PDF = {
  nome: 'KLINIK Uniformes Premium',
  cidade: 'Curitiba',
  assunto: 'Orçamento referente a uniformes de alto padrão',
  entradaPercentual: 50,
  pixDescontoPercentual: 5,
  cartaoParcelas: 2,
  banco: ['Banco do Brasil · PIX: 41999230065', 'Roberto Kulig · Ag.: 1534-2 · C/C: 23.776-0'],
  informacoes: [
    'Nossos jalecos e uniformes são produzidos nos tamanhos PP até GG.',
    'Pedidos sob medida serão acrescidos de 30% do valor da peça.',
    'Não fazemos ajustes de uniformes. Caso solicite ajustes, será cobrado por ponto ajustado (ex.: cós, perna, barra, acinturar etc.).',
    'Este pedido é produzido exclusivamente e com personalização para a sua empresa e colaboradores.',
    'Não aceitamos devolução de pedidos produzidos.'
  ],
  despedida: ['Estamos à sua disposição para qualquer esclarecimento.', 'Grata.', 'Equipe Klinik'],
  rodape: 'www.klinik.com.br · klinik@klinik.com.br · Tel/WhatsApp: (41) 3244-6976 · (41) 99923-0065 · Rua Hermes Fontes, 37 – Batel – Curitiba/PR'
};
