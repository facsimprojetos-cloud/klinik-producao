import { db, tem } from '../app.js';
import { h, num, data, chip, ler, modal, etapasTexto, arr, NOME_ETAPA } from '../util.js';
import { desmembrar, encaminhar, enviar, confirmarSaida, excluirRemessa, receber, embalar, imprimirRomaneio, imprimirFolhaOp, chipsEtapas, resumoEtapasOp, chipsResumo } from '../acoes.js';

const COLUNAS = [
  { id: 'CORTADO', nome: 'Cortado · gerar OP' },
  { id: 'FACCAO', nome: 'Facção', etapa: true }, { id: 'SILK', nome: 'Silk', etapa: true }, { id: 'BORDADO', nome: 'Bordado', etapa: true },
  { id: 'EMBALAGEM', nome: 'Embalagem' }, { id: 'PRONTO', nome: 'Pronto para entrega' },
];
// quando uma etapa está aberta, ela vira um Kanban próprio com estas colunas
const SUB = [
  { id: 'AGUARDANDO_ENVIO', nome: 'Aguardando envio' }, { id: 'PREPARADO', nome: 'Remessa preparada' },
  { id: 'COM_PARCEIRO', nome: 'Com o parceiro' }, { id: 'CONCLUIDO', nome: 'Retornou · aguardando próximo passo' },
];
let busca = '';
let soAtrasados = false;
let aberta = null;
let cortadosPorId = new Map();   // etapa expandida (FACCAO, SILK, BORDADO) ou null

const colunaDe = (c) => c.local === 'ETAPA' ? c.etapa : c.local;

