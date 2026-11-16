import { db, ctx } from '../app.js';
import { h, num, moeda, data, chip, ler } from '../util.js';

export async function render(el) {
  const [orcs, peds, rems, semOp] = await Promise.all([
    ler(db.from('v_orcamentos').select('status,total').in('status', ['ELABORACAO', 'ENVIADO', 'AGUARDANDO', 'APROVADO'])),
    ler(db.from('v_pedido_resumo').select('*').is('baixado_em', null).neq('situacao', 'CANCELADO').order('previsao_entrega', { ascending: true, nullsFirst: false })),
    ler(db.from('v_remessas').select('*').in('status', ['PREPARADO', 'ENVIADO', 'PARCIAL'])),
    ler(db.from('v_itens_sem_op').select('saldo')),
  ]);
  const st = s => orcs.filter(o => o.status === s);
  const comParceiro = rems.filter(r => r.status !== 'PREPARADO');
  const atrasadosPed = peds.filter(p => p.atrasado);
  const atrasadasRem = rems.filter(r => r.atrasada);
  const porParceiro = new Map();
  comParceiro.forEach(r => { const x = porParceiro.get(r.parceiro_nome) || { pecas: 0, atrasadas: 0, valor: 0 }; x.pecas += r.pendentes; x.atrasadas += r.atrasada ? 1 : 0; x.valor += Number(r.valor_total); porParceiro.set(r.parceiro_nome, x); });
  el.innerHTML = `
    <div class="cab"><div><h1>Olá, ${h(ctx.nome)}</h1><p>Resumo de orçamentos, pedidos e produção.</p></div></div>
    <h2>Comercial</h2>
    <div class="grade g4">
      <a class="kpi" href="#/orcamentos"><div class="rot">Em elaboração</div><div class="val">${st('ELABORACAO').length}</div></a>
      <a class="kpi" href="#/orcamentos"><div class="rot">Enviados / aguardando</div><div class="val">${st('ENVIADO').length + st('AGUARDANDO').length}</div><div class="peq muted">${moeda([...st('ENVIADO'), ...st('AGUARDANDO')].reduce((a, o) => a + Number(o.total), 0))}</div></a>
      <a class="kpi ok" href="#/orcamentos"><div class="rot">Aprovados (virar pedido)</div><div class="val">${st('APROVADO').length}</div></a>
      <a class="kpi" href="#/pedidos"><div class="rot">Pedidos em andamento</div><div class="val">${peds.length}</div></a>
    </div>
    <h2 style="margin-top:18px">Produção</h2>
    <div class="grade g4">
      <a class="kpi ${semOp.length ? 'alerta' : ''}" href="#/producao"><div class="rot">Peças sem OP</div><div class="val">${num(semOp.reduce((a, x) => a + x.saldo, 0))}</div></a>
      <a class="kpi" href="#/remessas"><div class="rot">Peças com parceiros</div><div class="val">${num(comParceiro.reduce((a, r) => a + r.pendentes, 0))}</div></a>
      <a class="kpi ${atrasadasRem.length ? 'erro' : ''}" href="#/remessas"><div class="rot">Remessas atrasadas</div><div class="val">${atrasadasRem.length}</div></a>
      <a class="kpi ok" href="#/pedidos"><div class="rot">Prontos para entrega</div><div class="val">${peds.filter(p => p.situacao === 'PRONTO PARA ENTREGA').length}</div></a>
    </div>
    <div class="grade g2" style="margin-top:18px">
      <div class="card"><h2>Pedidos atrasados ${atrasadosPed.length ? chip(atrasadosPed.length, 'erro') : ''}</h2>
        ${atrasadosPed.length ? `<table><tbody>${atrasadosPed.slice(0, 15).map(p => `<tr><td class="forte">${h(p.numero)}</td><td>${h(p.cliente_nome)}</td><td>${data(p.previsao_entrega)}</td><td class="n">${p.pct_pronto}%</td></tr>`).join('')}</tbody></table>` : '<p class="muted">Nenhum pedido atrasado.</p>'}</div>
      <div class="card"><h2>Com cada parceiro</h2>
        ${porParceiro.size ? `<table><thead><tr><th>Parceiro</th><th class="n">Peças</th><th class="n">A pagar</th><th></th></tr></thead><tbody>${[...porParceiro.entries()].sort((a, b) => b[1].pecas - a[1].pecas).map(([n, x]) => `<tr><td>${h(n)}</td><td class="n">${num(x.pecas)}</td><td class="n">${moeda(x.valor)}</td><td>${x.atrasadas ? chip(x.atrasadas + ' atrasada(s)', 'erro') : ''}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">Nenhuma peça com parceiros.</p>'}</div>
    </div>`;
}
