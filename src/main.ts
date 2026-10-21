import { App, Editor, MarkdownView, Menu, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile, setIcon } from 'obsidian';
import { parseImageRefs, ImageRef, makeReplacement, selectOccurrence } from './links';
import { detectSlide, Trim } from './detect';
import { Quad, Point, insetQuad, outputSize, dist, distToSegment, isValidQuad } from './geometry';
import { warpPixels } from './warp';
import { t, setLang, Lang } from './i18n';
import { ColorMode, Tone, COLOR_STRENGTH, autoColor, applyTone } from './color';

type OutPrefs = Pick<Prefs,'aspect'|'format'|'color'|'tone'|'crop'>;
type Rec = {src:string; quad:Quad; w:number; h:number; prefs?:OutPrefs};
const outPrefs=(p:Prefs):OutPrefs=>({aspect:p.aspect,format:p.format,color:p.color,tone:p.tone,crop:p.crop});
const sameOutPrefs=(a:OutPrefs,b:OutPrefs):boolean=>a.aspect===b.aspect&&a.format===b.format&&a.color===b.color&&a.tone===b.tone&&a.crop===b.crop;
const sameQuad=(a:Quad,b:Quad,tol=0.75):boolean=>a.every((p,i)=>Math.abs(p.x-b[i].x)<=tol&&Math.abs(p.y-b[i].y)<=tol);
/** True when the frame/output settings differ from the baseline. Moving a corner and putting it back (within ~0.3% of the photo) is not a change, and with crop off the frame and aspect do not matter. */
function modifiedParts(base:Baseline,quad:Quad,prefs:OutPrefs,natW:number,natH:number):string[] {
  const parts:string[]=[];
  if(base.prefs.crop!==prefs.crop)parts.push('Crop');
  if(prefs.crop){
    if(!sameQuad(base.quad,quad,Math.max(1.5,0.003*Math.max(natW,natH))))parts.push('Frame');
    if(base.prefs.aspect!==prefs.aspect)parts.push('Aspect');
  }
  if(base.prefs.color!==prefs.color)parts.push('Color');
  if(base.prefs.tone!==prefs.tone)parts.push('Tone');
  if(base.prefs.format!==prefs.format)parts.push('Format');
  return parts;
}
const isModified=(base:Baseline,quad:Quad,prefs:OutPrefs,natW:number,natH:number):boolean=>modifiedParts(base,quad,prefs,natW,natH).length>0;
/** A processed photo only needs saving again when its frame or output settings differ from what produced the current image. */
type Baseline = {quad:Quad; prefs:OutPrefs};
/** Remember a frame the user dragged (or forget it once they ask for auto-detect again), whether or not they save. */
function noteDraft(plugin:SlideFrameCorrector,file:TFile,editor:QuadEditor,sameAsSaved=false):void {
  if(sameAsSaved)plugin.clearDraft(file.path); // dragged back to the saved frame: nothing pending
  else if(editor.origin==='user')plugin.setDraft(file.path,{src:file.path,quad:editor.quad.map(v=>({...v})) as Quad,w:editor.natW,h:editor.natH});
  else if(editor.origin==='auto')plugin.clearDraft(file.path);
}
type Resolved = {ref: ImageRef; file: TFile};
type Entry = Resolved & {note: TFile};
type Aspect = 'auto'|'16:9'|'4:3';
type OutputFormat = 'image/jpeg'|'image/png';
type Prefs = {aspect: Aspect; format: OutputFormat; color: ColorMode; tone: Tone; crop: boolean; lang: Lang; trim: Trim};
const DEFAULT_PREFS: Prefs = {aspect:'16:9', format:'image/jpeg', color:'off', tone:'color', crop:true, lang:'auto', trim:'normal'};
type Opt = [string,string,string?]; // caption, value, optional Lucide icon
const TRIM_OPTIONS: Opt[] = [['Off','off'],['Normal','normal'],['Wide ⚠','wide']];
/** Edge trim used by the next auto-detect (kept in sync with the setting). */
let currentTrim: Trim = 'normal';
const TRIM_HINT='Pulls the detected frame inward past dark/gold screen bands. Wide reaches thicker bands but can cut into the slide; it works best on light-background slides.';
const LANG_OPTIONS: [string,string][] = [['Auto (follow Obsidian)','auto'],['English','en'],['中文','zh']];
const ASPECT_OPTIONS: [string,string][] = [['16:9','16:9'],['4:3','4:3'],['Auto','auto']];
const FORMAT_OPTIONS: [string,string][] = [['JPG','image/jpeg'],['PNG','image/png']];
const COLOR_OPTIONS: [string,string][] = [['Off','off'],['Soft','soft'],['Standard','standard'],['Strong','strong']];
const TONE_OPTIONS: Opt[] = [['Full color','color','palette'],['Grayscale','gray','contrast'],['Black & white','bw','sun-moon']];
const COLOR_LEVELS: Opt[] = [['Soft','soft'],['Standard','standard'],['Strong','strong']];
const CROP_OPTIONS: [string,string][] = [['On','on'],['Off (color only)','off']];
const SUPPORTED=/\.(png|jpe?g|webp|bmp|avif)$/i;
/** Files written by this plugin are named `<photo>-slide-001.jpg`; they count as already processed. */
const PROCESSED=/-slide-\d{3}$/;
const isProcessed=(file:TFile):boolean=>PROCESSED.test(file.basename);

function decodeTarget(t:string): string {
  try {return decodeURIComponent(t.replace(/\\([ ()])/g,'$1'));} catch{return t;}
}
function getRefFile(app:App,ref:ImageRef,note:TFile):TFile|null {
  const target=decodeTarget(ref.target);
  const file=app.metadataCache.getFirstLinkpathDest(target,note.path);
  return file && SUPPORTED.test(file.name)?file:null;
}
function getContent(view:MarkdownView,app:App):Promise<string> {
  if(view.getMode()==='source')return Promise.resolve(view.editor.getValue());
  return app.vault.cachedRead(view.file!);
}

async function loadImageFile(app:App,file:TFile):Promise<{img:HTMLImageElement;release:()=>void}> {
  const data=await app.vault.readBinary(file);
  const lower=file.extension.toLowerCase();
  const type=lower==='jpg'||lower==='jpeg'?'image/jpeg':lower==='png'?'image/png':lower==='webp'?'image/webp':lower==='avif'?'image/avif':'image/bmp';
  const url=URL.createObjectURL(new Blob([data],{type}));
  const img=new Image();
  img.src=url;
  try {
    await new Promise<void>((resolve,reject)=>{img.onload=()=>resolve();img.onerror=()=>reject(new Error('Unsupported or damaged image'));});
  }catch(err){URL.revokeObjectURL(url);throw err;}
  if(!img.naturalWidth||!img.naturalHeight){URL.revokeObjectURL(url);throw new Error('Empty photo');}
  return {img,release:()=>URL.revokeObjectURL(url)};
}

