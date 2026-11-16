import { db, tem } from '../app.js';
import { h, num, data, chip, ler, NOME_ETAPA } from '../util.js';
import { desmembrar, encaminhar, enviar, confirmarSaida, excluirRemessa, receber, embalar, imprimirRomaneio, imprimirFolhaOp, chipsEtapas } from '../acoes.js';

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
let aberta = null;   // etapa expandida (FACCAO, SILK, BORDADO) ou null

const colunaDe = (c) => c.local === 'ETAPA' ? c.etapa : c.local;

export async function render(el) {
  const [cards, itens] = await Promise.all([
    ler(db.from('v_kanban').select('*').order('op_numero')),
    ler(db.from('v_detalhe_venda').select('*').gt('saldo', 0)),
  ]);
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
  const cardsCortado = [...cortados.values()]
    .filter(g => (!soAtrasados || (g.previsao_entrega && g.previsao_entrega < hoje)) &&
      (!t || [g.pedido_numero, g.cliente_nome, ...g.lista.map(i => i.descricao + ' ' + (i.cor || ''))].join(' ').toLowerCase().includes(t)))
    .sort((a, b) => String(a.previsao_entrega || '9').localeCompare(String(b.previsao_entrega || '9')));
  const emCorte = itens.filter(i => i.disponivel_op <= 0 && i.corte_status !== 'CORTADO').reduce((a, i) => a + i.saldo, 0);

  const cartaoCortado = (g) => {
    const atras = g.previsao_entrega && g.previsao_entrega < hoje;
    return `<article class="kcard cortado ${atras ? 'atrasado' : ''}">
      <div class="t"><span>Pedido ${h(g.pedido_numero)}</span><span class="q">${num(g.pecas)} pç</span></div>
      <div class="d"><b>${h(g.cliente_nome)}</b>${g.previsao_entrega ? ` · entrega ${data(g.previsao_entrega)}` : ''}</div>
      <div class="d">${h([...new Set(g.lista.map(i => i.descricao + (i.cor ? ' ' + i.cor : '')))].join(' | '))}</div>
      <div style="margin-top:6px">${chip('✂ Cortado · sem OP', 'info')}${atras ? ' ' + chip('Atrasado', 'erro') : ''}</div>
      ${pode ? `<div class="acoes"><button class="btn peq pri" data-gerar="${h(g.pedido_numero)}">Gerar OP</button></div>` : ''}</article>`;
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
  el.querySelectorAll('[data-gerar]').forEach(b => b.onclick = () => { sessionStorage.setItem('itens_busca', b.dataset.gerar); location.hash = '#/itens'; });
  el.querySelector('#busca').onchange = (e) => { busca = e.target.value; render(el); };
  el.querySelector('#atras').onchange = (e) => { soAtrasados = e.target.checked; render(el); };
  el.querySelector('#nova-op')?.addEventListener('click', () => { location.hash = '#/itens'; });
  el.querySelectorAll('[data-acao]').forEach(b => b.onclick = (ev) => {
    ev.stopPropagation();
    const d = b.dataset, volta = () => render(el);
    if (d.acao === 'enviar') enviar(d.op, d.etapa, volta);
    else if (d.acao === 'saida') confirmarSaida(d.rem, volta);
    else if (d.acao === 'excluir') excluirRemessa(d.rem, d.num, volta);
    else if (d.acao === 'receber') receber(d.rem, volta);
    else if (d.acao === 'romaneio') imprimirRomaneio(d.rem);
    else if (d.acao === 'embalar') embalar(d.op, volta);
    else if (d.acao === 'folha') imprimirFolhaOp(d.op);
    else if (d.acao === 'desmembrar') desmembrar(d.op, volta);
    else if (d.acao === 'encaminhar') encaminhar(d.op, d.etapa, null, volta);
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

function cartao(c, pode) {
  const col = colunaDe(c);
  let estado = '', acoes = '', cls = '';
  if (c.estado === 'AGUARDANDO_ENVIO') {
    estado = chip('Aguardando envio', 'info');
    if (pode) acoes = `<button class="btn peq pri" data-acao="enviar" data-op="${c.op_id}" data-etapa="${c.etapa}">Enviar</button>
      <button class="btn peq" data-acao="desmembrar" data-op="${c.op_id}">Desmembrar</button>`;
  } else if (c.estado === 'PREPARADO') {
    estado = chip(`${c.remessa_numero} · aguardando saída`, 'alerta') + `<div class="d">Para ${h(c.parceiro_nome)}</div>`;
    if (pode) acoes = `<button class="btn peq pri" data-acao="saida" data-rem="${c.remessa_id}">Confirmar saída</button>
      <button class="btn peq" data-acao="romaneio" data-rem="${c.remessa_id}">Romaneio</button>
      <button class="btn peq perigo" data-acao="excluir" data-rem="${c.remessa_id}" data-num="${h(c.remessa_numero)}">Excluir</button>`;
  } else if (c.estado === 'COM_PARCEIRO') {
    cls = 'parceiro';
    estado = `<div class="d"><b>Com ${h(c.parceiro_nome)}</b> desde ${data(c.data_envio)}${c.previsao_retorno ? ` · previsão ${data(c.previsao_retorno)}` : ''}</div><div class="d">${h(c.remessa_numero)}</div>`;
    if (pode) acoes = `<button class="btn peq pri" data-acao="receber" data-rem="${c.remessa_id}">Receber peças</button>
      <button class="btn peq" data-acao="romaneio" data-rem="${c.remessa_id}">Romaneio</button>`;
  } else if (c.estado === 'CONCLUIDO') {
    cls = 'concluido';
    estado = chip(`✓ ${NOME_ETAPA[c.etapa]} pronta`, 'ok') + `<div class="d peq muted">Arraste para a próxima coluna ou clique em Encaminhar.</div>`;
    if (pode) acoes = `<button class="btn peq pri" data-acao="encaminhar" data-op="${c.op_id}" data-etapa="${c.etapa}">Encaminhar ▸</button>`;
  } else if (c.estado === 'AGUARDANDO_EMBALAGEM') {
    estado = chip('Pronto para embalar', 'ok');
    if (pode) acoes = `<button class="btn peq pri" data-acao="embalar" data-op="${c.op_id}">Embalar</button>`;
  } else if (c.estado === 'EMBALADO') {
    cls = 'pronto'; estado = chip('Embalado', 'ok');
  }
  if (c.atrasado) cls = 'atrasado';
  const tudo = col === 'EMBALAGEM' || col === 'PRONTO';
  const arrasta = pode && c.estado === 'CONCLUIDO' ? `draggable="true" data-op="${c.op_id}" data-etapa="${c.etapa}"` : '';
  return `<article class="kcard ${cls}" ${arrasta}>
    <div class="t"><span>OP ${c.op_numero}</span><span class="q">${num(c.quantidade)} pç</span></div>
    ${c.op_descricao ? `<div class="d"><b>${h(c.op_descricao)}</b></div>` : ''}
    <div class="d">${h(c.itens)}</div>
    <div class="d">${h(c.pedidos)}${c.entrega ? ` · entrega ${data(c.entrega)}` : ''}</div>
    ${chipsEtapas(c.roteiro, c.local === 'ETAPA' ? c.etapa : null, tudo)}
    <div style="margin-top:6px">${estado}${c.atrasado ? ' ' + chip('Atrasado', 'erro') : ''}</div>
    <div class="acoes">${acoes}<button class="btn peq" data-acao="folha" data-op="${c.op_id}">Folha OP</button></div>
  </article>`;
}
export { NOME_ETAPA };
