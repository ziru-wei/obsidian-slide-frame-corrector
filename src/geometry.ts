export type Point = { x: number; y: number };
export type Quad = [Point, Point, Point, Point]; // clockwise TL, TR, BR, BL

export function dist(a: Point, b: Point): number { return Math.hypot(a.x-b.x, a.y-b.y); }
export function quadArea(q: Quad): number {
  let sum = 0;
  for (let i=0; i<4; i++) { const a=q[i], b=q[(i+1)%4]; sum += a.x*b.y - a.y*b.x; }
  return Math.abs(sum)/2;
}
export function isValidQuad(q: Quad, w: number, h: number): boolean {
  if (quadArea(q) < w*h*0.01) return false;
  let sign = 0;
  for (let i=0; i<4; i++) {
    const a=q[i], b=q[(i+1)%4], c=q[(i+2)%4];
    if (!Number.isFinite(a.x+a.y) || a.x < 0 || a.x > w || a.y < 0 || a.y > h) return false;
    const cross=(b.x-a.x)*(c.y-b.y)-(b.y-a.y)*(c.x-b.x);
    if (Math.abs(cross)<1e-7) return false;
    if (sign && cross*sign<0) return false;
    sign=cross;
  }
  return true;
}
export function insetQuad(w: number, h: number, margin=0.07): Quad {
  return [
    {x:w*margin,y:h*margin}, {x:w*(1-margin),y:h*margin},
    {x:w*(1-margin),y:h*(1-margin)}, {x:w*margin,y:h*(1-margin)}
  ];
}

// Solve 8x8 DLT, mapping destination unit square (u,v) to photo x,y.
export function squareToQuad(q: Quad): number[] {
  const target: [number,number][]=[[0,0],[1,0],[1,1],[0,1]];
  const rows: number[][] = [];
  for (let i=0;i<4;i++) {
    const [u,v]=target[i], {x,y}=q[i];
    rows.push([u,v,1,0,0,0,-u*x,-v*x,x]);
    rows.push([0,0,0,u,v,1,-u*y,-v*y,y]);
  }
  for (let i=0;i<8;i++) {
    let piv=i;
    for (let j=i+1;j<8;j++) if (Math.abs(rows[j][i])>Math.abs(rows[piv][i])) piv=j;
    if (Math.abs(rows[piv][i])<1e-10) throw new Error('Invalid or degenerate crop corners.');
    [rows[i],rows[piv]]=[rows[piv],rows[i]];
    const d=rows[i][i];
    for (let k=i;k<=8;k++) rows[i][k]/=d;
    for (let j=0;j<8;j++) if (j!==i) {
      const f=rows[j][i];
      for (let k=i;k<=8;k++) rows[j][k]-=f*rows[i][k];
    }
  }
  return rows.map(r=>r[8]);
}
export function project(h: number[], u: number, v: number): Point {
  const z=h[6]*u+h[7]*v+1;
  return {x:(h[0]*u+h[1]*v+h[2])/z,y:(h[3]*u+h[4]*v+h[5])/z};
}
export function outputSize(q: Quad, aspect: 'auto'|'16:9'|'4:3', maxSide=3000): {width:number;height:number} {
  let w=(dist(q[0],q[1])+dist(q[3],q[2]))/2;
  let h=(dist(q[0],q[3])+dist(q[1],q[2]))/2;
  if(aspect==='16:9') h=w*9/16;
  if(aspect==='4:3') h=w*3/4;
  const scale=Math.min(1, maxSide/Math.max(w,h), 9000000/(w*h) > 1 ? 1 : Math.sqrt(9000000/(w*h)));
  return {width:Math.max(1,Math.round(w*scale)),height:Math.max(1,Math.round(h*scale))};
}
export function distToSegment(p: Point, a: Point, b: Point): number {
  const dx=b.x-a.x, dy=b.y-a.y, len2=dx*dx+dy*dy;
  const t=len2===0?0:Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/len2));
  return dist(p,{x:a.x+t*dx,y:a.y+t*dy});
}
