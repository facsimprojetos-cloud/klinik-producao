// Ações de produção usadas em várias telas (Kanban, Remessas, Pedidos, Leitura QR)
import { db, tem } from './app.js';
import { PREVISAO_DIAS } from './config.js';
import {
  h, num, moeda, data, dataHora, chip, modal, chamar, ler, toast, confirmar, hojeISO, somaDias, opcoes,
  cadastros, NOME_ETAPA, etapasTexto, arr, qrSvg, imprimirHtml, cabecalhoDoc, nomeArquivo
} from './util.js';

const ORDEM_ETAPAS = ['FACCAO', 'CASEADOR', 'SILK', 'BORDADO'];
// Histórico por item da OP: { op_item_id: { ETAPA: {quantidade, enviado, retornado} } }
export function historicoEtapas(linhas) {
  const m = new Map();
  for (const e of linhas || []) {
    if (!m.has(e.op_item_id)) m.set(e.op_item_id, {});
    m.get(e.op_item_id)[e.etapa] = { quantidade: e.quantidade, enviado: e.enviado, retornado: e.retornado };
  }
  return m;
}
// Resumo da OP por etapa (somando os itens que passam por ela): [{etapa, total, retornado, enviado}]
export function resumoEtapasOp(linhas) {
  const r = {};
  for (const e of linhas || []) {
    const x = r[e.etapa] || (r[e.etapa] = { etapa: e.etapa, total: 0, retornado: 0, enviado: 0 });
    x.total += e.quantidade; x.retornado += Math.min(e.retornado, e.quantidade); x.enviado += Math.min(e.enviado, e.quantidade);
  }
  return ORDEM_ETAPAS.filter(k => r[k]).map(k => r[k]);
}
export function chipsResumo(res) {
  if (!res.length) return '';
  return `<div class="etapas">${res.map(x => {
    const cls = x.retornado >= x.total ? 'feito' : x.enviado > 0 || x.retornado > 0 ? 'atual' : '';
    return `<span class="etp ${cls}" title="${h(NOME_ETAPA[x.etapa])}: ${x.retornado} de ${x.total} peça(s) já voltaram${x.enviado > x.retornado ? `, ${x.enviado - x.retornado} com o parceiro` : ''}">${cls === 'feito' ? '✓ ' : ''}${h(NOME_ETAPA[x.etapa])} ${num(x.retornado)}/${num(x.total)}</span>`;
  }).join('')}</div>`;
}
// Aviso de etapas por onde o item já passou. destino = etapa que se pretende mandar agora
function avisoPassou(hist, destino) {
  if (!hist) return '';
  const feitas = ORDEM_ETAPAS.filter(k => hist[k] && hist[k].retornado > 0)
    .map(k => `${NOME_ETAPA[k]} ${num(Math.min(hist[k].retornado, hist[k].quantidade))}/${num(hist[k].quantidade)}`);
  const d = destino && hist[destino];
  let repete = '';
  if (d && d.enviado >= d.quantidade) repete = `<div class="aviso-repete">⚠ Este item já ${d.retornado >= d.quantidade ? 'passou pelo' : 'foi todo enviado para o'} ${h(NOME_ETAPA[destino])} (${num(d.enviado)} de ${num(d.quantidade)} peça(s)). Confira antes de mandar de novo.</div>`;
  else if (d && d.enviado > 0) repete = `<div class="peq" style="color:var(--alerta)">${num(d.enviado)} de ${num(d.quantidade)} peça(s) já foram para o ${h(NOME_ETAPA[destino])}; faltam ${num(d.quantidade - d.enviado)}.</div>`;
  return (feitas.length ? `<div class="peq" style="color:var(--ok)">Já passou: ${h(feitas.join(' · '))}</div>` : '') + repete;
}

const rotuloItem = (x) => [x.referencia, x.descricao, x.cor, x.tamanho].filter(Boolean).join(' · ');

// ---------- Nova OP: itens do saldo com as mesmas etapas ----------
export async function novaOp(depois, filtroPedido = null) {
  // OP agora é montada na tela "Itens dos pedidos" (só peças cortadas)
  if (filtroPedido) {
    const [p] = await ler(db.from('pedidos').select('numero').eq('id', filtroPedido));
    if (p) sessionStorage.setItem('itens_busca', p.numero);
  }
  location.hash = '#/itens';
}

