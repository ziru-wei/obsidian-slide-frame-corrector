import { Quad, Point, insetQuad, isValidQuad, quadArea } from './geometry';

/** `corners[i]` lists alternative vertices for corner i (TL, TR, BR, BL), best first by edge support:
 * intersections of the detected frame lines, plus where each line leaves the photo (for slides cut off by the frame). */
export type Candidate = Point & { score: number };
export type DetectionResult = { quad: Quad; confident: boolean; score: number; corners: Candidate[][] };
type Line = { a:number; b:number; r:number; votes:number; atCenter:number };
const RAD=Math.PI/180;
const clamp=(x:number,a:number,b:number)=>Math.max(a,Math.min(b,x));

/** Pulls each edge of a detected frame inward past the dark band (screen bezel, gold lip, wall) between the frame line
 *  and the lit slide. Every edge is probed in 12 segments; where a segment starts darker than the slide, it is pushed
 *  inward until the brightness reaches the slide level. A line is then fitted through those per-segment positions
 *  (with outlier rejection), so a band of uneven thickness or a slightly tilted slide edge is followed instead of
 *  just translated. Edges without a band, dark slides, and anything that needs a move beyond the limit stay put. */
export type Trim = 'off'|'normal'|'wide'|'xwide';
/** `maxFrac`: how far an edge may move (fraction of the short side); wide only searches further, so it never moves less than normal. */
const TRIM: Record<Exclude<Trim,'off'>, { maxFrac: number; low: number; reach: number; margin: number; lowerHalf?: boolean; knee?: boolean }> = {
  normal: { maxFrac: 0.05, low: 0.80, reach: 0.90, margin: 0 },
  wide: { maxFrac: 0.12, low: 0.85, reach: 0.90, margin: 1 },
  // xwide looks for where the brightness profile stops rising (the knee at the end of the band) instead of a fixed
  // brightness, so it also catches faint bands (a tan/gold lip at ~85% of the slide white) and is not fooled by slides
  // that are naturally a little darker near their edges. It searches far, keeps a safety margin, and fits the line
  // through the smaller shifts only, so content near an edge (a logo, a footer line) cannot pull it into the slide.
  xwide: { maxFrac: 0.2, low: 0.92, reach: 0.97, margin: 2, lowerHalf: true, knee: true },
};

