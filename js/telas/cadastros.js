import { db, tem } from '../app.js';
import { h, moeda, chip, modal, ler, toast, msgErro, limparCache, cadastros, confirmar, ETAPAS, NOME_ETAPA, arr } from '../util.js';

// Configuração de cada cadastro. pk = chave; campos.tipo: texto | numero | etapas | ref (outra tabela) | lista
const T = {
  clientes: { nome: 'Clientes', pk: 'id', ordem: 'nome', perfil: ['cadastros', 'comercial'], campos: [
    { k: 'nome', r: 'Nome fantasia', req: true }, { k: 'razao_social', r: 'Razão social' }, { k: 'documento', r: 'CNPJ / CPF' },
    { k: 'inscricao_estadual', r: 'Inscrição estadual' }, { k: 'contato', r: 'Contato' }, { k: 'telefone', r: 'Celular / WhatsApp' },
    { k: 'telefone_fixo', r: 'Telefone fixo' }, { k: 'email', r: 'E-mail' }, { k: 'endereco', r: 'Endereço completo', largo: true }],
    cab: ['Cliente', 'Documento', 'Contato', 'Telefone'], col: x => [h(x.nome) + (x.razao_social ? `<div class="peq muted">${h(x.razao_social)}</div>` : ''), h(x.documento || ''), h(x.contato || ''), h(x.telefone || x.telefone_fixo || '')] },
  produtos: { nome: 'Produtos', pk: 'id', ordem: 'referencia', ativo: true, campos: [
    { k: 'referencia', r: 'Referência', req: true }, { k: 'nome', r: 'Nome', req: true }, { k: 'preco', r: 'Preço de venda (R$)', tipo: 'numero' },
    { k: 'tecido_base', r: 'Tecido padrão', tipo: 'lista', lista: c => c.tecidos.map(t => t.nome) }],
    cab: ['Ref.', 'Produto', 'Preço', 'Tecido'], col: x => [h(x.referencia), h(x.nome), x.preco != null ? moeda(x.preco) : '—', h(x.tecido_base || '')] },
  parceiros: { nome: 'Parceiros', pk: 'id', ordem: 'nome', ativo: true, campos: [
    { k: 'nome', r: 'Nome', req: true }, { k: 'etapas', r: 'Etapas que faz', tipo: 'etapas' }, { k: 'telefone', r: 'Telefone' }, { k: 'observacao', r: 'Observação' }],
    cab: ['Parceiro', 'Etapas', 'Telefone'], col: x => [h(x.nome), arr(x.etapas).map(e => chip(NOME_ETAPA[e], 'info')).join(' '), h(x.telefone || '')] },
  precos_parceiro: { nome: 'Preços por parceiro', pk: 'id', ordem: 'atualizado_em', campos: [
    { k: 'parceiro_id', r: 'Parceiro', tipo: 'ref', ref: c => c.parceiros, rot: 'nome', req: true },
    { k: 'etapa', r: 'Etapa', tipo: 'sel', opcoes: ETAPAS.map(e => [e, NOME_ETAPA[e]]), req: true },
    { k: 'produto_id', r: 'Produto', tipo: 'ref', ref: c => c.produtos, rot: p => p.referencia + ' · ' + p.nome, req: true },
    { k: 'valor', r: 'Valor por peça (R$)', tipo: 'numero', req: true }],
    cab: ['Parceiro', 'Etapa', 'Produto', 'Valor/peça'], col: (x, c) => [h(c.parceiros.find(p => p.id === x.parceiro_id)?.nome || ''), h(NOME_ETAPA[x.etapa]),
      h((p => p ? p.referencia + ' · ' + p.nome : '')(c.produtos.find(p => p.id === x.produto_id))), moeda(x.valor)] },
  tecidos: { nome: 'Tecidos', pk: 'id', ordem: 'nome', campos: [{ k: 'nome', r: 'Tecido', req: true }], cab: ['Tecido'], col: x => [h(x.nome)] },
  cores: { nome: 'Cores', pk: 'id', ordem: 'nome', campos: [{ k: 'nome', r: 'Cor', req: true }], cab: ['Cor'], col: x => [h(x.nome)] },
  tecido_cores: { nome: 'Cores por tecido', pk: ['tecido_id', 'cor_id'], ordem: 'tecido_id', semEditar: true, campos: [
    { k: 'tecido_id', r: 'Tecido', tipo: 'ref', ref: c => c.tecidos, rot: 'nome', req: true }, { k: 'cor_id', r: 'Cor', tipo: 'ref', ref: c => c.cores, rot: 'nome', req: true }],
    cab: ['Tecido', 'Cor'], col: (x, c) => [h(c.tecidos.find(t => t.id === x.tecido_id)?.nome || ''), h(c.cores.find(t => t.id === x.cor_id)?.nome || '')] },
  tamanhos: { nome: 'Tamanhos', pk: 'codigo', ordem: 'ordem', campos: [{ k: 'codigo', r: 'Tamanho', req: true }, { k: 'ordem', r: 'Ordem de exibição', tipo: 'numero' }],
    cab: ['Tamanho', 'Ordem'], col: x => [h(x.codigo), x.ordem] },
  vendedores: { nome: 'Vendedores', pk: 'nome', ordem: 'nome', campos: [{ k: 'nome', r: 'Nome', req: true }], cab: ['Vendedor'], col: x => [h(x.nome)] },
  formas_pagamento: { nome: 'Formas de pagamento', pk: 'nome', ordem: 'nome', campos: [{ k: 'nome', r: 'Forma', req: true }], cab: ['Forma de pagamento'], col: x => [h(x.nome)] },
};
let aba = 'clientes';
let busca = '';

