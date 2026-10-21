
from PIL import Image,ImageDraw,ImageFont
from pathlib import Path
import math
out=Path(r'C:\Users\wangmeng\Desktop\git\docx_work\enhanced\figures')
font=r'C:\Windows\Fonts\msyh.ttc'
def F(sz):
 try:return ImageFont.truetype(font,sz,index=0)
 except:return ImageFont.load_default()
title,head,body,small=F(34),F(25),F(20),F(16)
navy='#102B3A'; blue='#1672B8'; cyan='#29B6C5'; mint='#3DBA97'; gold='#D3A84B'; ink='#183242'; muted='#536A77'; pale='#F3F7F9'; white='#FFFFFF'; orange='#E38A42'
def box(d,b,txt,col=blue):
 d.rounded_rectangle(b,18,fill=white,outline=col,width=3)
 bb=d.multiline_textbbox((0,0),txt,font=body,spacing=6,align='center')
 x=(b[0]+b[2]-(bb[2]-bb[0]))/2; y=(b[1]+b[3]-(bb[3]-bb[1]))/2
 d.multiline_text((x,y),txt,font=body,fill=ink,spacing=6,align='center')
def arr(d,a,b,c=navy):
 d.line((a,b),fill=c,width=5); ang=math.atan2(b[1]-a[1],b[0]-a[0]); h=15
 d.polygon([b,(b[0]-h*math.cos(ang-math.pi/6),b[1]-h*math.sin(ang-math.pi/6)),(b[0]-h*math.cos(ang+math.pi/6),b[1]-h*math.sin(ang+math.pi/6))],fill=c)
def base(t,s):
 im=Image.new('RGB',(1600,900),pale); d=ImageDraw.Draw(im)
 d.rectangle((0,0,1600,125),fill=navy); d.text((55,22),t,font=title,fill=white); d.text((58,78),s,font=small,fill='#B9D4DF')
 return im,d

# architecture
im,d=base('智巡云 Web 系统架构','页面展示、数据服务、地图与云存储按职责分层')
items=[((55,245,345,405),'用户浏览器\n登录 · 导航 · 页面状态',blue),((440,245,745,405),'Web 应用层\napp.js · 页面模块 · CSS',cyan),((835,175,1150,345),'数据访问层\napi.js · read-cache.js',mint),((835,430,1150,600),'业务组件层\n地图 · 工单 · 设备',gold),((1240,175,1540,345),'业务 REST API\n告警 · 工单 · 设备',blue),((1240,430,1540,600),'外部能力\n腾讯地图 · COS · Dify',cyan)]
for b,t,c in items:box(d,b,t,c)
for a,b in [((345,325),(440,325)),((745,290),(835,260)),((745,370),(835,515)),((1150,260),(1240,260)),((1150,515),(1240,515))]:arr(d,a,b)
d.text((65,690),'页面负责呈现与交互；数据访问层统一处理认证头、超时、字段映射和缓存失效。',font=body,fill=ink)
im.save(out/'architecture.png')

# workflow
im,d=base('事件处置闭环','从事件接入到处置结果回查')
steps=[('01 事件接入','告警 / 时间 / 等级\n坐标 / 证据'),('02 审核研判','核验有效性\n确定处理优先级'),('03 派发工单','关联责任人\n记录派发状态'),('04 现场处置','填写处置说明\n上传现场材料'),('05 结果回查','核对处理凭证\n更新工单状态')]
cols=[blue,cyan,gold,orange,mint]
for i,(t,s) in enumerate(steps):
 x=35+i*315; b=(x,260,x+270,510); box(d,b,t+'\n\n'+s,cols[i])
 if i<4:arr(d,(x+270,385),(x+310,385))
d.text((65,660),'页面发起操作，后端确认业务状态；成功后刷新相关队列与详情，失败时保留上下文供重试。',font=body,fill=ink)
im.save(out/'closed-loop.png')

# refresh
im,d=base('数据刷新与一致性控制','短缓存减少重复读取，写入后失效并校验异步响应')
nodes=[((60,270,350,445),'页面进入\n并行读取资源',blue),((455,270,745,445),'短缓存\n会话作用域 · 合并请求',cyan),((850,270,1140,445),'业务 API\n返回最新数据',mint),((1245,270,1540,445),'页面更新\n校验导航与数据版本',gold)]
for b,t,c in nodes:box(d,b,t,c)
for i in range(3):arr(d,(nodes[i][0][2]+10,355),(nodes[i+1][0][0]-10,355))
d.line((1380,500,1380,600,600,600,600,460),fill=orange,width=4);arr(d,(600,600),(600,475),orange)
d.text((720,565),'写入后使相关资源失效，再读取最新数据',font=small,fill='#9D5A1F')
d.text((65,690),'离开页面时停止对应定时刷新；较早请求晚到时，不允许其覆盖新的页面状态。',font=body,fill=ink)
im.save(out/'refresh.png')

# COS upload
im,d=base('工单材料上传链路','浏览器完成校验与直传，既有扫描与查询接口负责后续同步')
nodes=[((50,270,345,450),'选择文件\n多选 · 去重 · 限量',blue),((440,270,735,450),'本地校验\n格式 · MIME · 大小',cyan),((830,270,1125,450),'格式处理\nPNG/WEBP 转 JPG',gold),((1220,270,1530,450),'上传至 COS\n进度回调 · 失败重试',mint)]
for b,t,c in nodes:box(d,b,t,c)
for i in range(3):arr(d,(nodes[i][0][2]+8,360),(nodes[i+1][0][0]-8,360))
d.rounded_rectangle((365,575,1230,690),18,fill='#EAF4F7',outline=cyan,width=3)
bb=d.multiline_textbbox((0,0),'成功后显示临时预览 → 既有扫描任务同步 → 工单详情持久展示',font=body,align='center')
d.text(((1600-(bb[2]-bb[0]))/2,615),'成功后显示临时预览 → 既有扫描任务同步 → 工单详情持久展示',font=body,fill=ink)
arr(d,(1375,460),(1375,630),orange);arr(d,(1375,630),(1240,630),orange)
d.text((65,755),'限制：每批最多 10 个文件；单文件最大 200 MB。对象键包含工单编号与 UUID。',font=small,fill=muted)
im.save(out/'cos-upload.png')