export function refineQuad(gray: Float32Array, w: number, h: number, q: Quad, trim: Exclude<Trim,'off'> = 'normal'): Quad {
  const cfg = TRIM[trim];
  const maxShift = Math.max(3, Math.round(cfg.maxFrac * Math.min(w, h)));
  const cx = (q[0].x + q[1].x + q[2].x + q[3].x) / 4, cy = (q[0].y + q[1].y + q[2].y + q[3].y) / 4;
  type L = { p: Point; dx: number; dy: number };
  const lines: L[] = [];
  const SEGMENTS = 12;
  for (let i = 0; i < 4; i++) {
    const a = q[i], b = q[(i + 1) % 4];
    const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
    let nx = -dy / len, ny = dx / len;
    if ((cx - a.x) * nx + (cy - a.y) * ny < 0) { nx = -nx; ny = -ny; }
    // brightness profile (distance inward from the frame line) for every segment
    const segs: { t: number; raw: number[] }[] = [];
    for (let j = 0; j < SEGMENTS; j++) {
      const t0 = 0.06 + 0.88 * j / SEGMENTS, t1 = 0.06 + 0.88 * (j + 1) / SEGMENTS;
      const raw: number[] = [];
      for (let k = 0; k <= maxShift + 6; k++) {
        let sum = 0, cnt = 0;
        for (let s = 0; s < 8; s++) {
          const t = t0 + (t1 - t0) * (s + 0.5) / 8;
          const x = Math.round(a.x + dx * t + nx * k), y = Math.round(a.y + dy * t + ny * k);
          if (x >= 0 && x < w && y >= 0 && y < h) { sum += gray[y * w + x]; cnt++; }
        }
        raw.push(cnt ? sum / cnt : NaN);
      }
      segs.push({ t: (t0 + t1) / 2, raw });
    }
    // brightness of the slide itself near this edge
    let ref = 0;
    for (let k = 2; k <= maxShift + 6; k++) {
      let sum = 0, cnt = 0;
      for (const sg of segs) if (!Number.isNaN(sg.raw[k])) { sum += sg.raw[k]; cnt++; }
      if (cnt && sum / cnt > ref) ref = sum / cnt;
    }
    const pts: { t: number; s: number }[] = [];
    if (ref >= 110) {
      for (const sg of segs) {
        // 3-tap smoothing delays the transition by one pixel, which doubles as a one-pixel safety margin
        const p = sg.raw.map((v, k) => {
          const win = [sg.raw[k - 1], v, sg.raw[k + 1]].filter(x => x !== undefined && !Number.isNaN(x)) as number[];
          return win.length ? win.reduce((m, n) => m + n, 0) / win.length : NaN;
        });
        if (!(p[0] < cfg.low * ref)) { pts.push({ t: sg.t, s: 0 }); continue; }
        if (cfg.knee) {
          // the further in of: where the brightness profile flattens out (knee), and where it first reaches 90% of the slide
          let found = 0;
          for (let k = 1; k <= maxShift; k++) {
            let ahead = 0;
            for (let j = k + 1; j <= Math.min(p.length - 1, k + 8); j++) if (p[j] > ahead) ahead = p[j];
            if (ahead > 0 && p[k] >= cfg.reach * ahead && p[k] - p[0] >= 0.03 * ref) { found = k; break; }
          }
          let bright = 0;
          for (let k = 1; k <= maxShift + 1; k++) {
            if (p[k] >= 0.9 * ref && p[Math.min(k + 2, p.length - 1)] >= 0.85 * ref) { bright = k; break; }
          }
          const s = Math.max(found, bright);
          if (s) pts.push({ t: sg.t, s: s + cfg.margin });
          continue;
        }
        for (let k = 1; k <= maxShift + 1; k++) {
          if (p[k] >= cfg.reach * ref && p[Math.min(k + 2, p.length - 1)] >= (cfg.reach - 0.05) * ref) { pts.push({ t: sg.t, s: k + cfg.margin }); break; }
        }
      }
    }
    // least-squares line s(t) = A + B t through the per-segment shifts, dropping outliers
    let A = 0, B = 0;
    if (pts.length >= 5) {
      let use = pts;
      if (cfg.lowerHalf) {
        const sorted = pts.map(p => p.s).sort((a, b) => a - b);
        const med = sorted[Math.floor(sorted.length / 2)];
        use = pts.filter(p => p.s <= med);
        if (use.length < 4) use = pts;
      }
      for (let it = 0; it < 3; it++) {
        const n = use.length;
        const mt = use.reduce((m, p) => m + p.t, 0) / n, ms = use.reduce((m, p) => m + p.s, 0) / n;
        let sxx = 0, sxy = 0;
        for (const p of use) { sxx += (p.t - mt) ** 2; sxy += (p.t - mt) * (p.s - ms); }
        B = sxx > 1e-9 ? sxy / sxx : 0; A = ms - B * mt;
        const base = cfg.lowerHalf ? use : pts;
        const res = base.map(p => Math.abs(p.s - (A + B * p.t)));
        const sd = Math.sqrt(res.reduce((m, r) => m + r * r, 0) / res.length);
        const next = base.filter((_, ix) => res[ix] <= Math.max(2, 2 * sd));
        if (next.length < 4) break;
        use = next;
      }
    }
    const s0 = Math.min(maxShift, Math.max(0, A)), s1 = Math.min(maxShift, Math.max(0, A + B));
    lines.push({ p: { x: a.x + nx * s0, y: a.y + ny * s0 }, dx: dx + nx * (s1 - s0), dy: dy + ny * (s1 - s0) });
  }
  const out = q.map((orig, i) => {
    const l1 = lines[(i + 3) % 4], l2 = lines[i];
    const det = l1.dx * l2.dy - l1.dy * l2.dx;
    if (Math.abs(det) < 1e-6) return orig;
    const t = ((l2.p.x - l1.p.x) * l2.dy - (l2.p.y - l1.p.y) * l2.dx) / det;
    return { x: l1.p.x + l1.dx * t, y: l1.p.y + l1.dy * t };
  }) as Quad;
  return isValidQuad(out, w, h) && quadArea(out) > quadArea(q) * 0.7 ? out : q;
}

/** Detect straight slide frame in a 640px-or-smaller ImageData, with a safe manual-edit fallback.
 * Hough peaks use gradient direction so small projected edges survive busy slide contents.
 */
