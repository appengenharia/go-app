import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {JSDOM} from 'jsdom';
import {motivoBloqueioObra} from '../notas.mjs';
import {validarDataReferencia} from '../evolucao-fotos.mjs';
import {carregarDadosInformeDia,diarioDoDiaExiste,montarInformeDia,selecionarFotosDoDia} from '../evolucao-compartilhamento.mjs';

const source=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
function trecho(start,end){const a=source.indexOf(start),b=source.indexOf(end,a);assert.ok(a>=0&&b>a,`${start}`);return source.slice(a,b);}

function contextoPerda(extra={}) {
  const ctx=vm.createContext(extra);
  vm.runInContext(trecho('function _ePerdaDia(row){','function _eRenderClimaPainel(rows){')+trecho('function _vPerdaDia(row){','function _vCarregarClima()'),ctx);
  return ctx;
}

test('perda de produção independe de impacto, causa e horas; parcial mantém proporção',()=>{
  const ctx=contextoPerda();
  for(const impactoPrazo of [false,true]) for(const causaDia of ['clima','operacional','seguranca','outro','producao']) {
    for(const horasParadas of [0,3,8,12]) {
      ctx.row={data:'2026-10-06',houveProducao:'nao',percentualProducaoDia:0,horasParadas,causaDia,impactoPrazo};
      assert.equal(vm.runInContext('_ePerdaDia(row)',ctx),1);
      assert.equal(vm.runInContext('_vPerdaDia(row)',ctx),1);
    }
    ctx.row={houveProducao:'parcial',percentualProducaoDia:50,impactoPrazo,causaDia,horasParadas:8};
    assert.equal(vm.runInContext('_ePerdaDia(row)',ctx),0.5);
    assert.equal(vm.runInContext('_vPerdaDia(row)',ctx),0.5);
    ctx.row.houveProducao='sim';
    assert.equal(vm.runInContext('_ePerdaDia(row)',ctx),0);
  }
});

test('deduplicação usa obra e data, preservando perdas de obras distintas',()=>{
  const ctx=contextoPerda({rows:[
    {obraId:'a',data:'2026-10-06',houveProducao:'nao'},
    {obraId:'b',data:'2026-10-06',houveProducao:'nao'},
    {obraId:'a',data:'2026-10-06',houveProducao:'parcial',percentualProducaoDia:50},
  ]});
  assert.equal(vm.runInContext('_eTotalPerdaDias(rows)',ctx),1.5);
  assert.equal(vm.runInContext('_eTotalPerdaDias(rows.filter(r=>r.obraId==="a"),"a")',ctx),0.5);
});