/** Size a canvas to fit inside `box` (contain) and centre it, so a row of cards never needs vertical scrolling. */
function fitCanvas(canvas:HTMLCanvasElement,box:HTMLElement):void {
  const bw=box.clientWidth-2,bh=box.clientHeight-2;
  if(bw<=0||bh<=0||!canvas.width||!canvas.height)return;
  const k=Math.min(bw/canvas.width,bh/canvas.height);
  const st=canvas.style;
  st.position='absolute';st.left='50%';st.top='50%';st.transform='translate(-50%,-50%)';
  st.maxHeight='none';st.maxWidth='none';
  st.width=`${Math.floor(canvas.width*k)}px`;st.height=`${Math.floor(canvas.height*k)}px`;
}
function addSelect(parent:HTMLElement,label:string,opts:[string,string][],current:string,onChange:(value:string)=>void,hint?:string):void {
  const holder=parent.createEl('label',{cls:'sfc-field'});
  if(hint)holder.setAttribute('title',hint);
  holder.createEl('span',{text:t(label)});
  const select=holder.createEl('select');
  for(const [caption,value] of opts) {
    const option=select.createEl('option',{text:t(caption),attr:{value}});
    if(value===current)option.selected=true;
  }
  select.addEventListener('change',()=>onChange(select.value));
}
function setAutoBadge(btn:HTMLButtonElement,label:string,ok:boolean):void {
  const text=ok?`✓ ${t(label)}`:t(label);
  const span=btn.querySelector('.sfc-btn-label');
  if(span)span.setText(text);else btn.setText(text);
  btn.toggleClass('sfc-auto-ok',ok);
}
function addButton(parent:HTMLElement,label:string,onClick:(e:MouseEvent)=>void):HTMLButtonElement {
  const button=parent.createEl('button',{text:t(label),attr:{type:'button'}});
  button.addEventListener('click',onClick);return button;
}
/** Lucide icon (bundled with Obsidian). */
function makeIcon(parent:HTMLElement,name:string):HTMLElement {
  const el=parent.createEl('span',{cls:'sfc-icon'});
  setIcon(el,name);
  return el;
}
/** Button with a Lucide icon (and a label unless `iconOnly`); shows `fallback` text if the icon is unknown. */
function iconButton(parent:HTMLElement,icon:string,label:string,onClick:(e:MouseEvent)=>void,opts:{iconOnly?:boolean;fallback?:string}={}):HTMLButtonElement {
  const b=parent.createEl('button',{cls:'sfc-btn',attr:{type:'button'}});
  makeIcon(b,icon);
  if(opts.iconOnly){
    b.setAttribute('aria-label',t(label));b.setAttribute('title',t(label));
    if(!b.querySelector('svg'))b.setText(opts.fallback??'⋯');
  }else b.createEl('span',{cls:'sfc-btn-label',text:t(label)});
  b.addEventListener('click',onClick);
  return b;
}
function ctlLabel(parent:HTMLElement,label:string,icon?:string):void {
  const l=parent.createEl('span',{cls:'sfc-ctl-label'});
  if(icon)makeIcon(l,icon);
  l.createEl('span',{text:t(label)});
}
/** Segmented control: a few mutually exclusive choices side by side. */
function addSegmented(parent:HTMLElement,label:string,opts:Opt[],current:string,onChange:(value:string)=>void,hint?:string,labelIcon?:string){
  const el=parent.createDiv({cls:'sfc-ctl'});
  if(hint)el.setAttribute('title',hint);
  ctlLabel(el,label,labelIcon);
  const seg=el.createDiv({cls:'sfc-seg',attr:{role:'group'}});
  const btns=new Map<string,HTMLButtonElement>();
  const set=(v:string)=>{for(const [val,b] of btns){b.toggleClass('is-active',val===v);b.setAttribute('aria-pressed',String(val===v));}};
  for(const [caption,value,icon] of opts){
    const b=seg.createEl('button',{attr:{type:'button'}});
    if(icon)makeIcon(b,icon);
    b.createEl('span',{text:t(caption)});
    btns.set(value,b);
    b.addEventListener('click',()=>{set(value);onChange(value);});
  }
  set(current);
  return {el,set};
}
/** On/off switch with a label. */
function addSwitch(parent:HTMLElement,label:string,checked:boolean,onChange:(on:boolean)=>void,hint?:string,icon?:string){
  const el=parent.createEl('label',{cls:'sfc-ctl sfc-switch'});
  if(hint)el.setAttribute('title',hint);
  const input=el.createEl('input',{attr:{type:'checkbox'}});
  input.checked=checked;
  el.createEl('span',{cls:'sfc-switch-track'});
  ctlLabel(el,label,icon);
  input.addEventListener('change',()=>onChange(input.checked));
  return {el,input};
}
/** Slider over a few ordered levels, with the current level named next to it. */
function addStepSlider(parent:HTMLElement,label:string,opts:Opt[],current:string,onChange:(value:string)=>void,labelIcon?:string){
  const el=parent.createDiv({cls:'sfc-ctl'});
  ctlLabel(el,label,labelIcon);
  const input=el.createEl('input',{cls:'sfc-slider',attr:{type:'range',min:'0',max:String(opts.length-1),step:'1'}});
  const name=el.createEl('span',{cls:'sfc-slider-value'});
  const idx=Math.max(0,opts.findIndex(o=>o[1]===current));
  input.value=String(idx);name.setText(t(opts[idx][0]));
  input.addEventListener('input',()=>{const o=opts[Number(input.value)];name.setText(t(o[0]));onChange(o[1]);});
  return {el,input};
}
/** A titled group whose header carries its own on/off switch; when off, the controls inside are dimmed and disabled. */
function addGroup(parent:HTMLElement,title:string,icon:string,toggle:{checked:boolean;onChange:(on:boolean)=>void}){
  const g=parent.createDiv({cls:'sfc-group'});
  const head=g.createDiv({cls:'sfc-group-head'});
  const titleEl=head.createDiv({cls:'sfc-group-title'});
  makeIcon(titleEl,icon);
  titleEl.createEl('span',{text:t(title)});
  const sw=head.createEl('label',{cls:'sfc-switch sfc-group-switch',attr:{'aria-label':t(title)}});
  const input=sw.createEl('input',{attr:{type:'checkbox'}});
  input.checked=toggle.checked;
  sw.createEl('span',{cls:'sfc-switch-track'});
  const body=g.createDiv({cls:'sfc-group-body'});
  const setEnabled=(on:boolean)=>{
    g.toggleClass('sfc-off',!on);
    body.querySelectorAll('button,input').forEach(c=>{(c as HTMLButtonElement|HTMLInputElement).disabled=!on;});
  };
  input.addEventListener('change',()=>{setEnabled(input.checked);toggle.onChange(input.checked);});
  return {body,setEnabled};
}
type ToolbarHooks = {
  onCrop:(on:boolean)=>void; onAspect:()=>void; onTrim:()=>void; onColor:()=>void; onTone:()=>void;
  frameExtras:(body:HTMLElement)=>void;
};
/** Two groups, each with its own switch: Correct (the frame/crop) and Color (colour correction + tone). */
function buildToolbar(parent:HTMLElement,plugin:SlideFrameCorrector,h:ToolbarHooks):{setCropEnabled:(on:boolean)=>void} {
  const prefs=plugin.prefs;
  const bar=parent.createDiv({cls:'sfc-toolbar'});
  const frame=addGroup(bar,'Correct','crop',{checked:prefs.crop,onChange:on=>{plugin.setPref('crop',on);h.onCrop(on);}});
  addSegmented(frame.body,'Aspect',ASPECT_OPTIONS,prefs.aspect,v=>{plugin.setPref('aspect',v as Aspect);h.onAspect();},undefined,'ratio');
  addSegmented(frame.body,'Edge trim',TRIM_OPTIONS,prefs.trim,v=>{plugin.setPref('trim',v as Trim);h.onTrim();},t(TRIM_HINT),'scan');
  const extras=frame.body.createDiv({cls:'sfc-ctl sfc-ctl-buttons'});
  h.frameExtras(extras);
  frame.setEnabled(prefs.crop);
  const color=addGroup(bar,'Color','palette',{checked:prefs.color!=='off',onChange:on=>{
    plugin.setPref('color',on?plugin.lastColor:'off');h.onColor();
  }});
  addStepSlider(color.body,'Strength',COLOR_LEVELS,prefs.color==='off'?plugin.lastColor:prefs.color,v=>{
    plugin.lastColor=v as ColorMode;plugin.setPref('color',v as ColorMode);h.onColor();
  },'sliders-horizontal');
  addSegmented(color.body,'Tone',TONE_OPTIONS,prefs.tone,v=>{plugin.setPref('tone',v as Tone);h.onTone();},undefined,'swatch-book');
  color.setEnabled(prefs.color!=='off');
  return {setCropEnabled:frame.setEnabled};
}
/** Output format (and per-dialog extras), shown at the left of the bottom bar. */
function buildFileBar(parent:HTMLElement,plugin:SlideFrameCorrector,extras:(body:HTMLElement)=>void):void {
  addSegmented(parent,'Save as',FORMAT_OPTIONS,plugin.prefs.format,v=>plugin.setPref('format',v as OutputFormat),undefined,'image');
  extras(parent);
}
const KEY_HINT='Number key: next corner candidate · Shift+number: previous candidate';
/** The "…" menu: file name and paths live here instead of on the page; clicking a row copies it. */
function showInfoMenu(ev:MouseEvent,rows:[string,string][]):void {
  const menu=new Menu();
  for(const [label,value] of rows)
    menu.addItem(item=>item.setTitle(`${t(label)}: ${value}`).setIcon('copy').onClick(()=>{
      void navigator.clipboard?.writeText(value);new Notice(t('Copied'));
    }));
  menu.showAtMouseEvent(ev);
}
function fileRows(entry:Entry,source:TFile|null):[string,string][] {
  const rows:[string,string][]=[['Image',entry.file.name],['Image path',entry.file.path]];
  if(source&&source.path!==entry.file.path)rows.push(['Original path',source.path]);
  return rows;
}

