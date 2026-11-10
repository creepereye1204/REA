# REA — Reverse-engineering study → Cell Siege

**▶ Play:** https://creepereye1204.github.io/REA/

This repo has two parts:

1. **[ANALYSIS.md](ANALYSIS.md)**: an analysis of how a Flash-era (AS2, Flash 8) zombie survival SWF works. It covers deobfuscating its control-flow-flattened bytecode, the BFS flow-field pathfinding, the cell-to-cell creature state machine, the decaying combo multiplier, and the combo-threshold weapon unlocks. Every claim comes with decompiled evidence.
2. **Cell Siege** ([`index.html`](index.html), [`game/`](game/)): an original top-down survival shooter. Its gameplay systems (weapons, all 60 upgrades, level table, AI, damage/knock-back formulas) are ported 1:1 from the decompiled code and run at the original fixed 50 fps; art, map and names are original. It uses vanilla JS and Canvas, with no build step and no assets.

## Controls
| Action | Keyboard | Mobile (touch) |
|---|---|---|
| Move | WASD / Arrow keys | Drag a thumb on the left half (floating joystick) |
| Fire | Space / J (grenade: hold, release to throw) | Hold anywhere on the right half |
| Weapons | 1–9, 0, Q / E | Tap a weapon in the top bar, or the WPN button |
| Pause | P | ❚❚ button (auto-pauses when the app goes to background) |

On phones the game fills the screen in both portrait and landscape and renders at device pixel density.

## Tools
`tools/swf-analysis/` contains standard-library-only Python tools:
- `swftags.py`: SWF header and tag inventory
- `as2dis.py` / `as2flow.py`: linear and flow-following AVM1 disassemblers
- `as2emu.py`: symbolic-execution decompiler. It resolves obfuscator dispatch variables concretely, follows jumps outside the tag, and folds constant-returning functions.

```bash
python3 tools/swf-analysis/as2emu.py path/to/file.swf out/
```

The original SWF and its full decompiled source are not included.

## Run locally
```bash
python3 -m http.server 8000   # then open http://localhost:8000
```