export async function render(el) {
  const [cards, itens] = await Promise.all([
    ler(db.from('v_kanban').select('*').order('op_numero')),
    ler(db.from('v_detalhe_venda').select('*').gt('saldo', 0)),
  ]);
  const opIds = [...new Set(cards.map(c => c.op_id))];
  const etapasOps = opIds.length ? await ler(db.from('v_op_item_etapas').select('op_id,etapa,quantidade,enviado,retornado').in('op_id', opIds)) : [];
  resumoPorOp = new Map();
  etapasOps.forEach(e => { if (!resumoPorOp.has(e.op_id)) resumoPorOp.set(e.op_id, []); resumoPorOp.get(e.op_id).push(e); });
  const pecasSemOp = itens.reduce((a, x) => a + x.saldo, 0);
  const pode = tem('producao');
  const t = busca.toLowerCase();
  const filtrados = cards.filter(c => (!soAtrasados || c.atrasado) &&
    (!t || [c.op_numero, 'OP ' + c.op_numero, c.op_descricao, c.pedidos, c.itens, c.parceiro_nome, c.remessa_numero].join(' ').toLowerCase().includes(t)));
  // coluna "Cortado": itens já cortados que ainda não estão em OP, um cartão por pedido
  const cortados = new Map();
  itens.filter(i => i.disponivel_op > 0).forEach(i => {
    if (!cortados.has(i.pedido_id)) cortados.set(i.pedido_id, { ...i, pecas: 0, lista: [] });
    const g = cortados.get(i.pedido_id); g.pecas += i.disponivel_op; g.lista.push(i);
  });
  const hoje = new Date().toISOString().slice(0, 10);
  cortadosPorId = cortados; cardsAtuais = [];
  const cardsCortado = [...cortados.values()]
    .filter(g => (!soAtrasados || (g.previsao_entrega && g.previsao_entrega < hoje)) &&
      (!t || [g.pedido_numero, g.cliente_nome, ...g.lista.map(i => i.descricao + ' ' + (i.cor || ''))].join(' ').toLowerCase().includes(t)))
    .sort((a, b) => String(a.previsao_entrega || '9').localeCompare(String(b.previsao_entrega || '9')));
  const emCorte = itens.filter(i => i.disponivel_op <= 0 && i.corte_status !== 'CORTADO').reduce((a, i) => a + i.saldo, 0);

  const cartaoCortado = (g) => {
    const atras = g.previsao_entrega && g.previsao_entrega < hoje;
    return `<article class="kcard compacto cortado ${atras ? 'atrasado' : ''}" data-g="${g.pedido_id}" title="Clique para ver os itens">
      <div class="t"><span>Pedido ${h(g.pedido_numero)}</span><span class="q">${num(g.pecas)} pç</span></div>
      <div class="d um"><b>${h(g.cliente_nome)}</b></div>
      <div class="d um">${g.previsao_entrega ? `Entrega ${data(g.previsao_entrega)}` : ''}</div>
      <div class="rodape">${chip('✂ Cortado', 'info')}${atras ? chip('Atrasado', 'erro') : ''}${pode ? `<button class="btn peq pri" data-gerar="${h(g.pedido_numero)}">Gerar OP</button>` : ''}</div></article>`;
  };

  const col = (id, nome, lista, extra = '', html = null) => `<section class="kcol" data-col="${id}">
    <div class="kcol-cab">${extra}<span>${h(nome)}</span> <small>${num(lista.reduce((a, c) => a + (c.quantidade ?? c.pecas), 0))} pç</small></div>
    ${html ?? (lista.map(c => cartao(c, pode)).join('') || '<div class="kvazio">Nada aqui</div>')}</section>`;

  let quadro;
  if (aberta) {
    const daEtapa = filtrados.filter(c => c.local === 'ETAPA' && c.etapa === aberta);
    quadro = `<div class="etapa-aberta"><button class="btn" id="fechar-etapa">⤡ Fechar ${h(NOME_ETAPA[aberta])} (voltar ao quadro geral)</button>
      <span class="muted peq">Tudo o que está em ${h(NOME_ETAPA[aberta])}, separado pela situação.</span></div>
      <div class="kanban">${SUB.map(s => col(s.id, s.nome, daEtapa.filter(c => c.estado === s.id))).join('')}</div>`;
  } else {
    quadro = `<div class="kanban">${COLUNAS.map(c => {
      if (c.id === 'CORTADO') return col('CORTADO', c.nome, cardsCortado, '',
        (cardsCortado.map(cartaoCortado).join('') || '<div class="kvazio">Nada cortado aguardando OP</div>') +
        (emCorte ? `<div class="kvazio peq">${num(emCorte)} peça(s) ainda não cortadas · <a href="#/corte">ver corte</a></div>` : ''));
      const lista = filtrados.filter(x => colunaDe(x) === c.id);
      return col(c.id, c.nome, lista, c.etapa ? `<button class="kabrir" data-abrir="${c.id}" title="Abrir ${h(c.nome)} em detalhe">⤢</button>` : '');
    }).join('')}</div>`;
  }

  el.innerHTML = `
    <div class="cab"><div><h1>Produção${aberta ? ' · ' + h(NOME_ETAPA[aberta]) : ''}</h1><p>Cada cartão é uma OP (ou parte dela) no lugar onde as peças estão agora. Clique em ⤢ numa etapa para abrir o detalhe dela.</p></div>
      <div class="acoes">${pode ? `<button class="btn acento" id="nova-op">+ Nova OP</button>` : ''}
        <a class="btn" href="#/itens">${num(pecasSemOp)} peça(s) sem OP</a></div></div>
    <div class="filtros">
      <label class="campo">Buscar<input id="busca" value="${h(busca)}" placeholder="OP, cliente, pedido, parceiro, item…"></label>
      <label class="peq" style="padding-bottom:10px"><input type="checkbox" id="atras" ${soAtrasados ? 'checked' : ''}> Só atrasados</label>
    </div>
    ${quadro}`;

  el.querySelectorAll('[data-abrir]').forEach(b => b.onclick = () => { aberta = b.dataset.abrir; render(el); });
  el.querySelector('#fechar-etapa')?.addEventListener('click', () => { aberta = null; render(el); });
  el.querySelectorAll('[data-gerar]').forEach(b => b.onclick = (ev) => { ev.stopPropagation(); sessionStorage.setItem('itens_busca', b.dataset.gerar); location.hash = '#/itens'; });
  el.querySelector('#busca').onchange = (e) => { busca = e.target.value; render(el); };
  el.querySelector('#atras').onchange = (e) => { soAtrasados = e.target.checked; render(el); };
  el.querySelector('#nova-op')?.addEventListener('click', () => { location.hash = '#/itens'; });
  const executar = (d) => {
    const volta = () => render(el);
    if (d.acao === 'enviar') enviar(d.op, d.etapa, volta);
    else if (d.acao === 'saida') confirmarSaida(d.rem, volta);
    else if (d.acao === 'excluir') excluirRemessa(d.rem, d.num, volta);
    else if (d.acao === 'receber') receber(d.rem, volta);
    else if (d.acao === 'romaneio') imprimirRomaneio(d.rem);
    else if (d.acao === 'embalar') embalar(d.op, volta);
    else if (d.acao === 'folha') imprimirFolhaOp(d.op);
    else if (d.acao === 'desmembrar') desmembrar(d.op, volta);
    else if (d.acao === 'encaminhar') encaminhar(d.op, d.etapa, null, volta);
  };
  el.querySelectorAll('.kanban [data-acao]').forEach(b => b.onclick = (ev) => { ev.stopPropagation(); executar(b.dataset); });
  el.querySelectorAll('.kcard[data-k]').forEach(k => k.onclick = (ev) => {
    if (ev.target.closest('button,a')) return;
    detalheCartao(cardsAtuais[+k.dataset.k], pode, executar);
  });
  el.querySelectorAll('.kcard[data-g]').forEach(k => k.onclick = (ev) => {
    if (ev.target.closest('button,a')) return;
    detalheCortado(cortadosPorId.get(k.dataset.g), pode);
  });
  // arrastar cartão concluído para outra coluna
  let arrastando = null;
  el.querySelectorAll('.kcard[draggable=true]').forEach(k => {
    k.ondragstart = (e) => { arrastando = { op: k.dataset.op, etapa: k.dataset.etapa }; e.dataTransfer.effectAllowed = 'move'; k.classList.add('arrastando'); };
    k.ondragend = () => { k.classList.remove('arrastando'); el.querySelectorAll('.kcol').forEach(c => c.classList.remove('alvo')); };
  });
  el.querySelectorAll('.kcol[data-col]').forEach(col => {
    const ok = () => arrastando && !aberta && !['PRONTO', 'CORTADO'].includes(col.dataset.col);
    col.ondragover = (e) => { if (ok()) { e.preventDefault(); col.classList.add('alvo'); } };
    col.ondragleave = () => col.classList.remove('alvo');
    col.ondrop = (e) => {
      e.preventDefault(); col.classList.remove('alvo');
      if (!ok()) return;
      const a = arrastando; arrastando = null;
      encaminhar(a.op, a.etapa, col.dataset.col, () => render(el));
    };
  });
}