/** Crop (perspective warp) or keep the whole photo, then apply colour correction and tone. */
function makeOutput(src:ImageData,quad:Quad,prefs:Prefs,maxSide:number):ImageData {
  let out:ImageData;
  if(prefs.crop){
    const size=outputSize(quad,prefs.aspect,maxSide);
    out=warpPixels(src,quad,size.width,size.height);
  }else{
    const scale=Math.min(1,maxSide/Math.max(src.width,src.height));
    if(scale>=1)out=new ImageData(new Uint8ClampedArray(src.data),src.width,src.height);
    else{
      const a=document.createElement('canvas');a.width=src.width;a.height=src.height;
      a.getContext('2d')!.putImageData(src,0,0);
      const b=document.createElement('canvas');b.width=Math.max(1,Math.round(src.width*scale));b.height=Math.max(1,Math.round(src.height*scale));
      const bc=b.getContext('2d',{willReadFrequently:true})!;
      bc.drawImage(a,0,0,b.width,b.height);
      out=bc.getImageData(0,0,b.width,b.height);
    }
  }
  autoColor(out,COLOR_STRENGTH[prefs.color]);
  applyTone(out,prefs.tone);
  return out;
}
async function renderCorrected(img:HTMLImageElement,quad:Quad,prefs:Prefs):Promise<HTMLCanvasElement> {
  const w=img.naturalWidth,h=img.naturalHeight;
  const scale=Math.min(1,4200/Math.max(w,h),Math.sqrt(14000000/(w*h)));
  const source=document.createElement('canvas');
  source.width=Math.max(1,Math.round(w*scale));source.height=Math.max(1,Math.round(h*scale));
  const ctx=source.getContext('2d',{willReadFrequently:true});
  if(!ctx)throw new Error('Canvas not supported');
  ctx.drawImage(img,0,0,source.width,source.height);
  const src=ctx.getImageData(0,0,source.width,source.height);
  const q=quad.map(p=>({x:p.x*source.width/w,y:p.y*source.height/h})) as Quad;
  const result=makeOutput(src,q,prefs,prefs.crop?3000:4200);
  const canvas=document.createElement('canvas');canvas.width=result.width;canvas.height=result.height;
  canvas.getContext('2d')!.putImageData(result,0,0);
  return canvas;
}
async function saveCorrection(app:App,entry:Entry,source:TFile,img:HTMLImageElement,quad:Quad,prefs:Prefs):Promise<TFile> {
  if(prefs.crop&&!isValidQuad(quad,img.naturalWidth,img.naturalHeight))throw new Error(t('Adjust the four corners to form a valid quadrilateral.'));
  const canvas=await renderCorrected(img,quad,prefs);
  const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('Encoding failed')),prefs.format,.94));
  const bytes=await blob.arrayBuffer();
  const ext=prefs.format==='image/png'?'png':'jpg';
  const original=source;
  const folder=original.parent?.path==='/'?'':original.parent?.path??'';
  const base=original.basename.replace(/[^\p{L}\p{N} _.-]/gu,'_').slice(0,72);
  let path='';
  for(let i=1;i<=9999;i++){
    const name=`${base}-slide-${String(i).padStart(3,'0')}.${ext}`;
    const candidate=folder?`${folder}/${name}`:name;
    if(!app.vault.getAbstractFileByPath(candidate)){path=candidate;break;}
  }
  if(!path)throw new Error('Could not find a unique filename');
  const saved=await app.vault.createBinary(path,bytes);
  try {await replaceEmbed(app,entry,saved);}
  catch(err){
    // Only revert the newly created output, never alter the source photo.
    try{await app.vault.delete(saved);}catch{ /* recovery file can remain */ }
    throw err;
  }
  return saved;
}
/** Where to edit from: the original photo (with the frame used last time) when this embed is one of our outputs. */
function resolveSource(app:App,plugin:SlideFrameCorrector,entry:Entry):{file:TFile;rec:Rec|null;fromOriginal:boolean} {
  const rec=plugin.records[entry.file.path]??null;
  if(rec){
    const f=app.vault.getAbstractFileByPath(rec.src);
    if(f instanceof TFile)return {file:f,rec,fromOriginal:true};
  }
  if(isProcessed(entry.file)){
    const base=entry.file.basename.replace(PROCESSED,'');
    const folder=entry.file.parent?.path==='/'?'':entry.file.parent?.path??'';
    for(const ext of ['jpg','jpeg','png','webp','heic','avif','bmp']){
      const f=app.vault.getAbstractFileByPath(folder?`${folder}/${base}.${ext}`:`${base}.${ext}`);
      if(f instanceof TFile&&SUPPORTED.test(f.name))return {file:f,rec:null,fromOriginal:true};
    }
  }
  return {file:entry.file,rec:null,fromOriginal:false};
}
function usableQuad(rec:Rec|null,img:HTMLImageElement):Quad|undefined {
  return rec&&rec.w===img.naturalWidth&&rec.h===img.naturalHeight&&isValidQuad(rec.quad,rec.w,rec.h)?rec.quad:undefined;
}
async function replaceEmbed(app:App,entry:Entry,newFile:TFile):Promise<void> {
  const {note,ref}=entry;
  const replacement=makeReplacement(ref,newFile.path,note.path);
  // The live editor is authoritative when a note is being edited.
  let open:MarkdownView|null=null;
  app.workspace.iterateAllLeaves(leaf=>{
    if(!open && leaf.view instanceof MarkdownView && leaf.view.file?.path===note.path && leaf.view.getMode()==='source') open=leaf.view;
  });
  if(open) {
    const editor=(open as MarkdownView).editor;
    const found=selectOccurrence(editor.getValue(),ref);
    if(!found)throw new Error('The embed changed while editing. No note content was replaced.');
    editor.replaceRange(replacement,editor.offsetToPos(found.start),editor.offsetToPos(found.end));
    return;
  }
  await app.vault.process(note,current=>{
    const found=selectOccurrence(current,ref);
    if(!found)throw new Error('The embed changed while editing. No note content was replaced.');
    return current.slice(0,found.start)+replacement+current.slice(found.end);
  });
}

let activeEditor:QuadEditor|null=null;

