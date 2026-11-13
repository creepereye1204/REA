# REA — Cell Siege: Nightfall (+ reverse-engineering study)

**▶ Play:** https://creepereye1204.github.io/REA/ · self-hosted copy: https://www.boxhunter.p-e.kr

This repo has three parts:

1. **Cell Siege: Nightfall** ([`index.html`](index.html), [`game/sv/`](game/sv/)): the main game. It is an open-world, day/night survival shooter with P2P co-op.
2. **Cell Siege Classic** ([`classic.html`](classic.html), [`game/main.js`](game/main.js)): an arena shooter. Its gameplay systems are ported 1:1 from a decompiled Flash-era game and run at the original fixed 50 fps.
3. **[ANALYSIS.md](ANALYSIS.md)**: the reverse-engineering write-up behind the classic port. It covers deobfuscating the bytecode, the flow-field pathfinding, the combo multiplier and the upgrade tables.

Everything is vanilla JS and Canvas with no build step. Characters and the world are drawn procedurally; item icons, character/boss portraits and story illustrations in [`assets/`](assets/) were generated locally with **Qwen-Image-2.1-Turbo** (see `assets/art.json`).

## Nightfall: how it plays
- **Story:** the base radio starts the main line → amplify the signal at the radio tower → two branches:
  - **Cure:** kill the hospital's Broodmother for the lab keycard, open the Hanbit lab, kill Subject X-13, rescue Dr. Han, gather reagents, then hold the base for two nights.
  - **Evacuation:** meet Sgt. Yoon at the military checkpoint, bring helicopter fuel, kill the Red Dawn cult's priest, rescue the pilot-mechanic, then hold the rooftop helipad for 120 s.
  - **Villages:** each of the four village elders (!) gives a 3-quest chain (deliveries, rescues, hunts, boss bounties). Trust lowers their prices; finishing all four unlocks the **community** ending.
  - A hidden **warlord** ending, 30 collectible notes/tapes, daily radio chatter. Journal: **J**.
- **Day:** explore a 256×224-tile procedurally generated world with 4 villages, 4 bandit camps and 10 landmarks (hospital, lab, military checkpoint, radio tower, church, prison, gas station, farm, school, helipad). You can:
  - Loot containers and chop trees for wood.
  - Rescue survivors.
  - Trade at villages or with the travelling merchant who visits your base.
- **Night:** zombie waves come from the map edges. They path to your base's generator core and smash through anything in the way. You lose if the core is destroyed.
- **Villages:**
  - **Trade:** buy and sell with the village trader.
  - **Steal:** crouch to stay unseen. Villagers who can see you show an eye icon. If you're caught, the whole village turns hostile and its guards attack.
  - **Kill:** anyone you kill drops everything they carry. Killing a trader drops their entire shop stock.
- **Enemies:**
  - Zombies: walker, crawler, runner, spitter (ranged acid), brute (wall breaker), bloater (explodes), screamer (calls runners), hound (packs), riot (frontal shield), toxic (gas cloud on death), stalker (near-invisible, lunges).
  - Bosses: Blood Fiend / Goliath on boss nights; landmark bosses Broodmother (spawns crawlers), Goliath (charges through walls), Subject X-13 (blink dashes).
  - Bandits: thug, gunner, SMG, shotgun, sniper, and four named camp bosses. From day 3 they sometimes raid your base in daylight.
  - Factions: the Red Dawn cult (fire-bomb throwers) and the military remnant (neutral unless you shoot them; Sgt. Yoon trades military gear).
- **NPC AI:** NPCs use A* paths, take cover at range, strafe, reload, flee when hurt, and fight each other (bandits, villagers and zombies).
- **Survivors:** each has a perk:
  - Marksman: better aim and damage.
  - Mechanic: repairs your base automatically.
  - Medic: heals nearby allies.
  - Scavenger: brings back loot each morning.

  Survivors eat 1 food each morning.
- **Magazines:** each spare magazine is tracked separately. Reloading inserts the fullest spare and pouches the partial one. You buy magazines from traders or find them in loot.
- **Workbench:** upgrade each weapon's damage, magazine size, fire rate and reload speed (5 levels each), and craft grenades, molotovs, bandages, adrenaline, mines and body armor.
- **Items:** bandages, body armor (absorbs half the damage), molotovs (fire area), adrenaline, fuel/electronics/chemicals, and valuables to sell.
- **Building:** build within the core radius:
  - wood and metal walls
  - doors (allies only)
  - spike traps
  - auto-turrets (refill with scrap)
  - lights
  - explosive barrels
  - mines
- **Survival stats:** health, hunger and stamina. Eat food and use medkits to keep them up.
- **Co-op:** choose **"방 만들기"** (host) and share the 5-character code. Your friend chooses **"참가하기"** and types the code.
  - It connects over WebRTC through PeerJS. The host simulates; the guest sends input and gets snapshots.
  - Resources and buildings are shared.
  - A downed player can be revived by the other. A player who dies respawns at dawn.

## Controls (Nightfall)
| Action | Keyboard / mouse | Mobile |
|---|---|---|
| Move / sprint | WASD / Shift | Left thumb / 달리기 toggle |
| Aim / fire | Mouse / left click | Right thumb (aim assist, fires when pushed) |
| Use (tap = take/recruit/trade, hold = loot/chop/repair/revive) | E | 사용 |
| Reload / weapons | R / 1–7, wheel, Q | 장전 / tap the weapon bar |
| Eat / heal / grenade / molotov / adrenaline | F / H / G / T / V | 먹기 / 치료 / 수류(화염) / 아드 |
| Journal (quests, notes) | J | 📜 |
| Crouch (stealth) | C or Ctrl | 은신 |
| Build mode | B, then 1–8 to pick, left click to place, right click/X to demolish | 건설 → 설치 / 철거 |
| Map / help / menu | M / F1 / Esc | minimap tap / ☰ |

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
python3 -m http.server 8000   # then open http://localhost:8000 (classic: /classic.html)
```
