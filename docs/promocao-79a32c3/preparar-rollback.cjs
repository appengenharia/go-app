const fs=require('fs'),path=require('path'),cp=require('child_process');
const root=path.resolve(__dirname,'../..'),target=path.join(root,'tests','.runtime','rollback-79a32c3');fs.mkdirSync(target,{recursive:true});
let html=cp.execFileSync('git',['show','4d31ac5b268fba54fbd86b76817e16a25c297464:index.html'],{cwd:root,encoding:'utf8',maxBuffer:5e6}).replace(/\r\n/g,'\n');
for(const [old,next] of [
 ['const rows = snap.docs.map(d=>({id:d.id,...d.data()}));','const rows = snap.docs.map(d=>({id:d.id,...d.data()})).filter(l=>!l.cancelado);'],
 ['let lancs = snap.docs.map(d => d.data());','let lancs = snap.docs.map(d => d.data()).filter(l=>!l.cancelado);'],
 ["return snap.docs.map(d => ({ id: d.id, ...d.data() }));","return snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(l=>!l.cancelado);"],
 ['if(!l.data) return;','if(!l.data || l.cancelado) return;'],
 ['    uploadPhoto: async file => {','    uploadPhoto: async file => { throw new Error("Evolução em manutenção. Dados preservados.");'],
 ]){if(!html.includes(old))throw Error('Rollback: trecho ausente '+old);html=html.replace(old,next);}
const names=['saveLanc','editLanc','deleteLanc','syncPendingLancs','evolSalvarReg','evolSalvarDiario','_evolApagarFotoAdm','_evolTrocarFotoAdm','vApagarFoto','vTrocarFoto'];
for(const name of names)if(!new RegExp('function '+name+'\\(').test(html))throw Error('Rollback: função ausente '+name);
html=html.replace('  window.App = {',`  ${names.join(' = ')} = async () => toast("Notas/evolução em manutenção. Pendências e dados preservados.",false);\n  window.App = {`);
if(!html.includes('Notas/evolução em manutenção. Pendências'))throw Error('Rollback: export ausente');
fs.writeFileSync(path.join(target,'index.html'),html);
let rules=fs.readFileSync(path.join(root,'firestore.rules'),'utf8');const start=rules.indexOf('    function obraGravavel('),end=rules.indexOf('    function podeNota(',start);
rules=rules.slice(0,start)+'    function obraGravavel(obraId) { return false; }\n'+rules.slice(end);
for(const name of ['notaUsuarios','notaCodigosUsuarios']){const a=rules.indexOf('match /'+name+'/'),b=rules.indexOf('allow create: if ',a);rules=rules.slice(0,b)+rules.slice(b).replace('allow create: if ','allow create: if false && ');}
fs.writeFileSync(path.join(target,'firestore.rules'),rules);
fs.writeFileSync(path.join(target,'firebase.json'),JSON.stringify({firestore:{rules:'firestore.rules'}},null,2));
fs.writeFileSync(path.join(target,'sw.js'),fs.readFileSync(path.join(root,'sw.js'),'utf8').replace('go-v5-notas-prod','go-v5-notas-prod-rollback'));
console.log('Rollback preparado em '+target+'; nenhum dado ou deploy alterado.');
