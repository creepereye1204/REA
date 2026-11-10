import sys, struct, os, collections
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from swftags import load, tags, header_end
OPS={0x04:'nextFrame',0x05:'prevFrame',0x06:'play',0x07:'stop',0x0A:'add',0x0B:'sub',0x0C:'mul',0x0D:'div',0x0E:'eq',0x0F:'lt',0x10:'and',0x11:'or',0x12:'not',0x13:'strEq',0x14:'strLen',0x15:'substr',0x17:'pop',0x18:'int',0x1C:'getVar',0x1D:'setVar',0x20:'setTarget2',0x21:'strAdd',0x22:'getProp',0x23:'setProp',0x24:'cloneSprite',0x25:'removeSprite',0x26:'trace',0x27:'startDrag',0x28:'endDrag',0x30:'random',0x34:'getTime',0x3A:'delete',0x3B:'delete2',0x3C:'defineLocal',0x3D:'callFunction',0x3E:'return',0x3F:'mod',0x40:'newObject',0x41:'defineLocal2',0x42:'initArray',0x43:'initObject',0x44:'typeof',0x45:'targetPath',0x46:'enumerate',0x47:'add2',0x48:'less2',0x49:'equals2',0x4A:'toNumber',0x4B:'toString',0x4C:'pushDup',0x4D:'swap',0x4E:'getMember',0x4F:'setMember',0x50:'increment',0x51:'decrement',0x52:'callMethod',0x53:'newMethod',0x54:'instanceOf',0x55:'enumerate2',0x60:'bitAnd',0x61:'bitOr',0x62:'bitXor',0x63:'shl',0x64:'shr',0x65:'ushr',0x66:'strictEq',0x67:'greater',0x68:'strGreater',0x69:'extends',0x2B:'castOp',0x2C:'implementsOp',0x8F:'try',0x87:'storeRegister',0x88:'constantPool',0x81:'gotoFrame',0x83:'getURL',0x8A:'waitForFrame',0x8B:'setTarget',0x8C:'gotoLabel',0x96:'push',0x99:'jump',0x9D:'if',0x9E:'call',0x9F:'gotoFrame2',0x9A:'getURL2',0x94:'with',0x9B:'defineFunction',0x8E:'defineFunction2'}
def cstr(d,i):
    e=d.index(b'\0',i); return d[i:e].decode('latin1'),e+1
def dis(d,pool=None,ind='',out=None,regs=None):
    pool=pool if pool is not None else []
    i=0
    while i<len(d):
        op=d[i];off=i;i+=1
        if op==0: out.append(ind+'end');break
        ln=0;arg=b''
        if op>=0x80:
            ln=struct.unpack('<H',d[i:i+2])[0];i+=2;arg=d[i:i+ln];i+=ln
        name=OPS.get(op,'op%02x'%op)
        if op==0x88:
            n=struct.unpack('<H',arg[:2])[0];j=2;pool[:]=[]
            for _ in range(n): s,j=cstr(arg,j);pool.append(s)
            out.append(ind+'constantPool [%d]'%n);continue
        if op==0x96:
            j=0;vals=[]
            while j<len(arg):
                t=arg[j];j+=1
                if t==0: s,j=cstr(arg,j);vals.append(repr(s))
                elif t==1: vals.append(repr(struct.unpack('<f',arg[j:j+4])[0]));j+=4
                elif t==2: vals.append('null')
                elif t==3: vals.append('undefined')
                elif t==4: r=arg[j];vals.append((regs or {}).get(r,'r%d'%r));j+=1
                elif t==5: vals.append(str(bool(arg[j])).lower());j+=1
                elif t==6:
                    b=arg[j:j+8];vals.append(repr(struct.unpack('<d',b[4:]+b[:4])[0]));j+=8
                elif t==7: vals.append(str(struct.unpack('<i',arg[j:j+4])[0]));j+=4
                elif t==8: vals.append(repr(pool[arg[j]]) if arg[j]<len(pool) else 'c%d'%arg[j]);j+=1
                elif t==9: k=struct.unpack('<H',arg[j:j+2])[0];vals.append(repr(pool[k]) if k<len(pool) else 'c%d'%k);j+=2
            out.append(ind+'push '+', '.join(vals));continue
        if op in (0x9B,0x8E):
            fn,j=cstr(arg,0);n=struct.unpack('<H',arg[j:j+2])[0];j+=2
            params=[];r2={}
            if op==0x8E:
                rc=arg[j];fl=struct.unpack('<H',arg[j+1:j+3])[0];j+=3
                # preload registers
                r=1
                for bit,nm in ((0x01,'this'),(0x04,'arguments'),(0x10,'super'),(0x40,'_root'),(0x80,'_parent'),(0x100,'_global')):
                    if fl&bit: r2[r]=nm;r+=1
                for _ in range(n):
                    reg=arg[j];j+=1;s,j=cstr(arg,j);params.append(s)
                    if reg: r2[reg]=s
            else:
                for _ in range(n): s,j=cstr(arg,j);params.append(s)
            size=struct.unpack('<H',arg[j:j+2])[0]
            out.append(ind+'function %s(%s) {'%(fn or '<anon>',', '.join(params)))
            body=d[i:i+size];i+=size
            dis(body,pool,ind+'  ',out,r2);out.append(ind+'}');continue
        if op==0x87: out.append(ind+'storeRegister r%d%s'%(arg[0],' ('+regs[arg[0]]+')' if regs and arg[0] in regs else ''));continue
        if op in (0x99,0x9D): out.append(ind+'%s %+d'%(name,struct.unpack('<h',arg)[0]));continue
        if op==0x8C: out.append(ind+'gotoLabel '+cstr(arg,0)[0]);continue
        out.append(ind+name+(' '+arg.hex() if arg else ''))
    return out
def walk(b,pos,base,res):
    for code,data,_ in tags(b,pos):
        if code==12: res.append((base+'/DoAction',data))
        elif code==59: res.append(('sprite%d'%struct.unpack('<H',data[:2])[0],data[2:]))
        elif code==39:
            sid=struct.unpack('<H',data[:2])[0]
            walk(data,4,'sprite%d'%sid,res)
if __name__=='__main__':
    ver,ln,b=load(sys.argv[1]);outdir=sys.argv[2];os.makedirs(outdir,exist_ok=True)
    names={}
    for code,data,_ in tags(b,header_end(b)):
        if code==56:
            n=struct.unpack('<H',data[:2])[0];i=2
            for _ in range(n):
                cid=struct.unpack('<H',data[i:i+2])[0];i+=2;s,i=cstr(data,i);names['sprite%d'%cid]=s
    res=[];walk(b,header_end(b),'root',res)
    cnt=collections.Counter()
    for key,data in res:
        nm=names.get(key,key).replace('__Packages.','').replace('/','_')
        cnt[nm]+=1
        fn=os.path.join(outdir,nm+('' if cnt[nm]==1 else '_%d'%cnt[nm])+'.asm')
        try: lines=dis(data,[],'',[])
        except Exception as e: lines=['ERROR %r'%e]
        open(fn,'w').write('\n'.join(lines))
    print(len(res),'scripts')
