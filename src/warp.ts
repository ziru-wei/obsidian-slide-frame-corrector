import { Quad, squareToQuad, isValidQuad } from './geometry';

// Inverse-mapped bilinear resampling. No WebGL, native modules or network dependencies.
export function warpPixels(src: ImageData, q: Quad, width: number, height: number): ImageData {
  if (!isValidQuad(q,src.width,src.height)) throw new Error('The four corners must form a convex quadrilateral inside the photo.');
  const H=squareToQuad(q);
  const out=new ImageData(width,height);
  const s=src.data,d=out.data, sw=src.width,sh=src.height;
  for(let y=0;y<height;y++) {
    const v=height===1?0:y/(height-1);
    for(let x=0;x<width;x++) {
      const u=width===1?0:x/(width-1);
      const z=H[6]*u+H[7]*v+1;
      const px=(H[0]*u+H[1]*v+H[2])/z;
      const py=(H[3]*u+H[4]*v+H[5])/z;
      const di=4*(y*width+x);
      if(!Number.isFinite(px+py)||px<0||py<0||px>sw-1||py>sh-1) {d[di+3]=255;continue;}
      const x0=Math.floor(px),y0=Math.floor(py),x1=Math.min(sw-1,x0+1),y1=Math.min(sh-1,y0+1);
      const fx=px-x0,fy=py-y0;
      const i00=4*(y0*sw+x0),i10=4*(y0*sw+x1),i01=4*(y1*sw+x0),i11=4*(y1*sw+x1);
      const w00=(1-fx)*(1-fy),w10=fx*(1-fy),w01=(1-fx)*fy,w11=fx*fy;
      for(let c=0;c<3;c++) d[di+c]=s[i00+c]*w00+s[i10+c]*w10+s[i01+c]*w01+s[i11+c]*w11;
      d[di+3]=255;
    }
  }
  return out;
}
