# Symbolic-execution decompiler for obfuscated AS2 bytecode.
# Obfuscator vars (names made of control chars) are tracked concretely so the
# flattened dispatcher resolves; everything else becomes symbolic expressions.
import sys, struct, os, collections, re
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from swftags import load, tags, header_end
from as2dis import cstr, walk

def isobf(n): return isinstance(n, str) and n != '' and all(ord(c) < 32 for c in n)

class C:  # concrete
    __slots__ = ('v',)
    def __init__(s, v): s.v = v
    def __repr__(s):
        v = s.v
        if v is None: return 'undefined'
        if v is True: return 'true'
        if v is False: return 'false'
        if isinstance(v, float):
            return str(int(v)) if v == int(v) and abs(v) < 1e15 else repr(v)
        if isinstance(v, str): return '"' + v.replace('\\', '\\\\').replace('"', '\\"').replace('\n', '\\n') + '"'
        return repr(v)
class U:  # symbolic
    __slots__ = ('e',)
    def __init__(s, e): s.e = e
    def __repr__(s): return s.e

def num(v):
    if isinstance(v, bool): return 1.0 if v else 0.0
    if isinstance(v, (int, float)): return float(v)
    if v is None: return float('nan')
    try: return float(v)
    except Exception: return float('nan')
def truthy(v):
    if isinstance(v, str): return v != ''
    if v is None: return False
    if isinstance(v, float): return v == v and v != 0
    return bool(v)

BIN = {0x0A: '+', 0x47: '+', 0x0B: '-', 0x0C: '*', 0x0D: '/', 0x3F: '%', 0x0E: '==', 0x49: '==', 0x66: '===',
       0x0F: '<', 0x48: '<', 0x67: '>', 0x10: '&&', 0x11: '||', 0x60: '&', 0x61: '|', 0x62: '^', 0x63: '<<',
       0x64: '>>', 0x65: '>>>', 0x13: 'eq', 0x21: 'add', 0x68: 'gt', 0x54: 'instanceof'}

def cbin(op, a, b):
    try:
        if op in (0x0A,): return num(a) + num(b)
        if op == 0x47:
            if isinstance(a, str) or isinstance(b, str): return str(a) + str(b)
            return num(a) + num(b)
        if op == 0x0B: return num(a) - num(b)
        if op == 0x0C: return num(a) * num(b)
        if op == 0x0D: return num(a) / num(b) if num(b) else float('inf')
        if op == 0x3F: return float(int(num(a)) % int(num(b)))
        if op in (0x0E, 0x49): return a == b if type(a) == type(b) else num(a) == num(b)
        if op == 0x66: return a == b and type(a) == type(b)
        if op in (0x0F, 0x48): return num(a) < num(b)
        if op == 0x67: return num(a) > num(b)
        if op == 0x10: return truthy(a) and truthy(b)
        if op == 0x11: return truthy(a) or truthy(b)
        if op == 0x60: return float(int(num(a)) & int(num(b)))
        if op == 0x61: return float(int(num(a)) | int(num(b)))
        if op == 0x62: return float(int(num(a)) ^ int(num(b)))
    except Exception: pass
    raise ValueError

CONSTFN = {}
STACKKEY = True
class Fn:
    count = 0

