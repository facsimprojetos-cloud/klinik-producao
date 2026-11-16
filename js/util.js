// Utilidades compartilhadas
export const h = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const num = (n, d = 0) => (Number(n) || 0).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });
export const moeda = (n) => (Number(n) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export function data(d) {
  if (!d) return '';
  const s = String(d);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  const dt = new Date(s);
  return isNaN(dt) ? s : dt.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}
export function dataHora(d) {
  if (!d) return '';
  const dt = new Date(d);
  return isNaN(dt) ? String(d) : dt.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' });
}
export function hojeISO() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
}
export function token() {
  const a = new Uint8Array(16); crypto.getRandomValues(a);
  return Array.from(a, b => b.toString(16).padStart(2, '0')).join('');
}

export function toast(msg, tipo = '') {
  const raiz = document.getElementById('toast-raiz');
  const t = document.createElement('div');
  t.className = 'toast ' + tipo; t.textContent = msg;
  raiz.appendChild(t);
  setTimeout(() => t.remove(), tipo === 'erro' ? 7000 : 3500);
}

export function chip(texto, tipo = '') { return `<span class="chip ${tipo}">${h(texto)}</span>`; }

// Traduz mensagens do Postgres/PostgREST para o usuário
export function msgErro(e) {
  const m = (e && (e.message || e.details || e.hint)) || String(e);
  if (/JWT expired/i.test(m)) return 'Sua sessão expirou. Recarregue a página e entre novamente.';
  if (/permission denied/i.test(m)) return 'Você não tem permissão para esta ação.';
  if (/duplicate key/i.test(m)) return 'Já existe um registro com esse valor.';
  return m;
}

// Chama uma função do banco; mostra erro e devolve null em caso de falha
export async function chamar(db, fn, params, { silencioso = false } = {}) {
  const { data, error } = await db.rpc(fn, params);
  if (error) { if (!silencioso) toast(msgErro(error), 'erro'); return null; }
  return data ?? true;
}

export async function ler(consulta) {
  const { data, error } = await consulta;
  if (error) { toast(msgErro(error), 'erro'); throw error; }
  return data || [];
}

// ---------- Modal ----------
export function modal({ titulo, corpo, botoes = [], largo = false, aoAbrir }) {
  const raiz = document.getElementById('modal-raiz');
  const fundo = document.createElement('div');
  fundo.className = 'modal-fundo';
  fundo.innerHTML = `<div class="modal ${largo ? 'largo' : ''}" role="dialog" aria-modal="true">
    <div class="modal-cab"><h2>${h(titulo)}</h2><button type="button" data-fechar aria-label="Fechar">×</button></div>
    <div class="modal-corpo">${corpo}</div>
    <div class="modal-rod"></div></div>`;
  const fechar = () => fundo.remove();
  fundo.querySelector('[data-fechar]').onclick = fechar;
  fundo.addEventListener('mousedown', (e) => { if (e.target === fundo) fechar(); });
  const rod = fundo.querySelector('.modal-rod');
  botoes.forEach(b => {
    const el = document.createElement('button');
    el.type = 'button'; el.className = 'btn ' + (b.classe || ''); el.textContent = b.texto;
    el.onclick = async () => {
      if (!b.acao) return fechar();
      el.disabled = true;
      try { const r = await b.acao(fundo, fechar); if (r !== false && b.fecha !== false) fechar(); }
      finally { el.disabled = false; }
    };
    rod.appendChild(el);
  });
  if (!botoes.length) rod.remove();
  raiz.appendChild(fundo);
  aoAbrir && aoAbrir(fundo, fechar);
  fundo.querySelector('input,select,textarea')?.focus();
  return { el: fundo, fechar };
}

export function confirmar(titulo, texto, textoBotao = 'Confirmar', classe = 'pri') {
  return new Promise(res => {
    let ok = false;
    const m = modal({ titulo, corpo: `<p>${texto}</p>`, botoes: [
      { texto: 'Cancelar' },
      { texto: textoBotao, classe, acao: () => { ok = true; } }
    ]});
    const obs = new MutationObserver(() => { if (!document.body.contains(m.el)) { obs.disconnect(); res(ok); } });
    obs.observe(document.getElementById('modal-raiz'), { childList: true });
  });
}

// Pede um texto (ex.: motivo de exclusão). Devolve o texto ou null se cancelar.
export function pedirTexto(titulo, texto, { rotulo = 'Motivo', minimo = 3, botao = 'Confirmar', classe = 'perigo', valor = '' } = {}) {
  return new Promise(res => {
    let resultado = null;
    const m = modal({ titulo, corpo: `<p>${texto}</p><label class="campo">${h(rotulo)}<input id="pt-txt" value="${h(valor)}"></label>`, botoes: [
      { texto: 'Cancelar' },
      { texto: botao, classe, acao: (el) => {
        const v = el.querySelector('#pt-txt').value.trim();
        if (v.length < minimo) { toast(`${rotulo}: mínimo de ${minimo} caracteres.`, 'erro'); return false; }
        resultado = v;
      } }
    ]});
    const obs = new MutationObserver(() => { if (!document.body.contains(m.el)) { obs.disconnect(); res(resultado); } });
    obs.observe(document.getElementById('modal-raiz'), { childList: true });
  });
}

export function formDados(form) {
  const o = {};
  new FormData(form).forEach((v, k) => { o[k] = typeof v === 'string' ? v.trim() : v; });
  return o;
}

