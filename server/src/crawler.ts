import * as cheerio from 'cheerio';
import { chromium } from 'playwright';
import dns from 'node:dns/promises';
import net from 'node:net';

export type Found = {title:string; url:string; kind:string; status:string; httpStatus?:number; checkedAt:string; pageUrl:string};
const blockedHost = (h:string) => {
  h=h.toLowerCase().replace(/^\[|\]$/g,'');
  if(h==='localhost'||h.endsWith('.localhost')||h.endsWith('.local')||h==='metadata.google.internal') return true;
  if(net.isIP(h)===4){const a=h.split('.').map(Number); return a[0]===10||a[0]===127||a[0]===0||a[0]===169&&a[1]===254||a[0]===172&&a[1]>=16&&a[1]<=31||a[0]===192&&a[1]===168||a[0]>=224;}
  if(net.isIP(h)===6){const x=h.toLowerCase(); return x==='::1'||x==='::'||x.startsWith('fc')||x.startsWith('fd')||/^fe[89ab]/.test(x)||x.startsWith('::ffff:127.')||x.startsWith('::ffff:10.');}
  return false;
};
export async function safeUrl(raw:string):Promise<URL>{
  let u:URL; try{u=new URL(raw)}catch{throw new Error('URL inválida')}
  if(!['http:','https:'].includes(u.protocol)) throw new Error('Somente HTTP/HTTPS são permitidos');
  if(u.username||u.password) throw new Error('URLs com credenciais embutidas não são permitidas');
  if(blockedHost(u.hostname)) throw new Error('Destino local ou privado bloqueado');
  try { const records=await dns.lookup(u.hostname,{all:true}); if(!records.length||records.some(r=>blockedHost(r.address))) throw new Error('O domínio resolve para endereço local/privado e foi bloqueado'); } catch(e:any) { if(e.message?.includes('bloqueado')) throw e; throw new Error('Não foi possível resolver o domínio'); }
  return u;
}
const classify=(u:string,mime='')=>{const x=(u+' '+mime).toLowerCase(); if(/\.m3u8(?:$|[?#])|mpegurl/.test(x))return 'HLS / M3U8'; if(/\.mpd(?:$|[?#])|dash\+xml/.test(x))return 'MPEG-DASH / MPD'; if(/\.mp4(?:$|[?#])|video\/mp4/.test(x))return 'MP4'; if(/\.webm(?:$|[?#])|video\/webm/.test(x))return 'WEBM'; return 'FORMATO NÃO CONFIRMADO';};
const isMedia=(u:string,m='')=>classify(u,m)!=='FORMATO NÃO CONFIRMADO';
async function inspect(url:string, render:boolean){
 const checked=await safeUrl(url); let html='', links:string[]=[], media:{url:string,mime:string}[]=[], title='';
 const response=await fetch(checked,{redirect:'manual',signal:AbortSignal.timeout(Number(process.env.REQUEST_TIMEOUT_MS||12000)),headers:{'user-agent':'VideoLinkFinder/1.0 (authorized public-resource audit)'}});
 if(response.status>=300&&response.status<400){const loc=response.headers.get('location'); if(loc){const next=new URL(loc,checked).toString(); await safeUrl(next); throw new Error('Redirecionamento detectado; execute a URL de destino separadamente para validar novamente');}}
 if(!response.ok) throw new Error(`HTTP ${response.status}`);
 const ct=response.headers.get('content-type')||'';
 if(ct.includes('video/')||/mpegurl|dash\+xml/.test(ct)) media.push({url:checked.toString(),mime:ct});
 else if(ct.includes('text/html')||ct.includes('application/xhtml')){
   html=await response.text(); const $=cheerio.load(html); title=$('meta[property="og:title"]').attr('content')||$('meta[name="twitter:title"]').attr('content')||$('title').first().text().trim()||checked.hostname;
   $('a[href]').each((_,e)=>{const h=$(e).attr('href'); if(h){try{const a=new URL(h,checked).toString(); if(new URL(a).origin===checked.origin) links.push(a)}catch{}}});
   $('video,source').each((_,e)=>{const s=$(e).attr('src')||$(e).attr('data-src'); const m=$(e).attr('type')||''; if(s){try{media.push({url:new URL(s,checked).toString(),mime:m})}catch{}}});
   $('meta[property="og:video"],meta[property="og:video:url"],meta[name="twitter:player:stream"]').each((_,e)=>{const s=$(e).attr('content');if(s){try{media.push({url:new URL(s,checked).toString(),mime:''})}catch{}}});
   // Only inspect public page source references; no session, token, or protected API extraction.
   const re=/(https?:\\?\/\\?\/[^\s"'<>\\]+?\.(?:mp4|m3u8|mpd|webm)(?:\?[^\s"'<>]*)?)/gi; for(const m of html.matchAll(re)){media.push({url:m[1].replace(/\\\//g,'/'),mime:''});}
 }
 if(render && process.env.ALLOW_BROWSER_RENDER==='true' && (ct.includes('text/html')||ct.includes('application/xhtml'))){
   const browser=await chromium.launch({headless:true}); try{const page=await browser.newPage(); await page.goto(checked.toString(),{waitUntil:'domcontentloaded',timeout:15000}); title=(await page.title())||title; const extra=await page.evaluate(()=>Array.from(document.querySelectorAll('video,video source,meta[property="og:video"],meta[property="og:video:url"]')).map((e:any)=>({url:e.src||e.content||e.getAttribute('src'),mime:e.type||''})).filter((x:any)=>x.url)); for(const x of extra){try{media.push({url:new URL(x.url,checked).toString(),mime:x.mime||''})}catch{}} const ls=await page.locator('a[href]').evaluateAll(as=>as.map(a=>(a as HTMLAnchorElement).href)); for(const a of ls){try{if(new URL(a).origin===checked.origin)links.push(a)}catch{}} }finally{await browser.close();}
 }
 return {title,links:[...new Set(links)],media,ct,status:response.status};
}
export async function crawl(start:string,depth:number,maxPages:number,signal:AbortSignal,onProgress:(p:any)=>void){
 const root=await safeUrl(start); const queue:{url:string;d:number}[]=[{url:root.toString(),d:0}], seen=new Set<string>(), found:Found[]=[]; let pages=0;
 while(queue.length&&pages<maxPages&&!signal.aborted){const item=queue.shift()!; if(seen.has(item.url))continue; seen.add(item.url); try{const data=await inspect(item.url,true); pages++; const pageTitle=data.title||new URL(item.url).hostname;
   for(const m of data.media){let target:string;try{target=(await safeUrl(m.url)).toString()}catch{continue} const kind=classify(target,m.mime); if(!isMedia(target,m.mime))continue; let status='FORMATO NÃO CONFIRMADO',httpStatus:number|undefined;
     try{const r=await fetch(target,{method:'HEAD',redirect:'manual',signal:AbortSignal.timeout(7000),headers:{'user-agent':'VideoLinkFinder/1.0'}});httpStatus=r.status;status=r.status===401||r.status===403?'REQUER AUTENTICAÇÃO':r.status===404||r.status===410?'INDISPONÍVEL':r.ok?'VALIDADO':r.status>=300&&r.status<400?'EXPIRADO':'FORMATO NÃO CONFIRMADO';}catch{status='FORMATO NÃO CONFIRMADO'}
     found.push({title:pageTitle,url:target,kind,status,httpStatus,checkedAt:new Date().toISOString(),pageUrl:item.url});
   }
   if(item.d<depth)for(const link of data.links){if(!seen.has(link)&&queue.length+seen.size<maxPages*3)queue.push({url:link,d:item.d+1})}
 }catch{/* inaccessible pages are skipped and crawl continues */} onProgress({pagesAnalyzed:pages,titlesFound:new Set(found.map(f=>f.title)).size,linksValidated:found.filter(f=>f.status==='VALIDADO').length,queued:queue.length});
 }
 return {results:found.filter((x,i,a)=>a.findIndex(y=>y.url===x.url&&y.title===x.title)===i),pagesAnalyzed:pages,cancelled:signal.aborted};
}