// ---------- Encaminhar peças concluídas numa etapa (para outra etapa ou embalagem) ----------
const DESTINOS = [['FACCAO', 'Facção'], ['CASEADOR', 'Caseador'], ['SILK', 'Silk'], ['BORDADO', 'Bordado'], ['EMBALAGEM', 'Embalagem']];
export async function encaminhar(opId, de, para, depois) {
  if (!tem('producao')) return toast('Encaminhar exige o perfil "producao".', 'erro');
  const [todas, itens] = await Promise.all([
    ler(db.from('v_op_item_etapas').select('*').eq('op_id', opId)),
    ler(db.from('v_op_itens').select('*').eq('op_id', opId)),
  ]);
  const hist = historicoEtapas(todas);
  const etapas = todas.filter(e => e.etapa === de && e.concluido > 0);
  if (!etapas.length) return toast('Não há peças concluídas nesta etapa.', 'erro');
  const info = new Map(itens.map(i => [i.op_item_id, i]));
  const op = itens[0];
  // sugestão: próxima etapa planejada do 1º item; se não houver, embalagem
  const plano = arr(info.get(etapas[0].op_item_id)?.item_etapas);
  const sugestao = para || plano[plano.indexOf(de) + 1] || 'EMBALAGEM';
  const linhasHtml = (dest) => etapas.map(e => {
    const i = info.get(e.op_item_id) || {}, rot = arr(i.item_etapas);
    const passa = dest === 'EMBALAGEM' || rot.includes(dest);
    const faltam = dest === 'EMBALAGEM' ? rot.slice(rot.indexOf(de) + 1) : [];
    const hi = hist.get(e.op_item_id), jaFoi = dest !== 'EMBALAGEM' && hi?.[dest] && hi[dest].enviado >= hi[dest].quantidade;
    return `<tr data-oi="${e.op_item_id}" class="${jaFoi ? 'repete' : ''}"><td>${h(i.pedido_numero)}<div class="peq muted">${h(i.cliente_nome)}</div></td><td>${h(rotuloItem(i))}${avisoPassou(hi, dest === 'EMBALAGEM' ? null : dest)}</td>
      <td class="peq">${h(etapasTexto(rot))}</td><td class="n">${num(e.concluido)}</td>
      <td class="n">${passa ? `<input class="inp num" type="number" min="0" max="${e.concluido}" value="${jaFoi ? 0 : e.concluido}" data-eq>` : `<span class="peq muted">não passa por ${h(NOME_ETAPA[dest] || dest)}</span>`}
      ${passa && faltam.length ? `<div class="peq" style="color:var(--alerta)">ainda previsto: ${h(etapasTexto(faltam))}</div>` : ''}</td></tr>`;
  }).join('');
  modal({
    titulo: `OP ${op.op_numero} · ${NOME_ETAPA[de]} concluída · para onde vai?`, largo: true,
    corpo: `<div class="grade g2"><label class="campo">Destino<select id="enc-para">${DESTINOS.map(([v, n]) => `<option value="${v}" ${v === sugestao ? 'selected' : ''}>${n}${v === de ? ' (de novo)' : ''}</option>`).join('')}</select></label></div>
      <div class="tabela-wrap" style="margin-top:10px"><table><thead><tr><th>Pedido</th><th>Item</th><th>Etapas previstas</th><th class="n">Concluídas</th><th class="n">Encaminhar</th></tr></thead>
      <tbody id="enc-linhas">${linhasHtml(sugestao)}</tbody></table></div>
      <p class="peq muted" style="margin:8px 0 0">O que não for encaminhado agora continua aqui como concluído, esperando decisão.</p>`,
    aoAbrir: (m) => { m.querySelector('#enc-para').onchange = (ev) => { m.querySelector('#enc-linhas').innerHTML = linhasHtml(ev.target.value); }; },
    botoes: [{ texto: 'Cancelar' }, { texto: 'Encaminhar', classe: 'pri', acao: async (m) => {
      const dest = m.querySelector('#enc-para').value;
      const linhas = [...m.querySelectorAll('#enc-linhas tr[data-oi]')].map(tr => ({ op_item_id: tr.dataset.oi, quantidade: +(tr.querySelector('[data-eq]')?.value) || 0, repete: tr.classList.contains('repete') })).filter(l => l.quantidade > 0);
      if (!linhas.length) { toast('Nenhuma peça para encaminhar.', 'erro'); return false; }
      const rep = linhas.filter(l => l.repete).length;
      if (rep && !(await confirmar('Mandar de novo?', `${rep} item(ns) marcado(s) <b>já passaram por ${h(NOME_ETAPA[dest] || dest)}</b>. Tem certeza de que quer mandar de novo?`, 'Sim, mandar de novo'))) return false;
      linhas.forEach(l => delete l.repete);
      const r = await chamar(db, 'encaminhar', { p_de: de, p_para: dest, p_linhas: linhas });
      if (r == null) return false;
      toast(`${r} peça(s) encaminhadas para ${DESTINOS.find(d => d[0] === dest)[1]}.`, 'ok');
      depois && depois();
    } }]
  });
}