export function opcoes(lista, valor, rotulo = 'nome', id = 'id', vazio = 'Selecione…') {
  return (vazio !== null ? `<option value="">${h(vazio)}</option>` : '') +
    lista.map(x => `<option value="${h(x[id])}" ${String(x[id]) === String(valor ?? '') ? 'selected' : ''}>${h(x[rotulo])}</option>`).join('');
}

// ---------- Cadastros em cache ----------
const cache = {};
export async function cadastros(db, forcar = false) {
  if (!forcar && cache.v && Date.now() - cache.t < 60000) return cache.v;
  const [clientes, produtos, tecidos, cores, tecidoCores, tamanhos, parceiros, vendedores, formas] = await Promise.all([
    ler(db.from('clientes').select('*').order('nome')),
    ler(db.from('produtos').select('*').order('referencia')),
    ler(db.from('tecidos').select('*').order('nome')),
    ler(db.from('cores').select('*').order('nome')),
    ler(db.from('tecido_cores').select('*')),
    ler(db.from('tamanhos').select('*').order('ordem').order('codigo')),
    ler(db.from('parceiros').select('*').order('nome')),
    ler(db.from('vendedores').select('*').order('nome')),
    ler(db.from('formas_pagamento').select('*').order('nome')),
  ]);
  cache.v = { clientes, produtos, tecidos, cores, tecidoCores, tamanhos, parceiros, vendedores, formas }; cache.t = Date.now();
  return cache.v;
}
export function limparCache() { cache.v = null; }

export const ETAPAS = ['FACCAO', 'SILK', 'BORDADO'];
export const NOME_ETAPA = { FACCAO: 'Facção', SILK: 'Silk', BORDADO: 'Bordado' };
export function etapasTexto(lista) { return (lista || []).length ? lista.map(e => NOME_ETAPA[e] || e).join(' → ') : 'Sem etapas'; }
export function somaDias(isoData, n) { const d = new Date(isoData + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toLocaleDateString('en-CA'); }
// Postgres devolve arrays de enum como "{FACCAO,BORDADO}" em algumas views
export function arr(v) { if (Array.isArray(v)) return v; if (!v) return []; return String(v).replace(/[{}"]/g, '').split(',').filter(Boolean); }

// ---------- Impressão ----------
export function qrSvg(texto) {
  if (!window.qrcode) return '';
  const q = window.qrcode(0, 'M'); q.addData(String(texto)); q.make();
  return q.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
}

export function imprimirHtml(html) {
  const area = document.getElementById('impressao');
  area.className = '';
  area.innerHTML = html;
  setTimeout(() => window.print(), 300);
}

export function cabecalhoDoc(titulo, linha2) {
  return `<div class="topo"><div class="logo">KLINIK<small>UNIFORMES PREMIUM</small></div>
    <div class="tit"><b>${h(titulo)}</b>${h(linha2 || '')}</div></div>`;
}

// ---------- Lista suspensa com busca (abre ao clicar, filtra ao digitar) ----------
// fonte(): [{valor, rotulo, sub}] · aoEscolher(item)
let caixaAberta = null;
function fecharCaixa() { caixaAberta?.remove(); caixaAberta = null; }
document.addEventListener('mousedown', (e) => { if (caixaAberta && !e.target.closest('.ac-caixa') && !e.target.closest('[data-ac]')) fecharCaixa(); });
window.addEventListener('scroll', (e) => { if (caixaAberta && !e.target.closest?.('.ac-caixa')) fecharCaixa(); }, true);
export function autocompletar(input, fonte, aoEscolher) {
  if (!input || input.readOnly || input.disabled) return;
  input.dataset.ac = '1'; input.setAttribute('autocomplete', 'off');
  const abrir = () => {
    fecharCaixa();
    const t = input.value.trim().toLowerCase();
    const todos = fonte();
    let lista = todos.filter(x => !t || (x.rotulo + ' ' + (x.sub || '')).toLowerCase().includes(t));
    if (!lista.length && t) lista = todos; // nada bateu: mostra tudo
    const r = input.getBoundingClientRect();
    const cx = document.createElement('div');
    cx.className = 'ac-caixa';
    cx.style.cssText = `left:${r.left + window.scrollX}px;top:${r.bottom + window.scrollY + 2}px;min-width:${Math.max(r.width, 240)}px`;
    cx.innerHTML = `<div class="ac-info">${lista.length} opção(ões)${t ? ' · filtrando por "' + h(input.value.trim()) + '"' : ''}</div>` +
      (lista.slice(0, 80).map((x, i) => `<button type="button" data-i="${i}"><b>${h(x.rotulo)}</b>${x.sub ? `<small>${h(x.sub)}</small>` : ''}</button>`).join('') || '<div class="ac-info">Nenhum cadastro. Pode digitar livremente.</div>');
    cx.querySelectorAll('button').forEach(b => b.onmousedown = (e) => { e.preventDefault(); const it = lista[+b.dataset.i]; input.value = it.valor; fecharCaixa(); aoEscolher && aoEscolher(it); });
    document.body.appendChild(cx); caixaAberta = cx;
  };
  input.addEventListener('focus', abrir);
  input.addEventListener('click', abrir);
  input.addEventListener('input', abrir);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') fecharCaixa();
    if (e.key === 'Enter' && caixaAberta) { const b = caixaAberta.querySelector('button'); if (b) { e.preventDefault(); b.dispatchEvent(new MouseEvent('mousedown')); } }
    if (e.key === 'Tab') fecharCaixa();
  });
}