function contextoVisitante({parametrizado=false}={}) {
  const elements=new Map(),reads=[],histories=new Map(),deferred=new Map();
  const $=id=>id.includes('Chart')||id.startsWith('chart')||id==='vChartLinha'||id==='vGaleriaFiltroUnid'?null:
    (elements.get(id)||elements.set(id,{style:{},textContent:'',innerHTML:''}).get(id));
  const rows=Array.from({length:130},(_,i)=>({data:new Date(Date.UTC(2026,0,i+1)).toISOString().slice(0,10),pctGlobal:10,houveProducao:'nao',impactoPrazo:false}));
  histories.set('a',rows);histories.set('b',[{...rows[0],houveProducao:'parcial',percentualProducaoDia:50}]);
  const cfg={unidades:[{id:'u'}],parametrizado};
  const ctx=contextoPerda({$,document:{title:''},db:{},console,_eObraId:'a',_vObraId:null,_vClimaHist:[],_vClimaPrintUrl:'',_eClimaHist:[],_eClimaPrintUrl:'',
    _eCfg:cfg,_eRegistrosFisicos:[],
    _vCfg:null,_vCont:null,_vProg:{},_vFisico:null,_vRegistrosFisicos:[],_vGaleriaRegistros:[],
    _vRenderKpis:()=>{},_vRenderListaUnidades:()=>{},_vRenderGrafico:()=>{},vFiltrarGaleria:()=>{},_vPosicionarCardClima:()=>{},
    _epModo:config=>!!config?.parametrizado,_epHistorico:()=>[],_epCalcular:()=>({progresso:{}}),_epUI:{carregarRegistros:async()=>[]},
    doc:(_db,...segments)=>segments.join('/'),collection:(_db,...segments)=>segments.join('/'),orderBy:(...args)=>args,
    query:(path,...constraints)=>({path,constraints}),
    getDoc:async path=>({exists:()=>true,data:()=>path.includes('evolConfig')?cfg:{nome:'Obra mock'}}),
    getDocs:async ref=>{
      const path=typeof ref==='string'?ref:ref.path;reads.push(path);
      if(deferred.has(path)) await deferred.get(path).promise;
      const data=path.endsWith('/evolHistorico')?histories.get(path.split('/')[1])||[]:[];
      const docs=data.map(row=>({data:()=>row}));return{docs,forEach:fn=>docs.forEach(fn)};
    },
    fetch:()=>assert.fail('Sem rede'),setDoc:()=>assert.fail('Sem gravação Firebase'),
  });
  vm.runInContext(trecho('let _vHistoricoObraId =','let _vClimaPrintUrl')+
    trecho('async function visitanteInicializar(obraId) {','function _vRenderKpis()')+
    trecho('async function _vRenderHistorico() {','function vFiltrarGaleria()')+
    trecho('async function _eCarregarHistorico(','function _eHojeStr()')+
    trecho('function _vCarregarClima(){','function vVerClimaAmp()')+
    trecho('function _eRenderClimaPainel(rows){','function evolVerClimaFoto('),ctx);
  const historyReads=()=>reads.filter(path=>path.endsWith('/evolHistorico')).length;
  const hold=(obra,collection='evolHistorico')=>{let resolve;const promise=new Promise(r=>{resolve=r;});deferred.set(`obras/${obra}/${collection}`,{promise});return()=>{deferred.delete(`obras/${obra}/${collection}`);resolve();};};
  return{ctx,reads,histories,elements,historyReads,hold};
}

test('ADMIN e visitante recalculam o mesmo histórico editado; cada carregamento faz uma consulta',async()=>{
  const t=contextoVisitante();
  t.histories.get('a').push({...t.histories.get('a')[0]});
  await vm.runInContext('_eCarregarHistorico("a",true)',t.ctx);
  assert.equal(t.historyReads(),1);
  await vm.runInContext('visitanteInicializar("a")',t.ctx);
  assert.equal(t.historyReads(),2);
  assert.equal(t.elements.get('evolClimaKpiPerdidos').textContent,'130,0');
  assert.equal(t.elements.get('vClimaKpiPerdidos').textContent,'130,0');
  t.histories.get('a')[129]={...t.histories.get('a')[129],houveProducao:'parcial',percentualProducaoDia:50};
  await vm.runInContext('_eCarregarHistorico("a",true)',t.ctx);
  await vm.runInContext('visitanteInicializar("a")',t.ctx);
  assert.equal(t.historyReads(),4);
  assert.equal(t.elements.get('evolClimaKpiPerdidos').textContent,'129,5');
  assert.equal(t.elements.get('vClimaKpiPerdidos').textContent,'129,5');
});

for(const parametrizado of [false,true]) test(`visitante ${parametrizado?'parametrizado':'legado'} lê uma vez; render e galeria não releem histórico`,async()=>{
  const t=contextoVisitante({parametrizado});
  await vm.runInContext('visitanteInicializar("a")',t.ctx);
  assert.equal(t.historyReads(),1);
  assert.equal(t.elements.get('vClimaKpiPerdidos').textContent,'130,0');
  t.ctx.rows=t.histories.get('a');
  vm.runInContext('_eRenderClimaPainel(rows)',t.ctx);
  assert.equal(t.elements.get('evolClimaKpiPerdidos').textContent,'130,0');
  await vm.runInContext('_vRenderHistorico(); _vCarregarClima(); _vCarregarGaleria()',t.ctx);
  assert.equal(t.historyReads(),1);
  // Edição substitui o documento da data; atualização explícita deve buscar a versão nova.
  t.histories.get('a')[129]={...t.histories.get('a')[129],houveProducao:'parcial',percentualProducaoDia:50};
  await vm.runInContext('visitanteInicializar("a")',t.ctx);
  assert.equal(t.historyReads(),2);
  assert.equal(t.elements.get('vClimaKpiPerdidos').textContent,'129,5');
  await vm.runInContext('visitanteInicializar("b")',t.ctx);
  assert.equal(t.historyReads(),3);
  assert.equal(t.elements.get('vClimaKpiPerdidos').textContent,'0,5');
  assert.equal(vm.runInContext('_vHistoricoObraId',t.ctx),'b');
  vm.runInContext('_vLimparHistorico()',t.ctx);
  assert.equal(vm.runInContext('_vClimaHist.length',t.ctx),0);
  assert.equal(vm.runInContext('_vHistoricoObraId',t.ctx),null);
  await vm.runInContext('visitanteInicializar("a")',t.ctx);
  assert.equal(t.historyReads(),4);
  assert.equal(t.elements.get('vClimaKpiPerdidos').textContent,'129,5');
});

