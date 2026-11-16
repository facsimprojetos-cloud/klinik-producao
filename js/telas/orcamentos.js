import { db, tem } from '../app.js';
import { EMPRESA_PDF } from '../config.js';
import {
  h, num, moeda, data, chip, ler, toast, msgErro, confirmar, hojeISO, cadastros, limparCache,
  ETAPAS, NOME_ETAPA, etapasTexto, arr, imprimirHtml, cabecalhoDoc
} from '../util.js';
import { tabelaFuncionarios } from '../acoes.js';

const COLS = [
  { st: 'ELABORACAO', nome: 'Em elaboração' }, { st: 'ENVIADO', nome: 'Enviado' },
  { st: 'AGUARDANDO', nome: 'Aguardando aprovação' }, { st: 'APROVADO', nome: 'Aprovado' }, { st: 'PEDIDO', nome: 'Virou pedido' },
];
const MED = [['torax', 'Tórax'], ['busto', 'Busto'], ['cintura', 'Cintura'], ['quadril', 'Quadril'], ['manga', 'Manga'], ['comprimento', 'Comp.']];
let busca = '';
let el0 = null;
let reg = null;      // orçamento aberto no editor
let sujo = false;
let cad = null;

export async function render(el) {
  el0 = el; el.oninput = null; el.onchange = null;
  if (reg) return editor();
  const lista = await ler(db.from('v_orcamentos').select('*').neq('status', 'CANCELADO').order('criado_em', { ascending: false }).limit(400));
  const pode = tem('comercial');
  const f = lista.filter(o => !busca || [o.numero, o.cliente_nome, o.vendedor, o.pedido_numero].join(' ').toLowerCase().includes(busca.toLowerCase()));
  el.innerHTML = `
    <div class="cab"><div><h1>Orçamentos</h1><p>Arraste o cartão para a próxima coluna. Clique para abrir e editar.</p></div>
      ${pode ? '<button class="btn acento" id="novo">+ Novo orçamento</button>' : ''}</div>
    <div class="filtros"><label class="campo">Buscar<input id="busca" value="${h(busca)}" placeholder="Cliente, número, vendedor…"></label></div>
    <div class="kanban">${COLS.map(c => {
      let cards = f.filter(o => o.status === c.st);
      const soma = cards.reduce((a, o) => a + Number(o.total), 0), n = cards.length;
      if (c.st === 'PEDIDO') cards = cards.slice(0, 20);
      return `<section class="kcol" data-col="${c.st}"><div class="kcol-cab">${c.nome}<small>${n} · ${moeda(soma)}</small></div>
        ${cards.map(o => `<article class="kcard ${c.st !== 'PEDIDO' && pode ? 'arrasta' : ''} ${o.status === 'APROVADO' ? 'pronto' : ''}" data-id="${o.id}" draggable="${c.st !== 'PEDIDO' && pode}">
          <div class="t"><span>${h(o.cliente_nome)}</span></div>
          <div class="d">${h(o.numero)} · rev. ${o.revisao}${o.pedido_numero ? ' · Pedido ' + h(o.pedido_numero) : ''}</div>
          <div class="t" style="margin-top:4px"><span class="q">${moeda(o.total)}</span><span class="d">${data(o.data)}</span></div>
          ${o.vendedor ? `<div class="d">${h(o.vendedor)}</div>` : ''}
          ${c.st !== 'PEDIDO' && !o.pdf_atualizado ? `<div class="d">${chip('PDF desatualizado', 'alerta')}</div>` : ''}
          ${c.st !== 'PEDIDO' && pode ? `<select class="inp" data-mover="${o.id}" style="margin-top:6px;min-height:32px;padding:4px"><option value="">Mover para…</option>
            ${COLS.filter(x => x.st !== c.st && x.st !== 'PEDIDO').map(x => `<option value="${x.st}">${x.nome}</option>`).join('')}</select>` : ''}
        </article>`).join('') || '<div class="kvazio">Nenhum orçamento</div>'}</section>`;
    }).join('')}</div>`;

  el.querySelector('#busca').onchange = (e) => { busca = e.target.value; render(el); };
  el.querySelector('#novo')?.addEventListener('click', () => abrir(null));
  el.querySelectorAll('.kcard').forEach(k => {
    k.onclick = (e) => { if (!e.target.closest('select')) abrir(k.dataset.id); };
    k.ondragstart = (e) => e.dataTransfer.setData('text/plain', k.dataset.id);
  });
  el.querySelectorAll('.kcol').forEach(col => {
    col.ondragover = (e) => { if (col.dataset.col !== 'PEDIDO') { e.preventDefault(); col.classList.add('over'); } };
    col.ondragleave = () => col.classList.remove('over');
    col.ondrop = (e) => { e.preventDefault(); col.classList.remove('over'); mover(e.dataTransfer.getData('text/plain'), col.dataset.col); };
  });
  el.querySelectorAll('[data-mover]').forEach(s => s.onchange = () => s.value && mover(s.dataset.mover, s.value));
}

