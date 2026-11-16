import { db, tem } from '../app.js';
import { h, num, moeda, data, dataHora, chip, modal, ler, chamar, toast, confirmar, pedirTexto, NOME_ETAPA, etapasTexto, arr } from '../util.js';
import { novaOp, imprimirFolhaCorte, tabelaFuncionarios } from '../acoes.js';

let aba = 'andamento';
let busca = '';
const COR_SIT = { 'AGUARDANDO OP': 'info', 'EM PRODUÇÃO': 'alerta', 'PRONTO PARA ENTREGA': 'ok', 'ENTREGUE': '', 'CANCELADO': 'erro' };

export async function render(el) {
  let q = db.from('v_pedido_resumo').select('*').order('previsao_entrega', { ascending: true, nullsFirst: false }).limit(500);
  if (aba === 'andamento') q = q.is('baixado_em', null).neq('situacao', 'CANCELADO');
  if (aba === 'historico') q = db.from('v_pedido_resumo').select('*').not('baixado_em', 'is', null).order('baixado_em', { ascending: false }).limit(300);
  if (aba === 'cancelados') q = db.from('v_pedido_resumo').select('*').eq('situacao', 'CANCELADO').order('data', { ascending: false }).limit(300);
  const lista = (await ler(q)).filter(p => !busca || [p.numero, p.cliente_nome].join(' ').toLowerCase().includes(busca.toLowerCase()));
  el.innerHTML = `
    <div class="cab"><div><h1>Pedidos</h1><p>Clique no pedido para ver itens, OPs e com quem está cada parte.</p></div></div>
    <div class="abas">
      <button data-a="andamento" class="${aba === 'andamento' ? 'ativo' : ''}">Em andamento</button>
      <button data-a="historico" class="${aba === 'historico' ? 'ativo' : ''}">Histórico (entregues)</button>
      <button data-a="cancelados" class="${aba === 'cancelados' ? 'ativo' : ''}">Cancelados</button>
    </div>
    <div class="filtros"><label class="campo">Buscar<input id="busca" value="${h(busca)}" placeholder="Número ou cliente"></label></div>
    <div class="tabela-wrap"><table>
      <thead><tr><th>Pedido</th><th>Cliente</th><th>Data</th><th>Entrega</th><th class="n">Peças</th><th>Andamento</th><th>Situação</th></tr></thead>
      <tbody>${lista.map(p => {
        const pOk = p.pecas ? 100 * p.embalado / p.pecas : 0, pProd = p.pecas ? 100 * p.em_producao / p.pecas : 0;
        return `<tr data-p="${p.pedido_id}" style="cursor:pointer"><td class="forte">${h(p.numero)}</td><td>${h(p.cliente_nome)}</td><td>${data(p.data)}</td>
          <td>${data(p.previsao_entrega) || '—'} ${p.atrasado ? chip('Atrasado', 'erro') : ''}</td><td class="n">${num(p.pecas)}</td>
          <td style="min-width:150px"><div class="barra"><i class="b-ok" style="width:${pOk}%"></i><i class="b-prod" style="width:${pProd}%"></i></div>
            <span class="peq muted">${num(p.embalado)} prontas · ${num(p.em_producao)} em produção · ${num(p.sem_op)} sem OP</span></td>
          <td>${chip(p.situacao, COR_SIT[p.situacao])}</td></tr>`;
      }).join('') || '<tr><td colspan="7" class="vazio">Nenhum pedido.</td></tr>'}</tbody></table></div>`;
  el.querySelectorAll('[data-a]').forEach(b => b.onclick = () => { aba = b.dataset.a; render(el); });
  el.querySelector('#busca').onchange = (e) => { busca = e.target.value; render(el); };
  el.querySelectorAll('tr[data-p]').forEach(tr => tr.onclick = () => detalhe(tr.dataset.p, () => render(el)));
}

