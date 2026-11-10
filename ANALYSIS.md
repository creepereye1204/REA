# 분석 보고서: Flash 좀비 서바이벌 SWF는 어떻게 동작하나

대상: `boxhead.swf` (MrJeffFeng/Flash-Games 저장소, 1,943,061 bytes)
결과물: [`index.html`](index.html) + [`game/`](game/) — 분석한 메커니즘을 직접 다시 구현한 **오리지널** 게임 *Cell Siege*
(원작의 이름, 아트, 맵, 사운드, 코드는 쓰지 않았습니다. 시스템 구조와 공식만 참고했습니다.)

> 원본 SWF와 디컴파일한 전체 소스는 저작권 때문에 이 저장소에 넣지 않았습니다. 아래 인용은 근거를 보여주는 데 필요한 부분만 발췌한 것입니다.
> 인용문의 `LT123456_…` 라벨에 있는 숫자는 압축을 푼 SWF 본문 안의 **절대 바이트 오프셋**입니다. 아래 도구로 같은 출력을 다시 만들 수 있습니다.

---

## 1. 방법

| 단계 | 도구 | 결과 |
|---|---|---|
| 컨테이너 파싱 | `tools/swf-analysis/swftags.py` | `CWS` v8 (zlib), 640×480, **50 fps**, 63 frames, AS2 (`FileAttributes`=0 → AVM1) |
| 클래스 목록 | 같은 스크립트, `ExportAssets` 태그 | `__Packages.*` 심볼 100개 이상 (예: `World.CUpgrades`, `Thing.Creature.CThing_Creature_Zombie`, `World.Map.CMap_Cell` …) |
| 선형 디스어셈블 | `as2dis.py`, `as2flow.py` | **실패.** 난독화되어 있음 (2절) |
| 기호 실행 디컴파일 | `as2emu.py` | 166개 스크립트, 약 17k줄의 의사 AS2 코드 |

REA(morluto/rea)에는 SWF/AVM1 백엔드가 없습니다. 그래서 같은 방식(바이너리 직접 분석 → 근거 제시 → 재구현)을 따르되, AVM1 분석기는 Python 표준 라이브러리로 직접 만들었습니다.

재현 방법:
```bash
python3 tools/swf-analysis/swftags.py boxhead.swf          # 헤더와 태그 목록
python3 tools/swf-analysis/as2emu.py  boxhead.swf out/     # 난독화를 풀어 의사코드로 출력
```

---

## 2. 난독화와 해제 방법

`ExportAssets`에서 클래스 이름은 보이지만, 클래스 본문(`DoInitAction`)을 디스어셈블하면 식별자 문자열이 하나도 나오지 않습니다. 좀비 클래스(sprite 844, 2,601 bytes)의 첫 바이트는 다음과 같습니다.

```
9b 0700 01 02 00 0000 0900          DefineFunction "\x01\x02"(), body 9 bytes
96 0500 07 71080000                 push 2161
3e                                  return
96 0300 00 01 00                    push "\x01"
96 0500 07 43fbffff                 push -1213
96 0d00 06 ... 00 01 02 00          push 0, "\x01\x02"
3d 47 3c                            callFunction; add; defineLocal   →  \x01 = 948
```

이 코드에 쓰인 기법은 다음과 같습니다.

1. **제어 흐름 평탄화(control-flow flattening)**: 제어 문자로 된 상태 변수 `\x01`을 `if (\x01 == 948) … \x01 += 158; jump` 형태의 디스패처가 계속 갱신합니다.
2. **불투명 상수(opaque constant)**: 상태 변수의 초기값을 상수를 반환하는 함수 호출 뒤에 숨깁니다 (`2161 + -1213`).
3. **명령어 중첩(overlapping instructions)**: 점프가 다른 명령어의 중간 바이트를 가리킵니다. 예를 들어 `push "\x01"`(`96 03 00 00 01 00`)의 두 번째 바이트로 들어가면 `03 00`이라는 다른 명령으로 읽힙니다.
4. **태그 밖으로 점프**: 오프셋 581의 `jump -599`는 DoInitAction 시작보다 **13바이트 앞**, 즉 *다른 태그의 데이터 안*으로 들어갑니다. 진짜 상수 풀과 코드가 그 위치에 숨어 있습니다.