/** Canvas with four draggable corners and four draggable edges (an edge slides along its normal). */
class QuadEditor {
  readonly canvas:HTMLCanvasElement;
  quad:Quad;
  readonly natW:number;
  readonly natH:number;
  /** True while the frame is exactly what the detector confidently proposed. */
  autoResult=false;
  /** Where the current frame came from: the detector, the user's hands, or a frame restored from storage. */
  origin:'auto'|'user'|'restored'='auto';
  private enabled=true;
  private view:HTMLCanvasElement;
  private lens:HTMLCanvasElement;
  private lensSize:number;
  private active:{kind:'corner'|'edge';index:number}|null=null;
  private dragging=false;
  private startQuad:Quad|null=null;
  private startPoint:Point|null=null;
  private candidates:(Point&{score?:number})[][]=[[],[],[],[]];
  private cycle:{corner:number;list:Point[];index:number}|null=null;
  constructor(stage:HTMLElement,img:HTMLImageElement,private onChange:(final:boolean)=>void,maxSide=1000,lensSize=130) {
    this.natW=img.naturalWidth;this.natH=img.naturalHeight;
    const scale=Math.min(1,maxSide/Math.max(this.natW,this.natH));
    this.view=document.createElement('canvas');
    this.view.width=Math.round(this.natW*scale);this.view.height=Math.round(this.natH*scale);
    this.view.getContext('2d')!.drawImage(img,0,0,this.view.width,this.view.height);
    this.canvas=stage.createEl('canvas',{cls:'sfc-edit-canvas'});
    this.canvas.width=this.view.width;this.canvas.height=this.view.height;
    this.canvas.setAttribute('aria-label',t('Drag a corner or an edge to align with the slide boundary'));
    this.lensSize=lensSize;
    this.lens=stage.createEl('canvas',{cls:'sfc-loupe'});
    this.lens.width=lensSize;this.lens.height=lensSize;
    this.lens.style.width=`${lensSize}px`;this.lens.style.height=`${lensSize}px`;
    this.lens.style.display='none';
    this.quad=insetQuad(this.natW,this.natH);
    this.canvas.addEventListener('pointerdown',this.pointerDown);
    this.canvas.addEventListener('pointermove',this.pointerMove);
    this.canvas.addEventListener('pointerup',this.pointerUp);
    this.canvas.addEventListener('pointercancel',this.pointerUp);
    this.draw();
  }
  private sampled:ImageData|null=null;
  /** Downscaled pixels of the photo (cached), used for live previews. */
  sampleData():ImageData {
    if(!this.sampled)this.sampled=this.view.getContext('2d',{willReadFrequently:true})!.getImageData(0,0,this.view.width,this.view.height);
    return this.sampled;
  }
  /** Put back a frame set aside earlier (used when auto-detect-all is switched off). */
  restore(q:Quad,origin:'auto'|'user'|'restored'):void {
    this.quad=q.map(v=>({...v})) as Quad;this.cycle=null;this.autoResult=false;this.origin=origin;
    this.draw();this.onChange(true);
  }
  setQuad(q:Quad):void {this.quad=q.map(v=>({...v})) as Quad;this.cycle=null;this.autoResult=false;this.origin='user';this.draw();this.onChange(true);}
  /** With crop off the frame is hidden and cannot be edited. */
  setEnabled(on:boolean):void {
    this.enabled=on;
    this.canvas.style.cursor=on?'crosshair':'default';
    this.cycle=null;this.draw();
  }
  /** Candidate vertices currently on screen (after pressing 1-4). */
  private shown():{corner:number;list:Point[]}|null {
    return this.cycle?{corner:this.cycle.corner,list:this.cycle.list}:null;
  }
  /** Make this editor the target of the 1-4 keys. */
  focus():void {activeEditor=this;}
  private initial:{quad:Quad;origin:'auto'|'user'|'restored';auto:boolean}|null=null;
  /** Remember the frame the editor opened with; Reset returns to it (the state before this round of adjustments). */
  markInitial():void {this.initial={quad:this.quad.map(v=>({...v})) as Quad,origin:this.origin,auto:this.autoResult};}
  reset():void {
    const i=this.initial;
    if(i){this.quad=i.quad.map(v=>({...v})) as Quad;this.autoResult=i.auto;this.origin=i.origin==='auto'?'auto':'user';}
    else{this.quad=insetQuad(this.natW,this.natH);this.autoResult=false;this.origin='user';}
    this.cycle=null;this.draw();this.onChange(true);
  }
  /** Key 1-4: jump that corner to the next candidate vertex, best edge support first (line intersections and line/photo-border crossings, then the photo/inset corners). */
  cycleCorner(corner:number,dir:1|-1):void {
    this.ensureCandidates();
    if(!this.cycle||this.cycle.corner!==corner){
      const cur=this.quad[corner];
      const extras:(Point&{score?:number})[]=[insetQuad(this.natW,this.natH)[corner],[{x:0,y:0},{x:this.natW,y:0},{x:this.natW,y:this.natH},{x:0,y:this.natH}][corner]];
      const list=[...this.candidates[corner],...extras]
        .filter((c,i,all)=>dist(c,cur)>this.natW*0.004&&all.findIndex(o=>dist(o,c)<this.natW*0.004)===i)
        .filter(c=>{const q=this.quad.map(v=>({...v})) as Quad;q[corner]=c;return isValidQuad(q,this.natW,this.natH);})
        .sort((a,b)=>((b.score??-1)-(a.score??-1))||(dist(a,cur)-dist(b,cur)))
        .slice(0,8);
      list.push({...cur}); // last stop returns to where the corner started
      this.cycle={corner,list,index:-1};
    }
    const c=this.cycle;
    if(c.list.length<2){this.draw();return;}
    c.index=(c.index+dir+c.list.length)%c.list.length;
    const q=this.quad.map(v=>({...v})) as Quad;
    q[corner]=c.list[c.index];
    this.quad=q;this.autoResult=false;this.origin='user';
    this.draw();this.onChange(true);
  }
  private candidatesPending=false;
  private runDetection() {
    const scale=Math.min(1,640/Math.max(this.natW,this.natH));
    const t=document.createElement('canvas');t.width=Math.round(this.natW*scale);t.height=Math.round(this.natH*scale);
    const ctx=t.getContext('2d',{willReadFrequently:true});
    if(!ctx)return null;
    ctx.drawImage(this.view,0,0,t.width,t.height);
    const detection=detectSlide(ctx.getImageData(0,0,t.width,t.height),{trim:currentTrim});
    const toNat=(p:Point)=>({x:p.x*this.natW/t.width,y:p.y*this.natH/t.height});
    return {detection,toNat};
  }
  /** Candidate vertices are only computed when first needed when a saved frame was restored. */
  private ensureCandidates():void {
    if(!this.candidatesPending)return;
    this.candidatesPending=false;
    const r=this.runDetection();
    if(r)this.candidates=r.detection.corners.map(list=>list.map(c=>({...r.toNat(c),score:c.score})));
  }
  /** Returns true when the detector is confident. With `preset` (a frame restored from an earlier save) no detection runs; the frame is just set. */
  autoDetect(preset?:Quad):boolean {
    if(preset){
      this.quad=preset.map(v=>({...v})) as Quad;
      this.candidatesPending=true;this.cycle=null;this.autoResult=false;this.origin='restored';
      this.draw();this.onChange(true);
      return false;
    }
    const r=this.runDetection();
    if(!r)return false;
    this.candidatesPending=false;
    this.quad=r.detection.quad.map(r.toNat) as Quad;
    this.candidates=r.detection.corners.map(list=>list.map(c=>({...r.toNat(c),score:c.score})));
    this.cycle=null;this.autoResult=r.detection.confident;this.origin='auto';
    this.draw();this.onChange(true);
    return this.autoResult;
  }
  draw():void {
    const ctx=this.canvas.getContext('2d');if(!ctx)return;
    const w=this.canvas.width,h=this.canvas.height;
    ctx.clearRect(0,0,w,h);
    ctx.drawImage(this.view,0,0,w,h);
    if(!this.enabled)return;
    // The canvas is shown scaled down, so size every mark in on-screen pixels (u = canvas px per screen px).
    const u=Math.max(1,w/Math.max(1,this.canvas.getBoundingClientRect().width));
    const q=this.quad.map(p=>({x:p.x*w/this.natW,y:p.y*h/this.natH}));
    ctx.fillStyle='rgba(0,0,0,.38)';
    ctx.beginPath();ctx.rect(0,0,w,h);ctx.moveTo(q[0].x,q[0].y);
    for(let i=1;i<4;i++)ctx.lineTo(q[i].x,q[i].y);
    ctx.closePath();ctx.fill('evenodd');
    ctx.lineJoin='round';ctx.lineCap='round';
    for(let i=0;i<4;i++){
      const a=q[i],b=q[(i+1)%4],on=this.active?.kind==='edge'&&this.active.index===i;
      ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);
      ctx.strokeStyle='rgba(0,0,0,.5)';ctx.lineWidth=(on?5:4)*u;ctx.stroke();
      ctx.strokeStyle=on?'#ffffff':'#4be2d2';ctx.lineWidth=(on?2.5:1.6)*u;ctx.stroke();
    }
    // Edge handles: small pills at the midpoints
    for(let i=0;i<4;i++){
      const a=q[i],b=q[(i+1)%4],on=this.active?.kind==='edge'&&this.active.index===i;
      const ang=Math.atan2(b.y-a.y,b.x-a.x);
      ctx.save();ctx.translate((a.x+b.x)/2,(a.y+b.y)/2);ctx.rotate(ang);
      const pw=(on?22:18)*u,ph=(on?9:7)*u;
      ctx.beginPath();ctx.roundRect(-pw/2,-ph/2,pw,ph,ph/2);
      ctx.fillStyle=on?'#ffffff':'rgba(12,52,64,.85)';ctx.fill();
      ctx.strokeStyle=on?'#4be2d2':'#4be2d2';ctx.lineWidth=1.5*u;ctx.stroke();
      ctx.restore();
    }
    const shown=this.shown();
    if(shown){
      const cur=this.quad[shown.corner];
      for(const c of shown.list){
        const x=c.x*w/this.natW,y=c.y*h/this.natH,on=dist(c,cur)<1;
        ctx.beginPath();ctx.arc(x,y,(on?8:6)*u,0,2*Math.PI);
        ctx.strokeStyle='rgba(0,0,0,.55)';ctx.lineWidth=4*u;ctx.stroke();
        ctx.strokeStyle=on?'#ffffff':'#ffd166';ctx.lineWidth=2*u;ctx.stroke();
      }
    }
    const cx=(q[0].x+q[1].x+q[2].x+q[3].x)/4,cy=(q[0].y+q[1].y+q[2].y+q[3].y)/4;
    for(let i=0;i<4;i++){
      const p=q[i],on=(this.active?.kind==='corner'&&this.active.index===i)||shown?.corner===i;
      // Corner handle: an L-shaped bracket hugging the frame, so the exact corner stays visible and it reads
      // differently from the round candidate rings and from the numbered key cap below.
      const prev=q[(i+3)%4],next=q[(i+1)%4];
      const unit=(t:Point)=>{const dx=t.x-p.x,dy=t.y-p.y,l=Math.hypot(dx,dy)||1;return {x:dx/l,y:dy/l,l};};
      const d1=unit(prev),d2=unit(next);
      const leg=Math.min((on?24:19)*u,d1.l*0.4,d2.l*0.4);
      ctx.beginPath();ctx.moveTo(p.x+d1.x*leg,p.y+d1.y*leg);ctx.lineTo(p.x,p.y);ctx.lineTo(p.x+d2.x*leg,p.y+d2.y*leg);
      ctx.strokeStyle='rgba(0,0,0,.55)';ctx.lineWidth=(on?7:6)*u;ctx.stroke();
      ctx.strokeStyle=on?'#ffffff':'#4be2d2';ctx.lineWidth=(on?4:3.2)*u;ctx.stroke();
      // Number as a keyboard key cap (the number is also the key that cycles this corner), set well away from the corner.
      let dx=p.x-cx,dy=p.y-cy;const dl=Math.hypot(dx,dy)||1;dx/=dl;dy/=dl;
      const k=22*u,half=k/2,m=half+3*u;
      const bx=Math.min(w-m,Math.max(m,p.x+dx*34*u)),by=Math.min(h-m,Math.max(m,p.y+dy*34*u));
      ctx.beginPath();ctx.roundRect(bx-half,by-half+2*u,k,k,6*u);ctx.fillStyle='rgba(0,0,0,.5)';ctx.fill();
      ctx.beginPath();ctx.roundRect(bx-half,by-half,k,k,6*u);
      ctx.fillStyle=on?'#4be2d2':'#f4f6f7';ctx.fill();
      ctx.strokeStyle='rgba(0,0,0,.35)';ctx.lineWidth=1.2*u;ctx.stroke();
      ctx.font=`700 ${13*u}px -apple-system, "SF Pro Text", "Segoe UI", sans-serif`;
      ctx.textAlign='center';ctx.textBaseline='middle';
      ctx.fillStyle='#0c3440';ctx.fillText(String(i+1),bx,by+0.5*u);
    }
  }
  /** Called by the plugin's key handler; returns true when the key was used. */
  handleKey(key:string,shift:boolean):boolean {
    if(!this.enabled||!this.canvas.isConnected||!'1234'.includes(key)||key.length!==1)return false;
    this.cycleCorner(Number(key)-1,shift?-1:1);
    return true;
  }
  private location(event:PointerEvent):Point {
    const rect=this.canvas.getBoundingClientRect();
    return {x:(event.clientX-rect.left)/rect.width*this.natW,y:(event.clientY-rect.top)/rect.height*this.natH};
  }
  /** A visible candidate dot under the pointer (ignoring the one the corner already sits on). */
  private hitCandidate(p:Point):number {
    if(!this.cycle||this.dragging)return -1;
    const k=this.natW/Math.max(1,this.canvas.getBoundingClientRect().width);
    const cur=this.quad[this.cycle.corner];
    let best=-1,bestDist=10*k;
    this.cycle.list.forEach((c,i)=>{
      if(dist(c,cur)<12*k)return;
      const d=dist(c,p);if(d<bestDist){best=i;bestDist=d;}
    });
    return best;
  }
  private hit(p:Point):{kind:'corner'|'edge';index:number}|null {
    const rect=this.canvas.getBoundingClientRect();
    const k=this.natW/Math.max(1,rect.width);
    let best=-1,bestDist=22*k;
    this.quad.forEach((c,i)=>{const d=dist(c,p);if(d<bestDist){best=i;bestDist=d;}});
    if(best>=0)return {kind:'corner',index:best};
    bestDist=12*k;
    for(let i=0;i<4;i++){
      const d=distToSegment(p,this.quad[i],this.quad[(i+1)%4]);
      if(d<bestDist){best=i;bestDist=d;}
    }
    return best>=0?{kind:'edge',index:best}:null;
  }
  private pointerDown=(event:PointerEvent):void=>{
    activeEditor=this;
    if(!this.enabled)return;
    const location=this.location(event);
    const ci=this.hitCandidate(location);
    if(ci>=0&&this.cycle){
      // Clicking a candidate applies it.
      const corner=this.cycle.corner,q=this.quad.map(v=>({...v})) as Quad;
      q[corner]=this.cycle.list[ci];
      if(isValidQuad(q,this.natW,this.natH)){this.quad=q;this.cycle.index=ci;this.autoResult=false;this.origin='user';this.draw();this.onChange(true);}
      event.preventDefault();return;
    }
    const hit=this.hit(location);
    if(!hit)return;
    this.ensureCandidates();
    if(!(hit.kind==='corner'&&this.cycle?.corner===hit.index))this.cycle=null;
    this.autoResult=false;this.origin='user';
    this.active=hit;this.dragging=true;
    this.startQuad=this.quad.map(v=>({...v})) as Quad;this.startPoint=location;
    this.canvas.setPointerCapture(event.pointerId);
    this.draw();this.drawLens(location);
    event.preventDefault();
  };
  private pointerMove=(event:PointerEvent):void=>{
    if(!this.enabled)return;
    const p=this.location(event);
    if(!this.dragging||!this.active||!this.startQuad||!this.startPoint){
      if(this.hitCandidate(p)>=0){this.canvas.style.cursor='pointer';return;}
      const hit=this.hit(p);
      this.canvas.style.cursor=hit?(hit.kind==='corner'?'grab':'move'):'crosshair';
      return;
    }
    const w=this.natW,h=this.natH;
    if(this.active.kind==='corner'){
      const q=this.quad.map(v=>({...v})) as Quad;
      const target={x:Math.min(w,Math.max(0,p.x)),y:Math.min(h,Math.max(0,p.y))};
      q[this.active.index]=target;
      // Reject crossed corners; the output always uses a convex polygon.
      if(isValidQuad(q,w,h))this.quad=q;
    }else{
      const i=this.active.index,j=(i+1)%4,s=this.startQuad;
      const ex=s[j].x-s[i].x,ey=s[j].y-s[i].y,len=Math.hypot(ex,ey)||1;
      const nx=-ey/len,ny=ex/len;
      const amount=(p.x-this.startPoint.x)*nx+(p.y-this.startPoint.y)*ny;
      // Back off until the moved edge is valid, so the edge stops at the photo border instead of sticking.
      for(let f=1,tries=0;tries<14;tries++,f*=0.8){
        const q=s.map(v=>({...v})) as Quad;
        q[i]={x:s[i].x+nx*amount*f,y:s[i].y+ny*amount*f};
        q[j]={x:s[j].x+nx*amount*f,y:s[j].y+ny*amount*f};
        if(isValidQuad(q,w,h)){this.quad=q;break;}
      }
    }
    this.draw();this.drawLens(p);this.onChange(false);
    event.preventDefault();
  };
  private pointerUp=(event:PointerEvent):void=>{
    if(!this.dragging)return;
    this.dragging=false;this.active=null;this.startQuad=null;this.startPoint=null;
    this.lens.style.display='none';
    if(this.canvas.hasPointerCapture(event.pointerId))this.canvas.releasePointerCapture(event.pointerId);
    this.draw();this.onChange(true);
  };
  private drawLens(p:Point):void {
    const ctx=this.lens.getContext('2d');if(!ctx)return;
    const size=this.lensSize,half=size/2,sourceSize=Math.max(32,this.natW/22);
    const k=this.view.width/this.natW;
    ctx.clearRect(0,0,size,size);
    ctx.drawImage(this.view,(p.x-sourceSize/2)*k,(p.y-sourceSize/2)*k,sourceSize*k,sourceSize*k,0,0,size,size);
    ctx.strokeStyle='#4be2d2';ctx.lineWidth=1.5;
    ctx.beginPath();ctx.moveTo(half,0);ctx.lineTo(half,size);ctx.moveTo(0,half);ctx.lineTo(size,half);ctx.stroke();
    this.lens.style.display='block';
  }
}