async function mover(id, st) {
  const { error } = await db.rpc('orcamento_mover', { p_id: id, p_status: st });
  if (error) toast(msgErro(error), 'erro'); else toast('Orçamento movido.', 'ok');
  render(el0);
}

// ---------- Editor ----------
function itemVazio(tipo = 'PRODUTO') {
  return { tipo, produto_id: null, referencia: '', descricao: tipo === 'FRETE' ? 'Frete' : '', tecido: '', cor: '', tamanho: '', quantidade: 1,
    valor_unitario: 0, observacao: '', etapas: tipo === 'PRODUTO' ? ['FACCAO'] : [], silk_desc: '', bordado_desc: '', funcionarios: [] };
}

async function abrir(id) {
  cad = await cadastros(db);
  if (!id) {
    reg = { id: null, numero: '', status: 'ELABORACAO', revisao: 0, cliente_id: null, cliente_nome: '', data: hojeISO(), vendedor: '', pre_venda: '',
      forma_pagamento: '', parcelas: '', prazo_dias_uteis: 45, previsao_entrega: '', validade_dias: 15, observacoes: '', itens: [itemVazio()] };
    sujo = true;
  } else {
    const [[o], itens] = await Promise.all([
      ler(db.from('v_orcamentos').select('*').eq('id', id)),
      ler(db.from('orcamento_itens').select('*').eq('orcamento_id', id).order('ordem')),
    ]);
    const funcs = itens.length ? await ler(db.from('orcamento_funcionarios').select('*').in('item_id', itens.map(i => i.id)).order('ordem')) : [];
    reg = { ...o, itens: itens.map(i => ({ ...i, etapas: arr(i.etapas), funcionarios: funcs.filter(f => f.item_id === i.id) })) };
    sujo = false;
  }
  editor();
}

const travado = () => ['PEDIDO', 'CANCELADO'].includes(reg.status) || !tem('comercial');

function campoItem(i, k, rot, opts = {}) {
  const v = reg.itens[i][k] ?? '';
  return `<label class="campo">${rot}<input data-i="${i}" data-k="${k}" value="${h(v)}" ${opts.list ? `list="${opts.list}"` : ''} ${opts.type ? `type="${opts.type}" step="any" min="0"` : ''} ${opts.ro ? 'readonly' : ''}></label>`;
}

function grade(funcs) {
  const m = new Map();
  funcs.forEach(f => { const t = (f.tamanho || '?').toUpperCase(); m.set(t, (m.get(t) || 0) + (+f.quantidade || 1)); });
  return [...m.entries()].map(([t, q]) => `${t}: ${q}`).join(' · ');
}