// ---------- Desmembrar OP: peças ainda paradas vão para uma OP nova ----------
export async function desmembrar(opId, depois) {
  if (!tem('producao')) return toast('Desmembrar exige o perfil "producao".', 'erro');
  const itens = (await ler(db.from('v_op_itens').select('*').eq('op_id', opId))).map(i => ({ ...i, livre: i.quantidade - i.movido }));
  if (!itens.some(i => i.livre > 0)) return toast('Todas as peças desta OP já saíram; não há o que desmembrar.', 'erro');
  const op = itens[0];
  modal({
    titulo: `Desmembrar OP ${op.op_numero}`, largo: true,
    corpo: `<p class="muted peq">Escolha quantas peças de cada item vão para uma <b>OP nova</b>. Só dá para mover peças que ainda não foram enviadas. Para mandar só uma parte para um parceiro, você também pode simplesmente enviar uma quantidade menor.</p>
      <div class="tabela-wrap"><table><thead><tr><th>Pedido</th><th>Item</th><th>Etapas</th><th class="n">Na OP</th><th class="n">Ainda paradas</th><th class="n">Para a OP nova</th></tr></thead>
      <tbody>${itens.map(i => `<tr><td>${h(i.pedido_numero)}<div class="peq muted">${h(i.cliente_nome)}</div></td><td>${h(rotuloItem(i))}</td>
        <td class="peq">${h(etapasTexto(arr(i.item_etapas)))}</td><td class="n">${num(i.quantidade)}</td><td class="n">${num(i.livre)}</td>
        <td class="n">${i.livre > 0 ? `<input class="inp num" type="number" min="0" max="${i.livre}" value="0" data-dq="${i.op_item_id}">` : '—'}</td></tr>`).join('')}</tbody></table></div>
      <label class="campo" style="margin-top:10px">Descrição da OP nova<input id="d-desc" placeholder="${h(op.op_descricao || '')}"></label>`,
    botoes: [{ texto: 'Cancelar' }, { texto: 'Criar OP nova', classe: 'pri', acao: async (m) => {
      const linhas = [...m.querySelectorAll('[data-dq]')].map(x => ({ op_item_id: x.dataset.dq, quantidade: +x.value || 0 })).filter(x => x.quantidade > 0);
      if (!linhas.length) { toast('Informe quantas peças vão para a OP nova.', 'erro'); return false; }
      const nova = await chamar(db, 'desmembrar_op', { p_op: opId, p_linhas: linhas, p_descricao: m.querySelector('#d-desc').value });
      if (!nova) return false;
      toast(`OP ${nova.numero} criada a partir da OP ${op.op_numero}.`, 'ok');
      depois && depois();
      if (await confirmar('OP desmembrada', `Imprimir a folha da <b>OP ${nova.numero}</b>?`, 'Imprimir')) imprimirFolhaOp(nova.id);
    } }]
  });
}