class CorrectSlideModal extends Modal {
  private img:HTMLImageElement|null=null;
  private source:TFile|null=null;
  private base:Baseline|null=null;
  private release:(()=>void)|null=null;
  private editor:QuadEditor|null=null;
  private preview!:HTMLCanvasElement;
  private info!:HTMLDivElement;
  private saveButton!:HTMLButtonElement;
  private autoButton!:HTMLButtonElement;
  private resetButton!:HTMLButtonElement;
  private toolbar!:{setCropEnabled:(on:boolean)=>void};
  private timer:number|null=null;
  private previewData:ImageData|null=null;
  private busy=false;
  constructor(app:App,private plugin:SlideFrameCorrector,private entry:Entry) {super(app);}

  async onOpen():Promise<void> {
    this.modalEl.addClass('sfc-modal');
    this.titleEl.setText(t('Correct projected slide'));
    this.info=this.contentEl.createDiv({cls:'sfc-help'});
    this.toolbar=buildToolbar(this.contentEl,this.plugin,{
      onCrop:on=>{this.editor?.setEnabled(on);this.requestPreview(false);},
      onAspect:()=>this.requestPreview(false),
      onTrim:()=>{if(this.editor?.origin==='auto')this.editor.autoDetect();}, // re-run only if the frame is still the detector's own
      onColor:()=>this.requestPreview(false),
      onTone:()=>this.requestPreview(false),
      frameExtras:body=>{
        this.autoButton=iconButton(body,'sparkles','Auto-detect',()=>this.editor?.autoDetect());
        this.resetButton=iconButton(body,'rotate-ccw','Reset corners',()=>this.editor?.reset());
      },
    });

    const body=this.contentEl.createDiv({cls:'sfc-body'});
    const panels=body.createDiv({cls:'sfc-panels'});
    const left=panels.createDiv({cls:'sfc-panel'});
    left.createEl('div',{cls:'sfc-label',text:t('1 · Adjust frame')});
    const stage=left.createDiv({cls:'sfc-stage'});
    left.createDiv({cls:'sfc-help sfc-keyhint',text:t(KEY_HINT)});
    const right=panels.createDiv({cls:'sfc-panel'});
    right.createEl('div',{cls:'sfc-label',text:t('2 · Corrected preview')});
    const prevWrap=right.createDiv({cls:'sfc-preview-wrap'});
    this.preview=prevWrap.createEl('canvas',{cls:'sfc-preview'});
    const footer=this.contentEl.createDiv({cls:'sfc-footer'});
    buildFileBar(footer.createDiv({cls:'sfc-footer-left'}),this.plugin,body=>{
      iconButton(body,'ellipsis','More',ev=>showInfoMenu(ev,fileRows(this.entry,this.source)),{iconOnly:true,fallback:'⋯'});
    });
    const buttons=footer.createDiv({cls:'sfc-footer-buttons'});
    addButton(buttons,'Cancel',()=>this.close());
    this.saveButton=addButton(buttons,'Save & replace in note',()=>void this.save());
    this.saveButton.addClass('mod-cta');this.saveButton.disabled=true;
    try {
      const src=resolveSource(this.app,this.plugin,this.entry);
      this.source=src.file;
      const {img,release}=await loadImageFile(this.app,src.file);
      this.img=img;this.release=release;
      if(!src.fromOriginal&&isProcessed(this.entry.file))this.info.setText(t('Original photo not found — editing the processed image.'));
      const pscale=Math.min(1,1150/Math.max(img.naturalWidth,img.naturalHeight));
      const p=document.createElement('canvas');p.width=Math.round(img.naturalWidth*pscale);p.height=Math.round(img.naturalHeight*pscale);
      const pc=p.getContext('2d',{willReadFrequently:true});
      if(!pc)throw new Error('Canvas is unavailable');
      pc.drawImage(img,0,0,p.width,p.height);
      this.previewData=pc.getImageData(0,0,p.width,p.height);
      this.editor=new QuadEditor(stage,img,final=>{
        setAutoBadge(this.autoButton,'Auto-detect',this.editor?.autoResult??false);
        if(final&&this.editor)noteDraft(this.plugin,src.file,this.editor,!!this.base&&!isModified(this.base,this.editor.quad,outPrefs(this.plugin.prefs),this.editor.natW,this.editor.natH));
        this.requestPreview(!final);
      });
      this.editor.focus();
      const recQuad=usableQuad(src.rec,img);
      this.editor.autoDetect(usableQuad(this.plugin.drafts[src.file.path]??src.rec,img));
      this.editor.markInitial();
      if(isProcessed(this.entry.file))this.base={quad:(recQuad??this.editor.quad).map(v=>({...v})) as Quad,prefs:src.rec?.prefs??outPrefs(this.plugin.prefs)};
      this.editor.setEnabled(this.plugin.prefs.crop);
      this.toolbar.setCropEnabled(this.plugin.prefs.crop);
      this.saveButton.disabled=false;
    }catch(err){
      this.info.setText(t('Image could not be opened: {0}',String(err)));
      new Notice(t('Could not open slide photo.'));
    }
  }
  onClose():void {
    if(this.timer!==null)window.clearTimeout(this.timer);
    this.release?.();
    this.contentEl.empty();
  }
  private requestPreview(dragging:boolean):void {
    if(!this.editor||!this.previewData)return;
    if(this.timer!==null)window.clearTimeout(this.timer);
    this.timer=window.setTimeout(()=>{this.timer=null;this.renderPreview();},dragging?170:20);
  }
  private renderPreview():void {
    if(!this.editor||!this.previewData)return;
    const src=this.previewData;
    const sx=src.width/this.editor.natW,sy=src.height/this.editor.natH;
    const q=this.editor.quad.map(p=>({x:p.x*sx,y:p.y*sy})) as Quad;
    try {
      const processed=makeOutput(src,q,this.plugin.prefs,680);
      this.preview.width=processed.width;this.preview.height=processed.height;
      this.preview.getContext('2d')?.putImageData(processed,0,0);
    }catch(err){this.info.setText(t('Please adjust the crop corners: {0}',String(err)));}
  }
  private async save():Promise<void> {
    if(!this.img||!this.editor||this.busy)return;
    if(this.base&&!isModified(this.base,this.editor.quad,outPrefs(this.plugin.prefs),this.editor.natW,this.editor.natH)){
      new Notice(t('No changes — nothing to save.'));this.close();return;
    }
    this.busy=true;this.saveButton.disabled=true;this.saveButton.setText(t('Saving…'));
    try {
      const saved=await saveCorrection(this.app,this.entry,this.source??this.entry.file,this.img,this.editor.quad,this.plugin.prefs);
      this.plugin.clearDraft((this.source??this.entry.file).path);
      this.plugin.addRecord(saved.path,{src:(this.source??this.entry.file).path,quad:this.editor.quad.map(v=>({...v})) as Quad,w:this.img.naturalWidth,h:this.img.naturalHeight,prefs:outPrefs(this.plugin.prefs)});
      new Notice(t('Saved corrected slide.'));
      this.close();
    }catch(err){
      new Notice(t('Could not save corrected slide: {0}',err instanceof Error?err.message:String(err)),6500);
      this.info.setText(t('Save failed. The original image and embed were not overwritten.'));
    }finally{
      this.busy=false;
      if(this.saveButton?.isConnected){this.saveButton.disabled=false;this.saveButton.setText(t('Save & replace in note'));}
    }
  }
}