function htmlItem(it, i) {
  const fr = it.tipo === 'FRETE', pr = it.tipo === 'PRODUTO', porLista = !fr && it.funcionarios.length > 0;
  const qtd = porLista ? it.funcionarios.reduce((a, f) => a + (+f.quantidade || 1), 0) : it.quantidade;
  const coresTecido = (() => {
    const t = cad.tecidos.find(x => x.nome.toLowerCase() === String(it.tecido || '').toLowerCase());
    const ids = t ? cad.tecidoCores.filter(tc => tc.tecido_id === t.id).map(tc => tc.cor_id) : [];
    return ids.length ? cad.cores.filter(c => ids.includes(c.id)) : cad.cores;
  })();
  return `<article class="item-orc" data-item="${i}">
    <div class="io-cab"><b>Item ${i + 1}</b>
      <div class="acoes"><select class="inp" data-i="${i}" data-k="tipo" style="min-height:34px;padding:4px 8px;width:auto">${['PRODUTO', 'SERVICO', 'FRETE'].map(t => `<option ${it.tipo === t ? 'selected' : ''} value="${t}">${t === 'SERVICO' ? 'Serviço' : t === 'FRETE' ? 'Frete' : 'Produto'}</option>`).join('')}</select>
        <button class="btn peq perigo" data-rem-item="${i}">Remover</button></div></div>
    <div class="io-corpo">
      <div class="grade g4">
        ${pr ? `<label class="campo">Produto cadastrado<input data-i="${i}" data-prod list="dl-prod" placeholder="Referência ou nome" value="${h(it.referencia ? it.referencia + ' · ' + it.descricao : '')}"></label>` : ''}
        ${pr ? campoItem(i, 'referencia', 'Referência') : ''}
        ${campoItem(i, 'descricao', 'Descrição *')}
        ${pr ? campoItem(i, 'tecido', 'Tecido', { list: 'dl-tecido' }) : ''}
        ${pr ? `${campoItem(i, 'cor', 'Cor', { list: 'dl-cor-' + i })}<datalist id="dl-cor-${i}">${coresTecido.map(c => `<option value="${h(c.nome)}">`).join('')}</datalist>` : ''}
        ${!fr ? `<label class="campo">${porLista ? 'Grade (pela lista)' : 'Tamanho'}<input data-i="${i}" data-k="tamanho" list="dl-tam" value="${h(porLista ? grade(it.funcionarios) : it.tamanho || '')}" ${porLista ? 'readonly' : ''}></label>` : ''}
        <label class="campo">Quantidade<input data-i="${i}" data-k="quantidade" type="number" min="1" step="1" value="${qtd}" ${porLista ? 'readonly' : ''}></label>
        ${campoItem(i, 'valor_unitario', 'Valor unitário (R$)', { type: 'number' })}
      </div>
      ${pr ? `<div class="card" style="margin:12px 0 0;padding:10px;background:#f8f7f4">
        <b>Etapas de produção</b> <span class="muted peq">(marque o que esta variação vai ter)</span>
        <div class="grade g3" style="margin-top:6px">
          ${ETAPAS.map(e => `<div><label class="peq forte"><input type="checkbox" data-i="${i}" data-etapa="${e}" ${it.etapas.includes(e) ? 'checked' : ''}> ${NOME_ETAPA[e]}</label>
            ${e !== 'FACCAO' ? `<input class="inp" data-i="${i}" data-k="${e === 'SILK' ? 'silk_desc' : 'bordado_desc'}" placeholder="O que vai ter (ex.: logo peito)" value="${h(it[e === 'SILK' ? 'silk_desc' : 'bordado_desc'] || '')}" ${it.etapas.includes(e) ? '' : 'disabled'}>` : ''}</div>`).join('')}
        </div></div>` : ''}
      ${!fr ? `<div style="margin-top:12px"><div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
          <b>Funcionários e medidas</b><span class="acoes"><button class="btn peq" data-add-func="${i}">+ Funcionário</button>${i > 0 ? `<button class="btn peq" data-copiar="${i}">Copiar nomes do item anterior</button>` : ''}</span></div>
        ${it.funcionarios.length ? `<div class="tabela-wrap func-tab" style="margin-top:6px"><table><thead><tr><th>Nome *</th><th>Qtd</th><th>Tam. *</th>${MED.map(([, r]) => `<th>${r}</th>`).join('')}<th>Outras</th><th>Ajustes</th><th>Obs.</th><th></th></tr></thead>
          <tbody>${it.funcionarios.map((f, j) => `<tr><td><input data-i="${i}" data-f="${j}" data-fk="nome" value="${h(f.nome || '')}" style="min-width:140px"></td>
            <td><input data-i="${i}" data-f="${j}" data-fk="quantidade" type="number" min="1" value="${f.quantidade || 1}"></td>
            <td><input data-i="${i}" data-f="${j}" data-fk="tamanho" list="dl-tam" value="${h(f.tamanho || '')}"></td>
            ${MED.map(([k]) => `<td><input data-i="${i}" data-f="${j}" data-fk="${k}" inputmode="decimal" value="${h(f[k] ?? '')}"></td>`).join('')}
            <td><input data-i="${i}" data-f="${j}" data-fk="outras" value="${h(f.outras || '')}"></td><td><input data-i="${i}" data-f="${j}" data-fk="ajustes" value="${h(f.ajustes || '')}"></td>
            <td><input data-i="${i}" data-f="${j}" data-fk="observacao" value="${h(f.observacao || '')}"></td>
            <td><button class="btn peq perigo" data-rem-func="${i}:${j}">×</button></td></tr>`).join('')}</tbody></table></div>`
          : '<p class="muted peq">Opcional. Use quando cada funcionário tiver tamanho, medidas ou ajustes próprios.</p>'}
        <label class="campo" style="margin-top:8px">Observação do item (sai no PDF, na folha de corte e na OP)<input data-i="${i}" data-k="observacao" value="${h(it.observacao || '')}" placeholder="Ex.: bordado do logo no peito esquerdo"></label>
      </div>` : ''}
      <div style="text-align:right;margin-top:8px" class="forte">${moeda(qtd * (+it.valor_unitario || 0))}</div>
    </div></article>`;
}

