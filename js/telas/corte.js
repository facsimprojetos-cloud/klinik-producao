import { db, tem } from '../app.js';
import { h, num, data, dataHora, chip, ler, chamar, toast, opcoes } from '../util.js';
import { imprimirFolhaCorte } from '../acoes.js';

let aba = 'abertos';
let busca = '';
const COR = { AGUARDANDO: 'info', EM_CORTE: 'alerta', CORTADO: 'ok' };
const NOME = { AGUARDANDO: 'Aguardando', EM_CORTE: 'Em corte', CORTADO: 'Cortado' };

export async function render(el) {
  let q = db.from('v_cortes').select('*').is('baixado_em', null).order('criado_em', { ascending: false }).limit(400);
  if (aba === 'abertos') q = q.neq('status', 'CORTADO');
  const [cortes, pedidos] = await Promise.all([
    ler(q),
    ler(db.from('pedidos').select('id,numero,cliente_nome').is('baixado_em', null).is('cancelado_em', null).order('criado_em', { ascending: false }).limit(300)),
  ]);
  const pode = tem('corte');
  const lista = cortes.filter(c => !busca || [c.codigo, c.pedido_numero, c.cliente_nome, c.referencia, c.produto, c.cor].join(' ').toLowerCase().includes(busca.toLowerCase()));
  el.innerHTML = `
    <div class="cab"><div><h1>Corte</h1><p>A folha sai por pedido: uma ficha por artigo + cor, com os tamanhos e as medidas. Cada ficha tem um QR para marcar início e fim.</p></div></div>
    ${pode ? `<div class="card"><div class="filtros" style="margin:0">
      <label class="campo">Pedido<select id="ped">${opcoes(pedidos.map(p => ({ id: p.id, nome: p.numero + ' · ' + p.cliente_nome })), null, 'nome', 'id', 'Escolha o pedido…')}</select></label>
      <button class="btn pri" id="gerar">Gerar folha de corte</button></div></div>` : ''}
    <div class="abas">
      <button data-a="abertos" class="${aba === 'abertos' ? 'ativo' : ''}">A cortar / em corte</button>
      <button data-a="todos" class="${aba === 'todos' ? 'ativo' : ''}">Todas as fichas</button>
    </div>
    <div class="filtros"><label class="campo">Buscar<input id="busca" value="${h(busca)}" placeholder="Ficha, pedido, cliente, artigo, cor"></label></div>
    <div class="tabela-wrap"><table>
      <thead><tr><th>Ficha</th><th>Pedido</th><th>Ref.</th><th>Artigo</th><th>Cor</th><th class="n">Peças</th><th>Entrega</th><th>Início</th><th>Fim</th><th>Situação</th>${pode ? '<th></th>' : ''}</tr></thead>
      <tbody>${lista.map(c => `<tr><td class="forte">${h(c.codigo)}</td><td>${h(c.pedido_numero)}<div class="peq muted">${h(c.cliente_nome)}</div></td>
        <td>${h(c.referencia || '')}</td><td>${h(c.produto)}</td><td>${h(c.cor || '')}</td><td class="n">${num(c.pecas)}</td><td>${data(c.previsao_entrega) || '—'}</td>
        <td>${dataHora(c.inicio)}</td><td>${dataHora(c.fim)}</td><td>${chip(NOME[c.status], COR[c.status])}</td>
        ${pode ? `<td><div class="acoes">${c.status === 'AGUARDANDO' ? `<button class="btn peq" data-c="${c.id}" data-a2="INICIO">Iniciar</button>` : ''}
          ${c.status !== 'CORTADO' ? `<button class="btn peq pri" data-c="${c.id}" data-a2="FIM">Finalizar</button>` : `<button class="btn peq" data-c="${c.id}" data-a2="REABRIR">Reabrir</button>`}
          <button class="btn peq" data-folha="${c.pedido_id}">Folha</button></div></td>` : ''}</tr>`).join('')
        || `<tr><td colspan="11" class="vazio">Nenhuma ficha.</td></tr>`}</tbody></table></div>`;
  el.querySelectorAll('[data-a]').forEach(b => b.onclick = () => { aba = b.dataset.a; render(el); });
  el.querySelector('#busca').onchange = (e) => { busca = e.target.value; render(el); };
  el.querySelector('#gerar')?.addEventListener('click', async () => {
    const id = el.querySelector('#ped').value;
    if (!id) return toast('Escolha o pedido.', 'erro');
    await imprimirFolhaCorte(id); render(el);
  });
  el.querySelectorAll('[data-folha]').forEach(b => b.onclick = () => imprimirFolhaCorte(b.dataset.folha));
  el.querySelectorAll('[data-a2]').forEach(b => b.onclick = async () => {
    if (await chamar(db, 'corte_acao', { p_corte: b.dataset.c, p_acao: b.dataset.a2 })) { toast('Corte atualizado.', 'ok'); render(el); }
  });
}