type Card = {
  entry:Entry; source:TFile|null; processed:boolean; root:HTMLDivElement|null; editor:QuadEditor|null; status:HTMLDivElement|null;
  prev:{quad:Quad;origin:'auto'|'user'|'restored'}|null; refit:(()=>void)|null; reason:HTMLDivElement|null; base:Baseline|null; include:HTMLInputElement|null; autoBtn:HTMLButtonElement|null; preview:HTMLCanvasElement|null; timer:number|null; loading:boolean; saved:boolean; failed:boolean;
};

/** Dashboard: every embedded photo in the note as a card with its own editable frame. */
class BatchModal extends Modal {
  private cards:Card[];
  private grid!:HTMLDivElement;
  private summary!:HTMLDivElement;
  private saveButton!:HTMLButtonElement;
  private countEl!:HTMLDivElement;
  private master!:HTMLInputElement;
  private defaultInclude=true;
  private autoAll=false;
  private observers:ResizeObserver[]=[];
  private empty!:HTMLDivElement;
  private showProcessed=false;
  private busy=false;
  private closed=false;
  private pumping=false;
  constructor(app:App,private plugin:SlideFrameCorrector,entries:Entry[]) {
    super(app);
    this.cards=entries.map(entry=>({entry,source:null,processed:isProcessed(entry.file),root:null,editor:null,status:null,prev:null,refit:null,reason:null,base:null,include:null,autoBtn:null,preview:null,timer:null,loading:false,saved:false,failed:false}));
  }
  onOpen():void {
    this.modalEl.addClass('sfc-modal');
    this.modalEl.addClass('sfc-batch-modal');
    this.titleEl.setText(t('Slide photos in this note'));
    buildToolbar(this.contentEl,this.plugin,{
      onCrop:on=>{for(const c of this.cards)c.editor?.setEnabled(on);this.refreshPreviews();},
      onAspect:()=>this.refreshPreviews(),
      onTrim:()=>{for(const c of this.cards)if(c.editor?.origin==='auto')c.editor.autoDetect();},
      onColor:()=>this.refreshPreviews(),
      onTone:()=>this.refreshPreviews(),
      frameExtras:body=>{
        addSwitch(body,'Auto-detect all',false,on=>{
          this.autoAll=on;
          for(const c of this.visible())if(on)this.applyAuto(c);else this.undoAuto(c);
        },undefined,'sparkles');
      },
    });
    this.summary=this.contentEl.createDiv({cls:'sfc-help'});
    const body=this.contentEl.createDiv({cls:'sfc-body'});
    this.grid=body.createDiv({cls:'sfc-grid'});
    this.empty=body.createDiv({cls:'sfc-empty sfc-help'});
    const footer=this.contentEl.createDiv({cls:'sfc-footer'});
    buildFileBar(footer.createDiv({cls:'sfc-footer-left'}),this.plugin,body=>{
      addSwitch(body,'Show processed',false,on=>{this.showProcessed=on;this.render();},undefined,'eye');
      const all=body.createEl('label',{cls:'sfc-ctl'});
      this.master=all.createEl('input',{attr:{type:'checkbox'}});
      this.master.checked=true;
      ctlLabel(all,'Select all','list-checks');
      this.master.addEventListener('change',()=>{
        this.defaultInclude=this.master.checked;
        for(const c of this.visible())if(c.include&&!c.include.disabled)c.include.checked=this.defaultInclude;
        this.updateSave();
      });
    });
    const right=footer.createDiv({cls:'sfc-footer-right'});
    const buttons=right.createDiv({cls:'sfc-footer-buttons'});
    addButton(buttons,'Close',()=>this.close());
    this.saveButton=addButton(buttons,'Save',()=>void this.saveAll());
    this.saveButton.addClass('mod-cta');
    this.countEl=right.createDiv({cls:'sfc-help sfc-count'});
    this.render();
  }
  onClose():void {
    this.closed=true;
    for(const c of this.cards)if(c.timer!==null)window.clearTimeout(c.timer);
    for(const o of this.observers)o.disconnect();
    this.contentEl.empty();
  }
  /** Tint the whole card when saving it would produce something new, and say what is different. */
  private paintChange(c:Card):void {
    if(!c.root||!c.reason)return;
    const on=!!c.editor&&!c.saved&&this.changed(c);
    c.root.toggleClass('sfc-changed-card',on);
    let text='';
    if(on){
      if(!c.processed)text=t('New photo');
      else if(c.base&&c.editor){
        const parts=modifiedParts(c.base,c.editor.quad,outPrefs(this.plugin.prefs),c.editor.natW,c.editor.natH);
        text=t('Changed: {0}',parts.map(x=>t(x)).join(t(', ')));
      }
    }
    c.reason.setText(text);
  }
  private refreshPreviews():void {for(const c of this.cards)if(c.editor)this.schedulePreview(c,20);this.updateSave();}
  /** New photos always need saving; processed ones only if the frame or output settings moved since the last save. */
  private changed(c:Card):boolean {
    if(!c.processed)return true;
    if(!c.base||!c.editor)return false;
    return isModified(c.base,c.editor.quad,outPrefs(this.plugin.prefs),c.editor.natW,c.editor.natH);
  }
  private schedulePreview(card:Card,delay=120):void {
    if(card.timer!==null)window.clearTimeout(card.timer);
    card.timer=window.setTimeout(()=>{card.timer=null;this.renderPreview(card);},delay);
  }
  private renderPreview(card:Card):void {
    if(!card.editor||!card.preview||this.closed)return;
    const src=card.editor.sampleData();
    const sx=src.width/card.editor.natW,sy=src.height/card.editor.natH;
    const q=card.editor.quad.map(p=>({x:p.x*sx,y:p.y*sy})) as Quad;
    try {
      const out=makeOutput(src,q,this.plugin.prefs,520);
      card.preview.width=out.width;card.preview.height=out.height;
      card.preview.getContext('2d')?.putImageData(out,0,0);
      card.refit?.();
    }catch{ /* invalid frame while dragging: keep the last preview */ }
  }
  private visible():Card[] {return this.cards.filter(c=>this.showProcessed||!c.processed);}
  private render():void {
    const visible=this.visible();
    for(const card of this.cards){
      const show=visible.includes(card);
      if(show&&!card.root)this.buildCard(card);
      if(card.root)card.root.style.display=show?'':'none';
    }
    const hidden=this.cards.length-visible.length;
    this.empty.setText(visible.length?'':t('All {0} photos in this note are already processed. Tick “Show processed” to re-edit one.',this.cards.length));
    this.empty.style.display=visible.length?'none':'';
    this.summary.setText(t('{0} shown',visible.length)+(hidden?t(' · {0} processed hidden',hidden):'')+' · '+t(KEY_HINT));
    this.updateSave();
    void this.pump();
  }
  private buildCard(card:Card):void {
    const root=this.grid.createDiv({cls:'sfc-card'});
    const head=root.createDiv({cls:'sfc-card-head'});
    const label=head.createEl('label',{cls:'sfc-card-name'});
    const include=label.createEl('input',{attr:{type:'checkbox'}});
    include.checked=this.defaultInclude;
    include.addEventListener('change',()=>this.updateSave());
    label.createEl('span',{text:t('Photo {0}',this.cards.indexOf(card)+1)});
    const tools=head.createDiv({cls:'sfc-card-tools'});
    card.autoBtn=addButton(tools,'Auto',()=>{card.editor?.autoDetect();});
    addButton(tools,'Reset',()=>{card.editor?.reset();});
    const more=addButton(tools,'⋯',ev=>showInfoMenu(ev,fileRows(card.entry,card.source)));
    more.addClass('sfc-more');more.setAttribute('aria-label',t('More'));
    card.reason=root.createDiv({cls:'sfc-reason'});
    card.status=root.createDiv({cls:'sfc-help',text:t('Loading…')});
    root.addEventListener('pointerdown',()=>this.select(card),true);
    root.createDiv({cls:'sfc-stage'});
    const prev=root.createDiv({cls:'sfc-preview-wrap sfc-card-preview'});
    card.preview=prev.createEl('canvas',{cls:'sfc-preview'});
    card.root=root;card.include=include;
    const stageEl=root.querySelector('.sfc-stage') as HTMLElement;
    const refit=()=>{
      if(card.editor){fitCanvas(card.editor.canvas,stageEl);card.editor.draw();}
      if(card.preview)fitCanvas(card.preview,prev);
    };
    card.refit=refit;
    const ro=new ResizeObserver(refit);ro.observe(stageEl);ro.observe(prev);
    this.observers.push(ro);
  }
  /** Auto-detect, remembering the frame it replaces so unticking the box can bring it back. */
  private applyAuto(card:Card):void {
    if(!card.editor)return;
    if(!card.prev)card.prev={quad:card.editor.quad.map(v=>({...v})) as Quad,origin:card.editor.origin};
    card.editor.autoDetect();
  }
  /** Restore the earlier frame, unless the user has dragged this one since. */
  private undoAuto(card:Card):void {
    const prev=card.prev;card.prev=null;
    if(!prev||!card.editor||card.editor.origin!=='auto')return;
    card.editor.restore(prev.quad,prev.origin==='auto'?'auto':'user');
  }
  private select(card:Card):void {
    for(const c of this.cards)c.root?.toggleClass('sfc-selected',c===card);
    card.editor?.focus();
  }
  /** Loads cards one at a time so a long note stays responsive. */
  private async pump():Promise<void> {
    if(this.pumping)return;
    this.pumping=true;
    try {
      for(;;){
        if(this.closed)return;
        const card=this.visible().find(c=>c.root&&!c.editor&&!c.loading&&!c.failed);
        if(!card)return;
        card.loading=true;
        try {
          const src=resolveSource(this.app,this.plugin,card.entry);
          card.source=src.file;
          const {img,release}=await loadImageFile(this.app,src.file);
          try {
            if(this.closed)return;
            const stage=card.root!.querySelector('.sfc-stage') as HTMLElement;
            const editor=new QuadEditor(stage,img,final=>{if(card.autoBtn)setAutoBadge(card.autoBtn,'Auto',editor.autoResult);if(final)noteDraft(this.plugin,src.file,editor,!!card.base&&!isModified(card.base,editor.quad,outPrefs(this.plugin.prefs),editor.natW,editor.natH));this.schedulePreview(card);this.updateSave();},900,100);
            card.editor=editor;
            card.refit?.();
            const recQuad=usableQuad(src.rec,img);
            editor.autoDetect(usableQuad(this.plugin.drafts[src.file.path]??src.rec,img));
            editor.markInitial();
            if(card.processed)card.base={quad:(recQuad??editor.quad).map(v=>({...v})) as Quad,prefs:src.rec?.prefs??outPrefs(this.plugin.prefs)};
            editor.setEnabled(this.plugin.prefs.crop);
            if(this.autoAll)this.applyAuto(card);
            card.status?.setText('');
            if(!this.cards.some(c=>c.root?.hasClass('sfc-selected')))this.select(card);
          }finally{release();}
        }catch(err){
          card.failed=true;
          card.status?.setText(t('Could not open: {0}',err instanceof Error?err.message:String(err)));
          card.status?.addClass('sfc-warn');
          if(card.include){card.include.checked=false;card.include.disabled=true;}
        }finally{card.loading=false;}
        this.updateSave();
        await new Promise(r=>window.setTimeout(r,0));
      }
    }finally{this.pumping=false;}
  }
  private selected():Card[] {
    return this.visible().filter(c=>c.include?.checked&&c.editor&&!c.saved);
  }
  private updateSave():void {
    if(!this.saveButton)return;
    const sel=this.selected(),n=sel.filter(c=>this.changed(c)).length,visible=this.visible();
    this.saveButton.setText(t('Save'));
    this.saveButton.disabled=this.busy||n===0;
    this.countEl.setText(t('{0}/{1} selected changed',n,sel.length));
    for(const c of this.cards)this.paintChange(c);
    const eligible=visible.filter(c=>c.include&&!c.include.disabled);
    const checked=eligible.filter(c=>c.include!.checked).length;
    this.master.checked=eligible.length>0&&checked===eligible.length;
    this.master.indeterminate=checked>0&&checked<eligible.length;
    this.master.disabled=eligible.length===0;
  }
  private async saveAll():Promise<void> {
    if(this.busy)return;
    // Replace later embeds first so earlier offsets in the note stay valid.
    const skipped=this.selected().filter(c=>!this.changed(c)).length;
    const todo=this.selected().filter(c=>this.changed(c)).sort((a,b)=>a.entry.note.path===b.entry.note.path?b.entry.ref.start-a.entry.ref.start:0);
    if(!todo.length)return;
    this.busy=true;this.updateSave();
    let ok=0,bad=0;
    for(const [i,card] of todo.entries()){
      this.saveButton.setText(t('Saving {0}/{1}…',i+1,todo.length));
      card.status?.setText(t('Saving…'));card.status?.removeClass('sfc-warn');
      let release:(()=>void)|null=null;
      try {
        const source=card.source??card.entry.file;
        const loaded=await loadImageFile(this.app,source);
        release=loaded.release;
        const quad=card.editor!.quad.map(v=>({...v})) as Quad;
        const saved=await saveCorrection(this.app,card.entry,source,loaded.img,quad,this.plugin.prefs);
        this.plugin.clearDraft(source.path);
        this.plugin.addRecord(saved.path,{src:source.path,quad,w:loaded.img.naturalWidth,h:loaded.img.naturalHeight,prefs:outPrefs(this.plugin.prefs)});
        card.base=card.processed?{quad,prefs:outPrefs(this.plugin.prefs)}:null;
        card.saved=true;ok++;
        card.status?.setText(t('Saved ✓'));
        card.root?.addClass('sfc-saved');
        if(card.include){card.include.checked=false;card.include.disabled=true;}
      }catch(err){
        bad++;
        card.status?.setText(t('Failed: {0}',err instanceof Error?err.message:String(err)));
        card.status?.addClass('sfc-warn');
      }finally{release?.();}
    }
    this.busy=false;
    new Notice((bad?t('Saved {0} corrected slide(s); {1} failed (see the dashboard).',ok,bad):t('Saved {0} corrected slide(s).',ok))+(skipped?' '+t('{0} unchanged skipped.',skipped):''),bad?6500:4000);
    if(!bad&&!this.closed)this.close();else this.updateSave();
  }
}