// ---------- Enviar peças de uma OP para um parceiro numa etapa ----------
export async function enviar(opId, etapa, depois) {
  if (!tem('producao')) return toast('Enviar exige o perfil "producao".', 'erro');
  const [todasEt, itens, cad] = await Promise.all([
    ler(db.from('v_op_item_etapas').select('*').eq('op_id', opId)),
    ler(db.from('v_op_itens').select('*').eq('op_id', opId)),
    cadastros(db),
  ]);
  const hist = historicoEtapas(todasEt);
  const etapas = todasEt.filter(e => e.etapa === etapa && e.aguardando_envio > 0);
  if (!etapas.length) return toast('Nada aguardando envio nesta etapa.', 'erro');
  const info = new Map(itens.map(i => [i.op_item_id, i]));
  const parceiros = cad.parceiros.filter(p => p.ativo && arr(p.etapas).includes(etapa));
  const op = itens[0];
  modal({
    titulo: `Enviar OP ${op.op_numero} · ${NOME_ETAPA[etapa]}`, largo: true,
    corpo: `
      <div class="grade g3">
        <label class="campo">Parceiro<select id="env-parc">${opcoes(parceiros, null, 'nome', 'id', parceiros.length ? 'Selecione…' : 'Cadastre um parceiro para esta etapa')}</select></label>
        <label class="campo">Data de envio<input type="date" id="env-data" value="${hojeISO()}"></label>
        <label class="campo">Previsão de retorno<input type="date" id="env-prev" value="${somaDias(hojeISO(), PREVISAO_DIAS)}"></label>
      </div>
      <div class="tabela-wrap" style="margin-top:12px"><table>
        <thead><tr><th>Pedido</th><th>Item</th><th class="n">Disponível</th><th class="n">Enviar</th><th class="n">R$/peça</th><th class="n">Total</th></tr></thead>
        <tbody>${etapas.map(e => { const i = info.get(e.op_item_id) || {}, hi = hist.get(e.op_item_id), jaFoi = !!hi?.[etapa] && hi[etapa].enviado >= hi[etapa].quantidade; return `<tr data-oi="${e.op_item_id}" data-prod="${i.produto_id || ''}" class="${jaFoi ? 'repete' : ''}">
          <td>${h(i.pedido_numero)}<div class="peq muted">${h(i.cliente_nome)}</div></td><td>${h(rotuloItem(i))}${avisoPassou(hi, etapa)}</td>
          <td class="n">${num(e.aguardando_envio)}</td>
          <td class="n"><input class="inp num" type="number" min="0" max="${e.aguardando_envio}" value="${e.aguardando_envio}" data-campo="q"></td>
          <td class="n"><input class="inp num" type="number" min="0" step="0.01" data-campo="v" placeholder="0,00"></td>
          <td class="n" data-t></td></tr>`; }).join('')}</tbody>
        <tfoot><tr class="grupo"><td colspan="3">Total</td><td class="n" id="env-tq"></td><td></td><td class="n" id="env-tv"></td></tr></tfoot></table></div>
      <p class="peq muted" style="margin:8px 0 0">Só aparecem os itens desta OP que passam por ${h(NOME_ETAPA[etapa])}. Os outros seguem para a próxima etapa deles ou para a embalagem.</p>
      <label class="campo" style="margin-top:10px">Observação para o parceiro<input id="env-obs"></label>
      <label class="peq" style="display:block;margin-top:8px"><input type="checkbox" id="env-precos" checked> Guardar os valores como preço deste parceiro</label>`,
    aoAbrir: (m) => {
      const total = () => {
        let tq = 0, tv = 0;
        m.querySelectorAll('tr[data-oi]').forEach(tr => {
          const q = +tr.querySelector('[data-campo=q]').value || 0, v = +tr.querySelector('[data-campo=v]').value || 0;
          tr.querySelector('[data-t]').textContent = moeda(q * v); tq += q; tv += q * v;
        });
        m.querySelector('#env-tq').textContent = num(tq); m.querySelector('#env-tv').textContent = moeda(tv);
      };
      m.querySelector('#env-parc').onchange = async (ev) => {
        const precos = ev.target.value ? await ler(db.from('precos_parceiro').select('*').eq('parceiro_id', ev.target.value).eq('etapa', etapa)) : [];
        m.querySelectorAll('tr[data-oi]').forEach(tr => {
          const p = precos.find(x => x.produto_id === tr.dataset.prod);
          tr.querySelector('[data-campo=v]').value = p ? p.valor : '';
        });
        total();
      };
      m.addEventListener('input', total); total();
    },
    botoes: [{ texto: 'Cancelar' }, {
      texto: 'Registrar remessa', classe: 'pri', acao: async (m) => {
        const parc = m.querySelector('#env-parc').value;
        if (!parc) { toast('Escolha o parceiro.', 'erro'); return false; }
        const rep = [...m.querySelectorAll('tr[data-oi].repete')].filter(tr => (+tr.querySelector('[data-campo=q]').value || 0) > 0).length;
        if (rep && !(await confirmar('Mandar de novo?', `${rep} item(ns) marcado(s) <b>já foram enviados inteiros para ${h(NOME_ETAPA[etapa])}</b> antes. Tem certeza de que quer mandar de novo?`, 'Sim, mandar de novo'))) return false;
        const linhas = [...m.querySelectorAll('tr[data-oi]')].map(tr => ({
          op_item_id: tr.dataset.oi, quantidade: +tr.querySelector('[data-campo=q]').value || 0,
          valor_peca: tr.querySelector('[data-campo=v]').value }));
        const r = await chamar(db, 'criar_remessa', {
          p_etapa: etapa, p_parceiro: parc, p_linhas: linhas, p_data_envio: m.querySelector('#env-data').value || null,
          p_previsao: m.querySelector('#env-prev').value || null, p_observacao: m.querySelector('#env-obs').value,
          p_salvar_precos: m.querySelector('#env-precos').checked });
        if (!r) return false;
        toast(`Remessa ${r.numero} registrada. Confirme a saída quando as peças saírem.`, 'ok');
        depois && depois();
        if (await confirmar('Remessa registrada', `Imprimir o romaneio <b>${h(r.numero)}</b>?`, 'Imprimir')) imprimirRomaneio(r.id);
      }
    }]
  });
}

export async function confirmarSaida(remessaId, depois) {
  const r = await chamar(db, 'confirmar_saida', { p_remessa: remessaId });
  if (r) { toast(`Saída de ${r.numero} registrada.`, 'ok'); depois && depois(); }
}

export async function excluirRemessa(remessaId, numero, depois) {
  if (!await confirmar('Excluir remessa', `Excluir a remessa <b>${h(numero)}</b>? As peças voltam para "aguardando envio".`, 'Excluir', 'perigo')) return;
  if (await chamar(db, 'excluir_remessa', { p_remessa: remessaId })) { toast('Remessa excluída.', 'ok'); depois && depois(); }
}

