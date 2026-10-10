import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {initializeTestEnvironment,assertFails,assertSucceeds} from '@firebase/rules-unit-testing';
import * as sdk from 'firebase/firestore';
import {criarStoreNotas} from '../notas.mjs';
if(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8089') throw new Error('Somente emulador local permitido.');
let env;const store=criarStoreNotas(sdk);
const contexts=new Map();
const ctx=uid=>{if(!contexts.has(uid)) contexts.set(uid,{db:env.authenticatedContext(uid).firestore(),uid});return contexts.get(uid);};
const entrada={data:'2026-10-09',categoria:'Materiais',descricao:'Nota teste',valor:50,reembolsavel:true,comprovante:{url:'https://res.cloudinary.com/dibvvm6ix/image/upload/teste.png',tipo:'imagem',nome:'original.png',mime:'image/png'}};
const criar=(uid,id,obraId='ufv')=>store.salvar({...ctx(uid),id,obraId,entrada});
const nota=async(id)=>(await sdk.getDoc(sdk.doc(ctx('admin').db,'lancamentos',id))).data();
const contador=async(obraId='ufv')=>(await sdk.getDoc(sdk.doc(ctx('admin').db,'notaObras',obraId))).data();
const setObra=async(id,patch)=>env.withSecurityRulesDisabled(async c=>sdk.setDoc(sdk.doc(c.firestore(),'obras',id),patch,{merge:true}));
before(async()=>{
 env=await initializeTestEnvironment({projectId:'demo-go-notas',firestore:{host:'127.0.0.1',port:8089,rules:fs.readFileSync(new URL('../firestore.rules',import.meta.url),'utf8')}});
 await env.clearFirestore();await env.withSecurityRulesDisabled(async c=>{
  const db=c.firestore();
  for(const [uid,p] of Object.entries({jos:{nome:'Josimar',role:'USER',ativo:true,canLancamentos:true,permEvolucao:true,obras:['ufv','ufv2','pausa']},jose:{nome:'José',role:'USER',ativo:true,canLancamentos:true,evolResponsavel:true,obras:['ufv','ufv2','pausa']},admin:{nome:'Admin',role:'ADMIN'},sem:{role:'USER',obras:['ufv']},outra:{role:'USER',canLancamentos:true,obras:['outra']},inativo:{role:'USER',ativo:false,canLancamentos:true,obras:['ufv']},visitante:{role:'VISITANTE',canLancamentos:true,obras:['ufv']}})) await sdk.setDoc(sdk.doc(db,'usuarios',uid),p);
  for(const id of ['ufv','ufv2','pausa']) await sdk.setDoc(sdk.doc(db,'obras',id),{nome:'UFV Solar',ativa:true,statusOperacional:'ativa'});
  await sdk.setDoc(sdk.doc(db,'lancamentos','legado'),{...entrada,obra_id:'ufv',colaborador_uid:'jos'});
 });
});
after(async()=>env?.cleanup());
test('concorrência: sequência única compartilhada e colisões de usuário/obra são resolvidas',async()=>{
 const outcomes=await Promise.allSettled(Array.from({length:12},(_,i)=>criar(i%2?'jos':'jose','conc-'+i)));
 for(const [i,o] of outcomes.entries()) if(o.status==='rejected') console.log('CONCORRENCIA',i,o.reason);
 const result=outcomes.map(o=>{if(o.status==='rejected') throw o.reason;return o.value;});
 assert.equal(new Set(result.map(r=>r.identificador)).size,12);
 assert.deepEqual(result.map(r=>r.sequencia).sort((a,b)=>a-b),Array.from({length:12},(_,i)=>i+1));
 assert.equal((await contador()).ultimaSequencia,12);
 const a=(await sdk.getDoc(sdk.doc(ctx('admin').db,'notaUsuarios','jos'))).data();
 const b=(await sdk.getDoc(sdk.doc(ctx('admin').db,'notaUsuarios','jose'))).data();assert.notEqual(a.codigo,b.codigo);
 const other=await criar('jos','outra-obra','ufv2');assert.equal(other.sequencia,1);assert.notEqual(other.codigoObra,(await contador()).codigo);
});
test('retry simultâneo e perda da confirmação usam mesmo ID; edição mantém criador, código e criadoEm',async()=>{
 const result=await Promise.all([criar('jos','retry'),criar('jos','retry')]);
 assert.equal(result[0].identificador,result[1].identificador);const count=(await contador()).ultimaSequencia;
 const first=await nota('retry');await criar('jos','retry');assert.equal((await contador()).ultimaSequencia,count);
 const edited=await store.salvar({...ctx('jos'),id:'retry',obraId:'ufv',entrada:{...entrada,valor:70},editar:true,revisaoEsperada:1,operacaoId:'edit-op'});
 await store.salvar({...ctx('jos'),id:'retry',obraId:'ufv',entrada:{...entrada,valor:70},editar:true,revisaoEsperada:1,operacaoId:'edit-op'});
 assert.equal(edited.identificador,first.identificador);assert.equal(edited.colaborador_uid,first.colaborador_uid);assert.ok(edited.criadoEm.isEqual(first.criadoEm));
 assert.equal((await contador()).ultimaSequencia,count);
 await assert.rejects(store.salvar({...ctx('jos'),id:'retry',obraId:'ufv',entrada,editar:true,revisaoEsperada:1,operacaoId:'edit-conflito'}),/outra sessão/);
});
test('cancelamento preserva documento, bloqueia delete e não reutiliza número; legado não é numerado',async()=>{
 const first=await criar('jos','cancelar');await store.cancelar({...ctx('jos'),id:'cancelar'});
 assert.equal((await nota('cancelar')).identificador,first.identificador);assert.equal((await nota('cancelar')).cancelado,true);
 await assertFails(sdk.deleteDoc(sdk.doc(ctx('admin').db,'lancamentos','cancelar')));
 const next=await criar('jos','apos-cancelar');assert.equal(next.sequencia,first.sequencia+1);
 const old=await store.salvar({...ctx('jos'),id:'legado',obraId:'ufv',entrada,editar:true,revisaoEsperada:0,operacaoId:'editar-legado'});
 assert.equal(old.identificador,undefined);assert.equal((await nota('legado')).identificador,undefined);
});
test('sem permissão, alocação, inativo e visitante são negados; forjar nota/código/contador direto é negado',async()=>{
 for(const uid of ['sem','outra','inativo','visitante']) await assert.rejects(criar(uid,'bad-'+uid));
 const db=ctx('jos').db;
 await assertFails(sdk.setDoc(sdk.doc(db,'lancamentos','direto'),{...entrada,obra_id:'ufv',colaborador_uid:'jos'}));
 await assertFails(sdk.updateDoc(sdk.doc(db,'notaObras','ufv'),{ultimaSequencia:999}));
 await assertFails(sdk.updateDoc(sdk.doc(db,'lancamentos','retry'),{identificador:'UFV_JOS_999999'}));
 await assertFails(sdk.updateDoc(sdk.doc(db,'notaUsuarios','jos'),{codigo:'ZZZ'}));
 await assertFails(sdk.setDoc(sdk.doc(db,'notaCodigosObras','ABC'),{obraId:'ufv'}));
 await assertFails(sdk.setDoc(sdk.doc(db,'notaCodigosUsuarios','ABC'),{uid:'jos'}));
});
test('formulário já aberto/offline: suspensão ao enviar bloqueia notas e evolução incluindo responsável/ADMIN; história e reativação',async()=>{
 const before=await criar('jos','historico-pausa','pausa');
 for(const statusOperacional of ['parada','suspensa']) {
  await setObra('pausa',{statusOperacional});
  for(const uid of ['jos','jose','admin']) {
   await assert.rejects(criar(uid,'bloq-'+statusOperacional+'-'+uid,'pausa'),/bloqueados/);
   const db=ctx(uid).db;
   await assertFails(sdk.setDoc(sdk.doc(db,'obras','pausa','evolRegistros','direto'),{data:'2026-10-09'}));
   await assertFails(sdk.setDoc(sdk.doc(db,'obras','pausa','evolProgresso','direto'),{pct:20}));
   await assertFails(sdk.setDoc(sdk.doc(db,'obras','pausa','evolHistorico','direto'),{data:'2026-10-09'}));
   await assertSucceeds(sdk.getDoc(sdk.doc(db,'lancamentos','historico-pausa')));
   await assertSucceeds(sdk.getDocs(sdk.collection(db,'obras','pausa','evolRegistros')));
  }
  assert.equal((await contador('pausa')).ultimaSequencia,before.sequencia);
  // Ponto/DDS conservam a autorização anterior.
  const db=ctx('jose').db;
  await assertSucceeds(sdk.setDoc(sdk.doc(db,'pontos','ponto-'+statusOperacional),{uid:'jose',obra_id:'pausa'}));
  await assertSucceeds(sdk.setDoc(sdk.doc(db,'obras','pausa','dds','dds-'+statusOperacional),{data:'2026-10-09'}));
 }
 await setObra('pausa',{statusOperacional:'ativa'});
 const after=await criar('jose','reativada','pausa');assert.equal(after.sequencia,before.sequencia+1);
 await assertSucceeds(sdk.setDoc(sdk.doc(ctx('jose').db,'obras','pausa','evolRegistros','apos'),{data:'2026-10-09'}));
});
test('suspensão entre leitura e commit invalida a transação e não consome sequência',async()=>{
 await setObra('pausa',{statusOperacional:'ativa'});
 const before=(await contador('pausa')).ultimaSequencia;
 let primeira=true;
 const corrida=criarStoreNotas({...sdk,runTransaction:(db,fn)=>sdk.runTransaction(db,async tx=>{
  const result=await fn(tx);
  if(primeira){primeira=false;await setObra('pausa',{statusOperacional:'suspensa'});}
  return result;
 })});
 await assert.rejects(corrida.salvar({...ctx('jos'),id:'corrida-suspensao',obraId:'pausa',entrada}),/bloqueados|permission/);
 assert.equal((await contador('pausa')).ultimaSequencia,before);
 assert.equal((await sdk.getDoc(sdk.doc(ctx('admin').db,'lancamentos','corrida-suspensao'))).exists(),false);
 await setObra('pausa',{statusOperacional:'ativa'});
 const saved=await criar('jos','corrida-suspensao','pausa');assert.equal(saved.sequencia,before+1);
});
test('passagem 999999 para 1000000 sem reset (fixture isolada)',async()=>{
 const c=ctx('jos');const first=await criar('jos','grande-inicial','ufv2');
 await env.withSecurityRulesDisabled(async x=>sdk.updateDoc(sdk.doc(x.firestore(),'notaObras','ufv2'),{ultimaSequencia:999999}));
 const next=await criar('jos','milhao','ufv2');assert.equal(next.identificador,first.codigoObra+'_'+first.codigoUsuario+'_1000000');
});

test('PDF novo negado no store e Rules; edição de PDF legado conserva anexo',async()=>{
 const pdf={url:'https://res.cloudinary.com/dibvvm6ix/raw/upload/legado.pdf',tipo:'pdf',mime:'application/pdf',nome:'legado.pdf'};
 await assert.rejects(store.salvar({...ctx('jos'),id:'pdf-novo',obraId:'ufv',entrada:{...entrada,comprovante:pdf}}),/PDF bloqueado/);
 const rogue=criarStoreNotas({...sdk,runTransaction:(db,fn)=>sdk.runTransaction(db,tx=>fn({get:ref=>tx.get(ref),set:(ref,value)=>tx.set(ref,ref.path.startsWith('lancamentos/')?{...value,comprovante:pdf}:value)}))});
 await assertFails(rogue.salvar({...ctx('jos'),id:'pdf-direto',obraId:'ufv',entrada}));
 const image=await criar('jos','imagem-base-pdf');
 await assertFails(sdk.updateDoc(sdk.doc(ctx('jos').db,'lancamentos',image.id),{comprovante:pdf,revisaoNota:2,ultimaOperacaoId:'troca-pdf',atualizadoEm:sdk.serverTimestamp(),atualizadoPor:'jos'}));
 await env.withSecurityRulesDisabled(async c=>sdk.setDoc(sdk.doc(c.firestore(),'lancamentos','pdf-legado'),{...entrada,comprovante:pdf,obra_id:'ufv',colaborador_uid:'jos',criadoEm:sdk.Timestamp.fromMillis(1)}));
 await store.salvar({...ctx('jos'),id:'pdf-legado',obraId:'ufv',editar:true,revisaoEsperada:0,operacaoId:'edita-legado',entrada:{...entrada,descricao:'Valor atualizado',comprovante:pdf}});
 assert.deepEqual((await nota('pdf-legado')).comprovante,pdf);
 const legacy=await nota('pdf-legado');
 await store.salvar({...ctx('jos'),id:'pdf-legado',obraId:'ufv',editar:true,revisaoEsperada:1,operacaoId:'troca-imagem',entrada});
 assert.deepEqual((await nota('pdf-legado')).comprovante,entrada.comprovante);
 assert.equal((await nota('pdf-legado')).criadoEm.toMillis(),legacy.criadoEm.toMillis());
});

test('Apagar legado/numerada exige proprietário ou ADMIN e preserva anexo/identificador',async()=>{
 const db=uid=>ctx(uid).db,imagem=entrada.comprovante,base={...entrada,obra_id:'ufv',colaborador_uid:'jos',revisaoNota:1};
 const seed=(id,data)=>env.withSecurityRulesDisabled(c=>sdk.setDoc(sdk.doc(c.firestore(),'lancamentos',id),data));
 const edit=(uid,id)=>sdk.updateDoc(sdk.doc(db(uid),'lancamentos',id),{descricao:'Alterada',revisaoNota:2,ultimaOperacaoId:'edit-'+id,atualizadoEm:sdk.serverTimestamp(),atualizadoPor:uid});
 const apagar=(uid,id,extra={})=>sdk.updateDoc(sdk.doc(db(uid),'lancamentos',id),{cancelado:true,canceladoPor:uid,canceladoEm:sdk.serverTimestamp(),...extra});
 for(const id of ['apagar-legado','apagar-numerada']){
  const n={...base,...(id.endsWith('numerada')?{identificador:'TES_JOS_000005',sequencia:5}:{})};await seed(id,n);
  await assertFails(apagar('outra',id));await assertFails(apagar('visitante',id));
  await assertFails(apagar('jos',id,{comprovante:null}));await assertFails(apagar('jos',id,{sequencia:1}));
  await assertSucceeds(apagar(id.endsWith('legado')?'admin':'jos',id));
  const saved=(await sdk.getDoc(sdk.doc(db('jos'),'lancamentos',id))).data();assert.deepEqual(saved.comprovante,imagem);assert.equal(saved.identificador,n.identificador);
  await assertFails(edit('jos',id));await assertFails(sdk.updateDoc(sdk.doc(db('admin'),'lancamentos',id),{cancelado:false}));
  for(const uid of ['jos','admin'])await assertFails(sdk.deleteDoc(sdk.doc(db(uid),'lancamentos',id)));
 }
});

test('cliente antigo em cache falha sem alterar nota/anexo/contador; leitura histórica continua',async()=>{
 const c=ctx('jos'),id='cache-antigo',data={...entrada,obra_id:'ufv',colaborador_uid:'jos',criadoEm:sdk.Timestamp.fromMillis(1)};
 await env.withSecurityRulesDisabled(x=>sdk.setDoc(sdk.doc(x.firestore(),'lancamentos',id),data));
 const before=await contador();
 await assertFails(sdk.setDoc(sdk.doc(c.db,'lancamentos','LANC_cliente_antigo'),{...data,criadoEm:sdk.serverTimestamp()}));
 await assertFails(sdk.updateDoc(sdk.doc(c.db,'lancamentos',id),{descricao:'Cliente antigo',criadoEm:sdk.serverTimestamp()}));
 await assertFails(sdk.deleteDoc(sdk.doc(ctx('admin').db,'lancamentos',id)));
 assert.deepEqual(await nota(id),data);assert.deepEqual(await contador(),before);
 await assertSucceeds(sdk.getDoc(sdk.doc(c.db,'lancamentos',id)));
});

test('suspensão bloqueia também exclusão e alteração legadas de evolução para ADMIN',async()=>{
 const db=ctx('admin').db;
 await setObra('pausa',{statusOperacional:'ativa'});
 for(const sub of ['evolRegistros','evolHistorico','evolProgresso'])await env.withSecurityRulesDisabled(x=>sdk.setDoc(sdk.doc(x.firestore(),'obras','pausa',sub,'legado-cache'),{data:'2026-10-09',fotoUrl:'original'}));
 for(const statusOperacional of ['parada','suspensa']){
  await setObra('pausa',{statusOperacional});
  for(const sub of ['evolRegistros','evolHistorico','evolProgresso']){
   const r=sdk.doc(db,'obras','pausa',sub,'legado-cache');
   await assertFails(sdk.updateDoc(r,{fotoUrl:'alterada'}));await assertFails(sdk.deleteDoc(r));
   assert.equal((await sdk.getDoc(r)).data().fotoUrl,'original');
  }
 }
 await setObra('pausa',{statusOperacional:'ativa'});
});
