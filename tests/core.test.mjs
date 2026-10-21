import test from 'node:test';
import assert from 'node:assert/strict';
import modules from './compiled.cjs';
const {geometry:g, links:l, detect:d,warp}=modules;

function makeImage(width,height,f){
  const data=new Uint8ClampedArray(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const v=f(x,y),p=4*(y*width+x);
    data[p]=v;data[p+1]=v;data[p+2]=v;data[p+3]=255;
  }
  return {width,height,data};
}
globalThis.ImageData=class ImageData { constructor(w,h) {this.width=w;this.height=h;this.data=new Uint8ClampedArray(w*h*4);} };

test('unit square perspective maps to all four corners',()=>{
  const quad=[{x:25,y:30},{x:140,y:20},{x:123,y:96},{x:39,y:103}];
  const h=g.squareToQuad(quad);
  for(const [i,uv] of [[0,[0,0]],[1,[1,0]],[2,[1,1]],[3,[0,1]]]) {
    const pt=g.project(h,...uv);
    assert.ok(Math.abs(pt.x-quad[i].x)<1e-6);assert.ok(Math.abs(pt.y-quad[i].y)<1e-6);
  }
  assert.ok(g.isValidQuad(quad,200,130));
});
test('crop proportions and non-upscale',()=>{
  const q=[{x:0,y:0},{x:1600,y:0},{x:1600,y:900},{x:0,y:900}];
  assert.deepEqual(g.outputSize(q,'16:9'),{width:1600,height:900});
  assert.deepEqual(g.outputSize(q,'4:3'),{width:1600,height:1200});
});
test('bilinear perspective warp preserves corners',()=>{
  const image=makeImage(50,50,(x,y)=>x*3+y*2);
  const q=[{x:5,y:5},{x:40,y:8},{x:37,y:42},{x:8,y:40}];
  const warped=warp.warpPixels(image,q,37,37);
  assert.equal(warped.width,37);
  const expected=[5*3+5*2,40*3+8*2,37*3+42*2,8*3+40*2];
  const actual=[0,36,36*37+36,36*37].map(i=>warped.data[4*i]);
  expected.forEach((v,i)=>assert.ok(Math.abs(v-actual[i])<=2,`${i}: ${actual[i]} vs ${v}`));
});
test('Markdown image extraction and one-occurrence replacement',()=>{
  const note='Before ![[lecture/pic.jpg|400]] and ![alt](<images/other photo.png>)';
  const refs=l.parseImageRefs(note);
  assert.equal(refs.length,2);assert.equal(refs[0].target,'lecture/pic.jpg');
  assert.equal(l.makeReplacement(refs[0],'lecture/pic-slide-001.jpg','notes/class.md'),'![[lecture/pic-slide-001.jpg|400]]');
  assert.equal(l.makeReplacement(refs[1],'notes/images/new.png','notes/class.md'),'![alt](<images/new.png>)');
  assert.equal(l.selectOccurrence('shifted '+note,refs[1])?.raw,refs[1].raw);
  assert.equal(l.selectOccurrence(`${note} ${refs[1].raw}`.replace('Before ','changed '),refs[1]),null);
});
test('auto detects high-contrast trapezoid projector against dark room',()=>{
  const width=640,height=420;
  const quad=[{x:100,y:70},{x:550,y:95},{x:530,y:344},{x:122,y:326}];
  const inside=(x,y)=>{
    let pos=true;
    for(let k=0;k<4;k++){
      const a=quad[k],b=quad[(k+1)%4];
      if((b.x-a.x)*(y-a.y)-(b.y-a.y)*(x-a.x)<0) pos=false;
    }
    return pos;
  };
  const image=makeImage(width,height,(x,y)=>inside(x,y)?213:28);
  const result=d.detectSlide(image);
  assert.ok(result.score>.15,`detection score ${result.score}`);
  assert.ok(result.confident,`confidence ${result.score}`);
  for(let i=0;i<4;i++) {
    assert.ok(Math.hypot(quad[i].x-result.quad[i].x,quad[i].y-result.quad[i].y)<24,
      `corner ${i} result=${JSON.stringify(result.quad[i])}`);
  }
});
test('featureless frames fall back safely',()=>{
  const result=d.detectSlide(makeImage(300,200,()=>50));
  assert.equal(result.confident,false);
  assert.deepEqual(result.quad,g.insetQuad(300,200));
});

test('autoColor lifts a dim, tinted image and off leaves pixels alone',()=>{
  const mk=()=>makeImage(40,40,()=>0);
  const img=mk();
  for(let i=0;i<img.data.length;i+=4){const v=40+((i/4)%120);img.data[i]=v;img.data[i+1]=v*0.8;img.data[i+2]=v*0.6;}
  const copy=new Uint8ClampedArray(img.data);
  modules.color.autoColor(img,0);
  assert.deepEqual([...img.data],[...copy]);
  modules.color.autoColor(img,1);
  let max=0;for(let i=0;i<img.data.length;i+=4)max=Math.max(max,img.data[i],img.data[i+1],img.data[i+2]);
  assert.ok(max>=250);
  // channels end up balanced instead of tinted
  assert.ok(Math.abs(img.data[0]-img.data[1])<8&&Math.abs(img.data[0]-img.data[2])<8);
});
test('distToSegment measures to the segment, not the infinite line',()=>{
  assert.equal(g.distToSegment({x:5,y:3},{x:0,y:0},{x:10,y:0}),3);
  assert.equal(g.distToSegment({x:15,y:0},{x:0,y:0},{x:10,y:0}),5);
});

