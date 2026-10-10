import test from 'node:test';
import assert from 'node:assert/strict';
import {validarAnexo,enviarAnexo,identificadorNota,codigoInicial,candidatoCodigo,validarPermissaoNota,nomeExportacaoNota} from '../notas.mjs';
const file=(bytes,name,type)=>new File([new Uint8Array(bytes)],name,{type});
const png=()=>file([137,80,78,71,13,10,26,10,1,2],'original.png','image/png');
const pdf=()=>new File(['%PDF-1.7\nconteudo'],'original.pdf',{type:'application/pdf'});

test('destino DEV exige pasta efetiva, cloud e recurso confirmados pelo upload',async()=>{
 const assetFolder='go-dev/demo/notas';
 const valid={secure_url:'https://res.cloudinary.com/test/image/upload/v1/id.png',public_id:'id.png',resource_type:'image',asset_folder:assetFolder};
 const send=data=>enviarAnexo(png(),{cloud:'test',preset:'dev-only',folder:assetFolder,assetFolder,fetchImpl:async(url,opts)=>{
  assert.equal(opts.body.get('upload_preset'),'dev-only');assert.equal(opts.body.get('asset_folder'),assetFolder);
  return {ok:true,json:async()=>data};
 }});
 assert.equal((await send(valid)).public_id,'id.png');
 for(const data of [{...valid,asset_folder:'cfo'},{...valid,asset_folder:undefined},{...valid,secure_url:'https://res.cloudinary.com/prod/image/upload/id.png'},{...valid,resource_type:'raw'},{...valid,secure_url:'https://example.test/test/image/upload/id.png'}])
  await assert.rejects(send(data),/Destino|Pasta efetiva/);
});
test('JPG/PNG validados pelos bytes; PDF bloqueado mesmo disfarçado',async()=>{
 await assert.rejects(validarAnexo(pdf()),/PDF bloqueado nesta versão/);
 await assert.rejects(validarAnexo(new File(['%PDF-1.7'],'falso.jpg',{type:'image/jpeg'})),/PDF bloqueado/);
 await assert.rejects(enviarAnexo(pdf(),{cloud:'test',preset:'test',fetchImpl:()=>assert.fail('PDF não pode iniciar upload')}),/PDF bloqueado/);
 assert.equal((await validarAnexo(file([255,216,255,1],'a.jpg','image/jpeg'))).recurso,'image');
 assert.equal((await validarAnexo(file([137,80,78,71,13,10,26,10],'a.png','image/png'))).mime,'image/png');
 await assert.rejects(validarAnexo(new File(['%PDF-1.7'],'documento',{type:''})),/PDF bloqueado/);
 await assert.rejects(validarAnexo(new File(['errado'],'fraude.png',{type:'image/png'})),/válido/);
 await assert.rejects(validarAnexo(new File(['a'.repeat(10485761)],'grande.pdf')),/10 MB/);
});
test('imagens seguem image, metadados preservam original; HTTP falho não confirma upload',async()=>{
 const calls=[]; const fetchImpl=async(url,opts)=>{calls.push([url,opts.body.get('file').name]);return {ok:true,json:async()=>({secure_url:'https://res.cloudinary.com/test/image/upload/file.png',public_id:'go/file',resource_type:'image'})};};
 const comp=await enviarAnexo(png(),{cloud:'test',preset:'test',fetchImpl});
 assert.equal(comp.tipo,'imagem');assert.equal(comp.nome,'original.png');assert.equal(comp.resource_type,'image');assert.match(calls[0][0],/\/image\/upload$/);
 await enviarAnexo(file([255,216,255],'camera.jpg','image/jpeg'),{cloud:'test',preset:'test',fetchImpl});assert.match(calls[1][0],/\/image\/upload$/);
 for(const response of [{ok:false,json:async()=>({error:{message:'Formato bloqueado'}})},{ok:true,json:async()=>({})}]) await assert.rejects(enviarAnexo(png(),{cloud:'test',preset:'test',fetchImpl:async()=>response}));
 await assert.rejects(enviarAnexo(png(),{cloud:'test',preset:'test',fetchImpl:async()=>{throw new Error('Rede indisponível');}}),/Rede/);
});
test('sequência não reinicia; siglas normalizadas e colisões percorrem 26³ códigos distintos',()=>{
 assert.equal(identificadorNota('UFV','JOS',1),'UFV_JOS_000001');assert.equal(identificadorNota('UFV','JOS',1000000),'UFV_JOS_1000000');
 assert.throws(()=>identificadorNota('UFV','JOS',Number.MAX_SAFE_INTEGER+1));
 assert.equal(codigoInicial('Jósimar Rocha'),'JOS');assert.equal(new Set(Array.from({length:17576},(_,i)=>candidatoCodigo('JOS',i))).size,17576);
 assert.equal(nomeExportacaoNota({id:'tecnico',identificador:'UFV_JOS_000001',comprovante:{tipo:'pdf',nome:'original.pdf'}}),'UFV_JOS_000001.pdf');
});
test('estado da obra bloqueia ADMIN, responsável e colaborador; consulta/reativação não muda permissões',()=>{
 for(const role of ['ADMIN','USER']) for(const statusOperacional of ['parada','suspensa']) assert.throws(()=>validarPermissaoNota({role,ativo:true,canLancamentos:true,obras:['o'],evolResponsavel:true},'o',{ativa:true,statusOperacional}),/bloqueados/);
 validarPermissaoNota({role:'USER',canLancamentos:true,obra_id:'o'},'o',{ativa:true});
 assert.throws(()=>validarPermissaoNota({role:'USER',evolResponsavel:true,obras:['o']},'o',{ativa:true}),/permissão/);
 assert.throws(()=>validarPermissaoNota({role:'USER',canLancamentos:true,obras:['outra']},'o',{ativa:true}),/permissão/);
});
