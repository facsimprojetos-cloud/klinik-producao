// Itens dos pedidos (detalhe de venda): todos os itens, um embaixo do outro,
// para selecionar itens de pedidos diferentes e formar uma OP.
import { db, tem } from '../app.js';
import { h, num, data, chip, modal, ler, chamar, toast, confirmar, etapasTexto, arr, ETAPAS } from '../util.js';
import { imprimirFolhaOp } from '../acoes.js';

let busca = '';
let mostrar = 'saldo';      // saldo | todos
let agrupar = true;
const CORTE = { CORTADO: ['Cortado', 'ok'], EM_CORTE: ['Em corte', 'alerta'], AGUARDANDO: ['Aguardando corte', 'info'], SEM_FICHA: ['Sem folha de corte', 'erro'] };
const sel = new Map();      // pedido_item_id -> { qtd, etapas, linha }
let linhas = [];

const chaveEtapas = (i) => arr(i.etapas).join(',');

export async function render(el) {
  const vindo = sessionStorage.getItem('itens_busca');
  if (vindo != null) { busca = vindo; mostrar = 'cortado'; sessionStorage.removeItem('itens_busca'); }
  linhas = await ler(db.from('v_detalhe_venda').select('*')
    .order('previsao_entrega', { ascending: true, nullsFirst: false }).order('pedido_numero').order('ordem'));
  // descarta seleção de itens que não têm mais saldo
  for (const [id] of sel) { const l = linhas.find(x => x.pedido_item_id === id); if (!l || l.disponivel_op <= 0) sel.delete(id); }
  desenhar(el);
}

function filtradas() {
  const t = busca.trim().toLowerCase();
  return linhas.filter(i => (mostrar === 'todos' || (mostrar === 'cortado' ? i.disponivel_op > 0 : i.saldo > 0)) &&
    (!t || [i.pedido_numero, i.cliente_nome, i.referencia, i.descricao, i.tecido, i.cor, i.tamanho, i.silk_desc, i.bordado_desc, i.ops]
      .join(' ').toLowerCase().includes(t)));
}