// ações possíveis do cartão: a principal aparece no cartão; todas aparecem na janela de detalhes
function acoesDe(c, pode) {
  const b = (acao, txt, cls = '', extra = '') => `<button class="btn peq ${cls}" data-acao="${acao}" data-op="${c.op_id}" data-etapa="${c.etapa || ''}" data-rem="${c.remessa_id || ''}" data-num="${h(c.remessa_numero || '')}" ${extra}>${txt}</button>`;
  let estado = '', lista = [], cls = '', linha = '';
  if (c.estado === 'AGUARDANDO_ENVIO') {
    estado = chip('Aguardando envio', 'info');
    if (pode) lista = [b('enviar', 'Enviar', 'pri'), b('desmembrar', 'Desmembrar')];
  } else if (c.estado === 'PREPARADO') {
    estado = chip('Aguardando saída', 'alerta'); linha = `${h(c.remessa_numero)} · para ${h(c.parceiro_nome)}`;
    if (pode) lista = [b('saida', 'Confirmar saída', 'pri'), b('romaneio', 'Romaneio'), b('excluir', 'Excluir remessa', 'perigo')];
  } else if (c.estado === 'COM_PARCEIRO') {
    cls = 'parceiro'; linha = `Com <b>${h(c.parceiro_nome)}</b>${c.previsao_retorno ? ` · volta ${data(c.previsao_retorno)}` : ''}`;
    if (pode) lista = [b('receber', 'Receber peças', 'pri'), b('romaneio', 'Romaneio')];
  } else if (c.estado === 'CONCLUIDO') {
    cls = 'concluido'; estado = chip(`✓ ${NOME_ETAPA[c.etapa]} pronta`, 'ok');
    if (pode) lista = [b('encaminhar', 'Encaminhar ▸', 'pri')];
  } else if (c.estado === 'AGUARDANDO_EMBALAGEM') {
    estado = chip('Pronto para embalar', 'ok');
    if (pode) lista = [b('embalar', 'Embalar', 'pri')];
  } else if (c.estado === 'EMBALADO') {
    cls = 'pronto'; estado = chip('Embalado', 'ok');
  }
  if (c.atrasado) cls = 'atrasado';
  return { estado, lista, cls, linha };
}

