import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { spawnSync, execFileSync } from 'node:child_process';
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
// Baseline PROD equivalente ao legado DEV; difere apenas na configuração Firebase.
const baseline=execFileSync('git',['show','e099cb7b1ccc7b29983798bb6b330cae2417e164:index.html'],{encoding:'utf8',maxBuffer:5e6}).replace(/\r\n/g,'\n');
const source=html.replace(/\r\n/g,'\n');
function block(text,start,end){ return text.slice(text.indexOf(start),text.indexOf(end,text.indexOf(start))); }
test('JavaScript principal continua sintaticamente válido',()=>{
  const script=html.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
  const result=spawnSync(process.execPath,['--check','--input-type=module'],{input:script,encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
});
test('salvamento legado preserva progresso e timestamp técnico, e editor V2 segue compatível',()=>{
  const saveBlock=block(source,'    const uid=$("evolRegUnidId").value;','  // ──────────────────────────── GALERIA DE FOTOS');
  assert.ok(saveBlock.includes('data:hoje')); assert.ok(saveBlock.includes('criadoEm:\n          serverTimestamp()'));
  assert.ok(saveBlock.includes('await setDoc(')); assert.ok(saveBlock.includes('const savedRef=await addDoc('));
  assert.ok(saveBlock.includes('getDoc(savedRef)')); assert.ok(saveBlock.includes('evolPrepararInformeSalvo(obraSalva,savedRegistro.data)'));
  assert.ok(!saveBlock.includes('abrirInformeWhatsApp('));
  for(const [start,end] of [
    ['  function _eGarantirDraftV2(){','    async function evolCfgSalvarV2(){'],
    ['    // ─────────────────────────────────────────────\n    // SEGURANÇA — configuração estrutural','  async function evolAnalisarIA()'],
  ]) assert.equal(block(source,start,end),block(baseline,start,end));
});
test('V1 IBITU e V2 relativo mantêm cálculos de Macro, Unidade e Global',()=>{
  const calc=block(source,'  const _ePctSvc','  // ──────────────────────────── RENDERIZAR PAINEL');
  const oldCalc=block(baseline,'  const _ePctSvc','  // ──────────────────────────── RENDERIZAR PAINEL');
  const run=(code,cfg)=>vm.runInNewContext(code+'\n[_ePctUnid("u1"),_ePctUnid("u2"),_ePctGlobal()]',{
    _epModo:()=>false,_eCfg:cfg,_eProg:{u1_s1:{pct:50,qtdExec:1},u1_s2:{pct:100,qtdExec:1},u2_s1:{pct:100,qtdExec:2}},
  });
  for(const cfg of [
    {unidades:[{id:'u1'},{id:'u2'}],servicos:[{id:'s1',peso:3},{id:'s2',peso:1}]},
    {modeloEvolucao:2,unidades:[{id:'u1'},{id:'u2'}],macros:[{id:'m1',percentual:100,micros:[{id:'s1',peso:3},{id:'s2',peso:1}]}]},
  ]) assert.deepEqual([...run(calc,cfg)],[...run(oldCalc,cfg)]);
});
test('API App antiga preservada e galeria continua sem deleteDoc',()=>{
  const api=block(source,'  window.App = {','</script>');
  for(const name of ['evolCfgSalvar','evolAbrirReg','evolFotoSel','evolFotoRemover','evolSalvarReg','evolAbrirGaleria','vApagarFoto','vTrocarFoto']) assert.ok(api.includes(name));
  for(const [start,end] of [['async function _evolApagarFotoAdm','  function evolVerFotoAmp'],['async function vApagarFoto','  async function']]) {
    const content=block(source,start,end);
    assert.ok(content.includes('updateDoc')); assert.ok(!content.includes('deleteDoc('));
  }
});

// Galerias reais, isoladas de rede e de qualquer escrita no Firebase.
const { JSDOM } = await import('jsdom');
const { parametrizada } = await import('../evolucao-parametrizada.mjs');
const { config } = await import('./fixture.mjs');
const {dataReferenciaRegistro,formatarDataReferencia,dataCorteLocal}=await import('../evolucao-fotos.mjs');
const photoBlocks = [
  ['function evolFiltrarGaleria()', 'async function _evolApagarFotoAdm('],
  ['function evolVerFotoAmp(', '// ──────────────────────────── RELATÓRIO PDF'],
  ['function vFiltrarGaleria()', 'async function vApagarFoto('],
];
const photoSource=photoBlocks.map(([a,b])=>block(source,a,b)).join('\n');
for(const mode of ['V1','V2 relativo','parametrizado quantidade','parametrizado percentual']) {
  for(const role of ['ADMIN','USER','VISITANTE']) {
    test(`legendas Antes/Depois e ampliação: ${mode}, ${role}`,()=>{
      const cfg=config();
      if(mode==='V1') {delete cfg.modeloEvolucao; delete cfg.modoCalculo;}
      if(mode==='V2 relativo') delete cfg.modoCalculo;
      cfg.modoApontamento=mode.endsWith('percentual')?'percentual':'quantidade';
      const r={id:'r1',unidId:'u1',unidNome:'Tracker 37/36',svcId:'s1',svcDesc:'Bacia de contenção',data:'2026-10-06',qtdHoje:0.25,unidade:'m³',pctAntes:10,pctDepois:35,fotoUrl:'https://example.test/antes',fotoUrlDepois:'https://example.test/depois'};
      const originalRecord=JSON.stringify(r);
      const ids=['evolGaleriaConteudo','evolGaleriaTotais','vGaleriaGrid','vGaleriaTotais','evolFotoAmpInfo','vFotoAmpInfo','evolFotoAmpImg','vFotoAmpImg','modalEvolFotoAmp','vModalFotoAmp'];
      const dom=new JSDOM(ids.map(id=>`<div id="${id}" class="hidden"></div>`).join(''));
      const $=id=>dom.window.document.getElementById(id);
      const ctx=vm.createContext({dataReferenciaRegistro,formatarDataReferencia,dataCorteLocal,document:dom.window.document,$,_eCfg:cfg,_vCfg:cfg,_eGaleriaRegistros:[r],_vGaleriaRegistros:[r],_eObraId:'obra',_vObraId:'obra',currentRole:role,currentProfile:{role},canEvoluirObra:()=>role==='USER',_epModo:parametrizada,_epPermissao:()=>role!=='VISITANTE',_epContext:()=>({profile:{role}})});
      vm.runInContext(photoSource+'\nevolFiltrarGaleria();vFiltrarGaleria();',ctx);
      for(const id of ['evolGaleriaConteudo','vGaleriaGrid']) {
        const el=$(id), text=el.textContent;
        assert.equal(el.querySelectorAll('img').length,2);
        for(const expected of ['Antes','Depois','Tracker 37/36','Bacia de contenção','06']) assert.ok(text.includes(expected),expected);
        assert.doesNotMatch(text,/0[,.]25|m³|25[,.]0|%/);
        assert.equal(el.querySelectorAll('input[type=file]').length,role==='VISITANTE'?0:2);
        for(const node of el.querySelectorAll('[onclick]')) {
          ctx.App={evolVerFotoAmp:ctx.evolVerFotoAmp,vVerFotoAmp:ctx.vVerFotoAmp};
          const handler=node.getAttribute('onclick');
          if(!handler.includes('VerFotoAmp')) continue;
          vm.runInContext(handler,ctx);
          const info=$(id==='vGaleriaGrid'?'vFotoAmpInfo':'evolFotoAmpInfo').textContent;
          assert.match(info,/Tracker 37\/36.*Bacia de contenção.*06\/10\/2026/);
          assert.doesNotMatch(info,/0[,.]25|m³|%/);
          if(id==='vGaleriaGrid') assert.ok(info.includes(handler.includes("'depois'")?'Depois':'Antes'));
        }
      }
      assert.equal(JSON.stringify(r),originalRecord);
      dom.window.close();
    });
  }
}

test('preparação consolidada está disponível no Evolução e consulta apenas dados salvos da obra/data escolhidas',()=>{
  const sharing=fs.readFileSync(new URL('../evolucao-compartilhamento.mjs',import.meta.url),'utf8');
  assert.match(source,/id="btnEvolInformeDia"/);
  assert.match(source,/App\.evolAbrirPrepararInformeDia\(\)/);
  assert.match(source,/id="evolInformeObra"/);
  assert.match(source,/id="evolInformeData"/);
  assert.match(sharing,/doc\(db, 'obras', obraId, 'evolHistorico', referencia\)/);
  assert.match(sharing,/collection\(db, 'obras', obraId, 'evolRegistros'\)/);
  assert.match(sharing,/getDocFromServer\(obraRef\), getDocFromServer\(diarioRef\), getDocsFromServer\(registrosRef\)/);
  assert.match(source,/diarioDoDiaExiste\(salvo\.diario\)/);
  assert.match(source,/montarInformeDia\(\{data,local:\{cidade:salvo\.obra\.cidade,estado:salvo\.obra\.estado\},responsavel:evolNomeResponsavelInforme\(\),diario\}\)/);
});

test('compartilhamento prepara arquivos reais, exibe falhas, e mantém WhatsApp via link como alternativa só de texto',()=>{
  const ui=fs.readFileSync(new URL('../evolucao-compartilhamento-ui.mjs',import.meta.url),'utf8');
  assert.match(ui,/navigatorObject\.canShare\(\{ files \}\)/);
  assert.match(ui,/navigatorObject\.share\(\{ text: textarea\.value, files \}\)/);
  assert.match(ui,/Abrir WhatsApp \(somente texto\)/);
  assert.match(ui,/Baixar fotos organizadas \(\.zip\)/);
  assert.match(ui,/photo\.error/);
  assert.match(source,/evolPrepararInformeSalvo\(context\.obraId, registro\.data\)/);
});

test('configuração e arquivos exclusivos de produção permanecem preservados',()=>{
  const prod=execFileSync('git',['show','8202e6f:index.html'],{encoding:'utf8',maxBuffer:5e6}).replace(/\r\n/g,'\n');
  assert.equal(block(source,'  const firebaseConfig = {','  const firebaseMain'),block(prod,'  const firebaseConfig = {','  const firebaseMain'));
  assert.ok(!source.includes('go-app-dev-bc1be'));
  for(const name of ['.firebaserc','firebase.json','acessos.mjs']) {
    assert.equal(fs.readFileSync(new URL('../'+name,import.meta.url),'utf8').replace(/\r\n/g,'\n'),execFileSync('git',['show','8202e6f:'+name],{encoding:'utf8',maxBuffer:5e6}).replace(/\r\n/g,'\n'),name);
  }
});

test('service worker mantém Network First e não perde a resposta por falha de cache', async()=>{
  const worker=fs.readFileSync(new URL('../sw.js',import.meta.url),'utf8');
  assert.match(worker,/Network First/);
  for(const failAt of ['open','put']) {
    const listeners={};
    const response={clone:()=>({cached:true})};
    const cache={put:async()=>{if(failAt==='put')throw new Error('cache denied');}};
    const context={
      self:{addEventListener:(type,handler)=>{listeners[type]=handler;},skipWaiting:()=>{},clients:{claim:()=>{}}},
      caches:{open:async()=>{if(failAt==='open')throw new Error('cache denied');return cache;},match:async()=>undefined},
      fetch:async()=>response,
    };
    vm.runInNewContext(worker,context);
    const event={request:{method:'GET',url:'/index.html'},waitUntil(promise){this.cachePromise=promise;},respondWith(promise){this.responsePromise=promise;}};
    listeners.fetch(event);
    assert.equal(await event.responsePromise,response,`network response survives cache.${failAt} rejection`);
    await event.cachePromise;
  }
});

test('imports locais do HTML e módulos publicados resolvem sem dependência DEV', async()=>{
  const root=new URL('../',import.meta.url), visited=new Set();
  async function visit(name){
    if(visited.has(name))return;visited.add(name);
    const content=fs.readFileSync(new URL(name,root),'utf8');
    for(const match of content.matchAll(/from\s+['"]\.\/([^'"]+)['"]/g)){
      assert.ok(fs.existsSync(new URL(match[1],root)),match[1]);
      await import(new URL(match[1],root));await visit(match[1]);
    }
  }
  await visit('index.html');
  for(const name of ['despesas.mjs','evolucao-fotos.mjs','evolucao-compartilhamento.mjs','evolucao-compartilhamento-ui.mjs'])assert.ok(visited.has(name));
});

test('cache novo tem preferência offline; ativação conserva cache anterior e pendências',async()=>{
 const listeners={},old={version:'old'},fresh={version:'fresh'};let found=fresh,claims=0,deletes=0;
 const caches={open:async()=>({match:async()=>found}),match:async()=>old,delete:async()=>{deletes++;}};
 const self={addEventListener:(type,fn)=>listeners[type]=fn,skipWaiting:()=>{},clients:{claim:async()=>{claims++;}}};
 vm.runInNewContext(fs.readFileSync(new URL('../sw.js',import.meta.url),'utf8'),{self,caches,fetch:async()=>{throw Error('offline');}});
 let activating;listeners.activate({waitUntil:p=>activating=p});await activating;assert.equal(claims,1);assert.equal(deletes,0);
 const request={method:'GET',url:'/go-app/index.html'};let response;listeners.fetch({request,waitUntil:()=>{},respondWith:p=>response=p});assert.equal(await response,fresh);
 found=undefined;listeners.fetch({request,waitUntil:()=>{},respondWith:p=>response=p});assert.equal(await response,old);
});