`as2emu.py`는 이 기법들을 다음과 같이 처리합니다.
- 압축을 푼 SWF 전체를 하나의 주소 공간으로 보고 실행을 따라갑니다. 그래서 태그 밖으로 가는 점프도 추적할 수 있습니다.
- 이름이 제어 문자인 변수는 **구체값**으로 추적하고, 나머지 값은 **기호식**으로 둡니다. 이렇게 하면 디스패처 분기는 결정되고 실제 분기만 `if … goto`로 남습니다.
- 상수를 반환하는 함수를 감지해 그 호출을 상수로 바꿉니다.

해제 결과 (좀비 클래스 일부):
```actionscript
r2.Process_Init = function() {
    super.Process_Init();
    this.mSpeed = 0.02;
    this.SetState("State_EnterMap");
    this.mScore = 100;
    this.mDamage = 50;
    this.mWorld.mUpgrades.Register_Creature_Zombie(this);
};
```

---

## 3. 게임이 동작하는 방식 (근거 포함)

### 3.1 전체 구조

```
CMain ─ Screen.* (화면 전환)
  └─ World.CWorld (MovieClip, onEnterFrame 체인: Init → InitDrawPlanes → InitThings → InitCleanUp → InitFinished)
       ├─ World.Map.CMap        셀 그리드 + 충돌 플래그 + 네비게이션
       ├─ World.CUpgrades       레벨 테이블, 콤보 배율, 무기 해금/강화
       ├─ Thing.CThing_Collection   모든 엔티티 (Creature / Shot / Object / Effect / Weapon)
       └─ World.CHud
```
매 프레임 `CWorld.Process` → `mThing_Collection.Process(); mUpgrades.Process(); mHud.Process();` 순서로 돕니다.

### 3.2 맵: 셀 그리드와 충돌 비트 플래그
맵 데이터는 라이브러리 MovieClip 안에 놓인 "초기화 마커" 클립입니다. `InitThings`가 각 마커의 `_CLASSID_`를 보고 엔티티를 만들거나 스폰 지점으로 등록합니다.
```actionscript
if (r3._CLASSID_ === "CWorld_Init_CollisionSolid") this.mMap.mCollide.MarkArea_PP(..., CMap_Cell.mCollide_Solid);
if (r0 === "CWorld_Init_Barrel")  this.mThing_Collection.AddThing(new CThing_Object_Barrel(r2.CellCentre()));
if (r0 === "CWorld_Init_Zombie")  this.AddSpawnPoint_Zombie(r2.CellCentre());
if (r0 === "CWorld_Init_Devil")   this.AddSpawnPoint_Devil(r2.CellCentre());
```
충돌 정보는 셀마다 비트 플래그(`mCollide_Solid / _Player / _Creature / _Object / _NoSpawn / _NonMovable / _StaticImpassable`)로 저장됩니다.

### 3.3 좀비 길찾기: 플레이어 기준 BFS 거리장 (flow field)
A*로 좀비마다 경로를 구하지 않습니다. 플레이어 셀에서 **4방향 BFS로 거리 `nDist`를 한 번 퍼뜨리고**, 모든 좀비가 그 값을 같이 씁니다. 이 계산은 시간 예산(`nTimeOut`)을 넘으면 `"continue"` 상태로 다음 프레임에 이어집니다.
```actionscript
r1.Nav_Update = function(sCellList) {
    CMap_Cell.nSTimer = getTimer(); CMap_Cell.nSDist = 0;
    ...
    r1 = CMap_Cell.pList[r2].ac;
    r1[0].NF_4(); r1[2].NF_4(); r1[4].NF_4(); r1[6].NF_4();      // 4-neighbour expansion
    CMap_Cell.nSDist = (CMap_Cell.nSDist + 1);
    if ((getTimer() - CMap_Cell.nSTimer) > CMap_Cell.nTimeOut) { CMap_Cell.nState = "continue"; return; }
```
좀비는 이웃 셀 중 `nDist`가 더 작은 곳으로 이동합니다. 목표 방향을 먼저 보고, 그다음 현재 방향을 보고, 둘 다 안 되면 거리순으로 정렬한 이웃 중에서 고릅니다.
```actionscript
r2.Nav_Direction = function(cDir, tDir, tCollideFlags, tForceIt) {
    if (this.ac[tDir].nDist < this.nDist && !(this["NavReal_" + tDir]() & tCollideFlags)) return tDir;
    if (this.ac[cDir].nDist < this.nDist && !(this["NavReal_" + cDir]() & tCollideFlags)) return cDir;
    r4 = this.ac.sortOn("nDist", Array.RETURNINDEXEDARRAY | Array.NUMERIC | Array.DESCENDING);
    ...
```