// ---------- Receber peças (retorno parcial ou total) ----------
export async function receber(remessaId, depois) {
  if (!tem('producao')) return toast('Receber exige o perfil "producao".', 'erro');
  const [[rem], envios] = await Promise.all([
    ler(db.from('v_remessas').select('*').eq('id', remessaId)),
    ler(db.from('v_envios').select('*').eq('remessa_id', remessaId).order('op_numero')),
  ]);
  if (!rem || !['ENVIADO', 'PARCIAL'].includes(rem.status)) return toast('A remessa precisa estar com o parceiro para receber peças.', 'erro');
  modal({
    titulo: `Receber · ${rem.numero} · ${rem.parceiro_nome}`, largo: true,
    corpo: `<label class="campo" style="max-width:220px">Data do recebimento<input type="date" id="rec-data" value="${hojeISO()}"></label>
      <div class="tabela-wrap" style="margin-top:10px"><table>
        <thead><tr><th>OP</th><th>Pedido</th><th>Item</th><th class="n">Enviado</th><th class="n">Já voltou</th><th class="n">Falta</th><th class="n">Recebendo agora</th></tr></thead>
        <tbody>${envios.map(e => `<tr data-env="${e.id}"><td>${e.op_numero}</td><td>${h(e.pedido_numero)}<div class="peq muted">${h(e.cliente_nome)}</div></td><td>${h(rotuloItem(e))}</td>
          <td class="n">${num(e.quantidade)}</td><td class="n">${num(e.retornado)}</td><td class="n forte">${num(e.pendente)}</td>
          <td class="n">${e.pendente ? `<input class="inp num" type="number" min="0" max="${e.pendente}" value="0">` : chip('Completo', 'ok')}</td></tr>`).join('')}</tbody></table></div>
      <button class="btn peq" id="rec-tudo" style="margin-top:8px">Preencher tudo o que falta</button>`,
    aoAbrir: (m) => {
      m.querySelector('#rec-tudo').onclick = () => m.querySelectorAll('tr[data-env] input').forEach(i => i.value = i.max);
    },
    botoes: [{ texto: 'Cancelar' }, {
      texto: 'Registrar recebimento', classe: 'pri', acao: async (m) => {
        const linhas = [...m.querySelectorAll('tr[data-env]')].map(tr => ({ envio_id: tr.dataset.env, quantidade: +(tr.querySelector('input')?.value || 0) }))
          .filter(l => l.quantidade > 0);
        if (!linhas.length) { toast('Informe quantas peças chegaram.', 'erro'); return false; }
        const r = await chamar(db, 'registrar_retorno', { p_remessa: remessaId, p_linhas: linhas, p_data: m.querySelector('#rec-data').value || null });
        if (!r) return false;
        toast(r.status === 'RETORNADO' ? `${r.numero} voltou completa.` : `Recebimento parcial registrado em ${r.numero}.`, 'ok');
        depois && depois();
      }
    }]
  });
}

// ---------- Embalagem ----------
export async function embalar(opId, depois) {
  if (!tem('producao')) return toast('Embalar exige o perfil "producao".', 'erro');
  const itens = (await ler(db.from('v_op_itens').select('*').eq('op_id', opId))).filter(i => i.aguardando_embalagem > 0);
  if (!itens.length) return toast('Nada aguardando embalagem nesta OP.', 'erro');
  modal({
    titulo: `Embalar · OP ${itens[0].op_numero}`, largo: true,
    corpo: `<div class="tabela-wrap"><table>
        <thead><tr><th>Pedido</th><th>Item</th><th class="n">Prontas</th><th class="n">Embalar</th></tr></thead>
        <tbody>${itens.map(i => `<tr data-oi="${i.op_item_id}"><td>${h(i.pedido_numero)}<div class="peq muted">${h(i.cliente_nome)}</div></td><td>${h(rotuloItem(i))}</td>
          <td class="n">${num(i.aguardando_embalagem)}</td><td class="n"><input class="inp num" type="number" min="0" max="${i.aguardando_embalagem}" value="${i.aguardando_embalagem}"></td></tr>`).join('')}</tbody></table></div>`,
    botoes: [{ texto: 'Cancelar' }, {
      texto: 'Registrar embalagem', classe: 'pri', acao: async (m) => {
        const linhas = [...m.querySelectorAll('tr[data-oi]')].map(tr => ({ op_item_id: tr.dataset.oi, quantidade: +tr.querySelector('input').value || 0 })).filter(l => l.quantidade > 0);
        if (!linhas.length) { toast('Informe as quantidades.', 'erro'); return false; }
        const n = await chamar(db, 'registrar_embalagem', { p_linhas: linhas });
        if (!n) return false;
        toast(`${n} peça(s) embaladas.`, 'ok'); depois && depois();
      }
    }]
  });
}