function desenhar(el) {
  const podeOp = tem('producao');
  const lista = filtradas();
  const grupos = [];
  lista.forEach(i => {
    const g = agrupar ? i.pedido_id : 'todos';
    let gr = grupos.find(x => x.id === g);
    if (!gr) grupos.push(gr = { id: g, itens: [] });
    gr.itens.push(i);
  });
  const linhaHtml = (i) => {
    const s = sel.get(i.pedido_item_id);
    const bloqueado = i.disponivel_op <= 0 || !podeOp;
    const motivo = i.saldo <= 0 ? 'Item já está todo em OP' : i.disponivel_op <= 0 ? 'Ainda não foi cortado: finalize a folha de corte' : !podeOp ? 'Precisa do perfil produção' : '';
    return `<tr class="${s ? 'sel' : ''} ${i.saldo <= 0 ? 'apagado' : ''}" data-id="${i.pedido_item_id}">
      <td><input type="checkbox" data-sel="${i.pedido_item_id}" ${s ? 'checked' : ''} ${bloqueado && !s ? 'disabled' : ''} title="${h(motivo)}"></td>
      ${agrupar ? '' : `<td class="forte">${h(i.pedido_numero)}</td><td>${h(i.cliente_nome)}</td>`}
      <td><b>${h(i.referencia || '')}</b> ${h(i.descricao || '')}${i.funcionarios ? `<div class="peq muted">${i.funcionarios} funcionário(s)</div>` : ''}</td>
      <td>${h(i.tecido || '')}</td><td>${h(i.cor || '')}</td><td>${h(i.tamanho || '')}</td>
      <td class="peq">${h(etapasTexto(arr(i.etapas)))}${[i.silk_desc && 'Silk: ' + i.silk_desc, i.bordado_desc && 'Bordado: ' + i.bordado_desc].filter(Boolean).map(x => `<div class="muted">${h(x)}</div>`).join('')}</td>
      <td class="n">${num(i.quantidade)}</td><td class="n">${num(i.em_op)}</td>
      <td class="n forte">${i.saldo > 0 ? num(i.saldo) : chip('em OP', 'ok')}</td>
      <td>${CORTE[i.corte_status] ? chip(CORTE[i.corte_status][0] + (i.corte_status === 'CORTADO' && i.cortado < i.quantidade ? ` (${num(i.cortado)})` : ''), CORTE[i.corte_status][1]) : ''}</td>
      <td class="n">${s ? `<input class="inp num" type="number" min="1" max="${i.disponivel_op}" value="${s.qtd}" data-q="${i.pedido_item_id}">` : ''}</td>
      <td class="peq">${h(i.ops || '')}</td></tr>`;
  };
  const cols = agrupar ? 12 : 14;
  const cabTabela = `<thead><tr><th></th>${agrupar ? '' : '<th>Pedido</th><th>Cliente</th>'}<th>Produto</th><th>Tecido</th><th>Cor</th><th>Tam.</th><th>Etapas</th>
    <th class="n">Qtd</th><th class="n">Em OP</th><th class="n">Saldo</th><th>Corte</th><th class="n">Na OP</th><th>OPs</th></tr></thead>`;
  const corpo = grupos.map(g => {
    const i0 = g.itens[0];
    const livres = g.itens.filter(i => i.disponivel_op > 0 && podeOp);
    const cabGrupo = agrupar ? `<tr class="grupo-ped"><td><input type="checkbox" data-grupo="${g.id}" ${livres.length && livres.every(i => sel.has(i.pedido_item_id)) ? 'checked' : ''} ${livres.length ? '' : 'disabled'} title="Marcar os itens deste pedido"></td>
      <td colspan="${cols - 1}"><b>Pedido ${h(i0.pedido_numero)}</b> · ${h(i0.cliente_nome)} · entrega ${data(i0.previsao_entrega) || '—'}
      ${i0.previsao_entrega && i0.previsao_entrega < new Date().toISOString().slice(0, 10) ? chip('Atrasado', 'erro') : ''}
      <span class="muted peq"> · ${g.itens.length} item(ns) · saldo ${num(g.itens.reduce((a, i) => a + Math.max(i.saldo, 0), 0))} peças</span></td></tr>` : '';
    return cabGrupo + g.itens.map(linhaHtml).join('');
  }).join('') || `<tr><td colspan="${cols}" class="vazio">${linhas.length ? 'Nada com esse filtro.' : 'Nenhum pedido em andamento.'}</td></tr>`;

  const vals = [...sel.values()];
  const pecas = vals.reduce((a, v) => a + (+v.qtd || 0), 0);
  const pedidosSel = new Set(vals.map(v => v.linha.pedido_numero));
  el.innerHTML = `
    <div class="cab"><div><h1>Itens dos pedidos</h1>
      <p>Todos os itens (detalhe de venda) um embaixo do outro. Marque itens de um ou de vários pedidos e crie a OP. Só entram em OP peças já cortadas.</p></div></div>
    <div class="filtros">
      <label class="campo">Buscar<input id="busca" value="${h(busca)}" placeholder="Pedido, cliente, produto, cor, tamanho, OP…"></label>
      <label class="campo" style="max-width:220px">Mostrar<select id="mostrar">
        <option value="cortado" ${mostrar === 'cortado' ? 'selected' : ''}>Cortados, prontos para OP</option>
        <option value="saldo" ${mostrar === 'saldo' ? 'selected' : ''}>Sem OP (cortados ou não)</option>
        <option value="todos" ${mostrar === 'todos' ? 'selected' : ''}>Todos os itens</option></select></label>
      <label class="campo" style="max-width:200px;flex:0">&nbsp;<span style="display:flex;gap:6px;align-items:center;min-height:42px;white-space:nowrap">
        <input type="checkbox" id="agrupar" ${agrupar ? 'checked' : ''} style="width:auto;min-height:0;margin:0"> Agrupar por pedido</span></label>
    </div>
    <div class="tabela-wrap"><table class="tab-itens">${cabTabela}<tbody>${corpo}</tbody></table></div>
    <div style="height:70px"></div>
    ${sel.size ? `<div class="barra-sel">
      <div><b>${sel.size} item(ns)</b> · ${num(pecas)} peças · ${pedidosSel.size} pedido(s) <span class="muted peq">(${h([...pedidosSel].join(', '))})</span></div>
      <div style="display:flex;gap:8px"><button class="btn" id="limpar">Limpar</button><button class="btn pri" id="criar">Criar OP</button></div></div>` : ''}`;

  const re = () => desenhar(el);
  const elBusca = el.querySelector('#busca');
  elBusca.oninput = () => { busca = elBusca.value; const pos = elBusca.selectionStart; re(); const b = el.querySelector('#busca'); b.focus(); b.setSelectionRange(pos, pos); };
  el.querySelector('#mostrar').onchange = (e) => { mostrar = e.target.value; re(); };
  el.querySelector('#agrupar').onchange = (e) => { agrupar = e.target.checked; re(); };
  el.querySelectorAll('[data-sel]').forEach(c => c.onchange = () => {
    const i = linhas.find(x => x.pedido_item_id === c.dataset.sel);
    if (c.checked) sel.set(i.pedido_item_id, { qtd: i.disponivel_op, etapas: chaveEtapas(i), linha: i }); else sel.delete(i.pedido_item_id);
    re();
  });
  el.querySelectorAll('[data-grupo]').forEach(c => c.onchange = () => {
    const itens = linhas.filter(i => i.pedido_id === c.dataset.grupo && i.disponivel_op > 0);
    if (!itens.length) return re();
    if (c.checked) itens.forEach(i => sel.set(i.pedido_item_id, { qtd: i.disponivel_op, etapas: chaveEtapas(i), linha: i }));
    else itens.forEach(i => sel.delete(i.pedido_item_id));
    re();
  });
  el.querySelectorAll('[data-q]').forEach(inp => inp.onchange = () => {
    const s = sel.get(inp.dataset.q); let v = Math.round(+inp.value || 0);
    v = Math.max(1, Math.min(v, s.linha.disponivel_op)); inp.value = v; s.qtd = v; re();
  });
  el.querySelector('#limpar')?.addEventListener('click', () => { sel.clear(); re(); });
  el.querySelector('#criar')?.addEventListener('click', () => criarOp(el));
}

