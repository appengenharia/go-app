import test from 'node:test';
import assert from 'node:assert/strict';
import { calcularTotaisDespesas, filtrarLancamentos, limitarLancamentosPorPermissao, linhasResumoDespesas, ordenarLancamentosRecentes, tipoDespesa, TIPO_DESPESA } from '../despesas.mjs';

const rows = [
  { id: 'new', obra_id: 'inimutaba', data: '2026-04-12', colaborador_uid: 'u1', reembolsavel: true, valor: 25, comprovante: { url: 'new.pdf' } },
  { id: 'legacy', obra_id: 'inimutaba', data: '2026-04-12', colaborador_uid: 'u1', valor: 10, comprovante: { url: 'legacy.pdf' } },
  { id: 'other', obra_id: 'outra', data: '2026-04-13', colaborador_uid: 'u2', reembolsavel: false, valor: 100 },
  { id: 'no-date', obra_id: 'inimutaba', colaborador_uid: 'u1', reembolsavel: false, valor: 5 },
];

test('classificação histórica ausente é Empresa; filtros obra, mês, colaborador e tipo se combinam', () => {
  assert.equal(tipoDespesa(rows[1]), TIPO_DESPESA.EMPRESA);
  const comum = { obraId: 'inimutaba', de: '2026-04-01', ate: '2026-04-30', colaboradorUid: 'u1' };
  assert.deepEqual(filtrarLancamentos(rows, { ...comum, tipo: TIPO_DESPESA.REEMBOLSAVEIS }).map(r => r.id), ['new']);
  assert.deepEqual(filtrarLancamentos(rows, { ...comum, tipo: TIPO_DESPESA.EMPRESA }).map(r => r.id), ['legacy']);
  assert.deepEqual(filtrarLancamentos(rows, { ...comum, tipo: TIPO_DESPESA.TODAS }).map(r => r.id), ['new', 'legacy']);
});

test('lista inclui registros sem criadoEm e ordena por data de referência quando não há timestamp', () => {
  const sorted = ordenarLancamentosRecentes([
    { id: 'old', data: '2025-02-01' },
    { id: 'missing-date' },
    { id: 'newer', data: '2025-10-01' },
  ]);
  assert.deepEqual(sorted.map(r => r.id), ['newer', 'old', 'missing-date']);
});

test('permissões incluem todas as obras alocadas; legado com obra_id continua compatível', () => {
  assert.deepEqual(limitarLancamentosPorPermissao(rows, 'USER', { obras: ['inimutaba', 'outra'], obra_id: 'inimutaba' }).map(r => r.id), rows.map(r => r.id));
  assert.deepEqual(limitarLancamentosPorPermissao(rows, 'USER', { obra_id: 'inimutaba' }).map(r => r.id), ['new', 'legacy', 'no-date']);
  assert.equal(limitarLancamentosPorPermissao(rows, 'ADMIN', {}).length, 4);
});

test('totais e subtotais batem com a seleção; lista vazia zera tudo', () => {
  const all = filtrarLancamentos(rows, { obraId: 'inimutaba', tipo: TIPO_DESPESA.TODAS });
  const totals = calcularTotaisDespesas(all);
  assert.deepEqual(totals, { reembolsaveis: 25, empresa: 15, geral: 40, quantidade: 3 });
  assert.deepEqual(linhasResumoDespesas(totals, TIPO_DESPESA.TODAS).map(x => x.value), [25, 15, 40]);
  const company = calcularTotaisDespesas(filtrarLancamentos(rows, { obraId: 'inimutaba', tipo: TIPO_DESPESA.EMPRESA }));
  assert.deepEqual(linhasResumoDespesas(company, TIPO_DESPESA.EMPRESA), [{ label: 'Total Empresa', value: 15 }]);
  assert.deepEqual(calcularTotaisDespesas([]), { reembolsaveis: 0, empresa: 0, geral: 0, quantidade: 0 });
});

import fs from 'node:fs';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
import * as despesas from '../despesas.mjs';
const source = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
function block(start, end) {
  const a=source.indexOf(start), b=source.indexOf(end,a);
  assert.ok(a>=0 && b>a); return source.slice(a,b);
}
for (const role of ['ADMIN','USER']) for (const tipo of Object.values(TIPO_DESPESA)) {
  test(`lista, relatório, PDF e comprovantes usam a mesma seleção: ${role}/${tipo}`, async()=>{
    const fixture=rows.map(r=>({...r,descricao:'nota-'+r.id,categoria:'Outros gastos',colaborador_nome:'Pessoa'}));
    const original=JSON.stringify(fixture);
    const dom=new JSDOM(`<div id="lancList"></div><div id="lancResumoTipo"></div><div id="relPreview"></div><div id="relPreviewContent"></div>
      <input id="filterLancObra"><input id="filterLancTipo" value="${tipo}"><select id="relObra"><option value="">Todas</option></select>
      <input id="relColab"><input id="relDe"><input id="relAte"><input id="relTipo" value="${tipo}">`);
    const $=id=>dom.window.document.getElementById(id);
    const tables=[],messages=[],queries=[];let saved=false;
    const pdf=new Proxy({internal:{getNumberOfPages:()=>1},lastAutoTable:{finalY:60}},{get:(target,key)=>key in target?target[key]:(...args)=>{
      if(key==='autoTable') tables.push(args[0]); if(key==='save')saved=true;
    }});
    const ctx=vm.createContext({...despesas,$,document:dom.window.document,db:{},currentRole:role,currentUser:{uid:'u1'},
      loadProfile:async()=>({obras:['inimutaba']}),collection:(_,name)=>{queries.push(name);return name;},
      getDocs:async()=>({docs:fixture.map(r=>({id:r.id,data:()=>r}))}),
      window:{jspdf:{jsPDF:function(){return pdf;}}},CATEGORIAS_CORES:{'Outros gastos':'#000'},setMsg:(_,text)=>messages.push(text),console,
    });
    vm.runInContext(block('  let allLancs = [];','  async function updateStatTotal()')+block('  async function getLancsFiltrados()', '  async function loadEmailConfig()'),ctx);
    await vm.runInContext('loadLancs()',ctx);await vm.runInContext('previewRelatorio()',ctx);await vm.runInContext('gerarPDF()',ctx);
    const expected=filtrarLancamentos(limitarLancamentosPorPermissao(fixture,role,{obras:['inimutaba']}),{tipo});
    assert.equal(saved,true,messages.join('\n'));
    assert.equal($('lancList').querySelectorAll('.lanc-item').length,expected.length);
    for(const row of fixture){
      const included=expected.some(r=>r.id===row.id);
      assert.equal($('lancList').textContent.includes(row.descricao),included);
      assert.equal($('relPreviewContent').textContent.includes(row.descricao),included);
      assert.equal(JSON.stringify(tables).includes(row.descricao),included);
      if(row.comprovante)for(const id of ['lancList','relPreviewContent']) assert.equal(Boolean($(id).querySelector(`a[href="${row.comprovante.url}"]`)),included);
    }
    const total=calcularTotaisDespesas(expected).geral.toLocaleString('pt-BR',{minimumFractionDigits:2});
    assert.ok($('lancResumoTipo').textContent.includes(total));
    assert.ok($('relPreviewContent').textContent.includes(total));
    assert.ok(JSON.stringify(tables).includes(total));
    assert.deepEqual(queries,['lancamentos','lancamentos','lancamentos']);
    assert.equal(JSON.stringify(fixture),original);
    dom.window.close();
  });
}