// ---------- Funcionários e medidas (para folhas e romaneios) ----------
async function funcionariosPorItem(ids) {
  if (!ids.length) return new Map();
  const lista = await ler(db.from('pedido_funcionarios').select('*').in('pedido_item_id', ids).order('ordem'));
  const m = new Map(); lista.forEach(f => { if (!m.has(f.pedido_item_id)) m.set(f.pedido_item_id, []); m.get(f.pedido_item_id).push(f); });
  return m;
}
const MED = [['torax', 'Tórax'], ['busto', 'Busto'], ['cintura', 'Cintura'], ['quadril', 'Quadril'], ['manga', 'Manga'], ['comprimento', 'Compr.']];
export function tabelaFuncionarios(funcs) {
  if (!funcs?.length) return '';
  const cols = MED.filter(([k]) => funcs.some(f => f[k] != null));
  const nota = f => [f.outras, f.ajustes && 'Ajuste: ' + f.ajustes, f.observacao].filter(Boolean).join(' · ');
  const temNota = funcs.some(nota);
  return `<table><thead><tr><th>Funcionário</th><th class="n">Qtd</th><th>Tam.</th>${cols.map(([, r]) => `<th class="n">${r}</th>`).join('')}${temNota ? '<th>Ajustes / observações</th>' : ''}</tr></thead>
    <tbody>${funcs.map(f => `<tr><td><b>${h(f.nome)}</b></td><td class="n">${f.quantidade}</td><td><b>${h(f.tamanho)}</b></td>
      ${cols.map(([k]) => `<td class="n">${f[k] != null ? String(f[k]).replace('.', ',') : '·'}</td>`).join('')}${temNota ? `<td style="color:#9b1c1c;font-weight:700">${h(nota(f))}</td>` : ''}</tr>`).join('')}</tbody></table>`;
}

// ---------- Romaneio (A4) ----------
const unicos = (l) => [...new Set(l.filter(Boolean))];
export async function imprimirRomaneio(remessaId) {
  const [[rem], envios] = await Promise.all([
    ler(db.from('v_remessas').select('*').eq('id', remessaId)),
    ler(db.from('v_envios').select('*').eq('remessa_id', remessaId).order('op_numero').order('pedido_numero')),
  ]);
  if (!rem) return;
  const funcs = await funcionariosPorItem([...new Set(envios.map(e => e.pedido_item_id))]);
  imprimirHtml(`<div class="doc">
    ${cabecalhoDoc('ROMANEIO DE ENVIO · ' + (NOME_ETAPA[rem.etapa] || rem.etapa).toUpperCase(), rem.numero + ' · ' + data(rem.data_envio))}
    <div style="display:flex;gap:8mm;align-items:flex-start">
      <table class="info" style="flex:1"><tr><td>Parceiro</td><td><b>${h(rem.parceiro_nome)}</b></td><td>Etapa</td><td>${h(NOME_ETAPA[rem.etapa])}</td></tr>
        <tr><td>Envio</td><td>${data(rem.data_envio)}</td><td>Previsão de retorno</td><td>${data(rem.previsao_retorno) || '—'}</td></tr></table>
      <div style="text-align:center;width:30mm">${qrSvg('KLINIK|RM|' + rem.numero).replace('<svg', '<svg style="width:26mm;height:26mm"')}<div style="font-size:7pt;font-weight:700">${h(rem.numero)}</div><div style="font-size:6pt;color:#8a857d">Bipe na saída</div></div>
    </div>
    <h3>Peças enviadas</h3>
    <table><thead><tr><th>OP</th><th>Pedido · cliente</th><th>Ref.</th><th>Artigo</th><th>Cor</th><th>Tam.</th><th class="n">Qtd</th><th class="n">R$/peça</th><th class="n">Total</th></tr></thead>
      <tbody>${envios.map(e => `<tr><td>${e.op_numero}</td><td>${h(e.pedido_numero)} · ${h(e.cliente_nome)}</td><td>${h(e.referencia || '')}</td><td>${h(e.descricao)}${e.silk_desc ? `<br><small>Silk: ${h(e.silk_desc)}</small>` : ''}${e.bordado_desc ? `<br><small>Bordado: ${h(e.bordado_desc)}</small>` : ''}</td>
        <td>${h(e.cor || '')}</td><td>${h(e.tamanho || '')}</td><td class="n">${num(e.quantidade)}</td><td class="n">${moeda(e.valor_peca)}</td><td class="n">${moeda(e.valor_total)}</td></tr>`).join('')}</tbody>
      <tfoot><tr><th colspan="6">Total</th><th class="n">${num(rem.pecas)}</th><th></th><th class="n">${moeda(rem.valor_total)}</th></tr></tfoot></table>
    ${rem.observacao ? `<div class="obs">${h(rem.observacao)}</div>` : ''}
    ${envios.filter(e => funcs.get(e.pedido_item_id)?.length).map(e => `<h3>Medidas · ${h(e.pedido_numero)} · ${h(e.cliente_nome)} · ${h(rotuloItem(e))}</h3>${tabelaFuncionarios(funcs.get(e.pedido_item_id))}`).join('')}
    <div class="assin"><div>Enviado por (KLINIK) · data</div><div>Recebido por (${h(rem.parceiro_nome)}) · data</div></div>
  </div>`, nomeArquivo(['Romaneio', rem.numero, NOME_ETAPA[rem.etapa], rem.parceiro_nome,
    'OP ' + unicos(envios.map(e => e.op_numero)).join(', '), 'Pedido ' + unicos(envios.map(e => e.pedido_numero)).join(', '),
    unicos(envios.map(e => e.cliente_nome)).join(', '), num(rem.pecas) + ' pc', data(rem.data_envio).replaceAll('/', '-')]));
}