function totais() {
  let t = 0, frete = 0;
  reg.itens.forEach(it => {
    const q = it.tipo !== 'FRETE' && it.funcionarios.length ? it.funcionarios.reduce((a, f) => a + (+f.quantidade || 1), 0) : +it.quantidade || 0;
    const v = q * (+it.valor_unitario || 0); t += v; if (it.tipo === 'FRETE') frete += v;
  });
  return { t, frete };
}

function editor() {
  const el = el0, tr = travado(), o = reg;
  const cab = (k, rot, tipo = 'text', extra = '') => `<label class="campo">${rot}<input data-cab="${k}" type="${tipo}" value="${h(o[k] ?? '')}" ${extra}></label>`;
  const { t } = totais();
  el.innerHTML = `
    <div class="cab"><div><h1>${o.id ? 'Orçamento ' + h(o.numero) : 'Novo orçamento'}</h1>
      <p>${o.id ? `${chip(COLS.find(c => c.st === o.status)?.nome || o.status, o.status === 'APROVADO' ? 'ok' : 'info')} · revisão ${o.revisao}${o.pdf_atualizado ? ' · PDF em dia' : o.id ? ' · ' + chip('PDF desatualizado', 'alerta') : ''}${o.pedido_numero ? ' · Pedido ' + h(o.pedido_numero) : ''}` : 'Preencha e salve.'}</p></div>
      <button class="btn" id="voltar">← Voltar ao quadro</button></div>
    <fieldset ${tr ? 'disabled' : ''} style="border:0;padding:0;margin:0">
    <div class="card"><div class="grade g4">
      <label class="campo" style="grid-column:span 2">Cliente *<input data-cab="cliente_nome" list="dl-cli" value="${h(o.cliente_nome || '')}" placeholder="Digite para buscar no cadastro"></label>
      ${cab('data', 'Data do orçamento', 'date')}
      ${cab('validade_dias', 'Validade (dias)', 'number', 'min="0"')}
      ${cab('vendedor', 'Vendedor', 'text', 'list="dl-vend"')}
      ${cab('pre_venda', 'Pré-venda / responsável')}
      ${cab('forma_pagamento', 'Forma de pagamento', 'text', 'list="dl-forma"')}
      ${cab('parcelas', 'Parcelas', 'number', 'min="0"')}
      ${cab('prazo_dias_uteis', 'Prazo (dias úteis)', 'number', 'min="0"')}
      ${cab('previsao_entrega', 'Previsão de entrega', 'date')}
      <label class="campo" style="grid-column:1/-1">Observações e condições para o cliente<textarea data-cab="observacoes" class="inp">${h(o.observacoes || '')}</textarea></label>
    </div>
    ${o.cliente_id ? '' : '<p class="muted peq" style="margin:6px 0 0">Cliente novo? Ele é cadastrado em Cadastros › Clientes; no orçamento basta o nome.</p>'}</div>
    <div class="cab"><h2>Produtos e serviços</h2><div class="acoes">
      <button class="btn" data-add="PRODUTO">+ Produto</button><button class="btn" data-add="SERVICO">+ Serviço</button><button class="btn" data-add="FRETE">+ Frete</button></div></div>
    <div id="itens">${o.itens.map(htmlItem).join('')}</div>
    </fieldset>
    <datalist id="dl-cli">${cad.clientes.map(c => `<option value="${h(c.nome)}">${h(c.documento || '')}</option>`).join('')}</datalist>
    <datalist id="dl-prod">${cad.produtos.filter(p => p.ativo).map(p => `<option value="${h(p.referencia + ' · ' + p.nome)}">`).join('')}</datalist>
    <datalist id="dl-tecido">${cad.tecidos.map(x => `<option value="${h(x.nome)}">`).join('')}</datalist>
    <datalist id="dl-tam">${cad.tamanhos.map(x => `<option value="${h(x.codigo)}">`).join('')}</datalist>
    <datalist id="dl-vend">${cad.vendedores.map(x => `<option value="${h(x.nome)}">`).join('')}</datalist>
    <datalist id="dl-forma">${cad.formas.map(x => `<option value="${h(x.nome)}">`).join('')}</datalist>
    <div class="total-barra"><div>Total do orçamento <b id="tot">${moeda(t)}</b></div>
      <div class="acoes">
        ${!tr ? `<button class="btn pri" id="salvar">${sujo ? 'Salvar' : 'Salvo'}</button>` : ''}
        ${o.id ? '<button class="btn" id="pdf">Gerar PDF</button>' : ''}
        ${o.id && !tr && o.status !== 'APROVADO' ? '<button class="btn" id="aprovar">Registrar aprovação</button>' : ''}
        ${o.id && !tr && o.status === 'APROVADO' ? '<button class="btn acento" id="pedido">Virar pedido</button>' : ''}
        ${o.id && !tr ? '<button class="btn perigo" id="cancelar">Cancelar orçamento</button>' : ''}
      </div></div>`;

  el.querySelector('#voltar').onclick = async () => {
    if (sujo && !tr && !await confirmar('Sair sem salvar?', 'Há alterações não salvas neste orçamento.', 'Sair sem salvar', 'perigo')) return;
    reg = null; render(el);
  };
  if (tr) { ligarSaida(); return; }

  el.oninput = aoDigitar;
  el.onchange = aoMudar;
  el.querySelectorAll('[data-add]').forEach(b => b.onclick = () => { reg.itens.push(itemVazio(b.dataset.add)); marcar(); editor(); });
  el.querySelectorAll('[data-rem-item]').forEach(b => b.onclick = () => { reg.itens.splice(+b.dataset.remItem, 1); marcar(); editor(); });
  el.querySelectorAll('[data-add-func]').forEach(b => b.onclick = () => { reg.itens[+b.dataset.addFunc].funcionarios.push({ nome: '', quantidade: 1, tamanho: '' }); marcar(); editor(); });
  el.querySelectorAll('[data-rem-func]').forEach(b => b.onclick = () => { const [i, j] = b.dataset.remFunc.split(':').map(Number); reg.itens[i].funcionarios.splice(j, 1); marcar(); editor(); });
  el.querySelectorAll('[data-copiar]').forEach(b => b.onclick = () => {
    const i = +b.dataset.copiar, ant = [...reg.itens.slice(0, i)].reverse().find(x => x.funcionarios.length);
    if (!ant) return toast('Nenhum item anterior tem funcionários.', 'erro');
    const ja = new Set(reg.itens[i].funcionarios.map(f => (f.nome || '').toLowerCase()));
    ant.funcionarios.filter(f => f.nome && !ja.has(f.nome.toLowerCase())).forEach(f => reg.itens[i].funcionarios.push({ nome: f.nome, quantidade: 1, tamanho: '' }));
    marcar(); editor();
  });
  el.querySelector('#salvar').onclick = salvar;
  ligarSaida();
}