### 3.4 크리처: 문자열 기반 상태 머신 + 셀 단위 이동
```actionscript
r2.SetState = function(nState) {
    this.mReturnStateID = this.mStateID; this.mStateID = nState; this.mStateCount = 0;
    this.fState = this[nState];
    this[(nState + "_Init")]();
};
```
상태 이름은 `State_EnterMap → State_GotoPlayer → State_CellToCell / State_Turn / State_Attack / State_Wait / State_Sleep`입니다. 크리처는 항상 **셀 중심에서 다음 셀 중심으로** 이동합니다. 이동할 때 목적지 셀에 `mCollide_Creature` 플래그를 미리 세워 자리를 예약하므로, 좀비가 한 셀에 겹쳐 쌓이지 않습니다.
```actionscript
r2.State_CellToCell_Init = function() {
    this.mDelta = this.mAngle.__get__mDirectionDelta().Clone();
    this.SetCollideDirection(this.mPosition.Add(this.mDelta), CMap_Cell.mCollide_Creature);
    this.mStateCount = (1.4142135623730951 / this.mSpeed);    // 대각선이면 √2배 시간
```
좀비 공격: 목표 방향 이웃 셀에 플레이어 플래그가 있으면 `State_Attack`으로 바뀌고, 애니메이션이 끝날 때 그 셀에 `CThing_Affect_ZombieAttack(this, 50)`을 적용합니다.

### 3.5 수치

| 대상 | 값 (원본) | 근거 위치 |
|---|---|---|
| 플레이어 | life 200, speed 0.16 셀/프레임, 스폰 직후 무적 200프레임 | `CThing_Creature_Player.Process_Init` |
| 플레이어 회복 | `mLife += mMaxLife / (FPS*30)` → 30초에 완전 회복 | `State_PlayerControl` |
| 좀비 | life 100, speed 0.02, damage 50, score 100 | `CThing_Creature_Zombie.Process_Init` |
| 데빌 | life 1000, speed 0.04, attackRange 5, damage 50, score 1000 | `CThing_Creature_Devil.Process_Init` |
| Pistol | dmg 26, fireRate 8f, range 8, 무한 | `CThing_Weapon_Pistol` |
| UZI | dmg 35, 4f, auto, 100발 | `CThing_Weapon_UZI` |
| Shotgun | dmg 51, 12f, range 7, 20발. 중앙 1발 + 좌우 대칭 `1.25°×(wide+1)` 간격 | `CThing_Weapon_Shotgun.Fire` |
| Rocket / Grenade / Railgun | 250 / 150 / 100 dmg | 각 Weapon 클래스 |

### 3.6 레벨(웨이브) 테이블: 1~100 레벨을 시작할 때 미리 생성
```actionscript
r8 = 1*FPS; r4 = 10; r5 = 10; r6 = 10*FPS; r7 = 0; r9 = 0;
for (r3 = 1; r3 <= 100; r3++) {
    AddToLevel(r3, {Zombie_SpawnRate: r8, Zombie_Count: r4, Zombie_TotalCount: r5,
                    CThing_Creature_Zombie.SpeedUp: Math.min(1 + r3/100*10, 5)});
    r8 = Math.max(r8 - 1, 1);  r4 = Math.min(r4 + 5, 60);  r5 = r5 + 5;
    if (mDevilsActive) { ... r7 = Math.min(r7 + 0.3, 5); r9 = r9 + 0.25; r6 = Math.max(r6 - 1, FPS); }
}
```
`CUpgrades.Process`는 동시에 살아 있는 수가 `min(Zombie_Count, 60)`보다 적을 때만 `Zombie_SpawnRate` 프레임마다 하나씩 스폰합니다. 남은 좀비와 데빌이 모두 0이 되면 `mLevel + 1`이 됩니다.

