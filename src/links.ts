export type ImageRef = { raw: string; target: string; start: number; end: number; kind:'wiki'|'markdown'; suffix:string; alt:string };

/** Supported: ![[image.png|300]], ![caption](image.png), and ![caption](<image file.png>).
 * Does not intentionally scan HTML images, remote URLs, or fenced code blocks.
 */
export function parseImageRefs(text:string):ImageRef[] {
  const re=/!\[\[([^\]\n]+)\]\]|!\[([^\]\n]*)\]\((<[^>\n]+>|[^\s)]+)(?:\s+['"][^'"\n]*['"])?\)/g;
  const refs:ImageRef[]=[];
  let m:RegExpExecArray|null;
  while((m=re.exec(text))) {
    const pre=text.slice(0,m.index), line=pre.lastIndexOf('\n')+1;
    // Skip fenced source code (both ``` and ~~~).
    const priorLines=pre.slice(0,line).split('\n');
    let fence:string|null=null;
    for(const row of priorLines){
      const found=row.match(/^\s*(`{3,}|~{3,})/);
      if(found){if(!fence)fence=found[1][0];else if(found[1][0]===fence)fence=null;}
    }
    if(fence)continue;
    if(m[1]!==undefined){
      const pipe=m[1].indexOf('|');
      const target=(pipe<0?m[1]:m[1].slice(0,pipe)).split('#')[0];
      const suffix=pipe<0?'':m[1].slice(pipe);
      if(target)refs.push({raw:m[0],target,start:m.index,end:m.index+m[0].length,kind:'wiki',suffix,alt:''});
    }else{
      const target=m[3].startsWith('<')?m[3].slice(1,-1):m[3];
      if(!/^(https?:|data:|file:)/i.test(target))refs.push({raw:m[0],target,start:m.index,end:m.index+m[0].length,kind:'markdown',suffix:'',alt:m[2]});
    }
  }
  return refs;
}

export function relativeToNote(notePath:string,assetPath:string):string {
  const from=notePath.split('/').slice(0,-1),to=assetPath.split('/');
  while(from.length&&to.length&&from[0]===to[0]){from.shift();to.shift();}
  return [...from.map(()=>'..'),...to].join('/');
}
export function makeReplacement(ref:ImageRef,newPath:string,notePath:string):string {
  if(ref.kind==='wiki')return `![[${newPath}${ref.suffix}]]`;
  const relative=relativeToNote(notePath,newPath);
  // Angle brackets in Markdown allow filenames with spaces. Encode special URL chars.
  const href=relative.split('/').map(s=>encodeURIComponent(s)).join('/');
  return `![${ref.alt}](<${href}>)`;
}
export function selectOccurrence(content:string,ref:ImageRef):ImageRef|null {
  // Prefer original offset; prevent a blind replace when the note has changed.
  if(content.slice(ref.start,ref.end)===ref.raw) return ref;
  const all=parseImageRefs(content).filter(v=>v.raw===ref.raw);
  return all.length===1?all[0]:null;
}