test('resposta atrasada não restaura histórico após troca de obra ou logout',async()=>{
  const t=contextoVisitante(),release=t.hold('a');
  const pending=vm.runInContext('visitanteInicializar("a")',t.ctx);
  while(!t.historyReads()) await new Promise(resolve=>setImmediate(resolve));
  await vm.runInContext('visitanteInicializar("b")',t.ctx);
  release();await pending;
  assert.equal(vm.runInContext('_vHistoricoObraId',t.ctx),'b');
  assert.equal(t.elements.get('vClimaKpiPerdidos').textContent,'0,5');
  const releaseLogout=t.hold('a'),before=t.historyReads();
  const late=vm.runInContext('visitanteInicializar("a")',t.ctx);
  while(t.historyReads()===before) await new Promise(resolve=>setImmediate(resolve));
  vm.runInContext('_vLimparHistorico()',t.ctx);
  releaseLogout();await late;
  assert.equal(vm.runInContext('_vHistoricoObraId',t.ctx),null);
  assert.equal(vm.runInContext('_vClimaHist.length',t.ctx),0);
  assert.match(trecho('async function logout(){','async function changePassword()'),/_vLimparHistorico\(\)/);
  assert.match(trecho('onAuthStateChanged(auth, async (user)', '  initOffline();'),/_vLimparHistorico\(\)/);
});

test('galeria atrasada não altera a obra atual nem restaura estado após logout',async()=>{
  for(const logout of [false,true]) {
    const t=contextoVisitante();
    await vm.runInContext('visitanteInicializar("a")',t.ctx);
    const release=t.hold('a','evolRegistros'),before=t.reads.length;
    const pending=vm.runInContext('_vCarregarGaleria()',t.ctx);
    while(t.reads.length===before) await new Promise(resolve=>setImmediate(resolve));
    if(logout) vm.runInContext('_vLimparHistorico()',t.ctx);
    else await vm.runInContext('visitanteInicializar("b")',t.ctx);
    t.ctx._vGaleriaRegistros=[{id:'estado-atual'}];
    release();await pending;
    assert.equal(vm.runInContext('_vGaleriaRegistros[0].id',t.ctx),'estado-atual');
  }
});

