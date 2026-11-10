# Flow-following AS2 disassembler (handles junk bytes between jumps)
import sys, struct, os, collections
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from swftags import load, tags, header_end
from as2dis import OPS, cstr, walk
def decode(d,i):
    op=d[i];ln=0;arg=b''
    if op>=0x80:
        ln=struct.unpack('<H',d[i+1:i+3])[0];arg=d[i+3:i+3+ln];nxt=i+3+ln
    else: nxt=i+1
    return op,arg,nxt
def fmt_push(arg,pool,regs):
    j=0;vals=[]
    while j<len(arg):
        t=arg[j];j+=1
        if t==0: s,j=cstr(arg,j);vals.append(repr(s))
        elif t==1: vals.append('%g'%struct.unpack('<f',arg[j:j+4])[0]);j+=4
        elif t==2: vals.append('null')
        elif t==3: vals.append('undefined')
        elif t==4: r=arg[j];vals.append('$'+regs.get(r,'r%d'%r));j+=1
        elif t==5: vals.append(str(bool(arg[j])).lower());j+=1
        elif t==6: b=arg[j:j+8];vals.append('%r'%struct.unpack('<d',b[4:]+b[:4])[0]);j+=8
        elif t==7: vals.append(str(struct.unpack('<i',arg[j:j+4])[0]));j+=4
        elif t==8: vals.append(repr(pool[arg[j]]) if arg[j]<len(pool) else 'c%d'%arg[j]);j+=1
        elif t==9: k=struct.unpack('<H',arg[j:j+2])[0];vals.append(repr(pool[k]) if k<len(pool) else 'c%d'%k);j+=2
        else: vals.append('?');break
    return vals
def dis(d,start,end,pool,regs,ind,out):
    seen={};work=[start];labels=set()
    while work:
        i=work.pop()
        while start<=i<end and i not in seen:
            try: op,arg,nxt=decode(d,i)
            except Exception: break
            seen[i]=(op,arg,nxt)
            if op==0: break
            if op in (0x9B,0x8E):
                fn,j=cstr(arg,0);n=struct.unpack('<H',arg[j:j+2])[0]
                size=struct.unpack('<H',arg[-2:])[0]
                seen[i]=(op,arg,nxt+size); nxt=nxt+size
            if op==0x99:
                t=nxt+struct.unpack('<h',arg)[0];labels.add(t);work.append(t);break
            if op==0x9D:
                t=nxt+struct.unpack('<h',arg)[0];labels.add(t);work.append(t)
            if op==0x3E: break
            i=nxt
    for i in sorted(seen):
        op,arg,nxt=seen[i]
        if i in labels: out.append(ind[:-2]+'L%d:'%i)
        name=OPS.get(op,'op%02x'%op)
        if op==0x88:
            n=struct.unpack('<H',arg[:2])[0];j=2;pool[:]=[]
            for _ in range(n): s,j=cstr(arg,j);pool.append(s)
            continue
        if op==0x96: out.append(ind+'push '+', '.join(fmt_push(arg,pool,regs)));continue
        if op in (0x9B,0x8E):
            fn,j=cstr(arg,0);n=struct.unpack('<H',arg[j:j+2])[0];j+=2;params=[];r2={}
            if op==0x8E:
                fl=struct.unpack('<H',arg[j+1:j+3])[0];j+=3;r=1
                for bit,nm in ((0x01,'this'),(0x04,'arguments'),(0x10,'super'),(0x40,'_root'),(0x80,'_parent'),(0x100,'_global')):
                    if fl&bit: r2[r]=nm;r+=1
                for _ in range(n):
                    reg=arg[j];j+=1;s,j=cstr(arg,j);params.append(s)
                    if reg: r2[reg]=s
            else:
                for _ in range(n): s,j=cstr(arg,j);params.append(s)
            size=struct.unpack('<H',arg[-2:])[0];bs=i+3+len(arg)
            out.append(ind+'function %s(%s) {'%(fn or '',', '.join(params)))
            dis(d,bs,bs+size,pool,r2,ind+'  ',out);out.append(ind+'}');continue
        if op==0x87: out.append(ind+'store $'+regs.get(arg[0],'r%d'%arg[0]));continue
        if op in (0x99,0x9D): out.append(ind+'%s L%d'%(name,i+3+len(arg)+struct.unpack('<h',arg)[0]));continue
        out.append(ind+name+(' '+arg.hex() if arg else ''))
if __name__=='__main__':
    ver,ln,b=load(sys.argv[1]);outdir=sys.argv[2];os.makedirs(outdir,exist_ok=True)
    names={}
    for code,data,_ in tags(b,header_end(b)):
        if code==56:
            n=struct.unpack('<H',data[:2])[0];i=2
            for _ in range(n):
                cid=struct.unpack('<H',data[i:i+2])[0];i+=2;s,i=cstr(data,i);names['sprite%d'%cid]=s
    res=[];walk(b,header_end(b),'root',res);cnt=collections.Counter()
    for key,data in res:
        nm=names.get(key,key).replace('__Packages.','').replace('/','_');cnt[nm]+=1
        out=[]
        try: dis(data,0,len(data),[],{},'  ',out)
        except Exception as e: out.append('ERROR %r'%e)
        open(os.path.join(outdir,nm+('' if cnt[nm]==1 else '_%d'%cnt[nm])+'.asm'),'w').write('\n'.join(out))