class CleanOriginalsModal extends Modal {
  constructor(app:App,private plugin:SlideFrameCorrector,private files:TFile[]) {super(app);}
  onOpen():void {
    this.titleEl.setText(t('Clean processed originals?'));
    this.contentEl.createDiv({cls:'sfc-help',text:t('{0} original photo(s) already have a corrected version and are not used in any note. They will be moved to the trash (according to your Obsidian “Deleted files” setting).',this.files.length)});
    const list=this.contentEl.createEl('ul',{cls:'sfc-clean-list'});
    for(const f of this.files)list.createEl('li',{text:f.path});
    const buttons=this.contentEl.createDiv({cls:'sfc-footer-buttons sfc-clean-buttons'});
    addButton(buttons,'Cancel',()=>this.close());
    const go=addButton(buttons,t('Move {0} to trash',this.files.length),()=>void this.run(go));
    go.addClass('mod-warning');
  }
  private async run(btn:HTMLButtonElement):Promise<void> {
    btn.disabled=true;
    let n=0;
    for(const f of this.files){
      try {await this.app.fileManager.trashFile(f);n++;this.plugin.forgetOriginal(f.path);}
      catch(err){new Notice(`${f.path}: ${err instanceof Error?err.message:String(err)}`,6000);}
    }
    new Notice(t('Moved {0} original photo(s) to the trash.',n));
    this.close();
  }
  onClose():void {this.contentEl.empty();}
}

class SlideFrameSettingTab extends PluginSettingTab {
  constructor(app:App,private plugin:SlideFrameCorrector) {super(app,plugin);}
  display():void {
    const {containerEl}=this;
    containerEl.empty();
    const dropdown=(name:string,desc:string,opts:Opt[],key:keyof Prefs,rerender=false)=>{
      new Setting(containerEl).setName(t(name)).setDesc(t(desc)).addDropdown(d=>{
        for(const [caption,value] of opts)d.addOption(value,t(caption));
        d.setValue(String(this.plugin.prefs[key])).onChange(v=>{this.plugin.setPref(key,v as never);if(rerender)this.display();});
      });
    };
    dropdown('Language','Language of this plugin’s interface. Commands update after reloading Obsidian.',LANG_OPTIONS,'lang',true);
    dropdown('Aspect ratio','Output shape of the corrected slide. These choices are also remembered when you change them in the editor.',ASPECT_OPTIONS,'aspect');
    dropdown('Save as','File format of the corrected image.',FORMAT_OPTIONS,'format');
    new Setting(containerEl).setName(t('Crop to slide')).setDesc(t('Off keeps the whole photo and only applies color/tone.')).addToggle(tg=>tg.setValue(this.plugin.prefs.crop).onChange(v=>this.plugin.setPref('crop',v)));
    dropdown('Edge trim',TRIM_HINT,TRIM_OPTIONS,'trim');
    dropdown('Color correction','Auto white balance and levels. Off keeps the original colors; Strong is the most aggressive.',COLOR_OPTIONS,'color');
    dropdown('Tone','Color, grayscale, or pure black & white (applied after color correction).',TONE_OPTIONS,'tone');
    new Setting(containerEl).setName(t('Clean originals')).setDesc(t('Move original photos that already have a corrected version and are no longer used in any note to the trash. You confirm the list first.'))
      .addButton(b=>b.setButtonText(t('Clean…')).setWarning().onClick(()=>this.plugin.openCleanOriginals()));
  }
}

