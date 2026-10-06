import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {chromium} from 'playwright';
fs.mkdirSync('tests/.runtime',{recursive:true});
const root=process.cwd(),html=fs.readFileSync('index.html','utf8');
const dom=new JSDOM(html);
const styles=[...dom.window.document.querySelectorAll('style')].map(x=>x.outerHTML).join('\n');
const card=dom.window.document.getElementById('filterLancObra').closest('.card').outerHTML;
const server=http.createServer((req,res)=>{
  const name=decodeURIComponent((req.url||'/').split('?')[0]).slice(1);
  if(!name){res.setHeader('Content-Type','text/html');res.end(`<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1">${styles}<body>${card}</body>`);return;}
  if(!/^[\w.-]+\.mjs$/.test(name)){res.writeHead(404);res.end();return;}
  res.setHeader('Content-Type','text/javascript');res.end(fs.readFileSync(path.join(root,name)));
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
try{
  browser=await chromium.launch({channel:'msedge',headless:true});
  const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  for(const width of [1440,390,320]){
    await page.setViewportSize({width,height:900});
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.evaluate(async()=>{
      const {abrirPreviaInformeDia}=await import('/evolucao-compartilhamento-ui.mjs');
      const {montarInformeDia,criarZipFotos}=await import('/evolucao-compartilhamento.mjs');
      const canvas=document.createElement('canvas');canvas.width=180;canvas.height=110;const ctx=canvas.getContext('2d');ctx.fillStyle='#cbd5e1';ctx.fillRect(0,0,180,110);ctx.fillStyle='#334155';ctx.font='16px sans-serif';ctx.fillText('Foto de teste',35,60);const blob=await new Promise(resolve=>canvas.toBlob(resolve));const file=new File([blob],'antes.png',{type:'image/png'});
      window.shareCalls=[];
      window.preview=abrirPreviaInformeDia({report:montarInformeDia({data:'2024-11-03',local:{cidade:'Inimutaba',estado:'MG'},responsavel:'Responsável de teste',diario:{observacao:'Execução de bacia',motivoParalisacao:'Sem ocorrência'}}),
        fotos:[{id:'1',file,unidade:'Torre A',servico:'Execução de bacia',tipo:'Antes'},{id:'2',file,unidade:'Torre A',servico:'Execução de bacia',tipo:'Depois'}],
        zip:await criarZipFotos([file]),navigatorObject:{canShare:()=>true,share:async args=>window.shareCalls.push({text:args.text,count:args.files.length})}});
    });
    const dims=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,modal:document.querySelector('[data-informe-preview] .modal').getBoundingClientRect().toJSON(),shares:shareCalls.length}));
    assert.equal(dims.shares,0);assert.ok(dims.scroll<=width,`Transbordamento em ${width}: ${JSON.stringify(dims)}`);
    assert.ok(dims.modal.width<=width);
    await page.locator('[data-share-text]').fill('Texto revisado');await page.locator('[data-native-share]').click();
    assert.deepEqual(await page.evaluate(()=>shareCalls),[{text:'Texto revisado',count:2}]);
    await page.screenshot({path:`tests/.runtime/informe-${width}.png`});
    await page.locator('[data-close]').click();
    const listWidth=await page.evaluate(()=>document.documentElement.scrollWidth);
    assert.ok(listWidth<=width,`Filtros transbordam em ${width}: ${listWidth}`);
    console.log(`Desktop/celular ${width}: filtros e prévia cabem; texto editado e 2 arquivos só compartilhados após clique (API simulada).`);
  }
  assert.deepEqual(errors,[]);
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
