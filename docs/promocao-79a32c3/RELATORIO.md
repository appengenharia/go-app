# Promoção seletiva GO-PROD — 79a32c3

Base PROD: 4d31ac5b268fba54fbd86b76817e16a25c297464, main local/remota e último build Pages confirmado.
Fonte: HEAD local GO-DEV 79a32c36906c617a235e3a98b7e08213134d9782, branch codex/revisao-go-dev-20261009. O remoto DEV main continua em 093ba9cbe93fe451e01a4ffe4ed9fe306e5ab20c; a promoção usa o commit local exato solicitado, sem publicar ou modificar DEV.

Histórico e diff revisados: commits 7cddb21, 7afe29a, e4de2ad e 79a32c3; seleção de hunks de notas/status, sem substituir o HTML PROD. Preservadas correções de diário retroativo, refresh, dias sem produção, visitantes, layout de filtros e demais módulos PROD.

## Escopo

- Novos comprovantes somente JPG/PNG, validação dos bytes e destino Cloudinary.
- Identificador/sequência internos atribuídos em transação; títulos só descrição, sem ID em cartões/relatórios.
- Editar conserva autoria, ID, criadoEm e anexos; Apagar é lógico, sem apagar documentos/assets, reativar canceladas ou reutilizar números.
- Notas e evolução: obra parada, suspensa ou desativada bloqueia cliente e Rules, incluindo alteração/exclusão legada. Revalidação no commit cobre suspensão durante envio.
- IndexedDB preservado, imagens/ID/operação duráveis antes do upload; retry reutiliza upload confirmado e evita duplicar documento/contador. Edições pendentes têm chave por operação para não sobrescrever outra edição da mesma nota.
- PDFs históricos continuam acessíveis/editáveis conservando anexo; novo PDF e pendência de novo PDF ficam bloqueados e preservados.
- Pendências antigas sem ambiente explícito permanecem bloqueadas para revisão manual, sem descarte/conversão automática. Cache anterior conservado; cache novo tem preferência offline.

Sem Functions, backend novo, faturamento, preset DEV, public_id/display_name/renomeação remota, melhoria de datas/prazos, migração, numeração de notas antigas ou exclusão em lote. Upload unsigned com resposta perdida pode deixar asset órfão; retry não duplica nota/contador. Nenhum asset é apagado automaticamente.

## Destinos reais confirmados

GitHub Pages: appengenharia/go-app, build_type legacy, source main e raiz /, https://appengenharia.github.io/go-app/, sem domínio personalizado. Publicação pelo push normal à main; não criar workflow/Hosting/domínio novo.

Firebase: .firebaserc e app WEB registrado apontam go-app-prod-53ab5, número 354997193181, appId 1:354997193181:web:0729a32728505bfa3f4e34. firebase.json conserva somente firestore.rules. Cloudinary dibvvm6ix, preset cfo_uploads, folder go inalterados. Rules remotas anteriores (116c998d-99a3-4fc3-a293-e196abc471d7) iguais à base local. Quatro coleções notaObras/notaUsuarios/notaCodigosObras/notaCodigosUsuarios vazias na leitura prévia; nenhuma gravação administrativa realizada.

## Compatibilidade com clientes em cache

Leitura antiga continua autorizada. Criar/editar notas pelo contrato antigo e exclusão física são recusados pelas novas Rules, preservando dados. Clientes antigos podem mostrar canceladas em listas/totais até recarregar online; não existe forma de alterar JavaScript já carregado sem recarregar. Não forçar reload nem apagar cache/IndexedDB ou formulários. Pendências permanecem locais; novo cliente revalida usuário, vínculo, obra, PDF, ambiente e revisão antes de enviar. Obras sem statusOperacional continuam ativas por padrão, sem atualizar documentos. Não é necessária migração.

## Testes

136 testes de aplicação aprovados; 25 de Rules via SDK real/emulador; 1 teste de rollback/emulador. Revalidação final de 51 testes afetados aprovada após passar contexto correto da obra/banco para upload de evolução e acrescentar canceladas aos fixtures de relatórios (não somar testes repetidos).

Layout Edge: 1440/768/390/320; integração relatório/compartilhamento: 1440/390/320. Script visual confirma cartões, preview e chamadas de geração PDF sem identificador em 390/1440, mantendo descrição completa. Dados Firebase/Cloudinary reais não usados em testes de escrita. Logs nesta pasta; imagens e snapshot de recuperação em tests/.runtime (ignorado).

## Publicação coordenada

1. Conferir HEAD remoto PROD ainda igual à base e árvore aprovada; commit local.
2. firebase deploy --only firestore:rules --project go-app-prod-53ab5 --config firebase.json
3. Confirmar via API Rules que o conteúdo ativo corresponde ao commit.
4. git push origin main, preservando Pages main /; conferir build com o SHA publicado e conteúdo servido, imports, sw.js e Firebase PROD.

Rules primeiro: clientes antigos falham de forma segura durante a janela até o Pages ficar disponível. GitHub Pages e Firestore são serviços separados, sem troca atômica; não relaxar Rules para manter a escrita do cliente antigo. Se a etapa seguinte falhar, conservar Rules protetoras e reparar Pages.

## Rollback compatível com os dados

Não usar git revert integral nem republicar Rules anteriores: isso permitiria exclusão física, sobrescrita e totais contendo canceladas.

Executar node docs/promocao-79a32c3/preparar-rollback.cjs para gerar tests/.runtime/rollback-79a32c3. O fallback usa o HTML da base PROD com filtros de canceladas e notas/evolução em manutenção, sem enviar/descarregar fila. Mantém os módulos atuais para interpretação dos dados já criados. Rules de recuperação preservam leitura e congelam gravações de notas, contadores e registros de evolução; demais módulos conservam seu contrato. Não alterar documentos, anexos, IDs ou contadores.

Se necessário: publicar primeiro as Rules geradas com firebase deploy --only firestore:rules --project go-app-prod-53ab5 --config tests/.runtime/rollback-79a32c3/firebase.json. Copiar apenas index.html e sw.js gerados para a raiz PROD, fazer novo commit e push origin main. Conservar notas.mjs, despesas.mjs e demais módulos atuais. Conferir build Pages e Rules pela API. Recuperar a versão corrigida por novo commit/deploy; nunca restaurar dados ou zerar contadores.

Teste reproduzível: preparar o rollback e executar firebase emulators:exec --only firestore --project demo-go-evolucao --config firebase.emulator.json "node --test tests/rollback-notas.test.mjs". A geração não faz deploy ou gravação remota.