class Decomp:
    def __init__(s, d, fnstore):
        s.d = d; s.fns = fnstore
    def decode(s, i):
        d = s.d; op = d[i]
        if op >= 0x80:
            ln = struct.unpack('<H', d[i+1:i+3])[0]; return op, d[i+3:i+3+ln], i+3+ln
        return op, b'', i+1
    def pushvals(s, arg, pool, regs):
        j = 0; vals = []
        while j < len(arg):
            t = arg[j]; j += 1
            if t == 0: x, j = cstr(arg, j); vals.append(C(x))
            elif t == 1: vals.append(C(float(struct.unpack('<f', arg[j:j+4])[0]))); j += 4
            elif t == 2: vals.append(C(None))
            elif t == 3: vals.append(C(None))
            elif t == 4: r = arg[j]; j += 1; vals.append(regs.get(r, U('r%d' % r)))
            elif t == 5: vals.append(C(bool(arg[j]))); j += 1
            elif t == 6: b = arg[j:j+8]; vals.append(C(struct.unpack('<d', b[4:]+b[:4])[0])); j += 8
            elif t == 7: vals.append(C(float(struct.unpack('<i', arg[j:j+4])[0]))); j += 4
            elif t == 8: vals.append(C(pool[arg[j]] if arg[j] < len(pool) else '<c%d>' % arg[j])); j += 1
            elif t == 9:
                k = struct.unpack('<H', arg[j:j+2])[0]; j += 2; vals.append(C(pool[k] if k < len(pool) else '<c%d>' % k))
            else: break
        return vals

    def run(s, start, end, pool, regnames):
        out = []          # list of (nodeid, text)
        labels = set()
        visited = {}      # (pc, statekey) -> nodeid
        nid = [0]
        # state: pc, stack, obfvars, regs(dict reg->value), pool
        init_regs = {r: U(n) for r, n in regnames.items()}
        stack_work = [(start, [], {}, dict(init_regs), list(pool), None)]
        steps = 0
        while stack_work:
            pc, st, ov, regs, pl, fromlbl = stack_work.pop()
            if fromlbl is not None:
                out.append((None, '@L%s' % fromlbl))
            while True:
                steps += 1
                if steps > 400000: out.append((None, '// step limit')); return out, labels
                if pc == end or not (0 <= pc < len(s.d)):
                    out.append((None, 'return;')); break
                key = (pc, tuple(sorted((k, repr(v)) for k, v in ov.items())), tuple(repr(x) for x in st[-3:]) if STACKKEY else ())
                if key in visited:
                    labels.add(visited[key]); out.append((None, 'goto L%d;' % visited[key])); break
                nid[0] += 1; visited[key] = nid[0]; out.append((nid[0], None))
                try: op, arg, nxt = s.decode(pc)
                except Exception: out.append((None, '// bad decode')); break
                def pop():
                    return st.pop() if st else U('<?>')
                def emit(t): out.append((None, t))
                if op == 0: emit('return;'); break
                if op == 0x88:
                    n = struct.unpack('<H', arg[:2])[0]; j = 2; pl[:] = []
                    for _ in range(n): x, j = cstr(arg, j); pl.append(x)
                elif op == 0x96: st.extend(s.pushvals(arg, pl, regs))
                elif op == 0x17:
                    v = pop()
                    if isinstance(v, U) and ('(' in v.e or '=' in v.e): emit(v.e + ';')
                elif op in BIN:
                    b = pop(); a = pop()
                    if isinstance(a, C) and isinstance(b, C):
                        try: st.append(C(cbin(op, a.v, b.v))); pc = nxt; continue
                        except ValueError: pass
                    st.append(U('(%r %s %r)' % (a, BIN[op], b)))
                elif op == 0x12:
                    a = pop(); st.append(C(not truthy(a.v)) if isinstance(a, C) else U('!%r' % a))
                elif op in (0x50, 0x51):
                    a = pop()
                    if isinstance(a, C): st.append(C(num(a.v) + (1 if op == 0x50 else -1)))
                    else: st.append(U('(%r %s 1)' % (a, '+' if op == 0x50 else '-')))
                elif op == 0x44: st.append(U('typeof(%r)' % pop()))
                elif op in (0x4A, 0x18): a = pop(); st.append(U('Number(%r)' % a) if isinstance(a, U) else C(num(a.v)))
                elif op == 0x4B: st.append(U('String(%r)' % pop()))
                elif op == 0x4C: v = pop(); st += [v, v]
                elif op == 0x4D: b = pop(); a = pop(); st += [b, a]
                elif op == 0x1C:
                    n = pop()
                    if isinstance(n, C) and isobf(n.v):
                        st.append(ov.get(n.v, U('<obf>')))
                    else:
                        st.append(U(n.v if isinstance(n, C) and isinstance(n.v, str) else 'eval(%r)' % n))
                elif op in (0x1D, 0x3C):
                    v = pop(); n = pop()
                    if isinstance(n, C) and isobf(n.v):
                        if isinstance(v, C): ov[n.v] = v
                        else: ov.pop(n.v, None)
                    else:
                        nm = n.v if isinstance(n, C) else repr(n)
                        emit(('var ' if op == 0x3C else '') + '%s = %r;' % (nm, v))
                elif op == 0x41:
                    n = pop()
                    if not (isinstance(n, C) and isobf(n.v)): emit('var %s;' % (n.v if isinstance(n, C) else n))
                elif op == 0x87:
                    v = st[-1] if st else U('<?>'); r = arg[0]
                    name = regnames.get(r, 'r%d' % r)
                    emit('%s = %r;' % (name, v)); regs[r] = U(name)
                    if st: st[-1] = U(name)
                elif op == 0x4E:
                    n = pop(); o = pop()
                    if isinstance(n, C) and isinstance(n.v, str) and re.match(r'^[A-Za-z_$][\w$]*$', n.v):
                        st.append(U('%r.%s' % (o, n.v)))
                    else: st.append(U('%r[%r]' % (o, n)))
                elif op == 0x4F:
                    v = pop(); n = pop(); o = pop()
                    if isinstance(n, C) and isinstance(n.v, str) and re.match(r'^[A-Za-z_$][\w$]*$', n.v):
                        emit('%r.%s = %r;' % (o, n.v, v))
                    else: emit('%r[%r] = %r;' % (o, n, v))
                elif op in (0x3D, 0x52, 0x40, 0x53):
                    if op in (0x52, 0x53):
                        n = pop(); o = pop()
                        if isinstance(n, C) and (n.v is None or n.v == ''): f = repr(o)
                        elif isinstance(n, C) and isinstance(n.v, str): f = '%r.%s' % (o, n.v)
                        else: f = '%r[%r]' % (o, n)
                    else:
                        n = pop(); f = n.v if isinstance(n, C) and isinstance(n.v, str) else repr(n)
                        if op == 0x3D and isinstance(n, C) and n.v in CONSTFN:
                            c = pop(); cnt = int(num(c.v)) if isinstance(c, C) else 0
                            for _ in range(cnt): pop()
                            st.append(C(CONSTFN[n.v])); pc = nxt; continue
                    c = pop(); cnt = int(num(c.v)) if isinstance(c, C) and num(c.v) == num(c.v) else 0
                    args = [pop() for _ in range(max(0, min(cnt, 64)))]
                    st.append(U(('new ' if op in (0x40, 0x53) else '') + '%s(%s)' % (f, ', '.join(map(repr, args)))))
                elif op == 0x42:
                    c = pop(); cnt = int(num(c.v)) if isinstance(c, C) else 0
                    st.append(U('[%s]' % ', '.join(repr(pop()) for _ in range(max(0, min(cnt, 4096))))))
                elif op == 0x43:
                    c = pop(); cnt = int(num(c.v)) if isinstance(c, C) else 0; items = []
                    for _ in range(max(0, min(cnt, 4096))):
                        v = pop(); k = pop(); items.append('%s: %r' % (k.v if isinstance(k, C) else k, v))
                    st.append(U('{%s}' % ', '.join(reversed(items))))
                elif op == 0x3E: emit('return %r;' % pop()); break
                elif op == 0x2A: emit('throw %r;' % pop()); break
                elif op in (0x3A, 0x3B):
                    n = pop()
                    if op == 0x3A: o = pop(); emit('delete %r[%r];' % (o, n))
                    else: emit('delete %r;' % n)
                    st.append(C(True))
                elif op == 0x69: sup = pop(); sub = pop(); emit('%r extends %r;' % (sub, sup))
                elif op == 0x2C:
                    o = pop(); c = pop(); cnt = int(num(c.v)) if isinstance(c, C) else 0
                    ifs = [pop() for _ in range(cnt)]; emit('%r implements %s;' % (o, ', '.join(map(repr, ifs))))
                elif op == 0x2B: o = pop(); c = pop(); st.append(U('(%r)%r' % (c, o)))
                elif op == 0x26: emit('trace(%r);' % pop())
                elif op == 0x30: st.append(U('random(%r)' % pop()))
                elif op == 0x34: st.append(U('getTimer()'))
                elif op == 0x22: p = pop(); t = pop(); st.append(U('getProperty(%r, %r)' % (t, p)))
                elif op == 0x23: v = pop(); p = pop(); t = pop(); emit('setProperty(%r, %r, %r);' % (t, p, v))
                elif op == 0x14: st.append(U('length(%r)' % pop()))
                elif op == 0x15: c = pop(); i = pop(); x = pop(); st.append(U('substring(%r,%r,%r)' % (x, i, c)))
                elif op == 0x45: st.append(U('targetPath(%r)' % pop()))
                elif op in (0x46, 0x55):
                    o = pop(); st.append(C(None)); emit('// enumerate %r' % o)
                elif op == 0x20: emit('tellTarget(%r);' % pop())
                elif op == 0x24: d_ = pop(); t = pop(); src = pop(); emit('duplicateMovieClip(%r,%r,%r);' % (src, t, d_))
                elif op == 0x25: emit('removeMovieClip(%r);' % pop())
                elif op == 0x9A: t = pop(); u = pop(); emit('getURL(%r, %r);' % (u, t))
                elif op == 0x9F: emit('gotoFrame(%r);' % pop())
                elif op in (0x06, 0x07, 0x04, 0x05): emit({6: 'play();', 7: 'stop();', 4: 'nextFrame();', 5: 'prevFrame();'}[op])
                elif op == 0x81: emit('gotoAndStop(%d);' % (struct.unpack('<H', arg)[0] + 1))
                elif op == 0x8C: emit('gotoLabel(%r);' % cstr(arg, 0)[0])
                elif op == 0x8B: emit('tellTarget("%s");' % cstr(arg, 0)[0])
                elif op == 0x94:
                    o = pop(); emit('with (%r) { /* %d bytes */ }' % (o, struct.unpack('<H', arg)[0]))
                elif op in (0x9B, 0x8E):
                    fn, j = cstr(arg, 0); n = struct.unpack('<H', arg[j:j+2])[0]; j += 2
                    params = []; r2 = {}
                    if op == 0x8E:
                        fl = struct.unpack('<H', arg[j+1:j+3])[0]; j += 3; r = 1
                        for bit, nm in ((0x01, 'this'), (0x04, 'arguments'), (0x10, 'super'), (0x40, '_root'), (0x80, '_parent'), (0x100, '_global')):
                            if fl & bit: r2[r] = nm; r += 1
                        for _ in range(n):
                            reg = arg[j]; j += 1; x, j = cstr(arg, j); params.append(x)
                            if reg: r2[reg] = x
                    else:
                        for _ in range(n): x, j = cstr(arg, j); params.append(x)
                    size = struct.unpack('<H', arg[-2:])[0]; bs = nxt
                    body, bl = Decomp(s.d, s.fns).run(bs, bs + size, pl, r2)
                    Fn.count += 1; k = Fn.count
                    s.fns[k] = (params, render(body, bl))
                    rl = [x for x in render(body, bl) if x.strip()]
                    if fn and len(rl) == 1 and re.match(r'^return -?[\d.]+;$', rl[0]):
                        CONSTFN[fn] = float(rl[0][7:-1])
                    if fn: emit('function %s FUNC#%d' % (fn, k))
                    else: st.append(U('FUNC#%d' % k))
                    pc = bs + size; continue
                elif op == 0x99:
                    pc = nxt + struct.unpack('<h', arg)[0]; continue
                elif op == 0x9D:
                    c = pop(); tgt = nxt + struct.unpack('<h', arg)[0]
                    if isinstance(c, C):
                        pc = tgt if truthy(c.v) else nxt; continue
                    # real branch: fork
                    stack_work.append((tgt, list(st), dict(ov), dict(regs), list(pl), 'T%d_%d' % (pc, nid[0])))
                    emit('if (%r) goto LT%d_%d;' % (c, pc, nid[0]))
                elif op == 0x8F:
                    emit('try { /* try block */ }')
                elif op == 0x9E: emit('call(%r);' % pop())
                elif op == 0x2A: break
                else:
                    pass  # unknown / junk opcode -> ignored by player
                pc = nxt
        return out, labels

