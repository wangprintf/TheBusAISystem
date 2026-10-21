
from zipfile import ZipFile
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import shutil
out1=Path(r'C:\Users\wangmeng\Desktop\git\docx_work\assets_zhixunyun')
out1.mkdir(parents=True,exist_ok=True)
with ZipFile(r'C:\Users\wangmeng\Desktop\web--技术栈和实现方法\技术栈和实现方法.docx') as z:
    for n in [x for x in z.namelist() if x.startswith('word/media/')]:
        (out1/f"image{Path(n).stem.replace('image','')}.png").write_bytes(z.read(n))
mapping={'image1.png':'01-login.png','image2.png':'02-dashboard.png','image3.png':'03-orders.png','image4.png':'04-map.png','image5.png':'05-devices.png','image6.png':'06-assistant.png'}
for s,d in mapping.items():
    src=out1/s
    if src.exists():
        shutil.copy2(src,out1/d)
out2=Path(r'C:\Users\wangmeng\Desktop\智眼路安-新工科比赛版\docx_assets')
out2.mkdir(parents=True,exist_ok=True)
shutil.copy2(r'C:\Users\wangmeng\Desktop\智眼路安-新工科比赛版\新版登录页预览.png',out2/'01-login.png')
shutil.copy2(r'C:\Users\wangmeng\Desktop\智眼路安-新工科比赛版\地图居中与右侧助手预览.png',out2/'02-dashboard-assistant.png')
font_path=r'C:\Windows\Fonts\msyh.ttc'
try:
    font=ImageFont.truetype(font_path,24,index=0)
    small=ImageFont.truetype(font_path,16,index=0)
    tiny=ImageFont.truetype(font_path,13,index=0)
    title=ImageFont.truetype(font_path,30,index=0)
except:
    font=small=tiny=title=ImageFont.load_default()
def rounded(draw,box,r,fill,outline=None,w=1):
    draw.rounded_rectangle(box,r,fill=fill,outline=outline,width=w)
def header(draw,title_text,accent='#d6b777'):
    draw.rectangle((0,0,1200,84),fill='#0b241c')
    draw.rectangle((36,22,40,60),fill=accent)
    draw.text((55,22),title_text,font=title,fill='#eff5ea')
    draw.text((1010,27),'数据链路稳定',font=tiny,fill='#92e5bd')
def panel(draw,box,label,accent='#92e5bd'):
    rounded(draw,box,18,fill='#123126',outline='#2c5143',w=2)
    draw.text((box[0]+22,box[1]+18),label,font=font,fill='#eff5ea')
    draw.rectangle((box[0]+22,box[1]+62,box[0]+82,box[1]+66),fill=accent)
