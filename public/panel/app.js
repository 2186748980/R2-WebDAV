const $=s=>document.querySelector(s);
let config=null,currentPath="",nextCursor=null,allItems=[],filterText="",sortMode="name",viewMode="list",globalSearch=false;
const selected=new Set(),uploads=new Map();

function toast(msg){const el=$("#toast");el.textContent=msg;el.classList.add("show");clearTimeout(window.__toast);window.__toast=setTimeout(()=>el.classList.remove("show"),2200)}
async function request(path,options={}){const r=await fetch(path,options);if(!r.ok){let msg="HTTP "+r.status;try{const x=await r.json();msg=x.error||msg}catch{}throw new Error(msg)}return r}
async function apiJson(path,options={}){return (await request(path,options)).json()}
function encPath(p){return encodeURIComponent(p)}
function fmtSize(n){if(n<1024)return n+" B";if(n<1024**2)return(n/1024).toFixed(1)+" KB";if(n<1024**3)return(n/1024**2).toFixed(1)+" MB";return(n/1024**3).toFixed(2)+" GB"}
function fmtDate(v){if(!v)return"—";return new Date(v).toLocaleString("zh-CN",{year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit"})}
function baseUrl(path){return"/panel/api/"+path}
function sortItems(items){
  return [...items].sort((a,b)=>{
    if(a.type!==b.type)return a.type==="directory"?-1:1;
    if(sortMode==="size")return(b.size||0)-(a.size||0)||a.name.localeCompare(b.name);
    if(sortMode==="date")return new Date(b.uploaded||0)-new Date(a.uploaded||0)||a.name.localeCompare(b.name);
    return a.name.localeCompare(b.name,"zh-CN",{numeric:true,sensitivity:"base"});
  });
}
async function loadConfig(){
  try{
    config=await apiJson(baseUrl("config"));
    $("#serverUrl").textContent=config.serverUrl;$("#davUrl").textContent=config.serverUrl;$("#panelUrl").textContent=location.origin+"/panel/";
    $("#username").textContent=config.username;$("#username2").textContent=config.username;$("#settingsUrl").textContent=config.serverUrl;
    $("#fileCount").textContent=config.stats.files;$("#folderCount").textContent=config.stats.folders;
    await loadStats();
    await checkHealth();
  }catch(e){toast("配置加载失败："+e.message)}
}
async function loadStats(){
  try{const s=await apiJson(baseUrl("stats"));$("#totalFiles").textContent=s.files+(s.truncated?"+":"");$("#totalFolders").textContent=s.folders+(s.truncated?"+" :"");$("#totalSize").textContent=fmtSize(s.bytes)+(s.truncated?"+" :"");$("#statsNote").textContent=s.truncated?"统计已扫描前 5000 个对象":"已统计整个存储桶"}catch(e){$("#statsNote").textContent="统计暂时不可用"}}
async function checkHealth(){
  try{const h=await apiJson(baseUrl("health"));$("#healthStatus").textContent="正常 · R2 "+h.latencyMs+" ms";$("#healthStatus").className="badge ok"}catch{$("#healthStatus").textContent="R2 检查失败";$("#healthStatus").className="badge bad"}
}
function setView(name){
  const titles={overview:"概览",files:"文件",upload:"上传",webdav:"WebDAV",settings:"设置"};
  document.querySelectorAll(".view").forEach(v=>v.classList.add("hidden"));$("#view-"+name).classList.remove("hidden");$("#pageTitle").textContent=titles[name]||name;
  document.querySelectorAll(".nav-item").forEach(x=>x.classList.toggle("active",x.dataset.nav===name));
  if(name==="files")loadFiles(currentPath,true);
}
async function loadFiles(path="",reset=true){
  globalSearch=false;$("#globalSearchHint").classList.add("hidden");$("#search").value="";
  try{
    if(reset){allItems=[];nextCursor=null;selected.clear()}
    const q=new URLSearchParams({path,limit:"200"});if(nextCursor)q.set("cursor",nextCursor);
    const data=await apiJson(baseUrl("list")+"?"+q);currentPath=data.path;nextCursor=data.truncated?data.cursor:null;
    allItems=reset?data.items:allItems.concat(data.items);renderFiles(data);
  }catch(e){toast("目录加载失败："+e.message)}
}
function renderFiles(data){
  $("#pathLabel").textContent=currentPath?"/"+currentPath:"/";
  $("#fileSummary").textContent=allItems.length+" 项"+(data.truncated?" · 还有更多":"");
  const bc=$("#breadcrumb");bc.innerHTML="";
  const root=document.createElement("button");root.textContent="根目录";root.onclick=()=>loadFiles("",true);bc.append(root);
  let built="";currentPath.split("/").filter(Boolean).forEach(part=>{built+=(built?"/":"")+part;const p=built;const b=document.createElement("button");b.textContent=" / "+part;b.onclick=()=>loadFiles(p,true);bc.append(b)});
  const list=$("#fileList");list.className="file-list "+viewMode;list.innerHTML="";updateBatchBar();
  const shown=sortItems(allItems.filter(x=>x.name.toLowerCase().includes(filterText.toLowerCase())));
  $("#empty").classList.toggle("hidden",shown.length>0);
  shown.forEach(item=>{
    const row=document.createElement("div");row.className="file-row";
    const check=document.createElement("input");check.type="checkbox";check.checked=selected.has(item.path);check.onchange=()=>{check.checked?selected.add(item.path):selected.delete(item.path);updateBatchBar()};
    const icon=document.createElement("div");icon.className="file-icon";icon.textContent=item.type==="directory"?"📁":fileIcon(item.name);
    const name=document.createElement("div");name.className="file-name";name.title=item.name;name.textContent=item.name;
    name.onclick=()=>item.type==="directory"?loadFiles(item.path,true):preview(item);
    const meta=document.createElement("div");meta.className="file-meta";meta.textContent=item.type==="directory"?"文件夹":fmtSize(item.size);
    const date=document.createElement("div");date.className="file-date";date.textContent=fmtDate(item.uploaded);
    const actions=document.createElement("div");actions.className="row-actions";if(item.type==="file"){actions.append(btn("预览",()=>preview(item)));actions.append(btn("下载",()=>download(item)))}actions.append(btn("更多",e=>menu(e,item)));
    row.append(check,icon,name,meta,date,actions);list.append(row);
  });
  $("#loadMore").classList.toggle("hidden",!nextCursor);$("#selectAll").checked=shown.length>0&&shown.every(x=>selected.has(x.path));$("#selectAll").indeterminate=shown.some(x=>selected.has(x.path))&&!$("#selectAll").checked;
}
function fileIcon(name){const e=name.split(".").pop().toLowerCase();if(["jpg","jpeg","png","gif","webp","svg","bmp"].includes(e))return"🖼️";if(["mp4","webm","mov","m4v"].includes(e))return"🎬";if(["mp3","wav","ogg","m4a","flac"].includes(e))return"🎵";if(["zip","7z","rar","tar","gz"].includes(e))return"📦";if(["json","yaml","yml","xml","toml"].includes(e))return"⚙️";if(["pdf"].includes(e))return"📕";return"📄"}
function btn(label,fn){const b=document.createElement("button");b.textContent=label;b.onclick=fn;return b}
function menu(ev,item){
  const c=$("#context");c.innerHTML="";
  const opts=[["重命名",()=>rename(item)],["复制",()=>copyMove(item,"copy")],["移动",()=>copyMove(item,"move")],["生成分享链接",()=>share(item)],["删除",()=>removeItem(item)]];
  opts.forEach(([label,fn])=>{const b=btn(label,()=>{c.classList.add("hidden");fn()});c.append(b)});
  c.style.left=Math.min(innerWidth-190,ev.clientX)+"px";c.style.top=Math.min(innerHeight-210,ev.clientY)+"px";c.classList.remove("hidden");
}
async function action(payload){await request(baseUrl("action"),{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)})}
async function removeItem(item){if(!confirm("确定删除“"+item.name+"”吗？"+(item.type==="directory"?"\n文件夹内内容也会删除。":"")))return;try{await action({action:"delete",source:item.path});toast("已删除");await loadFiles(currentPath,true)}catch(e){toast("删除失败："+e.message)}}
async function rename(item){const name=prompt("输入新名称",item.name);if(!name||name===item.name)return;const dest=(currentPath?currentPath+"/":"")+name;try{await action({action:"rename",source:item.path,destination:dest});toast("已重命名");await loadFiles(currentPath,true)}catch(e){toast("重命名失败："+e.message)}}
async function copyMove(item,type){const name=prompt((type==="copy"?"复制":"移动")+"到文件名/路径",item.name);if(!name)return;const dest=name.startsWith("/")?name.slice(1):(currentPath?currentPath+"/":"")+name;try{await action({action:type,source:item.path,destination:dest});toast(type==="copy"?"已复制":"已移动");await loadFiles(currentPath,true)}catch(e){toast((type==="copy"?"复制":"移动")+"失败："+e.message)}}
function download(item){location.href=baseUrl("download")+"?path="+encPath(item.path)}
async function share(item){
  if(item.type!=="file")return;
  const choice=prompt("分享有效期：1=1小时，2=24小时，3=7天","2");if(choice===null)return;
  const expiresIn=choice==="1"?3600:choice==="3"?604800:86400;
  try{const data=await apiJson(baseUrl("share"),{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({path:item.path,expiresIn})});await navigator.clipboard.writeText(data.url);toast("分享链接已复制，"+fmtDate(data.expiresAt)+" 过期")}catch(e){toast("生成分享链接失败："+e.message)}
}
async function preview(item){
  const ext=item.name.split(".").pop().toLowerCase(),url=baseUrl("file")+"?path="+encPath(item.path);$("#modalTitle").textContent=item.name;const body=$("#modalBody");body.innerHTML="";
  const image=["jpg","jpeg","png","gif","webp","svg","bmp"].includes(ext),video=["mp4","webm","mov","m4v"].includes(ext),audio=["mp3","wav","ogg","m4a","flac"].includes(ext),text=["txt","md","json","xml","csv","yaml","yml","log","js","css","html","toml"].includes(ext),pdf=ext==="pdf";
  if(image){const x=document.createElement("img");x.src=url;x.className="modal-content";body.append(x)}
  else if(video){const x=document.createElement("video");x.src=url;x.controls=true;x.className="preview-video";body.append(x)}
  else if(audio){const x=document.createElement("audio");x.src=url;x.controls=true;x.className="preview-audio";body.append(x)}
  else if(pdf){const x=document.createElement("iframe");x.src=url;x.className="preview-video";x.style.height="70vh";body.append(x)}
  else if(text){const x=document.createElement("pre");x.className="preview-text";x.textContent="加载中…";body.append(x);try{x.textContent=await(await request(url)).text()}catch(e){x.textContent="预览失败："+e.message}}
  else body.innerHTML='<p class="muted">暂不支持在线预览此类型，请下载。</p><button id="modalDownload">下载文件</button>';
  const d=$("#modalDownload");if(d)d.onclick=()=>download(item);$("#modal").classList.remove("hidden")
}
async function mkdir(){const name=prompt("文件夹名称");if(!name)return;const path=(currentPath?currentPath+"/":"")+name;try{await action({action:"mkdir",path});toast("文件夹已创建");await loadFiles(currentPath,true)}catch(e){toast("创建失败："+e.message)}}

function uploadXhr(url,method,body,headers,onProgress){
  return new Promise((resolve,reject)=>{
    const xhr=new XMLHttpRequest();xhr.open(method,url);Object.entries(headers||{}).forEach(([k,v])=>xhr.setRequestHeader(k,v));
    xhr.upload.onprogress=e=>{if(e.lengthComputable)onProgress?.(e.loaded,e.total)};
    xhr.onload=()=>{if(xhr.status>=200&&xhr.status<300){let data=null;try{data=xhr.responseText?JSON.parse(xhr.responseText):null}catch{}resolve(data)}else reject(Object.assign(new Error("HTTP "+xhr.status),{status:xhr.status}))};
    xhr.onerror=()=>reject(new Error("网络错误"));xhr.onabort=()=>reject(Object.assign(new Error("已取消"),{cancelled:true}));xhr.send(body);
    return xhr;
  });
}
function xhrPromise(url,method,body,headers,onProgress,record){
  return new Promise((resolve,reject)=>{
    const xhr=new XMLHttpRequest();record.xhr=xhr;xhr.open(method,url);Object.entries(headers||{}).forEach(([k,v])=>xhr.setRequestHeader(k,v));
    xhr.upload.onprogress=e=>{if(e.lengthComputable)onProgress?.(e.loaded,e.total)};
    xhr.onload=()=>{record.xhr=null;if(xhr.status>=200&&xhr.status<300){let data=null;try{data=xhr.responseText?JSON.parse(xhr.responseText):null}catch{}resolve(data)}else reject(new Error("HTTP "+xhr.status))};
    xhr.onerror=()=>{record.xhr=null;reject(new Error("网络错误"))};xhr.onabort=()=>{record.xhr=null;reject(Object.assign(new Error("已取消"),{cancelled:true}))};xhr.send(body);
  })
}
function selectFiles(files){[...files].forEach(uploadFile)}
async function uploadFile(file){
  const id=crypto.randomUUID(),item=document.createElement("div");item.className="upload-item";
  item.innerHTML="<div><strong></strong><span>准备中</span></div><div class='progress'><i></i></div><div class='upload-actions'><button data-act='pause'>暂停</button><button data-act='retry'>重试</button><button data-act='cancel'>取消</button></div>";
  item.querySelector("strong").textContent=file.name;$("#uploadQueue").prepend(item);
  const record={id,file,item,paused:false,cancelled:false,xhr:null,retry:0};uploads.set(id,record);
  const setStatus=s=>item.querySelector("span").textContent=s;
  item.querySelector("[data-act=pause]").onclick=()=>{record.paused=!record.paused;item.querySelector("[data-act=pause]").textContent=record.paused?"继续":"暂停";setStatus(record.paused?"已暂停":"继续上传");};
  item.querySelector("[data-act=cancel]").onclick=async()=>{record.cancelled=true;record.xhr?.abort();if(record.uploadId){try{await fetch(baseUrl("upload/multipart")+"?path="+encPath(record.target)+"&uploadId="+encPath(record.uploadId),{method:"DELETE"})}catch{}}setStatus("已取消");item.querySelector(".progress i").style.width="0%";};
  item.querySelector("[data-act=retry]").onclick=()=>{if(record.done||record.cancelled)return;record.retry=0;startUpload(record)};
  startUpload(record);
}
async function waitIfPaused(record){while(record.paused&&!record.cancelled)await new Promise(r=>setTimeout(r,250));if(record.cancelled)throw Object.assign(new Error("已取消"),{cancelled:true})}
async function startUpload(record){
  if(record.running)return;record.running=true;record.cancelled=false;record.retry=0;
  const file=record.file,target=(currentPath?currentPath+"/":"")+file.name;record.target=target;
  try{
    if(file.size>=20*1024*1024)await multipartUpload(record);
    else await simpleUpload(record);
    record.done=true;record.running=false;record.item.querySelector("span").textContent="完成";record.item.querySelector(".progress i").style.width="100%";record.item.querySelector("[data-act=pause]").disabled=true;record.item.querySelector("[data-act=retry]").disabled=true;toast("上传完成："+file.name);
    if(location.hash==="#files")loadFiles(currentPath,true);
  }catch(e){record.running=false;if(e.cancelled){record.item.querySelector("span").textContent="已取消"}else record.item.querySelector("span").textContent="失败："+e.message}
}
async function simpleUpload(record){
  const file=record.file;let attempts=0;
  while(attempts<3){await waitIfPaused(record);try{
    await xhrPromise(baseUrl("upload")+"?path="+encPath(record.target),"PUT",file,{"Content-Type":file.type||"application/octet-stream"},(loaded,total)=>{record.item.querySelector("i").style.width=Math.round(loaded/total*100)+"%"},record);return;
  }catch(e){if(e.cancelled)throw e;if(++attempts>=3)throw e;record.item.querySelector("span").textContent="重试中…";await new Promise(r=>setTimeout(r,600*attempts))}}
}
async function multipartUpload(record){
  const file=record.file,partSize=10*1024*1024,partCount=Math.ceil(file.size/partSize);
  if(record.uploadId){try{await apiJson(baseUrl("upload/multipart")+"?path="+encPath(record.target)+"&uploadId="+encPath(record.uploadId),{method:"DELETE"})}catch{}record.uploadId=null}
  const created=await apiJson(baseUrl("upload/multipart"),{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({path:record.target,contentType:file.type||"application/octet-stream"})});
  record.uploadId=created.uploadId;const parts=[];let completedBytes=0;
  for(let n=1;n<=partCount;n++){
    await waitIfPaused(record);const start=(n-1)*partSize,end=Math.min(start+partSize,file.size);let attempt=0,part=null;
    while(attempt<3&&!part){await waitIfPaused(record);try{
      part=await xhrPromise(baseUrl("upload/multipart/part")+"?path="+encPath(record.target)+"&uploadId="+encPath(record.uploadId)+"&partNumber="+n,"PUT",file.slice(start,end),{"Content-Type":"application/octet-stream"},(loaded,total)=>{record.item.querySelector("i").style.width=Math.round((completedBytes+loaded)/file.size*100)+"%";record.item.querySelector("span").textContent="第 "+n+"/"+partCount+" 分片"},record);
    }catch(e){if(e.cancelled)throw e;if(++attempt>=3)throw e;record.item.querySelector("span").textContent="分片 "+n+" 重试…";await new Promise(r=>setTimeout(r,700*attempt))}}
    parts.push({partNumber:part.partNumber,etag:part.etag});completedBytes=end;
  }
  await apiJson(baseUrl("upload/multipart/complete")+"?path="+encPath(record.target)+"&uploadId="+encPath(record.uploadId),{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({parts})});
  record.uploadId=null;
}
async function mkdirFromCurrent(){await mkdir()}
function copyText(v){navigator.clipboard.writeText(v).then(()=>toast("已复制")).catch(()=>toast("复制失败"))}
async function globalSearchNow(){
  const q=$("#search").value.trim();if(!q){loadFiles(currentPath,true);return}
  try{const data=await apiJson(baseUrl("search")+"?path="+encPath(currentPath)+"&q="+encodeURIComponent(q));globalSearch=true;$("#globalSearchHint").textContent="全局搜索："+q+" · "+data.items.length+" 个结果"+(data.truncated?"（结果已截断）":"");$("#globalSearchHint").classList.remove("hidden");allItems=data.items;nextCursor=null;renderFiles({truncated:false});}catch(e){toast("搜索失败："+e.message)}
}
function updateBatchBar(){$("#batchBar").classList.toggle("hidden",selected.size===0);$("#selectedCount").textContent="已选 "+selected.size}
document.addEventListener("click",e=>{
  const b=e.target.closest("[data-copy]");if(b)copyText(document.getElementById(b.dataset.copy).textContent);
  if(!e.target.closest("#context"))$("#context").classList.add("hidden");
  const g=e.target.closest("[data-goto]");if(g)location.hash=g.dataset.goto;
});
$("#copyConfig").onclick=()=>copyText("WebDAV 地址："+config.serverUrl+"\n用户名："+config.username+"\n密码：请使用当前 Worker Secret 配置");
$("#refresh").onclick=()=>{loadConfig();if(!$("#view-files").classList.contains("hidden"))loadFiles(currentPath,true)};
$("#newFolder").onclick=mkdirFromCurrent;$("#uploadBtn").onclick=()=>location.hash="upload";$("#upBtn").onclick=()=>loadFiles(currentPath.split("/").slice(0,-1).join("/"),true);
$("#loadMore").onclick=()=>loadFiles(currentPath,false);
$("#search").oninput=e=>{filterText=e.target.value;renderFiles({truncated:Boolean(nextCursor)})};
$("#search").onkeydown=e=>{if(e.key==="Enter")globalSearchNow()};
$("#globalSearch").onclick=globalSearchNow;
$("#clearSearch").onclick=()=>{filterText="";$("#search").value="";loadFiles(currentPath,true)};
$("#sortMode").onchange=e=>{sortMode=e.target.value;renderFiles({truncated:Boolean(nextCursor)})};
$("#listMode").onclick=()=>{viewMode="list";renderFiles({truncated:Boolean(nextCursor)})};$("#gridMode").onclick=()=>{viewMode="grid";renderFiles({truncated:Boolean(nextCursor)})};
$("#selectAll").onchange=e=>{const shown=allItems.filter(x=>x.name.toLowerCase().includes(filterText.toLowerCase()));shown.forEach(x=>e.target.checked?selected.add(x.path):selected.delete(x.path));renderFiles({truncated:Boolean(nextCursor)})};
async function batchDelete(){if(!selected.size)return;if(!confirm("确定删除已选 "+selected.size+" 项吗？"))return;for(const path of [...selected])await action({action:"delete",source:path});selected.clear();toast("批量删除完成");await loadFiles(currentPath,true)}
async function batchCopyMove(type){if(!selected.size)return;const destRoot=prompt("输入目标文件夹路径（例如 backups/photos），留空表示根目录");if(destRoot===null)return;for(const path of [...selected]){const name=path.split("/").pop();const dest=(destRoot?destRoot.replace(/^\/+|\/+$/g,"")+"/":"")+name;await action({action:type,source:path,destination:dest})}selected.clear();toast(type==="copy"?"批量复制完成":"批量移动完成");await loadFiles(currentPath,true)}
$("#batchDelete").onclick=()=>batchDelete();$("#batchCopy").onclick=()=>batchCopyMove("copy");$("#batchMove").onclick=()=>batchCopyMove("move");$("#clearSelection").onclick=()=>{selected.clear();renderFiles({truncated:Boolean(nextCursor)})};
$("#modalClose").onclick=()=>$("#modal").classList.add("hidden");$("#modal").onclick=e=>{if(e.target.id==="modal")$("#modal").classList.add("hidden")};
$("#fileInput").onchange=e=>selectFiles(e.target.files);
const dz=$("#dropzone");["dragenter","dragover"].forEach(x=>dz.addEventListener(x,e=>{e.preventDefault();dz.classList.add("drag")}));["dragleave","drop"].forEach(x=>dz.addEventListener(x,e=>{e.preventDefault();dz.classList.remove("drag")}));dz.addEventListener("drop",e=>selectFiles(e.dataTransfer.files));
window.addEventListener("hashchange",()=>{const n=location.hash.slice(1)||"overview";setView(["overview","files","upload","webdav","settings"].includes(n)?n:"overview")});
loadConfig();setView(location.hash.slice(1)||"overview");