// Contrato compartilhado entre UI, transação e testes. Não acessa projetos remotos sozinho.
export function motivoBloqueioObra(obra) {
  if (!obra) return 'Obra não encontrada. Pendência preservada.';
  if (obra.ativa === false) return 'Obra desativada. Pendência preservada.';
  const status = obra.statusOperacional || 'ativa';
  if (status !== 'ativa') return `Obra ${status}. Lançamentos bloqueados; pendência preservada.`;
  return '';
}
export function validarPermissaoNota(perfil, obraId, obra) {
  const motivo = motivoBloqueioObra(obra);
  if (motivo) throw new Error(motivo);
  if (!perfil || perfil.ativo === false) throw new Error('Usuário inativo ou sessão expirada.');
  if (perfil.role === 'ADMIN') return;
  const alocadas = [...(Array.isArray(perfil.obras) ? perfil.obras : []), perfil.obra_id];
  if (perfil.role !== 'USER' || !perfil.canLancamentos || !alocadas.includes(obraId))
    throw new Error('Sem permissão para lançar notas nesta obra.');
}
export function codigoInicial(nome) {
  return String(nome || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3).padEnd(3, 'X');
}
export function candidatoCodigo(inicial, tentativa) {
  const base = [...inicial].reduce((n, c) => n * 26 + c.charCodeAt(0) - 65, 0);
  let n = (base + tentativa) % 17576;
  return String.fromCharCode(65 + Math.floor(n / 676), 65 + Math.floor(n / 26) % 26, 65 + n % 26);
}
export function identificadorNota(obra, usuario, sequencia) {
  if (!/^[A-Z]{3}$/.test(obra) || !/^[A-Z]{3}$/.test(usuario) || !Number.isSafeInteger(sequencia) || sequencia < 1)
    throw new Error('Código ou sequência inválida.');
  return `${obra}_${usuario}_${String(sequencia).padStart(6, '0')}`;
}
export function escaparTextoNota(value) {
  return String(value ?? '').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
export function rotuloNota(l) { return l?.identificador || 'Legado · ' + (l?.id || 'sem ID'); }
export function nomeExportacaoNota(l) {
  const ext = l?.comprovante?.tipo === 'pdf' ? 'pdf' : l?.comprovante?.mime === 'image/png' ? 'png' : l?.comprovante?.mime === 'image/jpeg' ? 'jpg' : (l?.comprovante?.nome?.match(/\.(png|jpe?g|webp)$/i)?.[1] || 'jpg');
  return `${l?.identificador || l?.id || 'comprovante'}.${ext}`;
}
export const PDF_ADIADO = 'Envio de PDF bloqueado nesta versão. Use JPG ou PNG. PDFs existentes e pendências são preservados.';
export function comprovantePdf(anexo) {
  return anexo?.tipo === 'pdf' || anexo?.mime === 'application/pdf' || /\.pdf$/i.test(anexo?.nome || '');
}
export async function motivoPdfPendente(record) {
  const anexo = record.anexoLocal;
  if ((!record.editar && comprovantePdf(record.comprovante)) || comprovantePdf(anexo)) return PDF_ADIADO;
  if (anexo?.blob) {
    const head = new Uint8Array(await anexo.blob.slice(0,5).arrayBuffer());
    if (String.fromCharCode(...head) === '%PDF-') return PDF_ADIADO;
  }
  return '';
}
export async function validarAnexo(file) {
  if (!file || file.size <= 0 || file.size > 10 * 1024 * 1024) throw new Error('Anexo vazio ou maior que 10 MB.');
  const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const ascii = String.fromCharCode(...head);
  if (ascii.startsWith('%PDF-') || file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '')) throw new Error(PDF_ADIADO);
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return { tipo: 'imagem', mime: 'image/jpeg', recurso: 'image' };
  if (head.slice(0,8).join(',') === '137,80,78,71,13,10,26,10') return { tipo: 'imagem', mime: 'image/png', recurso: 'image' };
  throw new Error('Selecione um JPG ou PNG válido.');
}
export function validarDestinoAnexo(data, { cloud, recurso, assetFolder }) {
  const url = new URL(data.secure_url);
  if (url.protocol !== 'https:' || url.hostname !== 'res.cloudinary.com' || url.username || url.password ||
      !url.pathname.startsWith(`/${cloud}/${recurso}/upload/`) || data.resource_type !== recurso)
    throw new Error('Destino Cloudinary divergente. Pendência preservada.');
  const pastaEfetiva = data.asset_folder ?? data.folder;
  if (pastaEfetiva !== assetFolder)
    throw new Error('Pasta efetiva do upload não confirmada. Pendência preservada.');
  return pastaEfetiva;
}
export async function enviarAnexo(file, { cloud, preset, folder = 'go', assetFolder, fetchImpl = fetch, timeoutMs = 30000 }) {
  const meta = await validarAnexo(file);
  const form = new FormData();
  // Preserva os bytes e o nome original da imagem.
  form.append('file', file, file.name); form.append('upload_preset', preset); form.append('folder', folder);
  if (assetFolder) form.append('asset_folder', assetFolder);
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`https://api.cloudinary.com/v1_1/${cloud}/${meta.recurso}/upload`, {method:'POST',body:form,signal:controller.signal});
    const data = await response.json();
    if (!response.ok || data.error || !/^https:\/\//.test(data.secure_url || '')) throw new Error(data.error?.message || 'Upload não confirmado.');
    const destino=new URL(data.secure_url);
    if(destino.hostname !== 'res.cloudinary.com' || !destino.pathname.startsWith(`/${cloud}/${meta.recurso}/upload/`) || data.resource_type !== meta.recurso) throw new Error('Destino Cloudinary divergente. Pendência preservada.');
    if (assetFolder) validarDestinoAnexo(data,{cloud,recurso:meta.recurso,assetFolder});
    return {url:data.secure_url,tipo:meta.tipo,nome:file.name,mime:meta.mime,tamanho:file.size,public_id:data.public_id || '',resource_type:data.resource_type || meta.recurso,
      ...(assetFolder ? {asset_folder:data.asset_folder ?? data.folder,cloud_name:cloud,upload_preset:preset,asset_id:data.asset_id || ''} : {})};
  } finally { clearTimeout(timer); }
}
const campos = ['data','categoria','descricao','valor','reembolsavel','comprovante'];
function entradaValida(entrada) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(entrada.data || '') || !entrada.categoria || !entrada.descricao?.trim() || !Number.isFinite(entrada.valor) || entrada.valor <= 0 || typeof entrada.reembolsavel !== 'boolean') throw new Error('Preencha os dados válidos da nota.');
  return Object.fromEntries(campos.map(k=>[k, entrada[k] ?? null]));
}
export function criarStoreNotas(sdk) {
  const {doc,collection,runTransaction,serverTimestamp,getDocFromServer} = sdk;
  const novoId = db => doc(collection(db, 'lancamentos')).id;
  async function codigoLivre(tx, db, colecao, inicial) {
    for (let i=0;i<17576;i++) {
      const codigo=candidatoCodigo(inicial,i), ref=doc(db,colecao,codigo);
      if (!(await tx.get(ref)).exists()) return {codigo,ref};
    }
    throw new Error('Todos os códigos de três letras estão ocupados. Nenhuma nota foi gravada.');
  }
  async function salvar({db,uid,id,obraId,entrada,editar=false,revisaoEsperada=0,operacaoId=id}) {
    if (!uid || !id || !operacaoId) throw new Error('Sessão ou operação inválida.');
    // Rules podem negar uma transação obsoleta antes da checagem de versão no emulador.
    // Repetimos somente se uma leitura realmente mudou no servidor; nunca ignoramos a autorização.
    for(let tentativa=0;tentativa<12;tentativa++) {
      const observadas=new Map();
      try { return await runTransaction(db,async originalTx=>{
      const tx={set:(...args)=>originalTx.set(...args),get:async ref=>{
        const snap=await originalTx.get(ref); observadas.set(ref.path,{ref,valor:JSON.stringify(snap.exists()?snap.data():null)});return snap;
      }};
      const ref=doc(db,'lancamentos',id);
      const [notaSnap,perfilSnap,obraSnap]=await Promise.all([tx.get(ref),tx.get(doc(db,'usuarios',uid)),tx.get(doc(db,'obras',obraId))]);
      const anterior=notaSnap.exists()?notaSnap.data():null, perfil=perfilSnap.data(), obra=obraSnap.data();
      if (anterior && ((!editar && anterior.operacaoId === operacaoId) || (editar && anterior.ultimaOperacaoId === operacaoId))) {
        if (anterior.colaborador_uid !== uid && perfil?.role !== 'ADMIN') throw new Error('Operação pertence a outro usuário.');
        return {...anterior,id}; // confirmação perdida: zero gravações e zero incrementos
      }
      validarPermissaoNota(perfil,obraId,obra);
      const dados=entradaValida(entrada);
      const mesmoComprovante = editar && anterior && JSON.stringify(dados.comprovante) === JSON.stringify(anterior.comprovante ?? null);
      if (!mesmoComprovante && dados.comprovante &&
          (comprovantePdf(dados.comprovante) || dados.comprovante.tipo !== 'imagem' || !['image/jpeg','image/png'].includes(dados.comprovante.mime)))
        throw new Error(comprovantePdf(dados.comprovante) ? PDF_ADIADO : 'Novos comprovantes devem ser JPG ou PNG.');
      if (perfil.role !== 'ADMIN' && !dados.comprovante?.url) throw new Error('Anexe o comprovante para continuar.');
      if (editar) {
        if (!anterior || anterior.cancelado || anterior.obra_id !== obraId || (anterior.colaborador_uid !== uid && perfil.role !== 'ADMIN')) throw new Error('Nota indisponível para edição ou obra alterada.');
        if ((anterior.revisaoNota || 0) !== revisaoEsperada) throw new Error('Nota alterada em outra sessão. Reabra antes de editar.');
        const value={...anterior,...dados,revisaoNota:revisaoEsperada+1,ultimaOperacaoId:operacaoId,atualizadoEm:serverTimestamp(),atualizadoPor:uid};
        tx.set(ref,value); return {...value,id};
      }
      if (anterior) throw new Error('ID técnico já utilizado. Pendência preservada.');
      const obraRef=doc(db,'notaObras',obraId), usuarioRef=doc(db,'notaUsuarios',uid);
      const [contadorSnap,codigoUsuarioSnap]=await Promise.all([tx.get(obraRef),tx.get(usuarioRef)]);
      const contador=contadorSnap.data(), usuario=codigoUsuarioSnap.data();
      const novoCodigoObra=contador?null:await codigoLivre(tx,db,'notaCodigosObras',codigoInicial(obra.siglaNotas || obra.nome));
      const novoCodigoUsuario=usuario?null:await codigoLivre(tx,db,'notaCodigosUsuarios',codigoInicial(perfil.nome));
      const sequencia=(contador?.ultimaSequencia || 0)+1;
      const codigoObra=contador?.codigo || novoCodigoObra.codigo, codigoUsuario=usuario?.codigo || novoCodigoUsuario.codigo;
      const identificador=identificadorNota(codigoObra,codigoUsuario,sequencia);
      const value={...dados,obra_id:obraId,obra_nome:obra.nome || obraId,colaborador_uid:uid,colaborador_nome:perfil.nome || uid,
        identificador,codigoObra,codigoUsuario,sequencia,operacaoId,revisaoNota:1,cancelado:false,criadoEm:serverTimestamp()};
      // Toda leitura ocorre antes destas gravações, inclusive reservas de códigos.
      if(novoCodigoObra) tx.set(novoCodigoObra.ref,{obraId});
      if(novoCodigoUsuario) { tx.set(novoCodigoUsuario.ref,{uid}); tx.set(usuarioRef,{codigo:codigoUsuario}); }
      tx.set(obraRef,{codigo:codigoObra,ultimaSequencia:sequencia,ultimoLancamentoId:id});
      tx.set(ref,value); return {...value,id};
      });
      } catch(e) {
        if(tentativa===11 || !getDocFromServer || !['permission-denied','aborted'].includes(e.code)) throw e;
        let mudou=false;
        for(const {ref,valor} of observadas.values()) {
          const snap=await getDocFromServer(ref);
          if(JSON.stringify(snap.exists()?snap.data():null)!==valor) {mudou=true;break;}
        }
        if(!mudou) throw e;
        await new Promise(resolve=>setTimeout(resolve,25+Math.floor(Math.random()*75)));
      }
    }
  }
  async function apagar({db,uid,id}) {
    return runTransaction(db,async tx=>{
      const ref=doc(db,'lancamentos',id), snap=await tx.get(ref);
      if(!snap.exists()) throw new Error('Nota não encontrada.');
      const nota=snap.data();
      const [perfil,obra]=await Promise.all([tx.get(doc(db,'usuarios',uid)),tx.get(doc(db,'obras',nota.obra_id))]);
      validarPermissaoNota(perfil.data(),nota.obra_id,obra.data());
      if(perfil.data().role!=='ADMIN' && nota.colaborador_uid!==uid) throw new Error('Sem permissão para apagar esta nota.');
      if(nota.cancelado) return;
      if(nota.statusAnexo==='finalizando') throw new Error('Aguarde a conclusão do envio antes de apagar a nota.');
      tx.update(ref,{cancelado:true,canceladoPor:uid,canceladoEm:serverTimestamp()});
    });
  }
  return {novoId,salvar,apagar,cancelar:apagar};
}
