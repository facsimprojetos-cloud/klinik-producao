import { db, tem } from '../app.js';
import { h, num, data, chip, ler, NOME_ETAPA } from '../util.js';
import { novaOp, enviar, confirmarSaida, excluirRemessa, receber, embalar, imprimirRomaneio, imprimirFolhaOp, chipsEtapas } from '../acoes.js';

const COLUNAS = [
  { id: 'FACCAO', nome: 'Facção' }, { id: 'SILK', nome: 'Silk' }, { id: 'BORDADO', nome: 'Bordado' },
  { id: 'EMBALAGEM', nome: 'Embalagem' }, { id: 'PRONTO', nome: 'Pronto para entrega' },
];
let busca = '';
let soAtrasados = false;

const colunaDe = (c) => c.local === 'ETAPA' ? c.etapa : c.local;

export async function render(el) {
  const [cards, semOp] = await Promise.all([
    ler(db.from('v_kanban').select('*').order('op_numero')),
    ler(db.from('v_itens_sem_op').select('saldo')),
  ]);
  const pecasSemOp = semOp.reduce((a, x) => a + x.saldo, 0);
  const pode = tem('producao');
  const filtrados = cards.filter(c => (!soAtrasados || c.atrasado) &&
    (!busca || [c.op_numero, 'OP ' + c.op_numero, c.op_descricao, c.pedidos, c.itens, c.parceiro_nome, c.remessa_numero].join(' ').toLowerCase().includes(busca.toLowerCase())));

  el.innerHTML = `
    <div class="cab"><div><h1>Produção</h1><p>Cada cartão é uma OP (ou parte dela) no lugar onde as peças estão agora.</p></div>
      <div class="acoes">${pode ? `<button class="btn acento" id="nova-op">+ Nova OP</button>` : ''}
        <a class="btn" href="#/pedidos">${num(pecasSemOp)} peça(s) sem OP</a></div></div>
    <div class="filtros">
      <label class="campo">Buscar<input id="busca" value="${h(busca)}" placeholder="OP, cliente, pedido, parceiro, item…"></label>
      <label class="peq" style="padding-bottom:10px"><input type="checkbox" id="atras" ${soAtrasados ? 'checked' : ''}> Só atrasados</label>
    </div>
    <div class="kanban">${COLUNAS.map(col => {
      const lista = filtrados.filter(c => colunaDe(c) === col.id);
      return `<section class="kcol"><div class="kcol-cab">${h(col.nome)} <small>${num(lista.reduce((a, c) => a + c.quantidade, 0))} pç</small></div>
        ${lista.map(c => cartao(c, pode)).join('') || '<div class="kvazio">Nada aqui</div>'}</section>`;
    }).join('')}</div>`;

  el.querySelector('#busca').onchange = (e) => { busca = e.target.value; render(el); };
  el.querySelector('#atras').onchange = (e) => { soAtrasados = e.target.checked; render(el); };
  el.querySelector('#nova-op')?.addEventListener('click', () => novaOp(() => render(el)));
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
  });
}

function cartao(c, pode) {
  const col = colunaDe(c);
  let estado = '', acoes = '', cls = '';
  if (c.estado === 'AGUARDANDO_ENVIO') {
    estado = chip('Aguardando envio', 'info');
    if (pode) acoes = `<button class="btn peq pri" data-acao="enviar" data-op="${c.op_id}" data-etapa="${c.etapa}">Enviar</button>`;
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
  } else if (c.estado === 'AGUARDANDO_EMBALAGEM') {
    estado = chip('Passou por todas as etapas', 'ok');
    if (pode) acoes = `<button class="btn peq pri" data-acao="embalar" data-op="${c.op_id}">Embalar</button>`;
  } else if (c.estado === 'EMBALADO') {
    cls = 'pronto'; estado = chip('Embalado', 'ok');
  }
  if (c.atrasado) cls = 'atrasado';
  const tudo = col === 'EMBALAGEM' || col === 'PRONTO';
  return `<article class="kcard ${cls}">
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