export function detectSlide(img: ImageData, opts: { trim?: Trim } = {}): DetectionResult {
  const {width:w,height:h,data}=img;
  const fallback: DetectionResult={quad:insetQuad(w,h),confident:false,score:0,corners:[[],[],[],[]]};
  if(w<80||h<80) return fallback;
  const gray=new Float32Array(w*h), mag=new Float32Array(w*h), gx=new Float32Array(w*h),gy=new Float32Array(w*h);
  for(let i=0;i<w*h;i++) gray[i]=.2126*data[i*4]+.7152*data[i*4+1]+.0722*data[i*4+2];
  let nonzero=0;
  for(let y=1;y<h-1;y++) for(let x=1;x<w-1;x++) {
    const i=y*w+x;
    const dx=-gray[i-w-1]+gray[i-w+1]-2*gray[i-1]+2*gray[i+1]-gray[i+w-1]+gray[i+w+1];
    const dy=-gray[i-w-1]-2*gray[i-w]-gray[i-w+1]+gray[i+w-1]+2*gray[i+w]+gray[i+w+1];
    const m=Math.hypot(dx,dy); mag[i]=m; gx[i]=dx; gy[i]=dy;
    if(m>75) nonzero++;
  }
  if(nonzero<60) return fallback;
  const angleStep=2, na=90, rStep=3, maxR=Math.hypot(w,h), nr=Math.ceil(2*maxR/rStep)+1;
  const acc=new Int32Array(na*nr);
  const cos=Array.from({length:na},(_,i)=>Math.cos(i*angleStep*RAD));
  const sin=Array.from({length:na},(_,i)=>Math.sin(i*angleStep*RAD));
  const step=w*h>240000?2:1;
  for(let y=2;y<h-2;y+=step) for(let x=2;x<w-2;x+=step) {
    const i=y*w+x, m=mag[i];
    if(m<75) continue;
    const theta=(Math.atan2(gy[i],gx[i])/RAD+180)%180;
    const bin=Math.round(theta/angleStep);
    const wt=Math.min(12,Math.max(1,Math.round(m/75)));
    for(let d=-2;d<=2;d++) {
      const t=(bin+d+na)%na;
      const r=Math.round((x*cos[t]+y*sin[t]+maxR)/rStep);
      if(r>=0&&r<nr) acc[t*nr+r]+=wt*(d===0?3:1);
    }
  }
  type Peak={t:number;r:number;votes:number};
  const peaks: Peak[]=[];
  let maxVote=0;
  for(let i=0;i<acc.length;i++) if(acc[i]>maxVote) maxVote=acc[i];
  const cutoff=Math.max(65,maxVote*.12);
  for(let t=0;t<na;t++) for(let r=2;r<nr-2;r++) {
    const value=acc[t*nr+r];
    if(value<cutoff)continue;
    let greater=false;
    for(let da=-1;da<=1&&!greater;da++) for(let dr=-2;dr<=2;dr++) {
      if(da===0&&dr===0)continue;
      const tt=(t+da+na)%na;
      if(acc[tt*nr+r+dr]>value) {greater=true;break;}
    }
    if(!greater)peaks.push({t,r,votes:value});
  }
  peaks.sort((a,b)=>b.votes-a.votes);
  const top:Line[]=[],bottom:Line[]=[],left:Line[]=[],right:Line[]=[];
  const cy=h/2,cx=w/2;
  function pushUnique(list:Line[],l:Line,near=13) {
    if(list.some(x=>Math.abs(x.atCenter-l.atCenter)<near)) return;
    if(list.length<10) list.push(l);
  }
  for(const p of peaks.slice(0,200)) {
    const a=cos[p.t],b=sin[p.t],r=p.r*rStep-maxR;
    if(Math.abs(b)>.57) {
      const y=(r-a*cx)/b;
      if(y>h*.015&&y<h*.65) pushUnique(top,{a,b,r,votes:p.votes,atCenter:y});
      if(y>h*.35&&y<h*.985) pushUnique(bottom,{a,b,r,votes:p.votes,atCenter:y});
    }
    if(Math.abs(a)>.64) {
      const x=(r-b*cy)/a;
      if(x>w*.015&&x<w*.65) pushUnique(left,{a,b,r,votes:p.votes,atCenter:x});
      if(x>w*.35&&x<w*.985) pushUnique(right,{a,b,r,votes:p.votes,atCenter:x});
    }
    if(top.length>=10&&bottom.length>=10&&left.length>=10&&right.length>=10) break;
  }
  const missingSide=!top.length||!bottom.length||!left.length||!right.length;

  function meet(l1:Line,l2:Line):Point|null {
    const det=l1.a*l2.b-l2.a*l1.b;
    if(Math.abs(det)<.20)return null;
    return {x:(l1.r*l2.b-l2.r*l1.b)/det,y:(l1.a*l2.r-l2.a*l1.r)/det};
  }
  function sample(a:Point,b:Point,center:Point):number {
    let grad=0, brightness=0;
    const n=36, dx=b.x-a.x,dy=b.y-a.y,len=Math.hypot(dx,dy);
    if(len<25)return 0;
    let nx=-dy/len,ny=dx/len;
    if((center.x-(a.x+b.x)/2)*nx+(center.y-(a.y+b.y)/2)*ny<0){nx=-nx;ny=-ny;}
    const offset=Math.max(3,Math.min(8,Math.min(w,h)*.013));
    for(let i=1;i<n;i++) {
      const px=a.x+dx*i/n,py=a.y+dy*i/n;
      const x=Math.round(px),y=Math.round(py);
      if(x>=1&&x<w-1&&y>=1&&y<h-1) grad+=Math.min(1,mag[y*w+x]/260);
      const ix=Math.round(px+nx*offset),iy=Math.round(py+ny*offset);
      const ox=Math.round(px-nx*offset),oy=Math.round(py-ny*offset);
      if(ix>=0&&ix<w&&iy>=0&&iy<h&&ox>=0&&ox<w&&oy>=0&&oy<h) {
        const diff=gray[iy*w+ix]-gray[oy*w+ox];
        brightness+=clamp(diff/70,-.5,1);
      }
    }
    return .7*grad/(n-1)+.3*Math.max(0,brightness/(n-1));
  }
  const strengthCache=new Map<Line,number>();
  /** Edge support of a whole line, measured over the part of it that lies inside the photo. */
  function lineStrength(l:Line):number {
    const cached=strengthCache.get(l);if(cached!==undefined)return cached;
    const pts:Point[]=[];
    if(Math.abs(l.b)>1e-3)for(const x of [0,w]){const y=(l.r-l.a*x)/l.b;if(y>=0&&y<=h)pts.push({x,y});}
    if(Math.abs(l.a)>1e-3)for(const y of [0,h]){const x=(l.r-l.b*y)/l.a;if(x>=0&&x<=w)pts.push({x,y});}
    let v=0;
    if(pts.length>=2){
      let a=pts[0],b=pts[1];
      for(const p of pts)for(const q of pts)if(Math.hypot(p.x-q.x,p.y-q.y)>Math.hypot(a.x-b.x,a.y-b.y)){a=p;b=q;}
      v=sample(a,b,{x:w/2,y:h/2});
    }
    strengthCache.set(l,v);return v;
  }
  function collect():Candidate[][] {
    const pairs:[Line[],Line[]][]=[[top,left],[top,right],[bottom,right],[bottom,left]];
    // Border each horizontal/vertical frame line can run into, per corner (x border for top/bottom lines, y border for left/right).
    const borders:[number,number][]=[[0,0],[w,0],[w,h],[0,h]];
    return pairs.map(([A,B],ci)=>{
      const out:Candidate[]=[];
      const add=(p:Point,score:number)=>{
        if(p.x<0||p.y<0||p.x>w||p.y>h)return;
        if(out.some(o=>Math.hypot(o.x-p.x,o.y-p.y)<4))return;
        out.push({x:p.x,y:p.y,score});
      };
      for(const l1 of A) for(const l2 of B) {
        const p=meet(l1,l2);
        if(p)add(p,(lineStrength(l1)+lineStrength(l2))/2);
      }
      const [bx,by]=borders[ci];
      for(const l of A)if(Math.abs(l.b)>.2)add({x:bx,y:(l.r-l.a*bx)/l.b},lineStrength(l));
      for(const l of B)if(Math.abs(l.a)>.2)add({x:(l.r-l.b*by)/l.a,y:by},lineStrength(l));
      return out;
    });
  }
  // A slide cut off by the photo has no frame line on that side; the other lines still give corner candidates.
  if(missingSide) return {...fallback,corners:collect()};
  let bestScore=0,best:Quad|null=null;
  for(const t of top) for(const b of bottom) {
    if(b.atCenter-t.atCenter<h*.23)continue;
    for(const l of left) for(const r of right) {
      if(r.atCenter-l.atCenter<w*.23)continue;
      const tl=meet(t,l),tr=meet(t,r),br=meet(b,r),bl=meet(b,l);
      if(!tl||!tr||!br||!bl)continue;
      const q:Quad=[tl,tr,br,bl];
      if(!isValidQuad(q,w,h))continue;
      const area=quadArea(q)/(w*h);
      if(area<.17||area>.94)continue;
      const center={x:(tl.x+tr.x+br.x+bl.x)/4,y:(tl.y+tr.y+br.y+bl.y)/4};
      const edge=(sample(tl,tr,center)+sample(tr,br,center)+sample(br,bl,center)+sample(bl,tl,center))/4;
      const areaFactor=Math.min(1,area/.42);
      const score=edge*(.75+.25*areaFactor);
      if(score>bestScore){bestScore=score;best=q;}
    }
  }
  // Weak edges are not guessed as trustworthy. User can drag the inset fallback.
  if(!best||bestScore<.15)return {...fallback,corners:collect()};
  const trim = opts.trim ?? 'normal';
  return {quad:trim==='off'?best:refineQuad(gray,w,h,best,trim),confident:bestScore>.25,score:bestScore,corners:collect()};
}
