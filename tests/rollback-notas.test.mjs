import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {initializeTestEnvironment,assertFails,assertSucceeds} from '@firebase/rules-unit-testing';
import * as sdk from 'firebase/firestore';
if(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8089')throw Error('Somente emulador local.');
test('rollback anterior em manutenção: JavaScript válido e sem gravação/descarte de fila',async()=>{
 const html=fs.readFileSync('tests/.runtime/rollback-79a32c3/index.html','utf8');
 const result=spawnSync(process.execPath,['--check','--input-type=module'],{input:html.match(/<script type="module">([\s\S]*?)<\/script>/)[1],encoding:'utf8'});assert.equal(result.status,0,result.stderr);
 assert.match(html,/syncPendingLancs = .*em manutenção/);assert.match(html,/filter\(l=>!l.cancelado\)/);assert.match(html,/go-app-prod-53ab5/);assert.doesNotMatch(html,/go-app-dev-bc1be/);
 const env=await initializeTestEnvironment({projectId:'demo-go-rollback',firestore:{host:'127.0.0.1',port:8089,rules:fs.readFileSync('tests/.runtime/rollback-79a32c3/firestore.rules','utf8')}});
 try{
 await env.withSecurityRulesDisabled(async c=>{const db=c.firestore();for(const [p,v] of [['usuarios/admin',{role:'ADMIN'}],['obras/obra',{ativa:true}],['lancamentos/nota',{obra_id:'obra',colaborador_uid:'admin',cancelado:true,identificador:'OBR_ADM_000042',sequencia:42,comprovante:{url:'https://res.cloudinary.com/dibvvm6ix/image/upload/original.jpg'}}],['notaObras/obra',{codigo:'OBR',ultimaSequencia:42,ultimoLancamentoId:'nota'}],['obras/obra/evolRegistros/registro',{fotoUrl:'original'}]])await sdk.setDoc(sdk.doc(db,p),v);});
 const db=env.authenticatedContext('admin').firestore(),ref=sdk.doc(db,'lancamentos/nota');const before=(await sdk.getDoc(ref)).data();
 await assertSucceeds(sdk.getDoc(ref));await assertFails(sdk.deleteDoc(ref));await assertFails(sdk.updateDoc(ref,{cancelado:false}));await assertFails(sdk.setDoc(sdk.doc(db,'lancamentos/nova'),{obra_id:'obra'}));await assertFails(sdk.updateDoc(sdk.doc(db,'notaObras/obra'),{ultimaSequencia:1}));await assertFails(sdk.updateDoc(sdk.doc(db,'obras/obra/evolRegistros/registro'),{fotoUrl:'alterada'}));assert.deepEqual((await sdk.getDoc(ref)).data(),before);assert.equal((await sdk.getDoc(sdk.doc(db,'notaObras/obra'))).data().ultimaSequencia,42);
 }finally{await env.cleanup();}
});
