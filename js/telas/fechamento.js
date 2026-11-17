import { db, tem } from '../app.js';
import { h, num, moeda, data, chip, modal, ler, chamar, toast, confirmar, pedirTexto, opcoes, hojeISO, cadastros, NOME_ETAPA, imprimirHtml, cabecalhoDoc, nomeArquivo } from '../util.js';

let aba = 'aberto';
let de = '', ate = '', etapa = '', antecipado = false;
let aberto = null;            // parceiro expandido
const excluidas = new Set();  // remessas desmarcadas
const itensAbertos = new Set();
let enviosCache = new Map();  // remessa_id -> linhas

const dataRef = (r) => r.ultimo_retorno || r.data_envio;
const br = (d) => d ? data(d) : '';

export async function render(el) {
  const pode = tem('financeiro');
  if (aba === 'aberto') {
    const todas = await ler(db.from('v_remessas').select('*').is('fechamento', null)
      .in('status', antecipado ? ['RETORNADO', 'ENVIADO', 'PARCIAL'] : ['RETORNADO']).order('data_envio'));
    const rems = todas.filter(r => (!de || dataRef(r) >= de) && (!ate || dataRef(r) <= ate) && (!etapa || r.etapa === etapa));
    const grupos = new Map();
    rems.forEach(r => {
      if (!grupos.has(r.parceiro_id)) grupos.set(r.parceiro_id, { id: r.parceiro_id, nome: r.parceiro_nome, rems: [] });
      grupos.get(r.parceiro_id).rems.push(r);
    });
    const lista = [...grupos.values()].map(g => ({ ...g,
      etapas: [...new Set(g.rems.map(r => NOME_ETAPA[r.etapa]))].join(', '),
      pecas: g.rems.reduce((a, r) => a + r.pecas, 0), valor: g.rems.reduce((a, r) => a + Number(r.valor_total), 0),
      semPreco: g.rems.filter(r => !Number(r.valor_total)).length })).sort((a, b) => b.valor - a.valor);
    const totalGeral = lista.reduce((a, g) => a + g.valor, 0);
    if (aberto && !grupos.has(aberto)) aberto = null;
    if (aberto) {
      const faltam = grupos.get(aberto).rems.filter(r => !enviosCache.has(r.id)).map(r => r.id);
      if (faltam.length) (await ler(db.from('v_envios').select('*').in('remessa_id', faltam).order('op_numero')))
        .reduce((m, e) => (m.get(e.remessa_id) || m.set(e.remessa_id, []).get(e.remessa_id)).push(e) && m, enviosCache);
      faltam.forEach(id => { if (!enviosCache.has(id)) enviosCache.set(id, []); });
    }
    const detalhe = (g) => {
      const selec = g.rems.filter(r => !excluidas.has(r.id));
      const tot = selec.reduce((a, r) => a + Number(r.valor_total), 0);
      return `<tr class="det"><td colspan="6"><div class="fech-det">
        <div class="tabela-wrap"><table>
          <thead><tr><th><input type="checkbox" id="todas" ${selec.length === g.rems.length ? 'checked' : ''}></th><th>Remessa</th><th>Etapa</th><th>Envio</th><th>Retorno</th><th class="n">Peças</th><th class="n">Voltaram</th><th>Situação</th><th class="n">Valor</th><th></th></tr></thead>
          <tbody>${g.rems.map(r => `<tr><td><input type="checkbox" data-r="${r.id}" ${excluidas.has(r.id) ? '' : 'checked'}></td><td class="forte">${h(r.numero)}</td><td>${h(NOME_ETAPA[r.etapa])}</td>
            <td>${br(r.data_envio)}</td><td>${br(r.ultimo_retorno) || '—'}</td><td class="n">${num(r.pecas)}</td><td class="n">${num(r.retornadas)}</td>
            <td>${chip(r.status, r.status === 'RETORNADO' ? 'ok' : 'alerta')}</td><td class="n">${Number(r.valor_total) ? moeda(r.valor_total) : chip('sem preço', 'erro')}</td>
            <td><button class="btn peq" data-itens="${r.id}">${itensAbertos.has(r.id) ? '▾' : '▸'} itens</button></td></tr>
            ${itensAbertos.has(r.id) ? `<tr><td></td><td colspan="9"><table class="sub"><thead><tr><th>OP</th><th>Pedido · cliente</th><th>Produto</th><th>Cor</th><th>Tam.</th><th class="n">Qtd</th><th class="n">R$/peça</th><th class="n">Total</th></tr></thead>
              <tbody>${(enviosCache.get(r.id) || []).map(e => `<tr><td>${e.op_numero}</td><td>${h(e.pedido_numero)} · ${h(e.cliente_nome)}</td><td>${h([e.referencia, e.descricao].filter(Boolean).join(' '))}</td><td>${h(e.cor || '')}</td><td>${h(e.tamanho || '')}</td>
                <td class="n">${num(e.quantidade)}</td><td class="n">${moeda(e.valor_peca)}</td><td class="n">${moeda(e.valor_total)}</td></tr>`).join('')}</tbody></table></td></tr>` : ''}`).join('')}</tbody></table></div>
        <div class="total-barra" style="margin-top:10px"><div>${selec.length} remessa(s) · ${num(selec.reduce((a, r) => a + r.pecas, 0))} peças · A pagar <b style="font-size:1.15rem">${moeda(tot)}</b></div>
          <div class="acoes"><input class="inp" id="obs" placeholder="Observação no comprovante (opcional)" style="min-width:220px">
            <button class="btn" id="previa" ${selec.length ? '' : 'disabled'}>Comprovante (prévia)</button>
            ${pode ? `<button class="btn pri" id="criar" ${selec.length ? '' : 'disabled'}>Gerar fechamento</button>` : ''}</div></div>
      </div></td></tr>`;
    };
    el.innerHTML = cabecalho() + `
      <div class="card"><div class="filtros" style="margin:0">
        <label class="campo">De<input type="date" id="de" value="${de}"></label>
        <label class="campo">Até<input type="date" id="ate" value="${ate}"></label>
        <label class="campo">Etapa<select id="etapa"><option value="">Todas</option>${Object.entries(NOME_ETAPA).map(([k, v]) => `<option value="${k}" ${etapa === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
        <div class="campo" style="flex:0;white-space:nowrap">Atalhos<div style="display:flex;gap:6px;margin-top:4px">
          <button class="btn peq" data-per="mes">Este mês</button><button class="btn peq" data-per="ant">Mês passado</button><button class="btn peq" data-per="tudo">Tudo</button></div></div>
        <label class="peq" style="padding-bottom:10px"><input type="checkbox" id="ant" ${antecipado ? 'checked' : ''}> Incluir remessas ainda com o parceiro</label>
      </div><p class="peq muted" style="margin:6px 0 0">O período considera a data em que as peças voltaram (ou a data de envio, se ainda não voltaram).</p></div>
      <div class="total-barra" style="margin:12px 0"><div>Em aberto${de || ate ? ` de ${br(de) || 'início'} até ${br(ate) || 'hoje'}` : ''}: <b style="font-size:1.2rem">${moeda(totalGeral)}</b> · ${lista.length} parceiro(s)</div></div>
      <div class="tabela-wrap"><table class="fech"><thead><tr><th>Parceiro</th><th>Etapas</th><th class="n">Remessas</th><th class="n">Peças</th><th class="n">Em aberto</th><th></th></tr></thead>
        <tbody>${lista.map(g => `<tr class="parc ${aberto === g.id ? 'aberto' : ''}" data-p="${g.id}"><td class="forte">${h(g.nome)}</td><td>${h(g.etapas)}</td><td class="n">${g.rems.length}</td><td class="n">${num(g.pecas)}</td>
          <td class="n forte">${moeda(g.valor)}${g.semPreco ? ` ${chip(g.semPreco + ' sem preço', 'erro')}` : ''}</td><td class="n">${aberto === g.id ? '▾' : '▸'}</td></tr>${aberto === g.id ? detalhe(g) : ''}`).join('')
          || '<tr><td colspan="6" class="vazio">Nada em aberto neste período.</td></tr>'}</tbody></table></div>`;

    const re = () => render(el);
    el.querySelector('#de').onchange = (e) => { de = e.target.value; re(); };
    el.querySelector('#ate').onchange = (e) => { ate = e.target.value; re(); };
    el.querySelector('#etapa').onchange = (e) => { etapa = e.target.value; re(); };
    el.querySelector('#ant').onchange = (e) => { antecipado = e.target.checked; re(); };
    el.querySelectorAll('[data-per]').forEach(b => b.onclick = () => {
      const d = new Date(), z = (x) => x.toISOString().slice(0, 10);
      if (b.dataset.per === 'mes') { de = z(new Date(d.getFullYear(), d.getMonth(), 1)); ate = z(new Date(d.getFullYear(), d.getMonth() + 1, 0)); }
      else if (b.dataset.per === 'ant') { de = z(new Date(d.getFullYear(), d.getMonth() - 1, 1)); ate = z(new Date(d.getFullYear(), d.getMonth(), 0)); }
      else { de = ''; ate = ''; }
      re();
    });
    el.querySelectorAll('tr.parc').forEach(tr => tr.onclick = () => { aberto = aberto === tr.dataset.p ? null : tr.dataset.p; re(); });
    if (aberto) {
      const g = grupos.get(aberto);
      el.querySelector('#todas').onchange = (e) => { g.rems.forEach(r => e.target.checked ? excluidas.delete(r.id) : excluidas.add(r.id)); re(); };
      el.querySelectorAll('[data-r]').forEach(c => c.onchange = () => { c.checked ? excluidas.delete(c.dataset.r) : excluidas.add(c.dataset.r); re(); });
      el.querySelectorAll('[data-itens]').forEach(b => b.onclick = () => { const id = b.dataset.itens; itensAbertos.has(id) ? itensAbertos.delete(id) : itensAbertos.add(id); re(); });
      const selec = () => g.rems.filter(r => !excluidas.has(r.id));
      const periodo = () => {
        const ds = selec().map(dataRef).filter(Boolean).sort();
        return `${br(de || ds[0])} a ${br(ate || ds[ds.length - 1])}`;
      };
      el.querySelector('#previa').onclick = () => imprimirDoc({ titulo: 'PRÉVIA DE FECHAMENTO', numero: 'Prévia · ' + br(hojeISO()), parceiro: g.nome, periodo: periodo(),
        rems: selec(), status: 'EM ABERTO', obs: el.querySelector('#obs').value });
      el.querySelector('#criar')?.addEventListener('click', async () => {
        const rs = selec(), tot = rs.reduce((a, r) => a + Number(r.valor_total), 0);
        if (!await confirmar('Gerar fechamento', `Fechar ${rs.length} remessa(s) de <b>${h(g.nome)}</b> (${periodo()}) no total de <b>${moeda(tot)}</b>?`, 'Gerar')) return;
        const f = await chamar(db, 'criar_fechamento', { p_parceiro: g.id, p_competencia: periodo(), p_remessas: rs.map(r => r.id),
          p_antecipado: rs.some(r => r.status !== 'RETORNADO'), p_observacao: el.querySelector('#obs').value });
        if (!f) return;
        toast(`Fechamento ${f.numero} gerado: ${moeda(f.total)}.`, 'ok');
        rs.forEach(r => excluidas.delete(r.id)); aberto = null; re();
        const [vf] = await ler(db.from('v_fechamentos').select('*').eq('id', f.id));
        if (vf && await confirmar('Fechamento gerado', `Imprimir o comprovante do <b>${h(f.numero)}</b>?`, 'Imprimir')) imprimir(vf);
      });
    }
  } else {
    const lista = await ler(db.from('v_fechamentos').select('*').order('criado_em', { ascending: false }).limit(300));
    el.innerHTML = cabecalho() + `<div class="tabela-wrap"><table><thead><tr><th>Nº</th><th>Parceiro</th><th>Competência</th><th class="n">Remessas</th><th class="n">Peças</th><th class="n">Total</th><th>Situação</th><th>Pagamento</th><th></th></tr></thead>
      <tbody>${lista.map(f => `<tr><td class="forte">${h(f.numero)}</td><td>${h(f.parceiro_nome)}</td><td>${h(f.competencia)}</td><td class="n">${f.remessas}</td><td class="n">${num(f.pecas)}</td><td class="n">${moeda(f.total)}</td>
        <td>${chip(f.status, f.status === 'PAGO' ? 'ok' : f.status === 'PENDENTE' ? 'alerta' : 'erro')}</td><td>${f.pago_em ? data(f.pago_em) + ' · ' + h(f.forma_pagamento || '') : '—'}</td>
        <td><div class="acoes"><button class="btn peq" data-imp="${f.id}">PDF</button>
          ${pode && f.status === 'PENDENTE' ? `<button class="btn peq pri" data-pagar="${f.id}">Registrar pagamento</button><button class="btn peq perigo" data-canc="${f.id}">Cancelar</button>` : ''}</div></td></tr>`).join('')
        || '<tr><td colspan="9" class="vazio">Nenhum fechamento.</td></tr>'}</tbody></table></div>`;
    el.querySelectorAll('[data-imp]').forEach(b => b.onclick = () => imprimir(lista.find(f => f.id === b.dataset.imp)));
    el.querySelectorAll('[data-pagar]').forEach(b => b.onclick = () => pagar(lista.find(f => f.id === b.dataset.pagar), () => render(el)));
    el.querySelectorAll('[data-canc]').forEach(b => b.onclick = async () => {
      const m = await pedirTexto('Cancelar fechamento', 'As remessas voltam a ficar disponíveis para outro fechamento.', { minimo: 5, botao: 'Cancelar fechamento' });
      if (m && await chamar(db, 'cancelar_fechamento', { p_id: b.dataset.canc, p_motivo: m })) { toast('Fechamento cancelado.', 'ok'); render(el); }
    });
  }
  el.querySelectorAll('[data-aba]').forEach(b => b.onclick = () => { aba = b.dataset.aba; render(el); });
}

function cabecalho() {
  return `<div class="cab"><div><h1>Fechamento dos parceiros</h1><p>Valores em aberto por parceiro. Clique no parceiro para ver o detalhe, ajuste o período e gere o fechamento.</p></div></div>
    <div class="abas"><button data-aba="aberto" class="${aba === 'aberto' ? 'ativo' : ''}">Em aberto</button><button data-aba="historico" class="${aba === 'historico' ? 'ativo' : ''}">Histórico</button></div>`;
}

function pagar(f, depois) {
  modal({
    titulo: `Pagamento · ${f.numero} · ${f.parceiro_nome}`,
    corpo: `<p>Total: <b>${moeda(f.total)}</b></p><div class="grade g2">
      <label class="campo">Data<input type="date" id="pg-data" value="${hojeISO()}"></label>
      <label class="campo">Forma<select id="pg-forma"><option>Pix</option><option>Transferência</option><option>Dinheiro</option><option>Boleto</option><option>Outro</option></select></label>
      <label class="campo" style="grid-column:1/-1">Comprovante / referência<input id="pg-ref"></label></div>`,
    botoes: [{ texto: 'Cancelar' }, { texto: 'Confirmar pagamento', classe: 'pri', acao: async (m) => {
      const r = await chamar(db, 'pagar_fechamento', { p_id: f.id, p_data: m.querySelector('#pg-data').value, p_forma: m.querySelector('#pg-forma').value, p_referencia: m.querySelector('#pg-ref').value });
      if (!r) return false; toast('Pagamento registrado.', 'ok'); depois();
    } }]
  });
}

async function imprimir(f) {
  const fr = await ler(db.from('fechamento_remessas').select('remessa_id, valor, pecas').eq('fechamento_id', f.id));
  const rems = fr.length ? await ler(db.from('v_remessas').select('*').in('id', fr.map(x => x.remessa_id)).order('data_envio')) : [];
  const valor = new Map(fr.map(x => [x.remessa_id, x]));
  rems.forEach(r => { r.valor_total = valor.get(r.id)?.valor ?? r.valor_total; });
  imprimirDoc({ titulo: f.status === 'PAGO' ? 'COMPROVANTE DE PAGAMENTO' : 'FECHAMENTO DE PARCEIRO', numero: f.numero, parceiro: f.parceiro_nome,
    periodo: f.competencia, rems, status: f.status, obs: f.observacao, total: f.total,
    pagamento: f.pago_em ? `${data(f.pago_em)} · ${f.forma_pagamento || ''}${f.referencia_pagamento ? ' · ' + f.referencia_pagamento : ''}` : '' });
}

// comprovante personalizado: resumo por remessa + itens de cada remessa
async function imprimirDoc({ titulo, numero, parceiro, periodo, rems, status, obs, total, pagamento }) {
  const env = rems.length ? await ler(db.from('v_envios').select('*').in('remessa_id', rems.map(r => r.id)).order('op_numero')) : [];
  const tot = total ?? rems.reduce((a, r) => a + Number(r.valor_total), 0);
  const pecas = rems.reduce((a, r) => a + r.pecas, 0);
  imprimirHtml(`<div class="doc">${cabecalhoDoc(titulo, numero)}
    <table class="info"><tr><td>Parceiro</td><td><b>${h(parceiro)}</b></td><td>Período</td><td><b>${h(periodo || '—')}</b></td></tr>
      <tr><td>Situação</td><td>${h(status)}</td><td>Pagamento</td><td>${h(pagamento || '—')}</td></tr>
      <tr><td>Remessas</td><td>${rems.length}</td><td>Peças</td><td>${num(pecas)}</td></tr></table>
    <h3>Resumo por remessa</h3>
    <table><thead><tr><th>Remessa</th><th>Etapa</th><th>Envio</th><th>Retorno</th><th class="n">Peças</th><th class="n">Valor</th></tr></thead>
      <tbody>${rems.map(r => `<tr><td>${h(r.numero)}</td><td>${h(NOME_ETAPA[r.etapa] || '')}</td><td>${data(r.data_envio)}</td><td>${data(r.ultimo_retorno) || '—'}</td><td class="n">${num(r.pecas)}</td><td class="n">${moeda(r.valor_total)}</td></tr>`).join('')}</tbody></table>
    <h3>Detalhe das peças</h3>
    <table><thead><tr><th>Remessa</th><th>OP</th><th>Pedido · cliente</th><th>Produto</th><th>Cor</th><th>Tam.</th><th class="n">Qtd</th><th class="n">R$/peça</th><th class="n">Total</th></tr></thead>
      <tbody>${env.map(e => `<tr><td>${h(e.remessa_numero)}</td><td>${e.op_numero}</td><td>${h(e.pedido_numero)} · ${h(e.cliente_nome)}</td><td>${h([e.referencia, e.descricao].filter(Boolean).join(' '))}</td>
        <td>${h(e.cor || '')}</td><td>${h(e.tamanho || '')}</td><td class="n">${num(e.quantidade)}</td><td class="n">${moeda(e.valor_peca)}</td><td class="n">${moeda(e.valor_total)}</td></tr>`).join('')}</tbody></table>
    <div class="total">TOTAL A PAGAR: ${moeda(tot)}</div>
    ${obs ? `<div class="obs">${h(obs)}</div>` : ''}
    <div class="assin"><div>KLINIK · data</div><div>${h(parceiro)} · recebi o valor acima</div></div></div>`,
    nomeArquivo([titulo === 'PRÉVIA DE FECHAMENTO' ? 'Previa fechamento' : 'Fechamento', numero, parceiro, (periodo || '').replaceAll('/', '-'), status, moeda(tot).replace(/\s/g, ' ')]));
}