### 3.7 콤보 배율: 이 게임의 핵심 진행 시스템
처치할 때마다 `LogKills`가 배율을 +1 합니다. 타이머가 끝나면 배율은 0으로 리셋되지 않고 **1씩** 내려갑니다. 타이머 길이는 배율이 높을수록 급격히 짧아집니다.
```actionscript
r2.LogKills = function(a) { while (a) { mMultipleKill++; mMultiplier++; a--; } };
// Process():
this.mMultiplierTick--; if (this.mMultiplierTick < 0) this.__set__mMultiplier(this.__get__mMultiplier() - 1);

r2.GetTicks = function(index) {
    index = 100 - (index - 1);
    return Math.pow(index, 2.5) / 100000 * (FPS*3 - 3) + 3;   // x1 ≈ 3.0s, x30 ≈ 1.3s, x50 ≈ 0.6s, x70 ≈ 0.2s
};
```
배율이 특정 값에 도달하면 그 값에 등록된 보상 중 아직 받지 않은 것만 지급됩니다. 보상마다 `mActive` 플래그가 있어 **한 번만** 나옵니다 (`if (r2.mActive != true) { AddUpgrade(...); r2.mActive = true; }`). 배율은 1~999로 제한됩니다. 보상 테이블의 일부는 다음과 같습니다.
```actionscript
AddToMultipliers(3,  {mClassID:"CThing_Weapon_Pistol",   mProp:"FastFire",     mName:"Pistol+: Fast Fire"});
AddToMultipliers(5,  {mClassID:"CThing_Creature_Player", mProp:"NW_uzi",       mName:"New Weapon: UZI (Key 2)"});
AddToMultipliers(10, {mClassID:"CThing_Creature_Player", mProp:"NW_shotgun",   mName:"New Weapon: Shotgun (Key 3)"});
AddToMultipliers(15, ... "NW_barrel");  (20) "NW_grenade";  (30) "NW_fakewall";  (40) "NW_mine";
AddToMultipliers(50, ... "NW_rocket");  (55) "NW_chargepack";  (70) "NW_railgun";  ... (125) "Railgun+: Long Shot"
```
강화는 **원본 수치에서 매번 다시 계산**합니다. 그래서 Double과 Quad가 서로 곱해지지 않습니다 (`ApplyUpgrade_Weapon`).
```actionscript
if (r3.FatalDamage) mDamage = orig.mDamage * 10; else if (r3.QuadDamage) ... * 4; else if (r3.DoubleDamage) ... * 2;
if (r3.RapidFire) { mFireRate = Math.round(Math.max(orig.mFireRate / 4, 2)); mAuto = true; } else if (r3.FastFire) mAuto = true;
if (r3.WiderShot) mWideShot = 2; else if (r3.WideShot) mWideShot = 1;
```

### 3.8 드롭과 픽업: "부족한 것"이 나올 확률이 높아짐
- 좀비를 연속 처치한 수(`mMultipleKill`)가 5의 배수가 될 때마다, 그리고 데빌은 처치할 때마다 상자를 떨어뜨립니다. 상자는 10초 뒤 사라집니다 (`SetDeleteCounter(FPS*10)`).
- 상자를 집으면 보유한 무기마다 `(1 - ammo/total) * 0.75 + 0.25`, 체력은 `(1 - life/max) * 누적합`을 가중치로 하는 룰렛을 돌립니다.
```actionscript
r8 = ((1 - (w.mAmmo / w.mTotalAmmo)) * 0.75) + 0.25;  r5 += r8;  r3.push({mNameID, mChanceIndex: r5});
if (this.mLife < this.mMaxLife) { r8 = (1 - this.mLife/this.mMaxLife) * r5; r5 += r8; r3.push({mNameID:"life", ...}); }
r6 = Math.random() * r5;   // pick first entry with r6 < mChanceIndex
```

### 3.9 기타
- 화면 흔들림은 `mShake = -mShake * 0.5`로 매 프레임 감쇠하며 진동합니다.
- 카메라는 이동량이 0.16셀을 넘으면 가속하는 추적 방식이고, 맵 경계 안으로 고정됩니다.
- 바닥(`bmFloor`), 데칼, 덮개(`bmCover`)는 BitmapData 레이어로 나뉘어 있습니다. 피와 그을음은 바닥 비트맵에 직접 그려서 영구히 남깁니다.
- 좀비 앰비언스는 화면에 보이는 좀비 수에 따라 채널 수, 빈도, 볼륨이 단계적으로 바뀝니다 (`ProcessAmbience`).

---

## 4. 재구현: 시스템 1:1 이식

`game/main.js`는 원본처럼 **50fps 고정 프레임**으로 돌고, 셀과 프레임 단위를 그대로 씁니다. 각 함수 위 주석에 원본 `Class.method` 이름을 적어 두었습니다.

