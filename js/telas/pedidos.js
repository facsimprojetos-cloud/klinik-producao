import { db, tem } from '../app.js';
import { h, num, moeda, data, dataHora, chip, modal, ler, chamar, toast, confirmar, pedirTexto, NOME_ETAPA, etapasTexto, arr, hojeISO, cadastros, imprimirHtml, cabecalhoDoc, nomeArquivo } from '../util.js';
import { novaOp, imprimirFolhaCorte, tabelaFuncionarios } from '../acoes.js';

let aba = 'andamento';
let busca = '';
const COR_SIT = { 'AGUARDANDO OP': 'info', 'EM PRODUÇÃO': 'alerta', 'PRONTO PARA ENTREGA': 'ok', 'ENTREGA PARCIAL': 'info', 'ENTREGUE': '', 'CANCELADO': 'erro' };

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
            <span class="peq muted">${p.entregue ? num(p.entregue) + ' entregues · ' : ''}${num(p.embalado)} prontas · ${num(p.em_producao)} em produção · ${num(p.sem_op)} sem OP</span></td>
          <td>${chip(p.situacao, COR_SIT[p.situacao])}</td></tr>`;
      }).join('') || '<tr><td colspan="7" class="vazio">Nenhum pedido.</td></tr>'}</tbody></table></div>`;
  el.querySelectorAll('[data-a]').forEach(b => b.onclick = () => { aba = b.dataset.a; render(el); });
  el.querySelector('#busca').onchange = (e) => { busca = e.target.value; render(el); };
  el.querySelectorAll('tr[data-p]').forEach(tr => tr.onclick = () => detalhe(tr.dataset.p, () => render(el)));
}