test('histórico antigo é recalculado na leitura; painéis têm o mesmo total, sem duplicar datas',async()=>{
  const els=new Map();
  const $=id=>id.startsWith('chart')||id==='vChartClima'?null:(els.get(id)||null);
  for(const id of ['evolClimaKpiPerdidos','vClimaKpiPerdidos']) els.set(id,{textContent:''});
  const rows=Array.from({length:130},(_,i)=>({data:`dia-${i}`,houveProducao:'nao',impactoPrazo:false}));
  const motivo='Visita dos agentes da seguradora e do perito para avaliação dos danos';
  rows.push({data:'2026-10-06',houveProducao:'nao',percentualProducaoDia:0,horasParadas:8,causaDia:'outro',motivoParalisacao:motivo,observacao:'Preservar',impactoPrazo:false});
  rows.push({...rows.at(-1)});
  rows.push({data:'2026-10-07',houveProducao:'parcial',percentualProducaoDia:50,impactoPrazo:false});
  const before=structuredClone(rows),queries=[];
  const ctx=contextoPerda({$,rows,_eClimaHist:[],_vClimaHist:[],_eClimaPrintUrl:'',_vClimaPrintUrl:'',_vPosicionarCardClima:()=>{},db:{},_eObraId:'obra-a',_vObraId:'obra-a',_vHistoricoObraId:'obra-a',console,
    collection:(_db,...path)=>path.join('/'),orderBy:(...args)=>args,query:(...args)=>{queries.push(args);return args;},
    getDocs:async()=>({forEach:fn=>rows.forEach(row=>fn({data:()=>row}))}),
    setDoc:()=>assert.fail('Leitura não pode regravar dados'),fetch:()=>assert.fail('Sem rede')});
  vm.runInContext(trecho('function _eRenderClimaPainel(rows){','function evolVerClimaFoto(')+trecho('function _vCarregarClima(){','function vVerClimaAmp()'),ctx);
  for(const role of ['ADMIN','RESPONSAVEL']) {
    ctx.currentRole=role;
    vm.runInContext('_eRenderClimaPainel(rows)',ctx);
    assert.equal(els.get('evolClimaKpiPerdidos').textContent,'131,5');
  }
  ctx._vClimaHist=rows;
  await vm.runInContext('_vCarregarClima()',ctx);
  assert.equal(els.get('vClimaKpiPerdidos').textContent,'131,5');
  assert.equal(queries.length,0,'Renderização reutiliza histórico e não consulta Firestore');
  assert.deepEqual(rows,before,'Data, motivo, horas, causa, observações e impacto preservados');
  ctx.rows=[{data:'2026-10-06',houveProducao:'nao'},{data:'2026-10-06',houveProducao:'parcial',percentualProducaoDia:50}];
  assert.equal(vm.runInContext('_eTotalPerdaDias(rows)',ctx),0.5,'Versão editada substitui a anterior na soma');
  assert.equal(vm.runInContext('_eTotalPerdaDias([{data:"2026-10-06",houveProducao:"nao"}])',ctx),1,'Outra obra tem sua soma independente');
});

