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
test('corpo de salvamento V1/V2 legado e editor V2 preservados',()=>{
  for(const [start,end] of [
    ['    const uid=$("evolRegUnidId").value;', '  // ──────────────────────────── GALERIA DE FOTOS'],
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
      const ctx=vm.createContext({document:dom.window.document,$,_eCfg:cfg,_vCfg:cfg,_eGaleriaRegistros:[r],_vGaleriaRegistros:[r],_eObraId:'obra',_vObraId:'obra',currentRole:role,currentProfile:{role},canEvoluirObra:()=>role==='USER',_epModo:parametrizada,_epPermissao:()=>role!=='VISITANTE',_epContext:()=>({profile:{role}})});
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

test('correção pontual preserva PDF, Firebase, autenticação, cálculos e persistência do PROD',()=>{
  const prod=execFileSync('git',['show','3de799416e7d1108896692dd68eb71c4d295e8b0:index.html'],{encoding:'utf8',maxBuffer:5e6}).replace(/\r\n/g,'\n');
  const withoutPhotos=text=>photoBlocks.reduce((value,[a,b])=>value.replace(block(value,a,b),''),text);
  assert.equal(withoutPhotos(source),withoutPhotos(prod));
  assert.equal(block(source,'async function evolGerarRelatorio()', '// ──────────────────────────── MODAL CONFIG'),block(prod,'async function evolGerarRelatorio()', '// ──────────────────────────── MODAL CONFIG'));
});