const podeEditar = (t) => (t.perfil || ['cadastros']).some(p => tem(p));

export async function render(el) {
  const t = T[aba], c = await cadastros(db, true);
  const lista = (await ler(db.from(aba).select('*').order(t.ordem))).filter(x => !busca || JSON.stringify(t.col(x, c)).toLowerCase().includes(busca.toLowerCase()));
  const ed = podeEditar(t);
  const chave = x => Array.isArray(t.pk) ? t.pk.map(k => x[k]).join('|') : x[t.pk];
  el.innerHTML = `
    <div class="cab"><div><h1>Cadastros</h1><p>${ed ? 'Você pode incluir e alterar este cadastro.' : 'Consulta (sem permissão de edição).'}</p></div>
      ${ed ? '<button class="btn acento" id="novo">+ Novo</button>' : ''}</div>
    <div class="abas">${Object.entries(T).map(([k, v]) => `<button data-a="${k}" class="${aba === k ? 'ativo' : ''}">${v.nome}</button>`).join('')}</div>
    <div class="filtros"><label class="campo">Buscar<input id="busca" value="${h(busca)}"></label></div>
    <div class="tabela-wrap"><table><thead><tr>${t.cab.map(x => `<th>${x}</th>`).join('')}${t.ativo ? '<th>Status</th>' : ''}${ed ? '<th></th>' : ''}</tr></thead>
      <tbody>${lista.map(x => `<tr>${t.col(x, c).map(v => `<td>${v}</td>`).join('')}${t.ativo ? `<td>${x.ativo ? chip('Ativo', 'ok') : chip('Inativo', 'erro')}</td>` : ''}
        ${ed ? `<td><div class="acoes">${t.semEditar ? '' : `<button class="btn peq" data-ed="${h(chave(x))}">Editar</button>`}<button class="btn peq perigo" data-del="${h(chave(x))}">🗑</button></div></td>` : ''}</tr>`).join('')
        || `<tr><td colspan="9" class="vazio">Nenhum registro.</td></tr>`}</tbody></table></div>`;
  el.querySelectorAll('[data-a]').forEach(b => b.onclick = () => { aba = b.dataset.a; busca = ''; render(el); });
  el.querySelector('#busca').onchange = (e) => { busca = e.target.value; render(el); };
  el.querySelector('#novo')?.addEventListener('click', () => form(null, c, () => render(el)));
  el.querySelectorAll('[data-ed]').forEach(b => b.onclick = () => form(lista.find(x => String(chave(x)) === b.dataset.ed), c, () => render(el)));
  el.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
    const x = lista.find(r => String(chave(r)) === b.dataset.del);
    if (!await confirmar('Excluir', `Excluir este registro de ${t.nome}?`, 'Excluir', 'perigo')) return;
    let q = db.from(aba).delete();
    (Array.isArray(t.pk) ? t.pk : [t.pk]).forEach(k => { q = q.eq(k, x[k]); });
    const { error } = await q;
    if (error) return toast(/foreign key|violates/i.test(error.message) ? 'Este registro já foi usado e não pode ser excluído.' + (t.ativo ? ' Desmarque "Ativo" para escondê-lo.' : '') : msgErro(error), 'erro');
    limparCache(); toast('Excluído.', 'ok'); render(el);
  });
}

