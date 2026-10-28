from pathlib import Path
from PIL import Image, ImageDraw

root=Path(__file__).resolve().parents[1]/'icons'
root.mkdir(exist_ok=True)
paths=[[(43,31),('L',(68,31)),('C',(83,31),(92,40),(92,54)),('C',(92,68),(83,77),(68,77)),('L',(58,77)),('L',(58,99)),('L',(43,99))],[(58,44),('L',(58,64)),('L',(67,64)),('C',(74,64),(78,61),(78,54)),('C',(78,47),(74,44),(67,44))]]
scale=8
icon=Image.new('RGBA',(128*scale,128*scale),'#101d22')
draw=ImageDraw.Draw(icon)
draw.rectangle((4*scale,4*scale,124*scale,124*scale),fill='#7a8e94')
draw.rectangle((10*scale,10*scale,118*scale,118*scale),fill='#f6f7f5')
for index,path in enumerate(paths):
 points=[path[0]]
 for segment in path[1:]:
  if segment[0]=='L':points.append(segment[1]);continue
  p0,p1,p2,p3=points[-1],*segment[1:]
  for k in range(1,41):
   t=k/40;u=1-t
   points.append(tuple(u*u*u*p0[i]+3*u*u*t*p1[i]+3*u*t*t*p2[i]+t*t*t*p3[i] for i in (0,1)))
 scaled=[(round(x*scale),round(y*scale)) for x,y in points]
 draw.polygon(scaled,fill='#4f6c75' if index==0 else '#f6f7f5')
for size in [16,32,48,128,256]:icon.resize((size,size),Image.Resampling.LANCZOS).save(root/f'icon{size}.png')
svg='''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><path fill="#f6f7f5" d="M4 4h120v120H4z"/><path fill="#7a8e94" fill-rule="evenodd" d="M4 4h120v120H4zM10 10v108h108V10z"/><path fill="#4f6c75" fill-rule="evenodd" d="M43 31h25c15 0 24 9 24 23S83 77 68 77H58v22H43zm15 13v20h9c7 0 11-3 11-10s-4-10-11-10z"/></svg>'''
(root/'logo.svg').write_text(svg,encoding='utf-8')