test('a slide cut off by the photo edge still offers the frame/border crossing as a corner candidate',()=>{
  const W=640,H=420;
  const img=makeImage(W,H,(x,y)=>(x>80&&y>110&&y<390)?(x>400?235:215):40);
  const r=d.detectSlide(img);
  assert.ok(r.corners[1].some(c=>Math.abs(c.x-W)<3&&Math.abs(c.y-110)<4));
});

test('applyTone: gray equalises channels, bw yields only 0/255',()=>{
  const mk=()=>{const im=makeImage(20,20,()=>0);for(let i=0;i<im.data.length;i+=4){const v=(i/4)%2?200:50;im.data[i]=v;im.data[i+1]=v*0.5;im.data[i+2]=v*0.3;}return im;};
  const a=mk();modules.color.applyTone(a,'gray');
  assert.ok(a.data[0]===a.data[1]&&a.data[1]===a.data[2]);
  const b=mk();modules.color.applyTone(b,'bw');
  const vals=new Set();for(let i=0;i<b.data.length;i+=4)vals.add(b.data[i]);
  assert.deepEqual([...vals].sort((x,y)=>x-y),[0,255]);
  const c=mk(),copy=[...c.data];modules.color.applyTone(c,'color');assert.deepEqual([...c.data],copy);
});

test('autoColor evens out a lighting/tint gradient on a light slide',()=>{
  const W=480,H=300;
  const img=makeImage(W,H,()=>0);
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){
    const p=4*(y*W+x),t=x/(W-1);
    // background drifts from dim and blue (left) to bright and warm (right)
    let r=150+90*t,g=175+70*t,b=235-10*t;
    if((x%23)<2&&(y%7)<5){r=g=b=40;} // a few dark "text" strokes
    img.data[p]=r;img.data[p+1]=g;img.data[p+2]=b;
  }
  modules.color.autoColor(img,1);
  const px=(x,y)=>{const p=4*(y*W+x);return [img.data[p],img.data[p+1],img.data[p+2]];};
  const left=px(20,150),right=px(W-21,150);
  for(let c=0;c<3;c++){
    assert.ok(left[c]>235&&right[c]>235,`channel ${c}: ${left[c]} / ${right[c]}`);
    assert.ok(Math.abs(left[c]-right[c])<14);
  }
});

test('refineQuad pulls edges in past a thin dark bezel and leaves clean edges alone',()=>{
  const W=200,H=120;
  const gray=new Float32Array(W*H);
  for(let y=0;y<H;y++)for(let x=0;x<W;x++)gray[y*W+x]=(x>=8&&x<=191&&y>=6&&y<=113)?220:30;
  const outer=[{x:2,y:2},{x:197,y:2},{x:197,y:117},{x:2,y:117}];
  const r=d.refineQuad(gray,W,H,outer);
  assert.ok(r[0].x>=8&&r[0].x<=11&&r[0].y>=6&&r[0].y<=9,JSON.stringify(r[0]));
  assert.ok(r[2].x<=192&&r[2].x>=189&&r[2].y<=114&&r[2].y>=111,JSON.stringify(r[2]));
  // an already tight frame stays put
  const tight=[{x:9,y:7},{x:190,y:7},{x:190,y:112},{x:9,y:112}];
  const same=d.refineQuad(gray,W,H,tight);
  tight.forEach((p,i)=>{assert.ok(Math.abs(same[i].x-p.x)<1.5&&Math.abs(same[i].y-p.y)<1.5);});
  // a dark slide is never "refined"
  const dark=new Float32Array(W*H).fill(40);
  const dr=d.refineQuad(dark,W,H,outer);
  dr.forEach((p,i)=>{assert.equal(p.x,outer[i].x);assert.equal(p.y,outer[i].y);});
});

test('wide edge trim reaches a thicker band than normal, and off leaves the frame alone',()=>{
  const W=320,H=200;
  const gray=new Float32Array(W*H);
  // a 14px dark/gold band around a bright slide (normal reaches 5% of 200 = 10px, wide 12% = 24px)
  for(let y=0;y<H;y++)for(let x=0;x<W;x++)gray[y*W+x]=(x>=16&&x<W-16&&y>=16&&y<H-16)?225:60;
  const outer=[{x:2,y:2},{x:W-3,y:2},{x:W-3,y:H-3},{x:2,y:H-3}];
  const normal=d.refineQuad(gray,W,H,outer,'normal');
  const wide=d.refineQuad(gray,W,H,outer,'wide');
  assert.ok(normal[0].x<10,'normal stays outside: '+normal[0].x);
  assert.ok(wide[0].x>=15&&wide[0].y>=15,'wide reaches the slide: '+JSON.stringify(wide[0]));
});