const numerosPedidos = (c) => [...new Set(String(c.pedidos || '').split(' | ').map(x => x.split(' · ')[0].trim()).filter(Boolean))];
const clientes = (c) => [...new Set(String(c.pedidos || '').split(' | ').map(x => x.split(' · ').slice(1).join(' · ')).filter(Boolean))];

function cartao(c, pode) {
  const a = acoesDe(c, pode);
  const arrasta = pode && c.estado === 'CONCLUIDO' ? `draggable="true" data-op="${c.op_id}" data-etapa="${c.etapa}"` : '';
  const cli = clientes(c);
  const peds = numerosPedidos(c);
  return `<article class="kcard compacto ${a.cls}" ${arrasta} data-k="${cardsAtuais.push(c) - 1}" title="Clique para ver tudo">
    <div class="t"><span>OP ${c.op_numero}</span><span class="q">${num(c.quantidade)} pç</span></div>
    ${peds.length ? `<div class="peds" title="Pedidos: ${h(peds.join(', '))}">${peds.slice(0, 4).map(n => `<span>Ped. ${h(n)}</span>`).join('')}${peds.length > 4 ? `<span class="mais">+${peds.length - 4}</span>` : ''}</div>` : ''}
    <div class="d um">${h(c.op_descricao || c.itens || '')}</div>
    <div class="d um">${h(cli[0] || '')}${cli.length > 1 ? ` <span class="muted">+${cli.length - 1}</span>` : ''}</div>
    ${a.linha ? `<div class="d um">${a.linha}</div>` : ''}
    ${chipsResumo(resumoEtapasOp(resumoPorOp.get(c.op_id)))}
    <div class="rodape">${a.estado}${c.atrasado ? chip('Atrasado', 'erro') : ''}${a.lista[0] || ''}</div>
  </article>`;
}

let cardsAtuais = [];
let resumoPorOp = new Map();
export function limparCards() { cardsAtuais = []; }