function campo(f, v, c) {
  const val = v?.[f.k];
  if (f.tipo === 'etapas') return `<div class="campo">${f.r}<div class="acoes" style="margin-top:6px">${ETAPAS.map(e => `<label><input type="checkbox" name="etapa" value="${e}" ${arr(val ?? ['FACCAO']).includes(e) ? 'checked' : ''}> ${NOME_ETAPA[e]}</label>`).join('')}</div></div>`;
  if (f.tipo === 'ref') return `<label class="campo">${f.r}<select name="${f.k}" ${f.req ? 'required' : ''}><option value="">Selecione…</option>${f.ref(c).map(o => `<option value="${o.id}" ${o.id === val ? 'selected' : ''}>${h(typeof f.rot === 'function' ? f.rot(o) : o[f.rot])}</option>`).join('')}</select></label>`;
  if (f.tipo === 'sel') return `<label class="campo">${f.r}<select name="${f.k}" ${f.req ? 'required' : ''}>${f.opcoes.map(([k, r]) => `<option value="${k}" ${k === val ? 'selected' : ''}>${h(r)}</option>`).join('')}</select></label>`;
  const dl = f.tipo === 'lista' ? `<datalist id="dl-${f.k}">${f.lista(c).map(x => `<option value="${h(x)}">`).join('')}</datalist>` : '';
  return `<label class="campo" ${f.largo ? 'style="grid-column:1/-1"' : ''}>${f.r}<input name="${f.k}" ${f.tipo === 'numero' ? 'type="number" step="0.01" min="0"' : ''} ${f.tipo === 'lista' ? `list="dl-${f.k}"` : ''} value="${h(val ?? '')}" ${f.req ? 'required' : ''}>${dl}</label>`;
}

function form(reg, c, depois) {
  const t = T[aba];
  modal({
    titulo: `${reg ? 'Editar' : 'Novo'} · ${t.nome}`,
    corpo: `<form id="fc" class="grade g2">${t.campos.map(f => campo(f, reg, c)).join('')}
      ${reg && t.ativo ? `<label class="campo"><input type="checkbox" name="ativo" ${reg.ativo ? 'checked' : ''} style="width:auto;min-height:0"> Ativo</label>` : ''}</form>`,
    botoes: [{ texto: 'Cancelar' }, { texto: 'Salvar', classe: 'pri', acao: async (m) => {
      const f = m.querySelector('#fc'); if (!f.reportValidity()) return false;
      const d = {};
      t.campos.forEach(x => {
        if (x.tipo === 'etapas') { d[x.k] = ETAPAS.filter(e => f.querySelector(`[name=etapa][value=${e}]`).checked); return; }
        const v = f.elements[x.k].value.trim();
        d[x.k] = v === '' ? null : x.tipo === 'numero' ? Number(v) : v;
      });
      if (reg && t.ativo) d.ativo = f.elements.ativo.checked;
      if (t.campos.some(x => x.tipo === 'etapas') && !d.etapas.length) { toast('Marque pelo menos uma etapa.', 'erro'); return false; }
      const { error } = reg ? await db.from(aba).update(d).eq(t.pk, reg[t.pk]) : await db.from(aba).insert(d);
      if (error) { toast(msgErro(error), 'erro'); return false; }
      limparCache(); toast('Salvo.', 'ok'); depois();
    } }]
  });
}