function criarOp(el) {
  const vals = [...sel.values()];
  const resumo = vals.map(v => `<tr><td>${h(v.linha.pedido_numero)}</td><td>${h(v.linha.cliente_nome)}</td>
    <td>${h([v.linha.referencia, v.linha.descricao].filter(Boolean).join(' '))}</td><td>${h(v.linha.cor || '')}</td><td>${h(v.linha.tamanho || '')}</td><td class="n">${num(v.qtd)}</td></tr>`).join('');
  modal({
    titulo: 'Criar OP', largo: true,
    corpo: `<p class="muted peq">Etapas da OP: <b>${h(etapasTexto([...new Set(vals.flatMap(v => arr(v.linha.etapas)))].sort((a, b) => ETAPAS.indexOf(a) - ETAPAS.indexOf(b))))}</b>. Cada item segue as próprias etapas.</p>
      <div class="tabela-wrap"><table><thead><tr><th>Pedido</th><th>Cliente</th><th>Produto</th><th>Cor</th><th>Tam.</th><th class="n">Qtd</th></tr></thead>
      <tbody>${resumo}</tbody></table></div>
      <div class="grade g2" style="margin-top:10px">
        <label class="campo">Descrição da OP<input id="op-desc" placeholder="Ex.: Calças retas brancas"></label>
        <label class="campo">Observação<input id="op-obs"></label></div>`,
    botoes: [{ texto: 'Voltar' }, { texto: 'Criar OP', classe: 'pri', acao: async (m) => {
      const op = await chamar(db, 'criar_op', {
        p_itens: vals.map(v => ({ pedido_item_id: v.linha.pedido_item_id, quantidade: +v.qtd })),
        p_descricao: m.querySelector('#op-desc').value, p_observacao: m.querySelector('#op-obs').value });
      if (!op) return false;
      sel.clear();
      toast(`OP ${op.numero} criada.`, 'ok');
      render(el);
      if (await confirmar('OP criada', `Imprimir a folha da <b>OP ${op.numero}</b> para o parceiro?`, 'Imprimir')) imprimirFolhaOp(op.id);
    } }]
  });
}
