import { db } from '../app.js';
import { h, dataHora, ler, msgErro } from '../util.js';
import { receber, imprimirFolhaOp } from '../acoes.js';

let ocupado = false;

export async function render(el) {
  el.innerHTML = `
    <div class="cab"><div><h1>Leitura de QR</h1><p>Folha de corte: 1ª leitura = início, 2ª = fim. Romaneio: 1ª leitura = saída; depois abre a tela para informar o que voltou. OP: abre a folha da OP.</p></div></div>
    <div class="card">
      <form id="f" class="filtros" style="margin:0" autocomplete="off">
        <label class="campo" style="flex:3">Código<input id="cod" class="scan" placeholder="Bipe aqui ou digite CT-2026-0001 / ROM-2026-0001 / OP 12"></label>
        <button class="btn pri">Registrar</button>
        <button class="btn" type="button" id="cam">Ler com a câmera</button>
      </form>
      <div id="video"></div>
      <div id="res"></div>
    </div>
    <h2>Últimas leituras</h2>
    <div class="tabela-wrap"><table><thead><tr><th>Quando</th><th>Código</th><th>O que aconteceu</th><th>Resultado</th><th>Usuário</th></tr></thead><tbody id="log"></tbody></table></div>`;
  const inp = el.querySelector('#cod');
  setTimeout(() => inp.focus(), 50);
  el.querySelector('#f').onsubmit = (e) => { e.preventDefault(); registrar(el, inp.value); };
  el.querySelector('#cam').onclick = () => camera(el);
  carregarLog(el);
}

async function carregarLog(el) {
  const l = await ler(db.from('leituras_qr').select('*').order('em', { ascending: false }).limit(15));
  el.querySelector('#log').innerHTML = l.map(x => `<tr><td>${dataHora(x.em)}</td><td>${h(x.codigo)}</td><td>${h(x.acao || '')}</td><td>${h(x.resultado || '')}</td><td>${h(x.usuario || '')}</td></tr>`).join('')
    || '<tr><td colspan="5" class="vazio">Nenhuma leitura ainda.</td></tr>';
}

async function registrar(el, texto) {
  texto = String(texto || '').trim(); if (!texto || ocupado) return;
  ocupado = true; el.querySelector('#cod').value = '';
  const res = el.querySelector('#res');
  const { data: r, error } = await db.rpc('ler_codigo', { p_texto: texto });
  ocupado = false;
  if (error) { res.innerHTML = `<div class="res-scan erro"><b>Não registrado</b><div>${h(msgErro(error))}</div></div>`; carregarLog(el); return; }
  try { navigator.vibrate && navigator.vibrate(120); } catch (_) { /* sem vibração */ }
  const tit = { INICIO: 'Corte iniciado', FIM: 'Corte finalizado', CONCLUIDO: 'Já concluído', SAIDA: 'Saída registrada', RETORNO_PENDENTE: 'Informe o que voltou', CONSULTA: 'OP encontrada', REPETIDA: 'Leitura repetida' }[r.acao] || r.acao;
  res.innerHTML = `<div class="res-scan ${r.acao === 'REPETIDA' ? '' : 'ok'}"><b style="font-size:1.2rem">${h(tit)}</b><div>${h(r.codigo)} · ${h(r.mensagem || '')}</div></div>`;
  if (r.acao === 'RETORNO_PENDENTE') receber(r.remessa_id, () => carregarLog(el));
  if (r.acao === 'CONSULTA' && r.op_id) imprimirFolhaOp(r.op_id);
  carregarLog(el);
  el.querySelector('#cod').focus();
}

function carregarJsQR() {
  return window.jsQR ? Promise.resolve(window.jsQR) : new Promise((ok, ko) => {
    const s = document.createElement('script'); s.src = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js';
    s.onload = () => ok(window.jsQR); s.onerror = () => ko(new Error('Não foi possível carregar o leitor de QR.')); document.head.appendChild(s);
  });
}

async function camera(el) {
  const box = el.querySelector('#video');
  try {
    await carregarJsQR();
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    box.innerHTML = '<video playsinline muted style="width:100%;max-width:420px;border-radius:10px;margin-top:10px"></video>';
    const v = box.querySelector('video'); v.srcObject = stream; await v.play();
    const cv = document.createElement('canvas'), cx = cv.getContext('2d');
    const parar = () => { stream.getTracks().forEach(t => t.stop()); box.innerHTML = ''; };
    let n = 0;
    const loop = () => {
      if (!v.isConnected) return parar();
      if (v.videoWidth) {
        cv.width = v.videoWidth; cv.height = v.videoHeight; cx.drawImage(v, 0, 0);
        const r = window.jsQR(cx.getImageData(0, 0, cv.width, cv.height).data, cv.width, cv.height);
        if (r && r.data) { parar(); return registrar(el, r.data); }
      }
      if (++n > 900) return parar();
      requestAnimationFrame(loop);
    };
    loop();
  } catch (e) {
    box.innerHTML = `<div class="erro-box">${h(e.message || 'Câmera indisponível neste aparelho.')}</div>`;
  }
}