export default class SlideFrameCorrector extends Plugin {
  prefs:Prefs={...DEFAULT_PREFS};
  /** Last non-off colour strength, restored when the Color switch is turned back on. */
  lastColor:ColorMode='standard';
  /** Output image path -> original photo and the frame that produced it, so re-editing starts from the original. */
  records:Record<string,Rec>={};
  /** Frames the user dragged but did not save, keyed by original photo path. */
  drafts:Record<string,Rec>={};
  private rightClickImage:HTMLImageElement|null=null;
  setPref<K extends keyof Prefs>(key:K,value:Prefs[K]):void {
    this.prefs[key]=value;
    if(key==='lang')setLang(value as Lang);
    if(key==='trim')currentTrim=value as Trim;
    this.persist();
  }
  addRecord(path:string,rec:Rec):void {this.records[path]=rec;this.persist();}
  setDraft(path:string,rec:Rec):void {this.drafts[path]=rec;this.persist();}
  clearDraft(path:string):void {if(this.drafts[path]){delete this.drafts[path];this.persist();}}
  /** Drop records whose original photo was removed, so re-editing falls back gracefully. */
  forgetOriginal(srcPath:string):void {
    for(const [k,r] of Object.entries(this.records))if(r.src===srcPath)delete this.records[k];
    delete this.drafts[srcPath];
    this.persist();
  }
  /** Originals that have a corrected output and are not linked from any note any more. */
  findCleanableOriginals():TFile[] {
    const linked=new Set<string>();
    for(const links of Object.values(this.app.metadataCache.resolvedLinks))for(const target of Object.keys(links))linked.add(target);
    const out=new Map<string,TFile>();
    for(const [outPath,rec] of Object.entries(this.records)){
      const o=this.app.vault.getAbstractFileByPath(outPath),src=this.app.vault.getAbstractFileByPath(rec.src);
      if(o instanceof TFile&&src instanceof TFile&&src.path!==o.path&&!linked.has(src.path))out.set(src.path,src);
    }
    return [...out.values()].sort((a,b)=>a.path.localeCompare(b.path));
  }
  openCleanOriginals():void {
    const files=this.findCleanableOriginals();
    if(!files.length){new Notice(t('Nothing to clean: no original photo has a corrected version that is unused elsewhere.'));return;}
    new CleanOriginalsModal(this.app,this,files).open();
  }
  private persist():void {void this.saveData({...this.prefs,records:this.records,drafts:this.drafts});}
  async onload():Promise<void> {
    const saved=(await this.loadData())??{};
    const pick=<T extends string>(v:unknown,opts:Opt[],fallback:T):T=>opts.some(o=>o[1]===v)?v as T:fallback;
    this.prefs={
      aspect:pick(saved.aspect,ASPECT_OPTIONS,DEFAULT_PREFS.aspect),
      format:pick(saved.format,FORMAT_OPTIONS,DEFAULT_PREFS.format),
      color:pick(saved.color,COLOR_OPTIONS,DEFAULT_PREFS.color),
      tone:pick(saved.tone,TONE_OPTIONS,DEFAULT_PREFS.tone),
      crop:typeof saved.crop==='boolean'?saved.crop:DEFAULT_PREFS.crop,
      lang:pick(saved.lang,LANG_OPTIONS,DEFAULT_PREFS.lang),
      trim:pick(saved.trim,TRIM_OPTIONS,DEFAULT_PREFS.trim)
    };
    setLang(this.prefs.lang);
    if(this.prefs.color!=='off')this.lastColor=this.prefs.color;
    currentTrim=this.prefs.trim;
    this.records=saved.records&&typeof saved.records==='object'?saved.records:{};
    this.drafts=saved.drafts&&typeof saved.drafts==='object'?saved.drafts:{};
    this.registerEvent(this.app.vault.on('rename',(file,oldPath)=>{
      let changed=false;
      if(this.records[oldPath]){this.records[file.path]=this.records[oldPath];delete this.records[oldPath];changed=true;}
      for(const r of Object.values(this.records))if(r.src===oldPath){r.src=file.path;changed=true;}
      if(this.drafts[oldPath]){this.drafts[file.path]={...this.drafts[oldPath],src:file.path};delete this.drafts[oldPath];changed=true;}
      if(changed)this.persist();
    }));
    this.addSettingTab(new SlideFrameSettingTab(this.app,this));
    // Keys 1-4 act on the editor the pointer last entered; typing in inputs/selects is never intercepted.
    this.registerDomEvent(document,'keydown',(event:KeyboardEvent)=>{
      if(!activeEditor||event.ctrlKey||event.metaKey||event.altKey)return;
      const t=event.target;
      if(t instanceof HTMLElement&&(t.isContentEditable||/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)))return;
      if(activeEditor.handleKey(event.key,event.shiftKey)){event.preventDefault();event.stopPropagation();}
    },true);
    this.addCommand({
      id:'correct-slide-in-current-note',
      name:t('Correct one photo'),
      checkCallback:checking=>{
        const view=this.app.workspace.getActiveViewOfType(MarkdownView);
        if(!view?.file)return false;
        if(!checking)void this.fromCommand(view);
        return true;
      }
    });
    this.addCommand({
      id:'batch-correct-slides-in-current-note',
      name:t('Correct all photos'),
      checkCallback:checking=>{
        const view=this.app.workspace.getActiveViewOfType(MarkdownView);
        if(!view?.file)return false;
        if(!checking)void this.openBatch(view);
        return true;
      }
    });
    // Remember the image under the pointer for Live Preview's native editor-menu.
    this.addCommand({id:'clean-processed-originals',name:t('Clean originals'),callback:()=>this.openCleanOriginals()});
    // Right-click on an image -> "Correct projected slide"; on the document -> "Batch correct…".
    // Obsidian's own menu is kept: our item is appended to whatever menu Obsidian opens for that click,
    // and only if Obsidian opens none (e.g. blank space in reading view) do we show a menu of our own.
    this.registerDomEvent(document,'contextmenu',(event:MouseEvent)=>{
      this.ctx=null;this.rightClickImage=null;
      const el=event.target;
      if(!(el instanceof Element)||!el.closest('.markdown-preview-view, .markdown-source-view'))return;
      const view=this.viewFor(el as HTMLElement);
      if(!view?.file)return;
      // In Live Preview the click can land on the embed's wrapper rather than on the <img> itself, so look inside the embed too.
      const embed=el.closest('.internal-embed, .image-embed, .media-embed, .cm-embed-block');
      const img=(el.closest('img') as HTMLImageElement|null)??(embed?.querySelector('img') as HTMLImageElement|null)??null;
      this.rightClickImage=img;
      let kind:'image'|'batch'|null=null;
      if(img)kind='image';
      else if(embed)kind=null; // some other embed or widget: leave Obsidian's menu alone
      else if(el.closest('.cm-editor')||el.matches('.markdown-source-view, .markdown-preview-view, .markdown-preview-sizer, .markdown-preview-pusher'))kind='batch';
      if(!kind)return;
      const time=Date.now();
      const ctx={kind,view,img,time};
      this.ctx=ctx;
      window.setTimeout(()=>{
        if(this.lastMenuShown>=time||this.ctx!==ctx)return;
        const menu=new Menu() as Menu&{__sfc?:boolean};
        menu.__sfc=true;this.fillMenu(menu,ctx);
        menu.showAtMouseEvent(event);
      },40);
    },true);
    const proto=Menu.prototype as unknown as Record<string,unknown>;
    for(const name of ['showAtMouseEvent','showAtPosition']){
      const orig=proto[name] as ((...a:unknown[])=>unknown)|undefined;
      if(typeof orig!=='function')continue;
      const self=this;
      proto[name]=function(this:Menu&{__sfc?:boolean},...args:unknown[]){
        try {
          self.lastMenuShown=Date.now();
          const c=self.ctx;
          if(!this.__sfc&&c&&Date.now()-c.time<300){this.__sfc=true;self.fillMenu(this,c);}
        }catch{ /* never block Obsidian's own menu */ }
        return orig.apply(this,args);
      };
      this.register(()=>{proto[name]=orig;});
    }
  }
  private ctx:{kind:'image'|'batch';view:MarkdownView;img:HTMLImageElement|null;time:number}|null=null;
  private lastMenuShown=0;
  private fillMenu(menu:Menu,c:{kind:'image'|'batch';view:MarkdownView;img:HTMLImageElement|null}):void {
    menu.addSeparator();
    if(c.kind==='image')
      menu.addItem(item=>item.setTitle(t('Correct projected slide')).setIcon('scan-line').onClick(()=>void this.openForView(c.view,c.img,c.view.getMode()==='source'?c.view.editor:undefined)));
    else
      menu.addItem(item=>item.setTitle(t('Batch correct slides in note…')).setIcon('layout-grid').onClick(()=>void this.openBatch(c.view)));
  }
  private viewFor(el:HTMLElement):MarkdownView|null {
    let view:MarkdownView|null=null;
    this.app.workspace.iterateAllLeaves(leaf=>{
      if(!view && leaf.view instanceof MarkdownView && leaf.view.containerEl.contains(el))view=leaf.view;
    });
    return view;
  }
  private async entriesFor(view:MarkdownView):Promise<Entry[]> {
    const note=view.file;if(!note)return [];
    const refs=parseImageRefs(await getContent(view,this.app));
    const entries:Entry[]=[];
    for(const ref of refs){const file=getRefFile(this.app,ref,note);if(file)entries.push({ref,file,note});}
    return entries;
  }
  private async fromCommand(view:MarkdownView):Promise<void> {
    await this.openForView(view,null,view.getMode()==='source'?view.editor:undefined);
  }
  private async openBatch(view:MarkdownView):Promise<void> {
    try {
      const entries=await this.entriesFor(view);
      if(!entries.length){new Notice(t('No local JPG/PNG/WebP/BMP/AVIF images are embedded in this note.'));return;}
      new BatchModal(this.app,this,entries).open();
    }catch(err){new Notice(t('Failed to read note images: {0}',String(err)));}
  }
  private async openForView(view:MarkdownView,img:HTMLImageElement|null,editor?:Editor):Promise<void> {
    try {
      const entries=await this.entriesFor(view);
      if(!entries.length){new Notice(t('No local JPG/PNG/WebP/BMP/AVIF images are embedded in this note.'));return;}
      let selection:Entry|null=null;
      if(img) {
        const embed=img.closest('.internal-embed')??img.closest('.image-embed');
        const target=embed?.getAttribute('src')?.split('|')[0]??'';
        const filename=decodeTarget(target);
        const same=entries.filter(e=>{
          const resource=this.app.vault.getResourcePath(e.file);
          return (filename && (e.ref.target===filename || e.file.path===filename || e.file.name===filename || e.file.basename===filename))
            || img.src.split('?')[0]===resource.split('?')[0];
        });
        if(same.length===1)selection=same[0];
      }
      if(!selection&&editor){
        const index=editor.posToOffset(editor.getCursor());
        selection=entries.find(e=>index>=e.ref.start&&index<=e.ref.end)??null;
      }
      if(selection)this.openEditor(selection);
      else if(entries.length===1)this.openEditor(entries[0]);
      else new BatchModal(this.app,this,entries).open();
    }catch(err){new Notice(t('Failed to read note images: {0}',String(err)));}
  }
  private openEditor(entry:Entry):void{new CorrectSlideModal(this.app,this,entry).open();}
}
