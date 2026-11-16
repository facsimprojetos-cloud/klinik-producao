import { db, tem } from '../app.js';
import { h, num, moeda, data, dataHora, chip, ler, NOME_ETAPA } from '../util.js';
import { confirmarSaida, excluirRemessa, receber, imprimirRomaneio } from '../acoes.js';

let aba = 'parceiro';
let busca = '';
const NOME = { PREPARADO: 'Aguardando saída', ENVIADO: 'Com o parceiro', PARCIAL: 'Retorno parcial', RETORNADO: 'Retornada', CANCELADO: 'Cancelada' };
const COR = { PREPARADO: 'info', ENVIADO: 'alerta', PARCIAL: 'alerta', RETORNADO: 'ok', CANCELADO: 'erro' };

export async function render(el) {
  let q = db.from('v_remessas').select('*').order('criado_em', { ascending: false }).limit(500);
  if (aba === 'preparado') q = q.eq('status', 'PREPARADO');
  if (aba === 'parceiro') q = q.in('status', ['ENVIADO', 'PARCIAL']);
  if (aba === 'retornado') q = q.eq('status', 'RETORNADO');
  const lista = (await ler(q)).filter(r => !busca || [r.numero, r.parceiro_nome, NOME_ETAPA[r.etapa]].join(' ').toLowerCase().includes(busca.toLowerCase()));
  const pode = tem('producao');
  el.innerHTML = `
    <div class="cab"><div><h1>Remessas</h1><p>Romaneios enviados aos parceiros (facção, silk, bordado). Para criar uma remessa, use o botão "Enviar" no Kanban de produção.</p></div></div>
    <div class="abas">${[['parceiro', 'Com os parceiros'], ['preparado', 'Aguardando saída'], ['retornado', 'Retornadas'], ['todas', 'Todas']]
      .map(([k, n]) => `<button data-a="${k}" class="${aba === k ? 'ativo' : ''}">${n}</button>`).join('')}</div>
    <div class="filtros"><label class="campo">Buscar<input id="busca" value="${h(busca)}" placeholder="Número, parceiro, etapa"></label></div>
    <div class="tabela-wrap"><table>
      <thead><tr><th>Nº</th><th>Etapa</th><th>Parceiro</th><th>Envio</th><th>Previsão</th><th class="n">Peças</th><th class="n">Voltaram</th><th class="n">A pagar</th><th>Situação</th><th></th></tr></thead>
      <tbody>${lista.map(r => `<tr><td class="forte">${h(r.numero)}</td><td>${h(NOME_ETAPA[r.etapa])}</td><td>${h(r.parceiro_nome)}</td>
        <td>${r.saida_em ? dataHora(r.saida_em) : data(r.data_envio)}</td><td>${data(r.previsao_retorno) || '—'} ${r.atrasada ? chip('Atrasada', 'erro') : ''}</td>
        <td class="n">${num(r.pecas)}</td><td class="n">${num(r.retornadas)}</td><td class="n">${moeda(r.valor_total)}</td>
        <td>${chip(NOME[r.status], COR[r.status])}${r.fechamento ? `<div class="peq muted">${h(r.fechamento)}</div>` : ''}</td>
        <td><div class="acoes">
          ${pode && r.status === 'PREPARADO' ? `<button class="btn peq pri" data-saida="${r.id}">Confirmar saída</button><button class="btn peq perigo" data-del="${r.id}" data-num="${h(r.numero)}">Excluir</button>` : ''}
          ${pode && ['ENVIADO', 'PARCIAL'].includes(r.status) ? `<button class="btn peq pri" data-rec="${r.id}">Receber peças</button>` : ''}
          <button class="btn peq" data-pdf="${r.id}">Romaneio</button></div></td></tr>`).join('')
        || '<tr><td colspan="10" class="vazio">Nenhuma remessa.</td></tr>'}</tbody></table></div>`;
  const volta = () => render(el);
  el.querySelectorAll('[data-a]').forEach(b => b.onclick = () => { aba = b.dataset.a; render(el); });
  el.querySelector('#busca').onchange = (e) => { busca = e.target.value; render(el); };
  el.querySelectorAll('[data-saida]').forEach(b => b.onclick = () => confirmarSaida(b.dataset.saida, volta));
  el.querySelectorAll('[data-del]').forEach(b => b.onclick = () => excluirRemessa(b.dataset.del, b.dataset.num, volta));
  el.querySelectorAll('[data-rec]').forEach(b => b.onclick = () => receber(b.dataset.rec, volta));
  el.querySelectorAll('[data-pdf]').forEach(b => b.onclick = () => imprimirRomaneio(b.dataset.pdf));
}
