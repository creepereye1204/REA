import sys, zlib, struct, collections
TAGS={0:'End',1:'ShowFrame',2:'DefineShape',4:'PlaceObject',5:'RemoveObject',6:'DefineBits',7:'DefineButton',8:'JPEGTables',9:'SetBackgroundColor',10:'DefineFont',11:'DefineText',12:'DoAction',13:'DefineFontInfo',14:'DefineSound',15:'StartSound',18:'SoundStreamHead',19:'SoundStreamBlock',20:'DefineBitsLossless',21:'DefineBitsJPEG2',22:'DefineShape2',24:'Protect',26:'PlaceObject2',28:'RemoveObject2',32:'DefineShape3',33:'DefineText2',34:'DefineButton2',35:'DefineBitsJPEG3',36:'DefineBitsLossless2',37:'DefineEditText',39:'DefineSprite',43:'FrameLabel',45:'SoundStreamHead2',46:'DefineMorphShape',48:'DefineFont2',56:'ExportAssets',58:'EnableDebugger',59:'DoInitAction',62:'DefineFontInfo2',64:'EnableDebugger2',65:'ScriptLimits',69:'FileAttributes',70:'PlaceObject3',73:'DefineFontAlignZones',74:'CSMTextSettings',75:'DefineFont3',76:'SymbolClass',77:'Metadata',82:'DoABC',83:'DefineShape4',86:'DefineSceneAndFrameLabelData',87:'DefineBinaryData',88:'DefineFontName'}
def load(p):
    d=open(p,'rb').read()
    sig,ver,ln=d[:3],d[3],struct.unpack('<I',d[4:8])[0]
    body=zlib.decompress(d[8:]) if sig==b'CWS' else d[8:]
    return ver,ln,body
def tags(b,pos):
    while pos<len(b):
        h=struct.unpack('<H',b[pos:pos+2])[0];pos+=2
        code,l=h>>6,h&63
        if l==63: l=struct.unpack('<I',b[pos:pos+4])[0];pos+=4
        yield code,b[pos:pos+l],pos
        pos+=l
        if code==0: break
def header_end(b):
    nbits=b[0]>>3; rb=(5+4*nbits+7)//8
    return rb+4
if __name__=='__main__':
    ver,ln,b=load(sys.argv[1])
    print('version',ver,'len',ln)
    nbits=b[0]>>3
    bits=int.from_bytes(b[:(5+4*nbits+7)//8],'big'); tot=((5+4*nbits+7)//8)*8
    vals=[(bits>>(tot-5-nbits*(i+1)))&((1<<nbits)-1) for i in range(4)]
    print('stage twips',vals,'px',[v/20 for v in vals])
    p=header_end(b); fr,fc=b[p-4:p-2],struct.unpack('<H',b[p-2:p])[0]
    print('fps',fr[1]+fr[0]/256,'frames',fc)
    c=collections.Counter()
    for code,data,_ in tags(b,p):
        c[TAGS.get(code,code)]+=1
        if code==69: print('FileAttributes',bin(data[0]))
        if code==56:
            n=struct.unpack('<H',data[:2])[0];i=2;out=[]
            for _ in range(n):
                cid=struct.unpack('<H',data[i:i+2])[0];i+=2;e=data.index(b'\0',i);out.append((cid,data[i:e].decode('latin1')));i=e+1
            print('Export',out)
        if code==43: print('FrameLabel',data.split(b'\0')[0])
    print(c.most_common())