def render(out, labels):
    lines = []
    for nid, t in out:
        if nid is not None:
            if nid in labels: lines.append('L%d:' % nid)
        else:
            lines.append(t if not t.startswith('@') else t[1:] + ':')
    return lines

def expand(lines, fns, ind=''):
    res = []
    for ln in lines:
        m = re.search(r'FUNC#(\d+)', ln)
        if m:
            k = int(m.group(1)); params, body = fns[k]
            head = ln[:m.start()] + 'function(%s) {' % ', '.join(params)
            tail = ln[m.end():]
            res.append(ind + head)
            res += expand(body, fns, ind + '    ')
            res.append(ind + '}' + tail)
        else:
            res.append(ind + ('    ' if not ln.endswith(':') else '') + ln)
    return res

def clean(lines):
    # drop gotos that jump to the very next label, and unreferenced labels
    txt = [l for l in lines]
    refs = set(re.findall(r'goto (L[\w]+);', '\n'.join(txt)))
    out = []
    for l in txt:
        s = l.strip()
        if s.endswith(':') and re.match(r'^L[\w]+:$', s) and s[:-1] not in refs: continue
        out.append(l)
    return out

def walkabs(b, pos, base_off, base, res, end=None):
    for code, data, p in tags(b, pos):
        if end is not None and p > end: break
        if code == 12: res.append((base + '/DoAction', p, p + len(data)))
        elif code == 59: res.append(('sprite%d' % struct.unpack('<H', data[:2])[0], p + 2, p + len(data)))
        elif code == 39:
            sid = struct.unpack('<H', data[:2])[0]
            walkabs(b, p + 4, 0, 'sprite%d' % sid, res, p + len(data))

if __name__ == '__main__':
    ver, ln, b = load(sys.argv[1]); outdir = sys.argv[2]; os.makedirs(outdir, exist_ok=True)
    names = {}
    for code, data, _ in tags(b, header_end(b)):
        if code == 56:
            n = struct.unpack('<H', data[:2])[0]; i = 2
            for _ in range(n):
                cid = struct.unpack('<H', data[i:i+2])[0]; i += 2; x, i = cstr(data, i); names['sprite%d' % cid] = x
    only = sys.argv[3] if len(sys.argv) > 3 else None
    res = []; walkabs(b, header_end(b), 0, 'root', res); cnt = collections.Counter()
    for key, st_, en_ in res:
        nm = names.get(key, key).replace('__Packages.', '').replace('/', '_'); cnt[nm] += 1
        if only and only not in nm: continue
        fns = {}
        try:
            body, bl = Decomp(b, fns).run(st_, en_, [], {})
            lines = clean(expand(render(body, bl), fns))
        except Exception as e:
            import traceback; lines = ['ERROR ' + traceback.format_exc()]
        open(os.path.join(outdir, nm + ('' if cnt[nm] == 1 else '_%d' % cnt[nm]) + '.as'), 'w').write('\n'.join(lines) + '\n')