async function detalhe(id, depois) {
  const [[p], [r], itens, dist] = await Promise.all([
    ler(db.from('pedidos').select('*').eq('id', id)),
    ler(db.from('v_pedido_resumo').select('*').eq('pedido_id', id)),
    ler(db.from('pedido_itens').select('*').eq('pedido_id', id).order('ordem')),
    ler(db.from('v_pedido_distribuicao').select('*').eq('pedido_id', id).order('op_numero')),
  ]);
  const funcs = itens.length ? await ler(db.from('pedido_funcionarios').select('*').in('pedido_item_id', itens.map(i => i.id)).order('ordem')) : [];
  const ativo = !p.baixado_em && !p.cancelado_em;
  const onde = d => d.local === 'ETAPA' ? `${NOME_ETAPA[d.etapa]} · ${d.estado === 'AGUARDANDO_ENVIO' ? 'aguardando envio' : d.estado === 'PREPARADO' ? 'remessa preparada' : d.estado === 'CONCLUIDO' ? 'pronto, aguardando encaminhar' : 'com o parceiro'}`
    : d.local === 'EMBALAGEM' ? 'Aguardando embalagem' : 'Embalado';
  modal({
    titulo: `Pedido ${p.numero} · ${p.cliente_nome}`, largo: true,
    corpo: `
      <div class="grade g4">
        <div class="kpi"><div class="rot">Peças</div><div class="val">${num(r.pecas)}</div></div>
        <div class="kpi ok"><div class="rot">Prontas</div><div class="val">${num(r.embalado)}</div></div>
        <div class="kpi alerta"><div class="rot">Em produção</div><div class="val">${num(r.em_producao)}</div></div>
        <div class="kpi"><div class="rot">Sem OP</div><div class="val">${num(r.sem_op)}</div></div>
      </div>
      <p>${chip(r.situacao, COR_SIT[r.situacao])} · Data ${data(p.data)} · Entrega <b>${data(p.previsao_entrega) || '—'}</b> ${r.atrasado ? chip('Atrasado', 'erro') : ''}
        ${p.baixado_em ? ` · Entregue em ${dataHora(p.baixado_em)} por ${h(p.baixado_por || '')}` : ''}</p>
      ${p.observacoes ? `<div class="aviso-box">${h(p.observacoes)}</div>` : ''}
      <h3>Itens</h3>
      <div class="tabela-wrap"><table><thead><tr><th>Item</th><th>Tecido</th><th>Etapas</th><th class="n">Qtd</th><th class="n">Valor</th></tr></thead>
        <tbody>${itens.map(i => { const fs = funcs.filter(f => f.pedido_item_id === i.id); return `<tr><td><b>${h([i.referencia, i.descricao, i.cor, i.tamanho].filter(Boolean).join(' · '))}</b>
          ${i.observacao ? `<div class="peq muted">${h(i.observacao)}</div>` : ''}${fs.length ? `<div class="peq muted">${fs.length} funcionário(s): ${h(fs.map(f => f.nome).join(', '))}</div>` : ''}</td>
          <td>${h(i.tecido || '')}</td><td class="peq">${i.tipo === 'PRODUTO' ? h(etapasTexto(arr(i.etapas))) + (i.silk_desc ? `<br>Silk: ${h(i.silk_desc)}` : '') + (i.bordado_desc ? `<br>Bordado: ${h(i.bordado_desc)}` : '') : chip(i.tipo === 'SERVICO' ? 'Serviço' : i.tipo)}</td>
          <td class="n">${num(i.quantidade)}</td><td class="n">${moeda(i.quantidade * i.valor_unitario)}</td></tr>`; }).join('')}</tbody></table></div>
      <h3 style="margin-top:14px">Onde estão as peças</h3>
      <div class="tabela-wrap"><table><thead><tr><th>OP</th><th>Item</th><th>Onde</th><th>Parceiro</th><th class="n">Peças</th></tr></thead>
        <tbody>${dist.map(d => `<tr><td class="forte">OP ${d.op_numero}</td><td>${h([d.descricao, d.cor, d.tamanho].filter(Boolean).join(' · '))}</td>
          <td>${h(onde(d))}${d.remessa_numero ? ` <span class="peq muted">${h(d.remessa_numero)}</span>` : ''}</td><td>${h(d.parceiro_nome || '—')}</td><td class="n">${num(d.quantidade)}</td></tr>`).join('')
          || '<tr><td colspan="5" class="vazio">Nenhuma peça em OP ainda.</td></tr>'}</tbody></table></div>`,
    botoes: [
      { texto: 'Fechar' },
      ...(ativo && tem('corte') ? [{ texto: 'Folha de corte', fecha: false, acao: () => { imprimirFolhaCorte(id); return false; } }] : []),
      ...(ativo && tem('producao') && r.sem_op > 0 ? [{ texto: 'Criar OP com este pedido', acao: () => { novaOp(depois, id); } }] : []),
      ...(ativo && tem('comercial') ? [{ texto: 'Editar entrega', fecha: false, acao: async () => {
        const nova = await pedirTexto('Previsão de entrega', 'Nova data de entrega (AAAA-MM-DD):', { rotulo: 'Data', minimo: 10, botao: 'Salvar', classe: 'pri', valor: p.previsao_entrega || '' });
        if (!nova) return false;
        if (await chamar(db, 'pedido_atualizar', { p_id: id, p_previsao: nova, p_observacoes: p.observacoes })) { toast('Entrega atualizada.', 'ok'); depois(); }
      } }] : []),
      ...(ativo && tem('comercial') ? [{ texto: 'Cancelar pedido', classe: 'perigo', fecha: false, acao: async () => {
        const motivo = await pedirTexto('Cancelar pedido', `Cancelar o pedido <b>${h(p.numero)}</b>?`, { minimo: 5, botao: 'Cancelar pedido' });
        if (!motivo) return false;
        if (await chamar(db, 'pedido_cancelar', { p_id: id, p_motivo: motivo })) { toast('Pedido cancelado.', 'ok'); depois(); }
      } }] : []),
      ...(ativo && tem('producao') && r.situacao === 'PRONTO PARA ENTREGA' ? [{ texto: 'Dar baixa (entregue)', classe: 'acento', acao: async () => {
        if (!await confirmar('Dar baixa', `Confirmar a entrega do pedido <b>${h(p.numero)}</b>? Ele sai da lista e vai para o histórico.`, 'Dar baixa')) return false;
        if (await chamar(db, 'baixar_pedido', { p_pedido: id })) { toast('Pedido entregue e movido para o histórico.', 'ok'); depois(); }
      } }] : []),
      ...(p.baixado_em && tem('supervisor') ? [{ texto: 'Reabrir pedido', classe: 'perigo', acao: async () => {
        if (await chamar(db, 'reabrir_pedido', { p_pedido: id })) { toast('Pedido reaberto.', 'ok'); depois(); }
      } }] : []),
    ]
  });
}
export { tabelaFuncionarios };