function ligarSaida() {
  const el = el0;
  el.querySelector('#pdf')?.addEventListener('click', gerarPdf);
  el.querySelector('#aprovar')?.addEventListener('click', async () => {
    if (sujo && !await salvar()) return;
    if (!await confirmar('Aprovação do cliente', 'O cliente aprovou exatamente esta revisão do orçamento?', 'Sim, aprovou')) return;
    const { error } = await db.rpc('orcamento_mover', { p_id: reg.id, p_status: 'APROVADO' });
    if (error) return toast(msgErro(error), 'erro');
    toast('Aprovação registrada.', 'ok'); abrir(reg.id);
  });
  el.querySelector('#pedido')?.addEventListener('click', virarPedido);
  el.querySelector('#cancelar')?.addEventListener('click', async () => {
    if (!await confirmar('Cancelar orçamento', `Cancelar o orçamento <b>${h(reg.numero)}</b>? Ele sai do quadro.`, 'Cancelar orçamento', 'perigo')) return;
    const { error } = await db.rpc('orcamento_mover', { p_id: reg.id, p_status: 'CANCELADO' });
    if (error) return toast(msgErro(error), 'erro');
    toast('Orçamento cancelado.', 'ok'); reg = null; render(el0);
  });
}

function marcar() { sujo = true; const b = el0.querySelector('#salvar'); if (b) b.textContent = 'Salvar'; const t = el0.querySelector('#tot'); if (t) t.textContent = moeda(totais().t); }