// ---------- Folha da OP para o parceiro ----------
export async function imprimirFolhaOp(opId) {
  const itens = await ler(db.from('v_op_itens').select('*').eq('op_id', opId).order('pedido_numero'));
  if (!itens.length) return;
  const op = itens[0];
  const funcs = await funcionariosPorItem(itens.map(i => i.pedido_item_id));
  const porPedido = new Map(); itens.forEach(i => { if (!porPedido.has(i.pedido_id)) porPedido.set(i.pedido_id, []); porPedido.get(i.pedido_id).push(i); });
  imprimirHtml(`<div class="doc">
    ${cabecalhoDoc('ORDEM DE PRODUÇÃO ' + op.op_numero, etapasTexto(arr(op.roteiro)))}
    <div style="display:flex;gap:8mm;align-items:flex-start">
      <table class="info" style="flex:1"><tr><td>OP</td><td><b>${op.op_numero}</b>${op.op_descricao ? ' · ' + h(op.op_descricao) : ''}</td><td>Peças</td><td><b>${num(itens.reduce((a, i) => a + i.quantidade, 0))}</b></td></tr>
        <tr><td>Etapas</td><td>${h(etapasTexto(arr(op.roteiro)))}</td><td>Entrega mais próxima</td><td>${data(itens.map(i => i.previsao_entrega).filter(Boolean).sort()[0]) || '—'}</td></tr></table>
      <div style="text-align:center;width:30mm">${qrSvg('KLINIK|OP|' + op.op_numero).replace('<svg', '<svg style="width:24mm;height:24mm"')}</div>
    </div>
    ${[...porPedido.values()].map(lista => `<h3>Pedido ${h(lista[0].pedido_numero)} · ${h(lista[0].cliente_nome)} · entrega ${data(lista[0].previsao_entrega) || '—'}</h3>
      <table><thead><tr><th>Ref.</th><th>Artigo</th><th>Tecido</th><th>Cor</th><th>Tam.</th><th class="n">Qtd</th></tr></thead>
      <tbody>${lista.map(i => `<tr><td>${h(i.referencia || '')}</td><td>${h(i.descricao)}${i.silk_desc ? `<br><small>Silk: ${h(i.silk_desc)}</small>` : ''}${i.bordado_desc ? `<br><small>Bordado: ${h(i.bordado_desc)}</small>` : ''}</td><td>${h(i.tecido || '')}</td><td>${h(i.cor || '')}</td><td>${h(i.tamanho || '')}</td><td class="n"><b>${num(i.quantidade)}</b></td></tr>`).join('')}</tbody></table>
      ${lista.filter(i => i.observacao).map(i => `<div class="obs">${h(i.descricao)} ${h(i.cor || '')}: ${h(i.observacao)}</div>`).join('')}
      ${lista.filter(i => funcs.get(i.pedido_item_id)?.length).map(i => `<div style="font-weight:700;margin-top:2mm">${h(rotuloItem(i))}</div>${tabelaFuncionarios(funcs.get(i.pedido_item_id))}`).join('')}`).join('')}
  </div>`, nomeArquivo(['OP ' + op.op_numero, etapasTexto(arr(op.roteiro)), op.op_descricao,
    'Pedido ' + unicos(itens.map(i => i.pedido_numero)).join(', '), unicos(itens.map(i => i.cliente_nome)).join(', '),
    num(itens.reduce((a, i) => a + i.quantidade, 0)) + ' pc']));
}