test('fechar e corrigir diário retroativo prepara o informe com a data fechada e dados mais recentes do servidor',async()=>{
  const dom=new JSDOM(source),el=id=>dom.window.document.getElementById(id),data='2026-10-05',obraId='obra-real-simulada';
  const docs=new Map([[`obras/${obraId}`,{nome:'Obra simulada',cidade:'Inimutaba',estado:'MG'}]]),writes=[],reads=[],previews=[];
  const doc=(_db,...segments)=>({path:segments.join('/')});
  const collection=(_db,...segments)=>({path:segments.join('/')});
  const getDocFromServer=async ref=>{reads.push(ref.path);const value=docs.get(ref.path);return{exists:()=>Boolean(value),data:()=>value};};
  const getDocsFromServer=async ref=>{reads.push(ref.path);return{docs:(docs.get(ref.path)||[]).map(record=>({id:record.id,data:()=>record}))};};
  const prepare=async(id,date)=>{
    const saved=await carregarDadosInformeDia({db:{},obraId:id,data:date,sdk:{doc,collection,getDocFromServer,getDocsFromServer}});
    const diario=saved.diario;
    const report=montarInformeDia({data:date,local:saved.obra,responsavel:'Joana',diario});
    const photos=selecionarFotosDoDia(saved.registros,date);
    previews.push({date,report,photos});
  };
  const ctx=vm.createContext({document:dom.window.document,$:el,db:{},_eObraId:obraId,_eClimaPrintFile:null,_eHojeStr:()=> '2026-10-06',
    validarDataReferencia,motivoBloqueioObra,doc,collection,getDocFromServer,getDocsFromServer,setDoc:async(ref,value)=>{writes.push(ref.path);docs.set(ref.path,{...docs.get(ref.path),...value});},serverTimestamp:()=>({serverTime:true}),
    currentUser:{uid:'responsavel'},currentProfile:{nome:'Joana'},currentRole:'ADMIN',_ePodeEditarDiario:()=>true,
    evolAtualizarCamposDiario:()=>{},_eCarregarHistorico:async()=>{},closeModal:()=>{},toast:()=>{},console,
    evolObrasPermitidasInforme:()=>[{value:obraId}],canEvoluirObra:()=>true,
    carregarDadosInformeDia,diarioDoDiaExiste,montarInformeDia,selecionarFotosDoDia,carregarArquivosFotos:async fotos=>({fotos,arquivos:[],falhas:[]}),criarZipFotos:async()=>null,
    abrirPreviaInformeDia:args=>{previews.push({date:args.report.message,report:args.report,fotos:args.fotos});return{};},
  });
  vm.runInContext(trecho('async function evolValidarPermissaoInforme(', 'function evolNomeResponsavelInforme(){')+trecho('function evolNomeResponsavelInforme(){','async function evolPrepararInformeDia(){')+trecho('async function evolPrepararInformeSalvo(', '\n  function _epResumo'),ctx);
  vm.runInContext(trecho('async function evolAbrirDiario(){','async function evolCarregarDiarioData(){')+trecho('async function evolCarregarDiarioData(){','function evolAtualizarCamposDiario()')+trecho('function evolAtualizarCamposDiario(){','function evolClimaFotoSel(')+trecho('async function evolSalvarDiario(){','// ─── Clima Visitante'),ctx);
  const photos=[
    {id:'retro-antes',data,fotoUrl:'https://img.test/antes.jpg'},
    {id:'retro-depois',data,fotoUrlDepois:'https://img.test/depois.jpg'},
    {id:'outro-dia',data:'2026-10-06',fotoUrl:'https://img.test/outro-dia.jpg'},
  ];
  docs.set(`obras/${obraId}/evolRegistros`,photos);
  el('evolDiaData').value=data;el('evolDiaObs').value='Observação original do dia 05';el('evolDiaMotivo').value='Ocorrência original';
  await vm.runInContext('evolSalvarDiario()',ctx);
  assert.deepEqual(writes,[`obras/${obraId}/evolHistorico/${data}`]);
  assert.equal(docs.get(`obras/${obraId}/evolHistorico/${data}`).observacao,'Observação original do dia 05');
  assert.equal(previews.length,1);
  assert.match(previews[0].report.message,/\*Data:\* 05\/10\/2026/);
  assert.match(previews[0].report.message,/Observação original do dia 05/);
  assert.match(previews[0].report.message,/Ocorrência original/);
  assert.deepEqual(previews[0].fotos.map(f=>f.id),['retro-antes:fotoUrl','retro-depois:fotoUrlDepois']);
  assert.ok(reads.includes(`obras/${obraId}/evolHistorico/${data}`));

  await vm.runInContext('evolAbrirDiario()',ctx);
  assert.equal(el('evolDiaData').value,data,'reabrir o diário preserva a data retroativa');
  assert.equal(el('evolDiaObs').value,'Observação original do dia 05','reabertura lê a versão do servidor');
  el('evolDiaObs').value='Observação corrigida do dia 05';el('evolDiaMotivo').value='Ocorrência corrigida';
  await vm.runInContext('evolSalvarDiario()',ctx);
  assert.equal(previews.length,2);
  assert.equal(docs.get(`obras/${obraId}/evolHistorico/${data}`).observacao,'Observação corrigida do dia 05');
  assert.match(previews[1].report.message,/\*Data:\* 05\/10\/2026/);
  assert.match(previews[1].report.message,/Observação corrigida do dia 05/);
  assert.match(previews[1].report.message,/Ocorrência corrigida/);
  assert.deepEqual(previews[1].fotos.map(f=>f.id),['retro-antes:fotoUrl','retro-depois:fotoUrlDepois']);
  assert.ok(reads.filter(path=>path===`obras/${obraId}/evolHistorico/${data}`).length>=3);
  dom.window.close();
});

test('data vazia não é trocada por hoje ao consultar ou salvar diário',async()=>{
  const dom=new JSDOM(source),el=id=>dom.window.document.getElementById(id),toasts=[];
  const ctx=vm.createContext({document:dom.window.document,$:el,_eObraId:'obra',_eHojeStr:()=> '2026-10-06',validarDataReferencia,toast:message=>toasts.push(message)});
  vm.runInContext(trecho('async function evolCarregarDiarioData(){','function evolAtualizarCamposDiario()')+trecho('function evolConsultarDiarioData(){','async function evolSalvarDiario()')+trecho('async function evolSalvarDiario(){','// ─── Clima Visitante'),ctx);
  el('evolDiaData').value='';el('evolClimaConsultaData').value='';
  await vm.runInContext('evolCarregarDiarioData()',ctx);
  vm.runInContext('evolConsultarDiarioData()',ctx);
  await vm.runInContext('evolSalvarDiario()',ctx);
  assert.equal(el('evolDiaData').value,'');
  assert.equal(toasts.length,3);
  assert.match(toasts.join(' '),/data.*diário|data de referência/i);
  dom.window.close();
});