function aoDigitar(e) {
  const x = e.target; if (!reg) return;
  if (x.dataset.cab) { reg[x.dataset.cab] = x.value; if (x.dataset.cab === 'cliente_nome') reg.cliente_id = cad.clientes.find(c => c.nome === x.value)?.id || null; marcar(); return; }
  if (x.dataset.i === undefined) return;
  const it = reg.itens[+x.dataset.i];
  if (x.dataset.fk) { it.funcionarios[+x.dataset.f][x.dataset.fk] = x.value; marcar(); return; }
  if (x.dataset.k) { it[x.dataset.k] = x.value; marcar(); }
}

function aoMudar(e) {
  const x = e.target; if (!reg) return;
  if (x.dataset.i === undefined) return;
  const i = +x.dataset.i, it = reg.itens[i];
  if (x.dataset.prod !== undefined) {
    const p = cad.produtos.find(p => p.referencia + ' · ' + p.nome === x.value || p.referencia.toLowerCase() === x.value.toLowerCase());
    if (p) { it.produto_id = p.id; it.referencia = p.referencia; it.descricao = p.nome; if (p.preco != null && !+it.valor_unitario) it.valor_unitario = p.preco; if (p.tecido_base && !it.tecido) it.tecido = p.tecido_base; marcar(); editor(); }
    return;
  }
  if (x.dataset.etapa) {
    it.etapas = ETAPAS.filter(e2 => e2 === x.dataset.etapa ? x.checked : it.etapas.includes(e2));
    marcar(); editor(); return;
  }
  if (x.dataset.k === 'tipo') { const novo = itemVazio(x.value); Object.assign(it, { tipo: x.value, etapas: novo.etapas }); if (x.value === 'FRETE') it.funcionarios = []; marcar(); editor(); return; }
  if (x.dataset.k === 'tecido' || x.dataset.fk === 'quantidade' || x.dataset.fk === 'tamanho') editor();
}

