import { db, tem } from '../app.js';
import { h, num, moeda, data, chip, modal, ler, chamar, toast, confirmar, pedirTexto, opcoes, hojeISO, cadastros, NOME_ETAPA, imprimirHtml, cabecalhoDoc, nomeArquivo } from '../util.js';

let aba = 'novo';
let parceiro = '';
let antecipado = false;
const sel = new Set();

export async function render(el) {
  const cad = await cadastros(db);
  const pode = tem('financeiro');
  if (aba === 'novo') {
    let rems = [];
    if (parceiro) {
      rems = await ler(db.from('v_remessas').select('*').eq('parceiro_id', parceiro).is('fechamento', null)
        .in('status', antecipado ? ['RETORNADO', 'ENVIADO', 'PARCIAL'] : ['RETORNADO']).order('data_envio'));
    }
    [...sel].forEach(id => { if (!rems.some(r => r.id === id)) sel.delete(id); });
    const tot = rems.filter(r => sel.has(r.id)).reduce((a, r) => a + Number(r.valor_total), 0);
    el.innerHTML = cabecalho() + `
      <div class="card"><div class="filtros" style="margin:0">
        <label class="campo">Parceiro<select id="parc">${opcoes(cad.parceiros, parceiro, 'nome', 'id', 'Escolha o parceiro…')}</select></label>
        <label class="campo">Competência<input type="month" id="comp" value="${hojeISO().slice(0, 7)}"></label>
        <label class="peq" style="padding-bottom:10px"><input type="checkbox" id="ant" ${antecipado ? 'checked' : ''}> Incluir remessas ainda com o parceiro (pagamento antecipado)</label>
      </div></div>
      <div class="tabela-wrap"><table><thead><tr><th><input type="checkbox" id="todos"></th><th>Remessa</th><th>Etapa</th><th>Envio</th><th class="n">Peças</th><th class="n">Voltaram</th><th>Situação</th><th class="n">Valor</th></tr></thead>
        <tbody>${rems.map(r => `<tr><td><input type="checkbox" data-r="${r.id}" ${sel.has(r.id) ? 'checked' : ''}></td><td class="forte">${h(r.numero)}</td><td>${h(NOME_ETAPA[r.etapa])}</td>
          <td>${data(r.data_envio)}</td><td class="n">${num(r.pecas)}</td><td class="n">${num(r.retornadas)}</td><td>${chip(r.status, r.status === 'RETORNADO' ? 'ok' : 'alerta')}</td><td class="n">${moeda(r.valor_total)}</td></tr>`).join('')
          || `<tr><td colspan="8" class="vazio">${parceiro ? 'Nenhuma remessa para fechar.' : 'Escolha o parceiro.'}</td></tr>`}</tbody></table></div>
      <div class="total-barra" style="margin-top:12px"><div>${sel.size} remessa(s) · Total <b>${moeda(tot)}</b></div>
        ${pode ? `<div class="acoes"><input class="inp" id="obs" placeholder="Observação (opcional)" style="min-width:220px"><button class="btn pri" id="criar" ${sel.size ? '' : 'disabled'}>Gerar fechamento</button></div>` : ''}</div>`;
    el.querySelector('#parc').onchange = (e) => { parceiro = e.target.value; sel.clear(); render(el); };
    el.querySelector('#ant').onchange = (e) => { antecipado = e.target.checked; render(el); };
    el.querySelector('#todos').onchange = (e) => { rems.forEach(r => e.target.checked ? sel.add(r.id) : sel.delete(r.id)); render(el); };
    el.querySelectorAll('[data-r]').forEach(c => c.onchange = () => { c.checked ? sel.add(c.dataset.r) : sel.delete(c.dataset.r); render(el); });
    el.querySelector('#criar')?.addEventListener('click', async () => {
      if (!await confirmar('Gerar fechamento', `Fechar ${sel.size} remessa(s) no total de <b>${moeda(tot)}</b>?`, 'Gerar')) return;
      const f = await chamar(db, 'criar_fechamento', { p_parceiro: parceiro, p_competencia: el.querySelector('#comp').value, p_remessas: [...sel], p_antecipado: antecipado, p_observacao: el.querySelector('#obs').value });
      if (f) { toast(`Fechamento ${f.numero} gerado: ${moeda(f.total)}.`, 'ok'); sel.clear(); aba = 'historico'; render(el); }
    });
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
  return `<div class="cab"><div><h1>Fechamento dos parceiros</h1><p>Junte as remessas que voltaram, gere o fechamento e registre o pagamento.</p></div></div>
    <div class="abas"><button data-aba="novo" class="${aba === 'novo' ? 'ativo' : ''}">Novo fechamento</button><button data-aba="historico" class="${aba === 'historico' ? 'ativo' : ''}">Histórico</button></div>`;
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
  const itens = await ler(db.from('fechamento_remessas').select('*, remessas(numero, etapa, data_envio)').eq('fechamento_id', f.id));
  imprimirHtml(`<div class="doc">${cabecalhoDoc('FECHAMENTO DE PARCEIRO', f.numero)}
    <table class="info"><tr><td>Parceiro</td><td><b>${h(f.parceiro_nome)}</b></td><td>Competência</td><td>${h(f.competencia)}</td></tr>
      <tr><td>Situação</td><td>${h(f.status)}</td><td>Pagamento</td><td>${f.pago_em ? data(f.pago_em) + ' · ' + h(f.forma_pagamento || '') : '—'}</td></tr></table>
    <table><thead><tr><th>Remessa</th><th>Etapa</th><th>Envio</th><th class="n">Peças</th><th class="n">Valor</th></tr></thead>
      <tbody>${itens.map(i => `<tr><td>${h(i.remessas?.numero)}</td><td>${h(NOME_ETAPA[i.remessas?.etapa] || '')}</td><td>${data(i.remessas?.data_envio)}</td><td class="n">${num(i.pecas)}</td><td class="n">${moeda(i.valor)}</td></tr>`).join('')}</tbody></table>
    <div class="total">TOTAL: ${moeda(f.total)}</div>
    ${f.observacao ? `<p>Observações: ${h(f.observacao)}</p>` : ''}
    <div class="assin"><div>KLINIK</div><div>${h(f.parceiro_nome)}</div></div></div>`,
    nomeArquivo(['Fechamento', f.numero, f.parceiro_nome, f.competencia, f.status, moeda(f.total).replace(/\s/g, ' ')]));
}