// ---------- Folha de corte (por pedido) ----------
export async function imprimirFolhaCorte(pedidoId) {
  const cortes = await chamar(db, 'gerar_cortes', { p_pedido: pedidoId });
  if (!cortes) return;
  if (!cortes.length) return toast('Este pedido não tem itens de produto.', 'erro');
  const [[ped], ci] = await Promise.all([
    ler(db.from('pedidos').select('*').eq('id', pedidoId)),
    ler(db.from('corte_itens').select('*').in('corte_id', cortes.map(c => c.id))),
  ]);
  const itens = await ler(db.from('pedido_itens').select('*').in('id', ci.map(x => x.pedido_item_id)));
  const funcs = await funcionariosPorItem(itens.map(i => i.id));
  const cad = await cadastros(db);
  const ordem = new Map(cad.tamanhos.map(t => [t.codigo.toUpperCase(), t.ordem]));
  const base = ['PP', 'P', 'M', 'G', 'GG'];
  const fichas = cortes.map((c, n) => {
    const its = itens.filter(i => ci.some(x => x.corte_id === c.id && x.pedido_item_id === i.id));
    const tams = [...new Set([...base, ...its.map(i => (i.tamanho || '—').toUpperCase())])]
      .sort((a, b) => (ordem.get(a) ?? (base.indexOf(a) + 1 || 99)) - (ordem.get(b) ?? (base.indexOf(b) + 1 || 99)));
    const q = t => its.filter(i => (i.tamanho || '—').toUpperCase() === t).reduce((a, i) => a + i.quantidade, 0);
    const tecidos = [...new Set(its.map(i => i.tecido).filter(Boolean))].join(', ');
    const obs = [...new Set(its.map(i => i.observacao).filter(Boolean))];
    const fs = its.flatMap(i => funcs.get(i.id) || []);
    return `<div class="ficha">
      <div class="f-top"><div class="f-info"><div class="f-ref">${h(c.referencia || '—')}</div><div class="f-prod">${h(c.produto)}</div>
        <div class="chips"><div><span>COR</span><b>${h(c.cor || '—')}</b></div><div><span>TECIDO</span><b>${h(tecidos || '—')}</b></div>
        <div><span>ENTREGA</span><b>${data(ped.previsao_entrega) || '—'}</b></div><div class="tot"><span>PEÇAS</span><b>${c.pecas}</b></div></div></div>
        <div class="f-qr">${qrSvg('KLINIK|CT|' + c.codigo)}<div>${h(c.codigo)}</div><div style="font-weight:400;font-size:6.5pt;color:#8a857d">Bipe no início e no fim do corte</div></div></div>
      <table class="grade"><tr>${tams.map(t => `<th>${h(t)}</th>`).join('')}<th>Total</th></tr>
        <tr>${tams.map(t => q(t) ? `<td>${q(t)}</td>` : '<td class="z">·</td>').join('')}<td>${c.pecas}</td></tr></table>
      ${obs.map(o => `<div class="obs" style="margin:2mm">${h(o)}</div>`).join('')}
      ${fs.length ? `<div style="padding:0 2mm 2mm"><div style="font-size:7pt;font-weight:700;color:#8a857d;margin:2mm 0 1mm">FUNCIONÁRIOS E MEDIDAS (cm)</div>${tabelaFuncionarios(fs)}</div>` : ''}
      <div style="display:flex;justify-content:space-between;font-size:7pt;color:#8a857d;padding:1mm 2mm;border-top:1px solid #e2ded7"><span>KLINIK · Folha de corte · Pedido ${h(ped.numero)} · ${h(ped.cliente_nome)}</span><span>Ficha ${n + 1} de ${cortes.length}</span></div>
    </div>`;
  });
  imprimirHtml(`<div class="doc">${fichas.join('')}</div>`, nomeArquivo(['Folha de corte', 'Pedido ' + ped.numero, ped.cliente_nome,
    cortes.map(c => c.codigo).join(', '), data(ped.previsao_entrega)?.replaceAll('/', '-') && 'entrega ' + data(ped.previsao_entrega).replaceAll('/', '-')]));
  toast(`${cortes.length} ficha(s) de corte geradas.`, 'ok');
}

// ---------- Cartão do Kanban: etapas com check ----------
export function chipsEtapas(roteiro, etapaAtual, tudoFeito = false) {
  const r = arr(roteiro); const pos = r.indexOf(etapaAtual);
  if (!r.length) return '';
  return `<div class="etapas">${r.map((e, i) => {
    const cls = tudoFeito || (pos >= 0 && i < pos) ? 'feito' : i === pos ? 'atual' : '';
    return `<span class="etp ${cls}">${cls === 'feito' ? '✓ ' : cls === 'atual' ? '◷ ' : ''}${h(NOME_ETAPA[e] || e)}</span>`;
  }).join('')}</div>`;
}
export { rotuloItem, dataHora };