def save_dashboard():
    im=Image.new('RGB',(1200,760),'#091b17')
    d=ImageDraw.Draw(im)
    header(d,'智眼路安——基于视觉感知与边缘计算的路网健康管理平台')
    panel(d,(28,110,330,710),'工单状态')
    panel(d,(348,110,850,710),'城市路网态势')
    panel(d,(868,110,1170,710),'运行概况')
    cx,cy=180,280
    colors=['#47dcb2','#d6b777','#5eb7dd','#a88ce5']
    start=0
    for c in colors:
        end=start+90
        d.pieslice((cx-95,cy-95,cx+95,cy+95),start,end,fill=c,outline='#10271f')
        start=end
    d.ellipse((cx-50,cy-50,cx+50,cy+50),fill='#123126')
    d.text((150,268),'12',font=title,fill='white')
    d.text((142,305),'工单总量',font=tiny,fill='#b5cfc0')
    for i,(lab,col,num) in enumerate([('未处理','#d6b777','3'),('处理中','#5eb7dd','3'),('待审核','#a88ce5','3'),('已完成','#47dcb2','3')]):
        x=58+(i%2)*130
        y=430+(i//2)*72
        rounded(d,(x,y,x+112,y+48),10,fill='#163b2e',outline=col)
        d.text((x+10,y+8),lab,font=tiny,fill='#b6c8bc')
        d.text((x+80,y+7),num,font=font,fill=col)
    rounded(d,(372,190,828,660),12,fill='#0c2433',outline='#285447')
    for x in range(390,820,80):
        d.line((x,210,x,640),fill='#153b45',width=1)
    for y in range(220,650,70):
        d.line((390,y,810,y),fill='#153b45',width=1)
    pts=[(480,330,'#d9535a'),(620,390,'#d6b777'),(710,290,'#d9535a'),(560,520,'#d6b777'),(760,550,'#d6b777')]
    for x,y,c in pts:
        d.ellipse((x-12,y-12,x+12,y+12),fill=c,outline='white',width=2)
    d.text((392,145),'已定位事件 12 条',font=small,fill='#92e5bd')
    for i,(lab,val,col) in enumerate([('今日告警','86','#d6b777'),('设备在线','92%','#92e5bd'),('处理完成','67%','#71c9ad')]):
        y=180+i*120
        rounded(d,(892,y,1148,y+92),12,fill='#17382b',outline='#2c5143')
        d.text((912,y+16),lab,font=small,fill='#b3c9bc')
        d.text((912,y+46),val,font=title,fill=col)
    d.text((892,560),'近 7 日告警趋势',font=small,fill='#eff5ea')
    pts=[(900,640),(940,610),(980,625),(1020,570),(1060,600),(1100,530),(1140,550)]
    d.line(pts,fill='#92e5bd',width=4)
    im.save(out2/'03-dashboard-wireframe.png')
def save_orders():
    im=Image.new('RGB',(1200,760),'#091b17')
    d=ImageDraw.Draw(im)
    header(d,'事件中心')
    panel(d,(28,110,470,710),'报警处置队列')
    panel(d,(490,110,1170,710),'工单详情')
    labels=['机动车违停','路面坑洼','道路设施损坏','非机动车逆行','护栏倾倒','占道施工','井盖移位']
    stages=['处理中','待处理','已完成','处理中','待审核','已完成','待处理']
    for i in range(7):
        y=190+i*63
        c='#9c4b57' if i==0 else '#17382b'
        rounded(d,(52,y,446,y+48),10,fill=c,outline='#d6b777' if i==0 else '#2c5143')
        d.text((68,y+9),labels[i],font=small,fill='#f0f5eb')
        d.text((320,y+11),stages[i],font=tiny,fill='#d6b777' if i<3 else '#92e5bd')
    d.text((530,185),'WO-20261004-0032',font=font,fill='#f0f5eb')
    d.text((530,235),'事件类型：道路安全 · 机动车违停',font=small,fill='#b9cabe')
    d.text((530,275),'位置：天津理工大学附近',font=small,fill='#b9cabe')
    rounded(d,(530,330,820,560),12,fill='#102b37',outline='#2c5143')
    d.text((550,350),'报警材料',font=small,fill='#f0f5eb')
    d.rectangle((550,395,800,535),fill='#213f4a')
    d.text((630,455),'现场图片 / 视频',font=font,fill='#92e5bd')
    rounded(d,(850,330,1125,560),12,fill='#102b37',outline='#2c5143')
    d.text((870,350),'处理后材料',font=small,fill='#f0f5eb')
    d.text((920,455),'待上传',font=font,fill='#d6b777')
    rounded(d,(530,600,1125,660),12,fill='#24553c')
    d.text((770,617),'发送工单   审核   上传材料',font=small,fill='#f5faed')
    im.save(out2/'04-orders-wireframe.png')
def save_devices():
    im=Image.new('RGB',(1200,760),'#091b17')
    d=ImageDraw.Draw(im)
    header(d,'设备中心')
    panel(d,(28,110,430,710),'设备状态分布')
    panel(d,(450,110,1170,710),'车载设备列表')
    for i,(lab,val,col) in enumerate([('正常','8','#92e5bd'),('异常','2','#d6b777'),('离线','1','#a9b4ae')]):
        y=210+i*120
        rounded(d,(70,y,390,y+84),14,fill='#17382b',outline=col)
        d.text((92,y+15),lab,font=small,fill='#bdd2c4')
        d.text((280,y+10),val,font=title,fill=col)
        d.text((92,y+50),'查看设备与原因',font=tiny,fill='#8cae9e')
    for i in range(6):
        y=180+i*74
        rounded(d,(485,y,1135,y+57),10,fill='#17382b',outline='#2c5143')
        d.text((505,y+10),f'BUS-{i+12:03d}',font=small,fill='#f0f5eb')
        d.text((650,y+10),f'津A·{i+1:04d}',font=tiny,fill='#b9cabe')
        d.text((785,y+10),['正常','正常','异常','正常','离线','正常'][i],font=tiny,fill=['#92e5bd','#92e5bd','#d6b777','#92e5bd','#a9b4ae','#92e5bd'][i])
        d.text((930,y+10),f'{50+i*3}℃',font=tiny,fill='#b9cabe')
        d.text((1030,y+10),f'{68-i*5}%',font=tiny,fill='#b9cabe')
    im.save(out2/'05-devices-wireframe.png')
def save_upload():
    im=Image.new('RGB',(1200,760),'#091b17')
    d=ImageDraw.Draw(im)
    header(d,'工单处理材料')
    panel(d,(120,140,1080,650),'图片与视频上传')
    rounded(d,(180,220,1020,285),12,fill='#193b2d',outline='#365b49')
    d.text((210,241),'＋ 添加图片 / 视频',font=small,fill='#92e5bd')
    d.text((760,241),'每批最多 10 个，单个不超过 200 MB',font=tiny,fill='#b7cabb')
    files=[('现场照片.jpg','100%','#92e5bd'),('处理结果.png → JPG','76%','#d6b777'),('现场视频.mp4','失败，可重试','#d9535a')]
    for i,(name,status,col) in enumerate(files):
        y=340+i*78
        rounded(d,(180,y,1020,y+55),10,fill='#17382b',outline='#2c5143')
        d.text((205,y+14),name,font=small,fill='#eff5ea')
        d.text((720,y+14),status,font=tiny,fill=col)
        d.rectangle((205,y+43,980,y+47),fill='#2a4a3a')
        d.rectangle((205,y+43,205+int(775*([1,.76,.25][i])),y+47),fill=col)
    rounded(d,(800,585,1020,635),10,fill='#24553c')
    d.text((858,600),'重试未完成项',font=small,fill='#f5faed')
    im.save(out2/'06-upload-wireframe.png')
save_dashboard()
save_orders()
save_devices()
save_upload()