async function detalhe(id, depois) {
  const [[p], [r], itens, dist, entregas, pags] = await Promise.all([
    ler(db.from('pedidos').select('*').eq('id', id)),
    ler(db.from('v_pedido_resumo').select('*').eq('pedido_id', id)),
    ler(db.from('pedido_itens').select('*').eq('pedido_id', id).order('ordem')),
    ler(db.from('v_pedido_distribuicao').select('*').eq('pedido_id', id).order('op_numero')),
    ler(db.from('entregas').select('*, entrega_itens(quantidade)').eq('pedido_id', id).order('criado_em')),
    ler(db.from('pedido_pagamentos').select('*').eq('pedido_id', id).order('data')),
  ]);
  const totalPedido = itens.reduce((a, i) => a + i.quantidade * Number(i.valor_unitario), 0);
  const pago = pags.reduce((a, x) => a + Number(x.valor), 0);
  const funcs = itens.length ? await ler(db.from('pedido_funcionarios').select('*').in('pedido_item_id', itens.map(i => i.id)).order('ordem')) : [];
  const ativo = !p.baixado_em && !p.cancelado_em;
  const onde = d => d.local === 'ETAPA' ? `${NOME_ETAPA[d.etapa]} · ${d.estado === 'AGUARDANDO_ENVIO' ? 'aguardando envio' : d.estado === 'PREPARADO' ? 'remessa preparada' : d.estado === 'CONCLUIDO' ? 'pronto, aguardando encaminhar' : 'com o parceiro'}`
    : d.local === 'DESTINO' ? 'Cortado · aguardando destino'
    : d.local === 'EMBALAGEM' ? 'Aguardando embalagem' : d.local === 'ENTREGUE' ? 'Entregue ao cliente' : 'Pronto (embalado), a entregar';
  const mm = modal({
    titulo: `Pedido ${p.numero} · ${p.cliente_nome}`, largo: true,
    corpo: `
      <div class="grade" style="grid-template-columns:repeat(auto-fit,minmax(120px,1fr))">
        <div class="kpi"><div class="rot">Peças</div><div class="val">${num(r.pecas)}</div></div>
        <div class="kpi"><div class="rot">Entregues</div><div class="val">${num(r.entregue)}</div></div>
        <div class="kpi ok"><div class="rot">Prontas a entregar</div><div class="val">${num(r.embalado)}</div></div>
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
      ${entregas.length ? `<h3 style="margin-top:14px">Entregas ${r.situacao === 'ENTREGA PARCIAL' ? chip('Entrega parcial · faltam ' + num(r.pecas - r.entregue) + ' pç', 'info') : ''}</h3>
      <div class="tabela-wrap"><table><thead><tr><th>Romaneio</th><th>Data</th><th class="n">Peças</th><th>Por</th><th></th></tr></thead>
        <tbody>${entregas.map(e => `<tr><td class="forte">${h(e.numero)}</td><td>${data(e.data)}</td><td class="n">${num(e.entrega_itens.reduce((a, x) => a + x.quantidade, 0))}</td><td>${h(e.criado_por || '')}</td>
          <td><button class="btn peq" data-imp-ent="${e.id}">Romaneio PDF</button>${tem('supervisor') ? ` <button class="btn peq perigo" data-del-ent="${e.id}" data-num="${h(e.numero)}">Excluir</button>` : ''}</td></tr>`).join('')}</tbody></table></div>` : ''}
      <h3 style="margin-top:14px">Pagamentos <span class="peq muted">· pedido ${moeda(totalPedido)} · recebido ${moeda(pago)} · ${pago >= totalPedido - 0.004 ? chip('Quitado', 'ok') : chip('Saldo ' + moeda(totalPedido - pago), 'alerta')}</span></h3>
      ${pags.length ? `<div class="tabela-wrap"><table><thead><tr><th>Data</th><th>Forma</th><th>Observação</th><th class="n">Valor</th><th></th></tr></thead>
        <tbody>${pags.map(x => `<tr><td>${data(x.data)}</td><td>${h(x.forma || '')}</td><td>${h(x.observacao || '')}</td><td class="n">${moeda(x.valor)}</td>
          <td>${tem('supervisor') ? `<button class="btn peq perigo" data-del-pag="${x.id}">Excluir</button>` : ''}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted peq">Nenhum pagamento registrado.</p>'}
      ${tem('financeiro') || tem('comercial') ? `<button class="btn peq" id="novo-pag">+ Registrar pagamento / antecipação</button>` : ''}
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
      { texto: 'Folha completa do pedido', fecha: false, acao: () => { imprimirFolhaPedido(id); return false; } },
      ...(ativo && tem('producao') && r.embalado > 0 ? [{ texto: 'Romaneio de entrega', classe: 'pri', acao: () => { novaEntrega(p, depois); } }] : []),
      ...(ativo && tem('producao') && r.situacao === 'PRONTO PARA ENTREGA' ? [{ texto: 'Dar baixa (entregue)', classe: 'acento', acao: async () => {
        if (!await confirmar('Dar baixa', `Confirmar a entrega do pedido <b>${h(p.numero)}</b>? Ele sai da lista e vai para o histórico.`, 'Dar baixa')) return false;
        if (await chamar(db, 'baixar_pedido', { p_pedido: id })) { toast('Pedido entregue e movido para o histórico.', 'ok'); depois(); }
      } }] : []),
      ...(p.baixado_em && tem('supervisor') ? [{ texto: 'Reabrir pedido', classe: 'perigo', acao: async () => {
        if (await chamar(db, 'reabrir_pedido', { p_pedido: id })) { toast('Pedido reaberto.', 'ok'); depois(); }
      } }] : []),
    ]
  });
  mm.el.querySelector('#novo-pag')?.addEventListener('click', () => novoPagamento(p, totalPedido - pago, () => { mm.fechar(); detalhe(id, depois); }));
  mm.el.querySelectorAll('[data-del-pag]').forEach(b => b.onclick = async () => {
    if (!await confirmar('Excluir pagamento', 'Excluir este pagamento do pedido?', 'Excluir', 'perigo')) return;
    if (await chamar(db, 'excluir_pagamento_pedido', { p_id: b.dataset.delPag })) { toast('Pagamento excluído.', 'ok'); mm.fechar(); detalhe(id, depois); }
  });
  mm.el.querySelectorAll('[data-imp-ent]').forEach(b => b.onclick = () => imprimirEntrega(b.dataset.impEnt));
  mm.el.querySelectorAll('[data-del-ent]').forEach(b => b.onclick = async () => {
    if (!await confirmar('Excluir entrega', `Excluir o romaneio <b>${h(b.dataset.num)}</b>? As peças voltam a ficar "prontas a entregar".`, 'Excluir', 'perigo')) return;
    if (await chamar(db, 'excluir_entrega', { p_entrega: b.dataset.delEnt })) { toast('Entrega excluída.', 'ok'); mm.fechar(); depois(); }
  });
}
export { tabelaFuncionarios };


// ---------- Romaneio de entrega (parcial ou total) ----------
async function novaEntrega(p, depois) {
  const itens = await ler(db.from('v_op_itens').select('*').eq('pedido_id', p.id).gt('embalado', 0).order('descricao'));
  const ent = itens.length ? await ler(db.from('entrega_itens').select('op_item_id, quantidade').in('op_item_id', itens.map(i => i.op_item_id))) : [];
  const ja = new Map(); ent.forEach(e => ja.set(e.op_item_id, (ja.get(e.op_item_id) || 0) + e.quantidade));
  const linhas = itens.map(i => ({ ...i, disp: i.embalado - (ja.get(i.op_item_id) || 0) })).filter(i => i.disp > 0);
  if (!linhas.length) return toast('Não há peças prontas (embaladas) para entregar.', 'erro');
  modal({
    titulo: `Romaneio de entrega · Pedido ${p.numero} · ${p.cliente_nome}`, largo: true,
    corpo: `<p class="muted peq">Marque o que vai nesta entrega. O pedido continua aberto com o que falta e fica sinalizado como <b>entrega parcial</b>. Quando tudo for entregue, ele dá baixa sozinho.</p>
      <div class="grade g2"><label class="campo">Data da entrega<input type="date" id="ent-data" value="${hojeISO()}"></label>
        <label class="campo">Observação<input id="ent-obs" placeholder="Ex.: retirado pela Ana"></label></div>
      <div class="tabela-wrap" style="margin-top:10px"><table><thead><tr><th>Item</th><th>OP</th><th class="n">Prontas</th><th class="n">Entregar</th></tr></thead>
        <tbody>${linhas.map(i => `<tr><td>${h([i.referencia, i.descricao, i.cor, i.tamanho].filter(Boolean).join(' · '))}</td><td>${i.op_numero}</td>
          <td class="n">${num(i.disp)}</td><td class="n"><input class="inp num" type="number" min="0" max="${i.disp}" value="${i.disp}" data-ent="${i.op_item_id}"></td></tr>`).join('')}</tbody></table></div>`,
    botoes: [{ texto: 'Cancelar' }, { texto: 'Registrar e imprimir', classe: 'pri', acao: async (m) => {
      const l = [...m.querySelectorAll('[data-ent]')].map(x => ({ op_item_id: x.dataset.ent, quantidade: +x.value || 0 })).filter(x => x.quantidade > 0);
      if (!l.length) { toast('Informe quantas peças vão nesta entrega.', 'erro'); return false; }
      const e = await chamar(db, 'registrar_entrega', { p_pedido: p.id, p_linhas: l, p_data: m.querySelector('#ent-data').value || null, p_observacao: m.querySelector('#ent-obs').value });
      if (!e) return false;
      toast(`Entrega ${e.numero} registrada.`, 'ok');
      depois && depois();
      const [rr] = await ler(db.from('v_pedido_resumo').select('baixado_em').eq('pedido_id', p.id));
      if (rr?.baixado_em) {
        toast('Pedido entregue por completo e movido para o histórico.', 'ok');
        if (await confirmar('Pedido completo', `Todas as peças do pedido <b>${h(p.numero)}</b> foram entregues. Imprimir a <b>folha completa</b> (com histórico de retiradas e pagamentos)?`, 'Folha completa', 'pri', 'Só o romaneio')) return imprimirFolhaPedido(p.id);
      }
      imprimirEntrega(e.id);
    } }]
  });
}

async function imprimirEntrega(entregaId) {
  const [[e]] = await Promise.all([ler(db.from('entregas').select('*, entrega_itens(op_item_id, quantidade)').eq('id', entregaId))]);
  if (!e) return;
  const [[p], [r], todas] = await Promise.all([
    ler(db.from('pedidos').select('*').eq('id', e.pedido_id)),
    ler(db.from('v_pedido_resumo').select('*').eq('pedido_id', e.pedido_id)),
    ler(db.from('entregas').select('id, numero, data, criado_em, entrega_itens(quantidade)').eq('pedido_id', e.pedido_id).order('criado_em')),
  ]);
  const ids = e.entrega_itens.map(x => x.op_item_id);
  const itens = ids.length ? await ler(db.from('v_op_itens').select('*').in('op_item_id', ids)) : [];
  const cli = p.cliente_id ? (await ler(db.from('clientes').select('*').eq('id', p.cliente_id)))[0] : null;
  const funcs = itens.length ? await ler(db.from('pedido_funcionarios').select('*').in('pedido_item_id', [...new Set(itens.map(i => i.pedido_item_id))]).order('ordem')) : [];
  const info = new Map(itens.map(i => [i.op_item_id, i]));
  // soma por item do pedido (o mesmo item pode estar em mais de uma OP)
  const porItem = new Map();
  e.entrega_itens.forEach(x => { const i = info.get(x.op_item_id); if (!i) return; const k = i.pedido_item_id;
    if (!porItem.has(k)) porItem.set(k, { ...i, q: 0 }); porItem.get(k).q += x.quantidade; });
  const linhas = [...porItem.values()].sort((a, b) => (a.descricao + a.cor + a.tamanho).localeCompare(b.descricao + b.cor + b.tamanho));
  const pecas = linhas.reduce((a, i) => a + i.q, 0);
  const ordem = todas.findIndex(x => x.id === e.id) + 1;
  const ateAqui = todas.slice(0, ordem).reduce((a, x) => a + x.entrega_itens.reduce((b, y) => b + y.quantidade, 0), 0);
  const faltam = Math.max(r.pecas - ateAqui, 0);
  imprimirHtml(`<div class="doc">${cabecalhoDoc('ROMANEIO DE ENTREGA' + (faltam ? ' · PARCIAL' : ''), `${e.numero} · ${data(e.data)}`)}
    <table class="info"><tr><td>Cliente</td><td><b>${h(p.cliente_nome)}</b>${cli?.razao_social ? `<br>${h(cli.razao_social)}` : ''}</td><td>CNPJ / CPF</td><td>${h(cli?.documento || '—')}</td></tr>
      <tr><td>Pedido</td><td><b>${h(p.numero)}</b></td><td>Entrega</td><td>${ordem}ª entrega · ${data(e.data)}</td></tr>
      ${cli?.endereco ? `<tr><td>Endereço</td><td colspan="3">${h(cli.endereco)}</td></tr>` : ''}</table>
    <h3>Peças entregues</h3>
    <table><thead><tr><th>Ref.</th><th>Produto</th><th>Tecido</th><th>Cor</th><th>Tam.</th><th>Funcionários</th><th class="n">Qtd</th></tr></thead>
      <tbody>${linhas.map(i => { const fs = funcs.filter(f => f.pedido_item_id === i.pedido_item_id);
        return `<tr><td>${h(i.referencia || '')}</td><td>${h(i.descricao)}</td><td>${h(i.tecido || '')}</td><td>${h(i.cor || '')}</td><td>${h(i.tamanho || '')}</td>
        <td class="peq">${h(fs.map(f => f.nome).join(', '))}</td><td class="n"><b>${num(i.q)}</b></td></tr>`; }).join('')}</tbody>
      <tfoot><tr><th colspan="6">Total desta entrega</th><th class="n">${num(pecas)}</th></tr></tfoot></table>
    <table class="info" style="margin-top:4mm"><tr><td>Peças do pedido</td><td><b>${num(r.pecas)}</b></td><td>Entregues até esta entrega</td><td><b>${num(ateAqui)}</b></td></tr>
      <tr><td>Faltam entregar</td><td colspan="3"><b>${faltam ? num(faltam) + ' peça(s) — entrega parcial' : 'Nenhuma — pedido completo'}</b></td></tr></table>
    ${e.observacao ? `<div class="obs">${h(e.observacao)}</div>` : ''}
    <div class="assin"><div>Entregue por (KLINIK) · data</div><div>Recebido por (${h(p.cliente_nome)}) · data</div></div></div>`,
    nomeArquivo(['Romaneio de entrega', e.numero, faltam ? 'Parcial' : 'Completo', 'Pedido ' + p.numero, p.cliente_nome, num(pecas) + ' pc', data(e.data).replaceAll('/', '-')]));
}


// ---------- Pagamento / antecipação do cliente ----------
async function novoPagamento(p, saldo, depois) {
  const cad = await cadastros(db);
  modal({
    titulo: `Pagamento · Pedido ${p.numero} · ${p.cliente_nome}`,
    corpo: `<p class="muted peq">Saldo em aberto: <b>${moeda(Math.max(saldo, 0))}</b></p><div class="grade g2">
      <label class="campo">Data<input type="date" id="pg-data" value="${hojeISO()}"></label>
      <label class="campo">Valor (R$)<input type="number" step="0.01" min="0" id="pg-valor" value="${saldo > 0 ? saldo.toFixed(2) : ''}"></label>
      <label class="campo">Forma<select id="pg-forma">${cad.formas.map(f => `<option ${f.nome === p.forma_pagamento ? 'selected' : ''}>${h(f.nome)}</option>`).join('')}<option>Outro</option></select></label>
      <label class="campo">Observação<input id="pg-obs" placeholder="Ex.: entrada 50%, antecipação"></label></div>`,
    botoes: [{ texto: 'Cancelar' }, { texto: 'Registrar', classe: 'pri', acao: async (m) => {
      const r = await chamar(db, 'registrar_pagamento_pedido', { p_pedido: p.id, p_data: m.querySelector('#pg-data').value || null,
        p_valor: +m.querySelector('#pg-valor').value || 0, p_forma: m.querySelector('#pg-forma').value, p_observacao: m.querySelector('#pg-obs').value });
      if (!r) return false;
      toast('Pagamento registrado.', 'ok'); depois && depois();
    } }]
  });
}

// ---------- Folha completa do pedido: itens, histórico de retiradas e pagamentos ----------
async function imprimirFolhaPedido(pedidoId) {
  const [[p], [r], itens, entregas, pags] = await Promise.all([
    ler(db.from('pedidos').select('*').eq('id', pedidoId)),
    ler(db.from('v_pedido_resumo').select('*').eq('pedido_id', pedidoId)),
    ler(db.from('pedido_itens').select('*').eq('pedido_id', pedidoId).order('ordem')),
    ler(db.from('entregas').select('*, entrega_itens(op_item_id, quantidade)').eq('pedido_id', pedidoId).order('criado_em')),
    ler(db.from('pedido_pagamentos').select('*').eq('pedido_id', pedidoId).order('data')),
  ]);
  const cli = p.cliente_id ? (await ler(db.from('clientes').select('*').eq('id', p.cliente_id)))[0] : null;
  const funcs = itens.length ? await ler(db.from('pedido_funcionarios').select('*').in('pedido_item_id', itens.map(i => i.id)).order('ordem')) : [];
  const oiIds = [...new Set(entregas.flatMap(e => e.entrega_itens.map(x => x.op_item_id)))];
  const ois = oiIds.length ? await ler(db.from('op_itens').select('id, pedido_item_id').in('id', oiIds)) : [];
  const itemDoOi = new Map(ois.map(o => [o.id, o.pedido_item_id]));
  const entreguePorItem = new Map();
  entregas.forEach(e => e.entrega_itens.forEach(x => { const k = itemDoOi.get(x.op_item_id); entreguePorItem.set(k, (entreguePorItem.get(k) || 0) + x.quantidade); }));
  const nomeItem = (i) => [i.referencia, i.descricao, i.cor, i.tamanho].filter(Boolean).join(' · ');
  const totalPedido = itens.reduce((a, i) => a + i.quantidade * Number(i.valor_unitario), 0);
  const pago = pags.reduce((a, x) => a + Number(x.valor), 0);
  const prod = itens.filter(i => i.tipo === 'PRODUTO');
  const completo = r.pecas > 0 && r.entregue >= r.pecas;
  imprimirHtml(`<div class="doc">${cabecalhoDoc(completo ? 'TERMO DE ENTREGA DO PEDIDO' : 'SITUAÇÃO DO PEDIDO', `Pedido ${p.numero} · ${data(hojeISO())}`)}
    <table class="info"><tr><td>Cliente</td><td><b>${h(p.cliente_nome)}</b>${cli?.razao_social ? `<br>${h(cli.razao_social)}` : ''}</td><td>CNPJ / CPF</td><td>${h(cli?.documento || '—')}</td></tr>
      <tr><td>Pedido</td><td><b>${h(p.numero)}</b> · ${data(p.data)}</td><td>Vendedor</td><td>${h(p.vendedor || '—')}</td></tr>
      <tr><td>Previsão de entrega</td><td>${data(p.previsao_entrega) || '—'}</td><td>Situação</td><td><b>${completo ? 'Entregue por completo' + (p.baixado_em ? ' em ' + data(p.baixado_em.slice(0, 10)) : '') : h(r.situacao)}</b></td></tr>
      ${cli?.endereco ? `<tr><td>Endereço</td><td colspan="3">${h(cli.endereco)}</td></tr>` : ''}</table>
    <h3>Itens do pedido</h3>
    <table><thead><tr><th>Item</th><th>Funcionários</th><th class="n">Qtd</th><th class="n">Entregue</th><th class="n">Falta</th><th class="n">Valor</th></tr></thead>
      <tbody>${itens.map(i => { const fs = funcs.filter(f => f.pedido_item_id === i.id), ent = entreguePorItem.get(i.id) || 0;
        return `<tr><td>${h(nomeItem(i))}${i.tecido ? `<br><small>${h(i.tecido)}</small>` : ''}</td><td class="peq">${h(fs.map(f => f.nome).join(', '))}</td>
          <td class="n">${num(i.quantidade)}</td><td class="n">${i.tipo === 'PRODUTO' ? num(ent) : '—'}</td><td class="n">${i.tipo === 'PRODUTO' ? num(Math.max(i.quantidade - ent, 0)) : '—'}</td>
          <td class="n">${moeda(i.quantidade * i.valor_unitario)}</td></tr>`; }).join('')}</tbody>
      <tfoot><tr><th colspan="2">Total</th><th class="n">${num(prod.reduce((a, i) => a + i.quantidade, 0))}</th><th class="n">${num(r.entregue)}</th><th class="n">${num(Math.max(r.pecas - r.entregue, 0))}</th><th class="n">${moeda(totalPedido)}</th></tr></tfoot></table>
    <h3>Histórico de retiradas</h3>
    ${entregas.length ? `<table><thead><tr><th>#</th><th>Romaneio</th><th>Data</th><th>Peças</th><th class="n">Qtd</th><th>Observação</th></tr></thead>
      <tbody>${entregas.map((e, n) => { const porItem = new Map(); e.entrega_itens.forEach(x => { const k = itemDoOi.get(x.op_item_id); porItem.set(k, (porItem.get(k) || 0) + x.quantidade); });
        return `<tr><td>${n + 1}ª</td><td>${h(e.numero)}</td><td>${data(e.data)}</td>
          <td class="peq">${[...porItem.entries()].map(([k, q]) => { const i = itens.find(x => x.id === k); return `${num(q)}× ${h(i ? nomeItem(i) : '')}`; }).join('<br>')}</td>
          <td class="n"><b>${num(e.entrega_itens.reduce((a, x) => a + x.quantidade, 0))}</b></td><td class="peq">${h(e.observacao || '')}</td></tr>`; }).join('')}</tbody></table>`
      : '<p>Nenhuma retirada registrada.</p>'}
    <h3>Pagamentos</h3>
    ${pags.length ? `<table><thead><tr><th>Data</th><th>Forma</th><th>Observação</th><th class="n">Valor</th></tr></thead>
      <tbody>${pags.map(x => `<tr><td>${data(x.data)}</td><td>${h(x.forma || '')}</td><td>${h(x.observacao || '')}</td><td class="n">${moeda(x.valor)}</td></tr>`).join('')}</tbody></table>`
      : `<p>Nenhum pagamento registrado${p.forma_pagamento ? ` · forma combinada: ${h(p.forma_pagamento)}` : ''}.</p>`}
    <table class="info" style="margin-top:4mm"><tr><td>Valor do pedido</td><td><b>${moeda(totalPedido)}</b></td><td>Recebido</td><td><b>${moeda(pago)}</b></td></tr>
      <tr><td>Saldo a receber</td><td colspan="3"><b>${pago >= totalPedido - 0.004 ? 'Quitado' : moeda(totalPedido - pago)}</b></td></tr></table>
    ${completo ? `<p style="margin-top:4mm">Declaro que recebi todas as peças deste pedido, conforme o histórico de retiradas acima.</p>` : ''}
    <div class="assin"><div>KLINIK · data</div><div>${h(p.cliente_nome)} · data</div></div></div>`,
    nomeArquivo([completo ? 'Termo de entrega' : 'Situacao do pedido', 'Pedido ' + p.numero, p.cliente_nome, completo ? 'Completo' : r.situacao,
      num(r.entregue) + ' de ' + num(r.pecas) + ' pc', pago >= totalPedido - 0.004 ? 'Quitado' : 'Saldo ' + moeda(totalPedido - pago).replace(/\s/g, ' '), data(hojeISO()).replaceAll('/', '-')]));
}