// janela com tudo o que está no cartão
export async function detalheCartao(c, pode, executar) {
  let q = db.from('v_posicao').select('op_item_id, quantidade').eq('op_id', c.op_id).eq('local', c.local).eq('estado', c.estado);
  if (c.etapa) q = q.eq('etapa', c.etapa);
  if (c.remessa_id) q = q.eq('remessa_id', c.remessa_id);
  const pos = await ler(q);
  const ids = [...new Set(pos.map(p => p.op_item_id))];
  const itens = ids.length ? await ler(db.from('v_op_itens').select('*').in('op_item_id', ids).order('pedido_numero')) : [];
  const qtd = new Map(); pos.forEach(p => qtd.set(p.op_item_id, (qtd.get(p.op_item_id) || 0) + p.quantidade));
  const a = acoesDe(c, pode);
  const onde = c.local === 'ETAPA' ? NOME_ETAPA[c.etapa] : c.local === 'EMBALAGEM' ? 'Embalagem' : 'Pronto para entrega';
  const m = modal({
    titulo: `OP ${c.op_numero}${c.op_descricao ? ' · ' + c.op_descricao : ''}`, largo: true,
    corpo: `<div class="grade g3">
        <div><div class="muted peq">Onde está</div><b>${h(onde)}</b> ${a.estado}${c.atrasado ? ' ' + chip('Atrasado', 'erro') : ''}</div>
        <div><div class="muted peq">Peças neste cartão</div><b>${num(c.quantidade)}</b></div>
        <div><div class="muted peq">Entrega mais próxima</div><b>${data(c.entrega) || '—'}</b></div>
        ${c.parceiro_nome ? `<div><div class="muted peq">Parceiro</div><b>${h(c.parceiro_nome)}</b></div>
          <div><div class="muted peq">Remessa</div><b>${h(c.remessa_numero)}</b> · enviada ${data(c.data_envio) || '—'}</div>
          <div><div class="muted peq">Previsão de retorno</div><b>${data(c.previsao_retorno) || '—'}</b></div>` : ''}
      </div>
      <div style="margin-top:10px">${chipsEtapas(c.roteiro, c.local === 'ETAPA' ? c.etapa : null, c.local !== 'ETAPA')}</div>
      <div class="tabela-wrap" style="margin-top:10px"><table>
        <thead><tr><th>Pedido · cliente</th><th>Entrega</th><th>Ref.</th><th>Produto</th><th>Tecido</th><th>Cor</th><th>Tam.</th><th>Etapas</th><th class="n">Aqui</th><th class="n">Na OP</th></tr></thead>
        <tbody>${itens.map(i => `<tr><td><b>${h(i.pedido_numero)}</b><div class="peq">${h(i.cliente_nome)}</div></td><td>${data(i.previsao_entrega) || '—'}</td>
          <td>${h(i.referencia || '')}</td><td>${h(i.descricao)}${i.silk_desc ? `<div class="peq muted">Silk: ${h(i.silk_desc)}</div>` : ''}${i.bordado_desc ? `<div class="peq muted">Bordado: ${h(i.bordado_desc)}</div>` : ''}${i.observacao ? `<div class="peq muted">${h(i.observacao)}</div>` : ''}</td>
          <td>${h(i.tecido || '')}</td><td>${h(i.cor || '')}</td><td>${h(i.tamanho || '')}</td><td class="peq">${h(etapasTexto(arr(i.item_etapas)))}</td>
          <td class="n"><b>${num(qtd.get(i.op_item_id))}</b></td><td class="n">${num(i.quantidade)}</td></tr>`).join('')}</tbody></table></div>
      <div class="acoes" style="margin-top:12px;display:flex;flex-wrap:wrap;gap:6px">${a.lista.join('')}
        <button class="btn peq" data-acao="folha" data-op="${c.op_id}">Folha OP</button></div>`,
  });
  m.el.querySelectorAll('[data-acao]').forEach(bt => bt.onclick = () => { m.fechar(); executar(bt.dataset); });
}

function detalheCortado(g, pode) {
  const m = modal({
    titulo: `Pedido ${g.pedido_numero} · ${g.cliente_nome} · cortado, sem OP`, largo: true,
    corpo: `<p class="muted peq">Entrega ${data(g.previsao_entrega) || '—'} · ${num(g.pecas)} peça(s) cortadas aguardando OP.</p>
      <div class="tabela-wrap"><table><thead><tr><th>Ref.</th><th>Produto</th><th>Tecido</th><th>Cor</th><th>Tam.</th><th>Etapas</th><th class="n">Prontas p/ OP</th></tr></thead>
      <tbody>${g.lista.map(i => `<tr><td>${h(i.referencia || '')}</td><td>${h(i.descricao)}${i.funcionarios ? `<div class="peq muted">${i.funcionarios} funcionário(s)</div>` : ''}</td><td>${h(i.tecido || '')}</td><td>${h(i.cor || '')}</td><td>${h(i.tamanho || '')}</td>
        <td class="peq">${h(etapasTexto(arr(i.etapas)))}</td><td class="n"><b>${num(i.disponivel_op)}</b></td></tr>`).join('')}</tbody></table></div>`,
    botoes: pode ? [{ texto: 'Fechar' }, { texto: 'Gerar OP', classe: 'pri', acao: () => { sessionStorage.setItem('itens_busca', g.pedido_numero); location.hash = '#/itens'; } }] : [{ texto: 'Fechar' }],
  });
}
export { NOME_ETAPA };
