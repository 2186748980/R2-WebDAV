const $=s=>document.querySelector(s);let config=null;
async function api(path){const r=await fetch(path,{headers:{Accept:"application/json"}});if(!r.ok)throw new Error("HTTP "+r.status);return r.json()}
function toast(msg){const el=$("#toast");el.textContent=msg;el.classList.add("show");setTimeout(()=>el.classList.remove("show"),1600)}
async function load(){try{config=await api("/panel/api/config");const u=config.serverUrl;$("#serverUrl").textContent=u;$("#davUrl").textContent=u;$("#panelUrl").textContent=location.origin+"/panel/";$("#username").textContent=config.username;$("#username2").textContent=config.username;$("#fileCount").textContent=config.stats.files;$("#folderCount").textContent=config.stats.folders}catch(e){toast("配置加载失败")}}
async function reveal(){if($("#password").textContent!=="••••••••"){return}try{const r=await api("/panel/api/secret");$("#password").textContent=r.password;$("#password2").textContent=r.password;$("#revealPassword").textContent="隐藏"}catch(e){toast("密码读取失败")}}
function value(id){return document.getElementById(id).textContent}
async function copyText(v){await navigator.clipboard.writeText(v);toast("已复制")}
document.addEventListener("click",e=>{const b=e.target.closest("[data-copy]");if(b)copyText(value(b.dataset.copy));});
$("#revealPassword").addEventListener("click",()=>{if($("#password").textContent==="••••••••")reveal();else{$("#password").textContent="••••••••";$("#password2").textContent="••••••••";$("#revealPassword").textContent="显示"}});
$("#copyConfig").addEventListener("click",()=>{if(!config)return;copyText("WebDAV 地址："+config.serverUrl+"\n用户名："+config.username+"\n密码：请使用当前 WebDAV/Worker Secret 配置")});
$("#refresh").addEventListener("click",load);
$("#openFiles").addEventListener("click",()=>toast("文件管理将在下一阶段接入"));
$("#openDav").addEventListener("click",()=>document.querySelector(".card:nth-of-type(3)")?.scrollIntoView({behavior:"smooth"}));
load();