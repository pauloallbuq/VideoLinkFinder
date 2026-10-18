// Port of server/src/crawler.ts that runs inside the Android app (no Node server).
// Uses CapacitorHttp (native HTTP, no CORS) and DOMParser instead of cheerio. Playwright rendering is not available on Android.
import { CapacitorHttp } from '@capacitor/core';

export type Found = {title:string; url:string; kind:string; status:string; httpStatus?:number; checkedAt:string; pageUrl:string};
const TIMEOUT = 12000;
const UA = 'VideoLinkFinder/1.0 (authorized public-resource audit)';

const isIPv4 = (h:string) => /^\d{1,3}(\.\d{1,3}){3}$/.test(h);
export const blockedHost = (h:string) => {
  h=h.toLowerCase().replace(/^\[|\]$/g,'');
  if(h==='localhost'||h.endsWith('.localhost')||h.endsWith('.local')||h==='metadata.google.internal') return true;
  if(isIPv4(h)){const a=h.split('.').map(Number); return a[0]===10||a[0]===127||a[0]===0||a[0]===169&&a[1]===254||a[0]===172&&a[1]>=16&&a[1]<=31||a[0]===192&&a[1]===168||a[0]>=224;}
  if(h.includes(':')){return h==='::1'||h==='::'||h.startsWith('fc')||h.startsWith('fd')||/^fe[89ab]/.test(h)||h.startsWith('::ffff:127.')||h.startsWith('::ffff:10.');}
  return false;
};
export function safeUrl(raw:string):URL{
  let u:URL; try{u=new URL(raw)}catch{throw new Error('URL inválida')}
  if(!['http:','https:'].includes(u.protocol)) throw new Error('Somente HTTP/HTTPS são permitidos');
  if(u.username||u.password) throw new Error('URLs com credenciais embutidas não são permitidas');
  if(blockedHost(u.hostname)) throw new Error('Destino local ou privado bloqueado');
  return u;
}
const classify=(u:string,mime='')=>{const x=(u+' '+mime).toLowerCase(); if(/\.m3u8(?:$|[?#])|mpegurl/.test(x))return 'HLS / M3U8'; if(/\.mpd(?:$|[?#])|dash\+xml/.test(x))return 'MPEG-DASH / MPD'; if(/\.mp4(?:$|[?#])|video\/mp4/.test(x))return 'MP4'; if(/\.webm(?:$|[?#])|video\/webm/.test(x))return 'WEBM'; return 'FORMATO NÃO CONFIRMADO';};
const isMedia=(u:string,m='')=>classify(u,m)!=='FORMATO NÃO CONFIRMADO';
const header=(h:Record<string,string>|undefined,name:string)=>{if(!h)return '';const k=Object.keys(h).find(k=>k.toLowerCase()===name);return k?String(h[k]):''};

async function inspect(url:string){
  const checked=safeUrl(url); const links:string[]=[], media:{url:string,mime:string}[]=[]; let title='';
  const r=await CapacitorHttp.request({url:checked.toString(),method:'GET',headers:{'user-agent':UA},responseType:'text',connectTimeout:TIMEOUT,readTimeout:TIMEOUT});
  // Native client follows redirects; re-validate the final destination.
  const finalUrl=r.url?safeUrl(r.url):checked;
  if(r.status<200||r.status>=300) throw new Error(`HTTP ${r.status}`);
  const ct=header(r.headers,'content-type');
  if(ct.includes('video/')||/mpegurl|dash\+xml/.test(ct)) media.push({url:finalUrl.toString(),mime:ct});
  else if(ct.includes('text/html')||ct.includes('application/xhtml')){
    const html=typeof r.data==='string'?r.data:String(r.data??'');
    const doc=new DOMParser().parseFromString(html,'text/html');
    const attr=(sel:string,a:string)=>doc.querySelector(sel)?.getAttribute(a)||'';
    title=attr('meta[property="og:title"]','content')||attr('meta[name="twitter:title"]','content')||doc.querySelector('title')?.textContent?.trim()||finalUrl.hostname;
    doc.querySelectorAll('a[href]').forEach(e=>{const h=e.getAttribute('href');if(h){try{const a=new URL(h,finalUrl);if(a.origin===finalUrl.origin)links.push(a.toString())}catch{}}});
    doc.querySelectorAll('video,source').forEach(e=>{const s=e.getAttribute('src')||e.getAttribute('data-src');const m=e.getAttribute('type')||'';if(s){try{media.push({url:new URL(s,finalUrl).toString(),mime:m})}catch{}}});
    doc.querySelectorAll('meta[property="og:video"],meta[property="og:video:url"],meta[name="twitter:player:stream"]').forEach(e=>{const s=e.getAttribute('content');if(s){try{media.push({url:new URL(s,finalUrl).toString(),mime:''})}catch{}}});
    const re=/(https?:\\?\/\\?\/[^\s"'<>\\]+?\.(?:mp4|m3u8|mpd|webm)(?:\?[^\s"'<>]*)?)/gi; for(const m of html.matchAll(re)){media.push({url:m[1].replace(/\\\//g,'/'),mime:''});}
  }
  return {title,links:[...new Set(links)],media};
}

export async function crawl(start:string,depth:number,maxPages:number,signal:AbortSignal,onProgress:(p:any)=>void){
  const root=safeUrl(start); const queue:{url:string;d:number}[]=[{url:root.toString(),d:0}], seen=new Set<string>(), found:Found[]=[]; let pages=0; let firstError='';
  while(queue.length&&pages<maxPages&&!signal.aborted){const item=queue.shift()!; if(seen.has(item.url))continue; seen.add(item.url); try{const data=await inspect(item.url); pages++; const pageTitle=data.title||new URL(item.url).hostname;
    for(const m of data.media){if(signal.aborted)break;let target:string;try{target=safeUrl(m.url).toString()}catch{continue} const kind=classify(target,m.mime); if(!isMedia(target,m.mime))continue; let status='FORMATO NÃO CONFIRMADO',httpStatus:number|undefined;
      try{const r=await CapacitorHttp.request({url:target,method:'HEAD',headers:{'user-agent':'VideoLinkFinder/1.0'},connectTimeout:7000,readTimeout:7000});httpStatus=r.status;status=r.status===401||r.status===403?'REQUER AUTENTICAÇÃO':r.status===404||r.status===410?'INDISPONÍVEL':r.status>=200&&r.status<300?'VALIDADO':r.status>=300&&r.status<400?'EXPIRADO':'FORMATO NÃO CONFIRMADO';}catch{status='FORMATO NÃO CONFIRMADO'}
      found.push({title:pageTitle,url:target,kind,status,httpStatus,checkedAt:new Date().toISOString(),pageUrl:item.url});
    }
    if(item.d<depth)for(const link of data.links){if(!seen.has(link)&&queue.length+seen.size<maxPages*3)queue.push({url:link,d:item.d+1})}
  }catch(e:any){if(!firstError)firstError=e?.message||'Falha ao acessar página'} onProgress({pagesAnalyzed:pages,titlesFound:new Set(found.map(f=>f.title)).size,linksValidated:found.filter(f=>f.status==='VALIDADO').length,queued:queue.length});
  }
  return {results:found.filter((x,i,a)=>a.findIndex(y=>y.url===x.url&&y.title===x.title)===i),pagesAnalyzed:pages,cancelled:signal.aborted,error:pages===0&&firstError?firstError:undefined};
}
