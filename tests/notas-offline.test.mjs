import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {JSDOM} from 'jsdom';
import {IDBFactory} from 'fake-indexeddb';
import * as notas from '../notas.mjs';
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8').replace(/\r\n/g,'\n');
const block=(start,end)=>{
 const from=html.indexOf(start),to=html.indexOf(end,from);
 assert.ok(from>=0 && to>from,`Trecho não encontrado: ${start} → ${end}`);
 return html.slice(from,to);
};
function setup(){
 const dom=new JSDOM(html); dom.window.HTMLElement.prototype.scrollIntoView=()=>{}; const $=id=>dom.window.document.getElementById(id);
 $('lancObra').innerHTML='<option value="obra">UFV Teste</option>';
 $('lancCategoria').innerHTML='<option value="Materiais">Materiais</option>';
 const profile={role:'USER',ativo:true,canLancamentos:true,obras:['obra'],nome:'Josimar'};
 const docs=new Map([['obras/obra',{nome:'UFV Teste',ativa:true,statusOperacional:'ativa'}],['usuarios/jos',profile]]);
 let seq=0,uploadCount=0,perderResposta=false,uploadFalha=false,uploadPausa=false;
 const ref=(path)=>({path,id:path.split('/').at(-1)});
 const doc=(base,...parts)=>ref([base.path,...(parts.length?parts:['id-'+(++seq)])].filter(Boolean).join('/'));
 const collection=(base,...parts)=>ref([base.path,...parts].filter(Boolean).join('/'));
 const snapshot=r=>({exists:()=>docs.has(r.path),data:()=>docs.get(r.path)});
 const getDocFromServer=async r=>{if(!ctx.navigator.onLine)throw new Error('Offline');return snapshot(r);};
 const runTransaction=async(_,fn)=>{
  if(!ctx.navigator.onLine)throw new Error('Offline');const writes=[];
  const result=await fn({get:async r=>snapshot(r),set:(r,v)=>writes.push([r.path,v]),update:(r,v)=>writes.push([r.path,{...docs.get(r.path),...v}])});
  writes.forEach(([p,v])=>docs.set(p,v));
  if(perderResposta){perderResposta=false;throw new Error('Resposta perdida após commit');}return result;
 };
 const fetchImpl=async(url,opts)=>{
  assert.match(url,/^https:\/\/api.cloudinary.com\/v1_1\/teste\//);uploadCount++;
  assert.equal(new Uint8Array(await opts.body.get('file').arrayBuffer()).slice(0,8).join(','),'137,80,78,71,13,10,26,10');
  if(uploadFalha) throw new Error('Upload interrompido');
  if(uploadPausa)docs.get('obras/obra').statusOperacional='suspensa';
  assert.equal(opts.body.get('upload_preset'),'cfo_uploads');
  assert.equal(opts.body.has('public_id'),false); assert.equal(opts.body.has('display_name'),false);
  assert.equal(opts.body.has('asset_folder'),false); assert.equal(opts.body.get('folder'),'go');
  return{ok:true,json:async()=>({secure_url:'https://res.cloudinary.com/teste/image/upload/aleatorio123.png',resource_type:'image',public_id:'aleatorio123',asset_folder:'go/go-app-prod-53ab5/notas'})};
 };
 const messages=[];
 const ctx=vm.createContext({document:dom.window.document,$,navigator:{onLine:false},indexedDB:new IDBFactory(),db:{},doc,collection,runTransaction,getDocFromServer,
  serverTimestamp:()=>({seconds:123}),getDoc:async r=>snapshot(r),getDocs:async()=>({docs:[]}),query:x=>x,orderBy:()=>{},where:()=>{},deleteDoc:()=>{},
  ...notas,fetch:fetchImpl,File,Blob,URL,FormData,AbortController,Uint8Array,setTimeout,clearTimeout,console,
  enviarAnexo:(file,opts)=>notas.enviarAnexo(file,{...opts,fetchImpl}),
  CLOUDINARY_CLOUD:'teste',CLOUDINARY_PRESET:'teste',CLOUDINARY_NOTAS_PROD:{cloud:'teste',preset:'cfo_uploads',folder:'go'},firebaseConfig:{projectId:'go-app-prod-53ab5'},
  currentUser:{uid:'jos',email:'jos@test'},currentProfile:profile,currentRole:'USER',
  loadProfile:async()=>profile,toast:text=>messages.push(text),setMsg:(id,text)=>{messages.push(text);$(id).textContent=text;},
  finCarregarResumoColaborador:async()=>{},finCarregarTudo:async()=>{},normalizarTipoDespesa:()=>'',filtrarLancamentos:x=>x,ordenarLancamentosRecentes:x=>x,
  limitarLancamentosPorPermissao:x=>x,calcularTotaisDespesas:()=>({}),linhasResumoDespesas:()=>[],showModal:()=>{},
 });
 vm.runInContext(block('  let editingLancId = null;', '  // ─────────────────────────────────────────\n  // OFFLINE / SYNC')+block('  const OFFLINE_DB_NAME', '  // ── Cache de credenciais')+block('  async function atualizarPendente(', '  window.addEventListener("online",'),ctx);
 // Refresh de listas não faz parte destes testes; gravar/queue/upload usam o código real.
 vm.runInContext('loadLancs=async()=>{};updateStatTotal=async()=>{};',ctx);
 const run=code=>vm.runInContext(code,ctx);
 const preencher=()=>{$('lancObra').value='obra';$('lancData').value='2026-10-09';$('lancCategoria').value='Materiais';$('lancDesc').value='Nota campo';$('lancValor').value='100';};
 const selecionar=async()=>{
  const input=$('lancFileArquivo');Object.defineProperty(input,'files',{configurable:true,value:[new File([new Uint8Array([137,80,78,71,13,10,26,10,1,2])],'original.png',{type:'image/png'})]});
  await run("onFileSelect('lancFileArquivo')");
 };
 return{dom,$,docs,ctx,run,preencher,selecionar,messages,get uploads(){return uploadCount;},set uploadFalha(v){uploadFalha=v;},set perderResposta(v){perderResposta=v;},set uploadPausa(v){uploadPausa=v;}};
}
test('offline: PNG original sobrevive no IndexedDB, número ausente; suspensão preserva pendência e reativação envia',async()=>{
 const t=setup();t.preencher();await t.selecionar();await t.run('saveLanc()');
 let p=await t.run('getPendingOffline()');assert.equal(p.length,1);assert.equal(p[0].identificador,undefined);assert.equal(p[0].anexoLocal.nome,'original.png');assert.equal(new Uint8Array(await p[0].anexoLocal.blob.arrayBuffer()).join(','),'137,80,78,71,13,10,26,10,1,2');assert.equal(t.uploads,0);
 const id=p[0].documentoId;t.docs.get('obras/obra').statusOperacional='suspensa';t.ctx.navigator.onLine=true;await t.run('syncPendingLancs()');
 p=await t.run('getPendingOffline()');assert.equal(p[0].documentoId,id);assert.match(p[0].motivo,/suspensa/);assert.equal(t.uploads,0);assert.match(t.$('notasPendentes').textContent,/suspensa/);
 t.docs.get('obras/obra').statusOperacional='ativa';await t.run('syncPendingLancs()');
 assert.equal((await t.run('getPendingOffline()')).length,0);assert.equal(t.docs.get('lancamentos/'+id).identificador,'UFV_JOS_000001');assert.equal(t.docs.get('lancamentos/'+id).comprovante.nome,'original.png');t.dom.window.close();
});
test('upload falho não consome sequência; perda da resposta depois do commit permite retry sem novo upload/nota',async()=>{
 const t=setup();t.preencher();await t.selecionar();await t.run('saveLanc()');t.ctx.navigator.onLine=true;t.uploadFalha=true;
 await t.run('syncPendingLancs()');assert.equal(t.docs.has('notaObras/obra'),false);assert.equal((await t.run('getPendingOffline()')).length,1);
 t.uploadFalha=false;t.perderResposta=true;await t.run('syncPendingLancs()');let p=await t.run('getPendingOffline()');assert.equal(p.length,1);const id=p[0].documentoId,uploads=t.uploads;
 assert.equal(t.docs.get('notaObras/obra').ultimaSequencia,1);assert.equal(p[0].uploadConfirmado,true);
 await t.run('syncPendingLancs()');assert.equal((await t.run('getPendingOffline()')).length,0);assert.equal(t.uploads,uploads);assert.equal(t.docs.get('notaObras/obra').ultimaSequencia,1);assert.equal([...t.docs.keys()].filter(p=>p.startsWith('lancamentos/')).length,1);assert.ok(t.docs.has('lancamentos/'+id));t.dom.window.close();
});
test('formulário aberto antes da suspensão conserva dados; suspensão após upload é revalidada na transação',async()=>{
 const t=setup();t.preencher();await t.selecionar();t.ctx.navigator.onLine=true;t.docs.get('obras/obra').statusOperacional='parada';await t.run('saveLanc()');
 assert.equal((await t.run('getPendingOffline()')).length,0);assert.equal(t.$('lancDesc').value,'Nota campo');assert.match(t.$('lancMsg').textContent,/parada/);
 t.docs.get('obras/obra').statusOperacional='ativa';t.uploadPausa=true;await t.run('saveLanc()');
 const p=await t.run('getPendingOffline()');assert.equal(p.length,1);assert.match(p[0].motivo,/suspensa/);assert.equal(t.docs.has('notaObras/obra'),false);t.dom.window.close();
});
test('edição offline mantém ID e identificador; pendência de outro usuário/ambiente nunca é enviada',async()=>{
 const t=setup();t.preencher();await t.selecionar();await t.run('saveLanc()');t.ctx.navigator.onLine=true;await t.run('syncPendingLancs()');
 const old=[...t.docs].find(([p])=>p.startsWith('lancamentos/'));const id=old[0].split('/')[1];
 t.ctx.old={...old[1],id};t.$('formLancCard').scrollIntoView=()=>{};await t.run('allLancs=[old];editLanc(old.id)');t.$('lancValor').value='200';t.ctx.navigator.onLine=false;await t.run('saveLanc()');
 let p=await t.run('getPendingOffline()');assert.equal(p[0].editar,true);assert.equal(p[0].documentoId,id);
 t.ctx.navigator.onLine=true;await t.run('syncPendingLancs()');assert.equal(t.docs.get('lancamentos/'+id).valor,200);assert.equal(t.docs.get('lancamentos/'+id).identificador,t.ctx.old.identificador);assert.equal(t.docs.get('notaObras/obra').ultimaSequencia,1);
 t.preencher();await t.selecionar();t.ctx.navigator.onLine=false;await t.run('saveLanc()');p=await t.run('getPendingOffline()');t.ctx.navigator.onLine=true;t.ctx.currentUser={uid:'outra'};await t.run('syncPendingLancs()');assert.equal((await t.run('getPendingOffline()')).length,1);
 t.ctx.currentUser={uid:'jos'};t.ctx.rec=p[0];await t.run('rec.ambiente="outro-projeto";atualizarPendente(rec)');await t.run('syncPendingLancs()');assert.match((await t.run('getPendingOffline()'))[0].motivo,/Ambiente/);t.dom.window.close();
});

test('seletores só oferecem JPG/PNG e seleção de PDF informa bloqueio sem upload',async()=>{
 const t=setup();
 for(const id of ['lancFileArquivo','lancFileCamera']) assert.equal(t.$(id).accept,'image/jpeg,image/png');
 Object.defineProperty(t.$('lancFileArquivo'),'files',{configurable:true,value:[new File(['%PDF-1.7'],'original.pdf',{type:'application/pdf'})]});
 await t.run("onFileSelect('lancFileArquivo')");
 assert.match(t.messages.at(-1),/PDF bloqueado nesta versão/);assert.equal(t.uploads,0);
 assert.equal(t.run('selectedFile'),null);t.dom.window.close();
});

test('cartão mostra descrição e dados sem identificador em nenhuma linha',async()=>{
 const t=setup();t.ctx.rows=[{id:'id',identificador:'TES_ADM_000001',descricao:'Descrição <original>',categoria:'Materiais',data:'2026-10-09',valor:5,cancelado:true}];
 t.ctx.tipoDespesa=()=>'';t.ctx.TIPO_DESPESA={REEMBOLSAVEIS:'reemb'};
 t.run(block('  async function loadLancs()', '  async function updateStatTotal()'));
 t.run('carregarLancamentosPermitidos=async()=>rows;');await t.run('loadLancs()');
 assert.equal(t.$('lancList').querySelector('.lanc-item-desc').textContent,'Descrição <original>');
 assert.doesNotMatch(t.$('lancList').textContent,/TES_ADM_000001|Legado/);assert.match(t.$('lancList').querySelector('.lanc-item-sub').textContent,/09\/10\/2026/);t.dom.window.close();
});

test('link de abertura e download usam URL final; arquivo baixado recebe identificador sem mudar nome original',async()=>{
 const t=setup();t.preencher();await t.selecionar();await t.run('saveLanc()');t.ctx.navigator.onLine=true;await t.run('syncPendingLancs()');
 const [path,data]=[...t.docs].find(([key])=>key.startsWith('lancamentos/'));const note={...data,id:path.split('/')[1]};
 t.ctx.rows=[note];t.ctx.tipoDespesa=()=>'';t.ctx.TIPO_DESPESA={REEMBOLSAVEIS:'reemb'};
 t.run(block('  async function loadLancs()', '  async function updateStatTotal()'));t.run('carregarLancamentosPermitidos=async()=>rows;');await t.run('loadLancs()');
 const link=t.$('lancList').querySelector('a');assert.equal(link.href,note.comprovante.url);assert.match(link.href,/\/aleatorio123\.png$/);
 const bytes=new Uint8Array([137,80,78,71,13,10,26,10,1,2]);const downloads=[];let blob;
 t.ctx.fetch=async url=>{assert.equal(url,link.href);return new Response(bytes,{status:200,headers:{'content-type':'image/png'}});};
 t.ctx.URL={createObjectURL:value=>{blob=value;return 'blob:download';},revokeObjectURL:()=>{}};t.ctx.setTimeout=fn=>{fn();return 0;};
 const create=t.dom.window.document.createElement.bind(t.dom.window.document);t.dom.window.document.createElement=tag=>{const el=create(tag);if(tag==='a')el.click=()=>downloads.push({nome:el.download,url:el.href});return el;};
 t.ctx.note=note;await t.run('exportarComprovante(note.id)');assert.equal(downloads[0].nome,'UFV_JOS_000001.png');assert.deepEqual(new Uint8Array(await blob.arrayBuffer()),bytes);assert.equal(note.comprovante.nome,'original.png');t.dom.window.close();
});

test('retry de operação iniciada não permite substituir a imagem offline original',async()=>{
 const t=setup();t.preencher();await t.selecionar();await t.run('saveLanc()');t.ctx.navigator.onLine=true;t.uploadFalha=true;await t.run('syncPendingLancs()');
 const [record]=await t.run('getPendingOffline()');assert.equal(record.operacaoCongelada,true);
 t.ctx.replacement={files:[new File([new Uint8Array([255,216,255])],'troca.jpg',{type:'image/jpeg'})]};t.ctx.record=record;
 await t.run('anexarPendente(record.localId,replacement)');assert.equal((await t.run('getPendingOffline()'))[0].anexoLocal.nome,'original.png');t.dom.window.close();
});

test('PDF offline antigo permanece byte a byte, bloqueado mesmo após reativação e não é substituído',async()=>{
 const t=setup();t.preencher();await t.selecionar();await t.run('saveLanc()');
 const [record]=await t.run('getPendingOffline()');
 record.anexoLocal={blob:new Blob(['%PDF-1.7\nLegado']),nome:'legado.pdf',mime:'application/pdf'};
 t.ctx.record=record;await t.run('atualizarPendente(record);updatePendingCount()');
 assert.match(t.$('notasPendentes').textContent,/PDF bloqueado nesta versão/);
 assert.equal(t.$('notasPendentes').querySelector('input').disabled,true);
 t.ctx.navigator.onLine=true;
 for(const status of ['suspensa','ativa']) {
  t.docs.get('obras/obra').statusOperacional=status;await t.run('syncPendingLancs()');
  const [pending]=await t.run('getPendingOffline()');
  assert.equal(pending.documentoId,record.documentoId);assert.equal(pending.operacaoId,record.operacaoId);
  assert.equal(pending.anexoLocal.nome,'legado.pdf');assert.equal(await pending.anexoLocal.blob.text(),'%PDF-1.7\nLegado');
  assert.match(pending.motivo,/PDF bloqueado nesta versão/);
 }
 t.ctx.replacement={files:[new File([new Uint8Array([255,216,255])],'novo.jpg',{type:'image/jpeg'})]};
 await t.run('anexarPendente(record.localId,replacement)');
 assert.equal((await t.run('getPendingOffline()'))[0].anexoLocal.nome,'legado.pdf');
 assert.equal(t.uploads,0);assert.equal(t.docs.has('notaObras/obra'),false);t.dom.window.close();
});

test('PDF com upload já confirmado permanece bloqueado, com URL e metadados intactos',async()=>{
 const t=setup();t.preencher();await t.selecionar();await t.run('saveLanc()');
 const [record]=await t.run('getPendingOffline()');
 record.anexoLocal=null;record.uploadConfirmado=true;
 record.comprovante={tipo:'pdf',nome:'salvo.pdf',mime:'application/pdf',url:'https://res.cloudinary.com/teste/raw/upload/salvo.pdf',public_id:'salvo.pdf'};
 t.ctx.record=record;await t.run('atualizarPendente(record)');t.ctx.navigator.onLine=true;await t.run('syncPendingLancs()');
 const [pending]=await t.run('getPendingOffline()');
 assert.equal(JSON.stringify(pending.comprovante),JSON.stringify(record.comprovante));assert.equal(pending.uploadConfirmado,true);
 assert.match(pending.motivo,/PDF bloqueado nesta versão/);assert.equal(t.uploads,0);assert.equal(t.docs.has('notaObras/obra'),false);t.dom.window.close();
});

test('PDF disfarçado em pendência é detectado pelos bytes antes de qualquer upload',async()=>{
 const t=setup();t.preencher();await t.selecionar();await t.run('saveLanc()');
 const [record]=await t.run('getPendingOffline()');record.anexoLocal={blob:new Blob(['%PDF-1.7']),nome:'foto.jpg',mime:'image/jpeg'};
 t.ctx.record=record;await t.run('atualizarPendente(record)');t.ctx.navigator.onLine=true;await t.run('syncPendingLancs()');
 assert.match((await t.run('getPendingOffline()'))[0].motivo,/PDF bloqueado nesta versão/);assert.equal(t.uploads,0);t.dom.window.close();
});

test('Apagar exige confirmação e conserva nota, sequência e comprovante; retry idempotente',async()=>{
 const t=setup(),note={obra_id:'obra',colaborador_uid:'jos',identificador:'TES_JOS_000042',sequencia:42,comprovante:{url:'https://example.test/antigo.jpg',nome:'original.jpg'}};
 t.ctx.navigator.onLine=true; t.docs.set('lancamentos/apagar',note);t.ctx.note={id:'apagar',...note};t.run('allLancs=[note]');let confirm;
 t.ctx.showModal=(title,message,fn)=>{assert.equal(title,'Apagar nota');assert.match(message,/Confirma/);confirm=fn;};
 await t.run("deleteLanc('apagar')");assert.equal(t.docs.get('lancamentos/apagar').cancelado,undefined);
 await confirm();await confirm();const saved=t.docs.get('lancamentos/apagar');assert.equal(saved.cancelado,true);assert.equal(saved.sequencia,42);assert.equal(saved.identificador,note.identificador);assert.deepEqual(saved.comprovante,note.comprovante);
});

test('Apagar nota antiga não numera nem altera outras notas ou contadores',async()=>{
 const t=setup();t.ctx.navigator.onLine=true;const old={obra_id:'obra',colaborador_uid:'jos',descricao:'Antiga',comprovante:{url:'https://example.test/legado.pdf',nome:'legado.pdf',tipo:'pdf'}};
 t.docs.set('lancamentos/antiga',old);t.docs.set('lancamentos/outra',{...old,descricao:'Outra'});t.docs.set('notaObras/obra',{codigo:'UFV',ultimaSequencia:42});
 const before=structuredClone([...t.docs]);await notas.criarStoreNotas({doc:t.ctx.doc,runTransaction:t.ctx.runTransaction,serverTimestamp:t.ctx.serverTimestamp}).apagar({db:{},uid:'jos',id:'antiga'});
 const saved=t.docs.get('lancamentos/antiga');assert.equal(saved.cancelado,true);assert.equal(Object.hasOwn(saved,'identificador'),false);assert.equal(Object.hasOwn(saved,'sequencia'),false);assert.deepEqual(saved.comprovante,old.comprovante);
 for(const [path,value] of before)if(path!=='lancamentos/antiga')assert.deepEqual(t.docs.get(path),value);assert.equal(t.docs.size,before.length);t.dom.window.close();
});

test('editar PDF histórico pela fila conserva anexo e ID, sem upload nem numeração',async()=>{
 const t=setup(),pdf={url:'https://res.cloudinary.com/teste/raw/upload/historico.pdf',tipo:'pdf',nome:'historico.pdf'};
 t.docs.set('lancamentos/pdf-historico',{obra_id:'obra',colaborador_uid:'jos',data:'2026-10-09',categoria:'Materiais',descricao:'Antiga',valor:100,reembolsavel:true,comprovante:pdf});
 t.ctx.legada={id:'pdf-historico',...t.docs.get('lancamentos/pdf-historico')};
 await t.run('allLancs=[legada];editLanc(legada.id)');t.$('lancValor').value='200';await t.run('saveLanc()');
 t.ctx.navigator.onLine=true;await t.run('syncPendingLancs()');
 const saved=t.docs.get('lancamentos/pdf-historico');assert.equal(saved.valor,200);assert.deepEqual(saved.comprovante,pdf);assert.equal(saved.identificador,undefined);assert.equal(t.docs.has('notaObras/obra'),false);assert.equal(t.uploads,0);assert.equal((await t.run('getPendingOffline()')).length,0);t.dom.window.close();
});
