import {writeFileSync} from 'node:fs';
// Project three tilted circular orbits into a small transparent SVG. The
// particles change size and pass behind/in front of the shaded nucleus.
const radius=25,focus=170,frames=72;
const planes=[{tilt:70,rotation:-28,duration:3.2},{tilt:65,rotation:32,duration:3.9},{tilt:72,rotation:92,duration:4.6}];
const f=value=>Number(value.toFixed(3)).toString();
const point=(plane,phi)=>{
 const a=plane.tilt*Math.PI/180,b=plane.rotation*Math.PI/180;
 const x=radius*Math.cos(phi),y=radius*Math.sin(phi)*Math.cos(a),z=radius*Math.sin(phi)*Math.sin(a),p=focus/(focus-z);
 return {x:32+(x*Math.cos(b)-y*Math.sin(b))*p,y:32+(x*Math.sin(b)+y*Math.cos(b))*p,z,r:3.2*p*(.9+.16*(z+radius)/(2*radius))};
};
const path=(plane,front)=>{
 const start=front?0:Math.PI;
 return Array.from({length:frames/2+1},(_,i)=>{const p=point(plane,start+i*Math.PI/(frames/2));return(i?'L':'M')+f(p.x)+' '+f(p.y)}).join(' ');
};
const definitions=`<defs>
 <radialGradient id="nucleus" cx="29%" cy="23%" r="78%"><stop stop-color="#fff3dc"/><stop offset=".27" stop-color="#f6b18a"/><stop offset=".58" stop-color="#d97757"/><stop offset="1" stop-color="#713b32"/></radialGradient>
 <radialGradient id="electron" cx="28%" cy="23%" r="78%"><stop stop-color="#fff7e7"/><stop offset=".25" stop-color="#f7c09b"/><stop offset=".6" stop-color="#dd8564"/><stop offset="1" stop-color="#874332"/></radialGradient>
 <linearGradient id="orbit" x1="10" y1="7" x2="53" y2="57" gradientUnits="userSpaceOnUse"><stop stop-color="#efbb9c"/><stop offset=".45" stop-color="#d98060"/><stop offset="1" stop-color="#a3614c"/></linearGradient>
 <filter id="halo" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="2.2"/></filter>
</defs>`;
function particle(plane,index,front,animated){
 const points=Array.from({length:frames+1},(_,i)=>point(plane,i*2*Math.PI/frames+index*1.8));
 const opacity=p=>{
  const near=Math.max(0,Math.min(1,.5+p.z/(radius*.16)));
  return (front?near:1-near)*(.55+.45*(p.z+radius)/(2*radius));
 };
 const first=points[0],values={cx:points.map(p=>p.x),cy:points.map(p=>p.y),r:points.map(p=>p.r),opacity:points.map(opacity)};
 return '<circle cx="'+f(first.x)+'" cy="'+f(first.y)+'" r="'+f(first.r)+'" opacity="'+f(opacity(first))+'" fill="url(#electron)">'+
  (animated?Object.entries(values).map(([name,list])=>'<animate attributeName="'+name+'" dur="'+plane.duration+'s" repeatCount="indefinite" calcMode="linear" values="'+list.map(f).join(';')+'"/>').join(''):'')+'</circle>';
}
function svg(animated){
 return '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64" fill="none">'+definitions+
  '<g stroke="#bc7a60" stroke-width="1.2" opacity=".4">'+planes.map(p=>'<path d="'+path(p,false)+'"/>').join('')+'</g>'+
  planes.map((p,i)=>particle(p,i,false,animated)).join('')+
  '<circle cx="32" cy="32" r="7" fill="#dc8c69" opacity=".18" filter="url(#halo)"/>'+
  '<circle cx="32" cy="32" r="6.7" fill="url(#nucleus)">'+(animated?'<animate attributeName="r" values="6.7;6.88;6.7" dur="4.8s" repeatCount="indefinite"/>':'')+'</circle>'+
  '<g stroke="url(#orbit)" stroke-width="1.45" opacity=".86">'+planes.map(p=>'<path d="'+path(p,true)+'"/>').join('')+'</g>'+
  planes.map((p,i)=>particle(p,i,true,animated)).join('')+'</svg>\n';
}
writeFileSync(new URL('../src/chimeric-atom-3d.svg',import.meta.url),svg(true));
writeFileSync(new URL('../src/chimeric-atom-3d-static.svg',import.meta.url),svg(false));