async function salvar() {
  const o = reg;
  if (!String(o.cliente_nome || '').trim()) { toast('Informe o cliente.', 'erro'); return false; }
  const p = { ...o, itens: o.itens.map(it => ({ ...it, funcionarios: it.tipo === 'FRETE' ? [] : it.funcionarios })) };
  const { data: id, error } = await db.rpc('orcamento_salvar', { p });
  if (error) { toast(msgErro(error), 'erro'); return false; }
  toast('Orçamento salvo.', 'ok');
  limparCache();
  await abrir(id);
  return true;
}

async function virarPedido() {
  if (!await confirmar('Virar pedido', `Transformar o orçamento <b>${h(reg.numero)}</b> de ${h(reg.cliente_nome)} em pedido?`, 'Virar pedido')) return;
  let { data: ped, error } = await db.rpc('orcamento_virar_pedido', { p_id: reg.id, p_confirmar_duplicado: false });
  if (error && /DUPLICADO/.test(error.message)) {
    if (!await confirmar('Pedido repetido?', h(error.message.replace(/^.*DUPLICADO:\s*/, '')), 'Gerar outro pedido', 'perigo')) return;
    ({ data: ped, error } = await db.rpc('orcamento_virar_pedido', { p_id: reg.id, p_confirmar_duplicado: true }));
  }
  if (error) return toast(msgErro(error), 'erro');
  toast('Pedido gerado.', 'ok'); reg = null; location.hash = '#/pedidos';
}