| 시스템 | 원본 규칙 (그대로 이식) |
|---|---|
| 무기 10종 | Pistol 26dmg/8f/사거리 8/무한 · SMG 35/4f/auto/100발 · Shotgun 51/12f/사거리 7/20발 · Barrel 150/10개 · Grenade 150/12f/20개, 손을 뗄 때 투척 · Fake Wall 체력 1000/5개 · Mine 100/10개 · Rocket 250/12f/20발 · Charge Pack 150/10개, 한 번 더 누르면 기폭 · Railgun 100/5f/사거리 10/15발/관통 |
| 업그레이드 | `MULTIPLIER_REWARDS`에 x3 ~ x125 보상 60개 전체. 업그레이드는 원본 수치에서 매번 다시 계산 (`ApplyUpgrade_Weapon`). RapidFire는 `round(max(rate/4, 2))` |
| 배율 | `getTicks()` 원본 공식. 타이머가 끝나면 −1. 멀티킬 창은 `getTicks/6`, 5킬마다 상자 드롭 |
| 레벨 | `buildLevels()`는 원본 InitLists 루프 그대로: 스폰 간격 50f에서 레벨마다 −1, 동시 출현 +5 (최대 60), 속도 `min(1+n/10, 5)`, 데빌 +0.3/+0.25 |
| 크리처 | 좀비 체력 100/속도 0.02/공격 50, 데빌 체력 1000/속도 0.04/사거리 5/화염구 50/질량 5. 상태 머신은 goto → turn → move(셀 단위) → attack → sleep(10f) |
| 길찾기 | 정적 지형만 쓰는 4방향 BFS. `Nav_Direction`은 목표 방향 → 현재 방향 → 갈 수 있는 칸 중 거리가 가장 짧은 칸 순서로 고르고, 전체 탐색은 프레임당 5회로 제한 |
| 피격 | 넉백 `max(dmg/5·2/32, 0.3)/mass`. 매 프레임 ×0.65로 줄고, 0.01 미만이 될 때까지 경직한 뒤 3프레임 sleep |
| 폭발 | 반경 `2 + max(dmg−100, 0)·0.005`. 반경 비율 ≤0.5면 100%, ≤0.75면 75%, 그 바깥은 50%. 플레이어도 피해를 받음 (`mDamageActive`). Big Bang은 주변 1셀에 추가 폭발 2개, Bigger Bang은 3개. Cluster는 파편탄 4개 |
| 투사체 | 로켓은 0.5셀/f로 시작해 매 프레임 ×1.1. 수류탄은 z 속도 0.5·power, 중력 0.06, 60f 뒤 폭발. 화염구는 매 프레임 ×1.02 |
| 설치물 | 플레이어가 서 있는 칸에 놓이고, 플레이어가 그 칸을 떠나야 막힘 판정이 생김. 지뢰는 크리처가 밟으면 2초 뒤 폭발 |
| 픽업 | `RandomPickup` 가중치 룰렛. 드롭된 상자는 10초 뒤 사라짐 |
| 플레이어 | 체력 200, 속도 0.16셀/f, 8방향, 30초에 완전 회복, 시작 무적 200f (깜빡임) |

**원본과 다른 부분**: 그래픽, 맵, 이름, 사운드는 독자 제작입니다. 원본은 애니메이션 프레임 데이터로 공격 타이밍을 정하는데, 이 데이터는 이식하지 않았습니다. 그래서 좀비 공격 스윙 길이(8프레임 가정)와 데빌 화염구 발사 시점은 근사값입니다. 데빌 화염구 속도(`mAttackSpeed`)는 원본에서 값을 찾지 못해 0.15셀/f로 정했습니다.

## 5. 한계
- `as2emu.py`는 AVM1 바이트코드를 완전히 디컴파일하지는 못합니다. `for..in`(`enumerate`)은 루프 본문을 복원하지 못하고, 일부 `switch`(`SetDifficulty`)는 분기 내용이 비어 보입니다. 결론은 직접 해제된 코드에서 확인한 부분만 근거로 삼았습니다.
- 그래픽과 애니메이션 데이터(XSI 3D 모델을 2D로 투영하는 `CDrawPrimitive_XSI_*`)는 분석했지만 재현 대상에서 뺐습니다.
- 2인 협동/데스매치 모드(`mGameMode == "Coop" / "DeathMatch"`)가 코드에 있다는 것은 확인했지만, 재구현은 1인 모드만 했습니다.
