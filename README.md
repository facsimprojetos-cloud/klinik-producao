# KLINIK — Gestão (orçamentos, pedidos e produção)

App web (HTML + JavaScript puro, sem build) publicado no GitHub Pages em **https://klinik.gutgestao.com.br**, com banco no Supabase (projeto **PROJETOS**, schema **`klinik`**). Mesmo padrão do app YAZFIT.

Substitui o web app do Google Apps Script ligado à planilha "KLINIK 2".

## Fluxo
1. **Orçamento** (Kanban): Em elaboração → Enviado → Aguardando aprovação → Aprovado → **Virar pedido**. Cada item marca as etapas que vai ter (Facção, Silk, Bordado). Itens por funcionário com medidas.
2. **Pedido**: item com funcionários vira uma linha por tamanho. Cada item é um saldo a produzir.
3. **Corte**: folha por pedido, uma ficha por artigo + cor, com QR de início e fim.
4. **OP**: tira peças do saldo (pode juntar pedidos diferentes, desde que tenham as mesmas etapas).
5. **Remessas**: envio da OP para o parceiro em cada etapa (Facção → Silk → Bordado, pulando as que não tem). Retorno parcial ou total.
6. **Embalagem** → **Baixa do pedido** (inteiro) → histórico.
7. **Fechamento dos parceiros**: junta remessas retornadas, gera o fechamento e registra o pagamento.

## Perfis
| Perfil | Pode |
|---|---|
| admin | tudo, inclusive usuários |
| supervisor | reabrir pedido baixado, ver auditoria |
| comercial | orçamentos, pedidos, clientes |
| cadastros | produtos, parceiros, preços, tecidos, cores, tamanhos… |
| corte | gerar folhas e registrar o corte |
| producao | OPs, remessas, retornos, embalagem, baixa |
| financeiro | fechamento e pagamento dos parceiros |
| consulta | só leitura |

## Primeiro acesso
1. No Supabase: **Settings › Data API › Exposed schemas** → incluir `klinik`.
2. Abra o app, clique em **Criar conta**, confirme pelo e-mail e entre.
3. Como ainda não há administrador, a tela oferece **Tornar-me administrador**.
4. Em **Usuários**, crie os demais (senha inicial 123456).

## Estrutura
```
index.html          página única
css/app.css         estilos (inclui documentos impressos: orçamento, folha de corte, OP, romaneio)
js/config.js        URL e chave pública do Supabase; dados da empresa no PDF do orçamento
js/app.js           login, menu e rotas
js/util.js          utilidades, modal, impressão, cadastros em cache
js/acoes.js         ações de produção compartilhadas (nova OP, enviar, receber, embalar, impressões)
js/telas/*.js       uma tela por arquivo
```

As regras de negócio ficam no banco (funções `klinik.*`, com checagem de perfil); o front só chama essas funções e lê as views `v_*`. PDFs são gerados pela impressão do navegador ("Salvar como PDF").

## Publicação
Branch `main` publicada pelo GitHub Pages a partir da raiz. Domínio: registro **CNAME** `klinik` → `facsimprojetos-cloud.github.io` no DNS de `gutgestao.com.br` (arquivo `CNAME` na raiz).