// ---------- PDF do orçamento (impressão → salvar como PDF) ----------
async function gerarPdf() {
  if (sujo) { if (!await salvar()) return; }
  const o = reg, E = EMPRESA_PDF, { t, frete } = totais();
  const cli = o.cliente_id ? cad.clientes.find(c => c.id === o.cliente_id) : null;
  const validoAte = o.data ? new Date(new Date(o.data + 'T12:00:00').getTime() + (+o.validade_dias || 15) * 86400000).toLocaleDateString('pt-BR') : '';
  const prazo = [o.prazo_dias_uteis && `${o.prazo_dias_uteis} dias úteis após a confirmação do pedido`, o.previsao_entrega && `previsão ${data(o.previsao_entrega)}`].filter(Boolean).join(' · ') || 'A combinar';
  const ent = Math.round(t * E.entradaPercentual) / 100;
  const qtd = it => it.tipo !== 'FRETE' && it.funcionarios.length ? it.funcionarios.reduce((a, f) => a + (+f.quantidade || 1), 0) : +it.quantidade;
  const tam = it => it.funcionarios.length ? grade(it.funcionarios) : it.tamanho || '';
  const detalhados = o.itens.map((it, i) => ({ it, i })).filter(({ it }) => it.tipo !== 'FRETE' && (it.funcionarios.length || it.observacao || it.silk_desc || it.bordado_desc));
  imprimirHtml(`<div class="doc">
    ${cabecalhoDoc('ORÇAMENTO COMERCIAL', `${o.numero} · Revisão ${o.revisao} · ${data(o.data)}`)}
    <table class="info">
      <tr><td>Cliente</td><td><b>${h(o.cliente_nome)}</b></td><td>Orçamento</td><td>${h(o.numero)}</td></tr>
      ${cli ? `<tr><td>Razão social</td><td>${h(cli.razao_social || '—')}</td><td>CNPJ / CPF</td><td>${h(cli.documento || '—')}</td></tr>
      <tr><td>Contato</td><td>${h(cli.contato || '—')}</td><td>Telefone</td><td>${h(cli.telefone || cli.telefone_fixo || '—')}</td></tr>` : ''}
      <tr><td>Vendedor(a)</td><td>${h(o.vendedor || '—')}</td><td>Validade</td><td>${o.validade_dias || 15} dias (até ${validoAte})</td></tr>
      <tr><td>Prazo de entrega</td><td colspan="3">${h(prazo)}</td></tr>
    </table>
    <p style="font-style:italic;color:#8a857d;font-size:8.5pt">${h(E.cidade)}, ${new Date((o.data || hojeISO()) + 'T12:00:00').toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' })}. ${h(E.assunto)}.</p>
    <h3>Resumo dos itens</h3>
    <table><thead><tr><th>Item</th><th>Ref.</th><th>Produto</th><th>Tecido / cor</th><th>Tamanhos</th><th class="n">Qtd.</th><th class="n">Unitário</th><th class="n">Total</th></tr></thead>
      <tbody>${o.itens.map((it, i) => `<tr><td>${i + 1}</td><td>${h(it.referencia || '—')}</td><td>${h(it.descricao)}${it.etapas?.includes('SILK') ? `<br><small>Silk: ${h(it.silk_desc || 'sim')}</small>` : ''}${it.etapas?.includes('BORDADO') ? `<br><small>Bordado: ${h(it.bordado_desc || 'sim')}</small>` : ''}</td>
        <td>${h([it.tecido, it.cor].filter(Boolean).join(' / ') || '—')}</td><td>${h(tam(it) || '—')}</td><td class="n">${num(qtd(it))}</td><td class="n">${moeda(it.valor_unitario)}</td><td class="n">${moeda(qtd(it) * it.valor_unitario)}</td></tr>`).join('')}</tbody>
      <tfoot><tr><th colspan="7" class="n">TOTAL${frete ? ' (com frete)' : ''}</th><th class="n">${moeda(t)}</th></tr></tfoot></table>
    ${detalhados.length ? `<h3>Detalhamento por item</h3>${detalhados.map(({ it, i }) => `<div style="margin-top:3mm"><b>Item ${i + 1} · ${h([it.referencia, it.descricao].filter(Boolean).join(' – '))}</b>
      ${it.observacao ? `<div>Observação: ${h(it.observacao)}</div>` : ''}${it.funcionarios.length ? tabelaFuncionarios(it.funcionarios) : ''}</div>`).join('')}` : ''}
    <div class="total">VALOR TOTAL: ${moeda(t)}</div>
    <h3>Condições comerciais</h3>
    <table class="info">
      <tr><td>Condições de pagamento</td><td colspan="3">${E.entradaPercentual}% de entrada no fechamento do pedido: ${moeda(ent)} · ${100 - E.entradaPercentual}% na entrega: ${moeda(t - ent)}
        ${E.pixDescontoPercentual ? `<br>OU à vista no PIX com ${E.pixDescontoPercentual}% de desconto: ${moeda(t * (1 - E.pixDescontoPercentual / 100))}` : ''}
        ${E.cartaoParcelas > 1 ? `<br>OU em até ${E.cartaoParcelas}x no cartão de crédito: ${E.cartaoParcelas}x de ${moeda(t / E.cartaoParcelas)}` : ''}</td></tr>
      ${o.forma_pagamento ? `<tr><td>Forma combinada</td><td colspan="3">${h(o.forma_pagamento)}${o.parcelas ? ' · ' + o.parcelas + ' parcela(s)' : ''}</td></tr>` : ''}
      <tr><td>Dados bancários</td><td colspan="3">${E.banco.map(h).join('<br>')}</td></tr>
      ${o.observacoes ? `<tr><td>Observações</td><td colspan="3">${h(o.observacoes)}</td></tr>` : ''}
    </table>
    <h3>Informações importantes</h3><ul style="margin:0;padding-left:5mm">${E.informacoes.map(x => `<li>${h(x)}</li>`).join('')}</ul>
    <h3>Aceite do cliente</h3><p>Declaro estar de acordo com os itens, valores e condições deste orçamento.</p>
    <div class="assin"><div>${h(cli?.razao_social || o.cliente_nome)}</div><div>Data do aceite</div></div>
    <p style="margin-top:6mm">${E.despedida.map(h).join('<br>')}</p>
    <div class="rod">${h(E.rodape)}</div>
  </div>`);
  const { error } = await db.rpc('orcamento_pdf_gerado', { p_id: o.id, p_url: null });
  if (error) toast(msgErro(error), 'erro'); else { reg.pdf_revisao = reg.revisao; reg.pdf_atualizado = true; }
}
