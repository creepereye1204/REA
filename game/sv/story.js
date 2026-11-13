'use strict';
// Story: main line → two branches (cure / evacuation), four village quest chains, lore notes,
// radio chatter and four endings. Host-authoritative; the guest gets G.Q in snapshots.

// ── cast ──────────────────────────────────────────────────────────────────
const CAST = {
  radio:   { name: '기지 무전기',       por: null },
  dr_han:  { name: '한서진 박사',       por: 'por_dr_han' },
  yoon:    { name: '윤태건 중사',       por: 'por_sgt_yoon' },
  priest:  { name: '붉은 사제 마르코',   por: 'por_priest' },
  elder0:  { name: '박 노인 (솔빛 마을)',   por: 'por_elder_park' },
  elder1:  { name: '최 이장 (은행나무 마을)', por: 'por_chief_choi' },
  elder2:  { name: '강 대장 (바람골 마을)',   por: 'por_captain_kang' },
  elder3:  { name: '오 할머니 (소금밭 마을)', por: 'por_grandma_oh' },
  child:   { name: '박민호',            por: 'por_survivor' },
  mechanic:{ name: '정비공 백도윤',      por: 'por_survivor' },
  you:     { name: '나',               por: null },
};

// ── quests ────────────────────────────────────────────────────────────────
// obj types: deliver{items,to} · goto{poi} · use{trig} · defend{trig,secs} · kill{kinds,n} · killTag{tags}
//            have{item} · escort{tag,to} · talk{to} · survive{n} · crew{n}
const QUESTS = {
  // main
  m1: { line: 'main', title: '불 꺼진 도시', giver: 'radio', next: 'm2',
        desc: '기지의 낡은 무전기가 잡음만 낸다. 경찰서 무기 보관함이나 정비소 공구함, 사무실 책상에서 무전기 부품 2개를 찾아 무전기에 끼워 넣자.',
        obj: { t: 'deliver', items: { radio_part: 2 }, to: 'radio' }, hint: 'radio_part',
        done: [['radio', '…치직… 부품을 끼우자 무전기에 불이 들어온다.'],
               ['dr_han', '…들리세요? 여기는 한빛 생명공학 연구소, 한서진입니다. 아직 살아 있는 사람이 있다면… 치료제의 단서가 있어요. 신호가 약해요. 송신탑을…'],
               ['yoon', '전 생존자에게 알린다. 여기는 잔존군 윤태건 중사. 아직 헬기 한 대가 남아 있다. 연료와… 치직…'],
               ['you', '신호가 끊긴다. 도시 외곽의 송신탑으로 가서 신호를 증폭해야 한다.']] },
  m2: { line: 'main', title: '신호를 쫓아서', giver: 'radio',
        desc: '송신탑의 제어반을 켜고 신호가 잡힐 때까지 60초 동안 버티자. 전력이 돌아오면 소리가 좀비들을 끌어모은다.',
        obj: { t: 'defend', trig: 'tower', secs: 60 },
        done: [['dr_han', '이제 또렷하게 들려요! 저는 연구소 지하에 갇혀 있어요. 실험체 X-13이 탈출해서 연구소를 지키고 있고… 연구소 출입카드는 종합병원으로 이송된 책임연구원이 갖고 있었어요.'],
               ['yoon', '송신탑 신호 확인. 우리 검문소로 와라. 헬기를 띄울 수 있다면 너희도 태워 주겠다. 대신 대가는 치러야 한다.'],
               ['you', '두 개의 길. 치료제를 만들 것인가, 이 도시를 떠날 것인가. 아니면… 마을 사람들과 여기서 다시 시작할 수도 있다.']],
        unlock: ['c1', 'e1'] },
  // cure branch
  c1: { line: 'cure', title: '치료제 ①  병원의 열쇠', giver: 'dr_han', next: 'c2',
        desc: '종합병원 깊은 곳에 거대한 변이체 "산란체"가 둥지를 틀었다. 놈을 쓰러뜨리고 연구소 출입카드를 찾자.',
        obj: { t: 'have', items: { keycard: 1 } }, poi: 'hospital',
        done: [['dr_han', '출입카드를 찾았군요! 연구소 정문은 카드로 열려요. 조심하세요, X-13은 빛을 싫어하고… 아주 빨라요.']] },
  c2: { line: 'cure', title: '치료제 ②  봉인된 문', giver: 'dr_han', next: 'c3',
        desc: '한빛 생명공학 연구소 정문에서 출입카드를 사용해 문을 열자.',
        obj: { t: 'use', trig: 'lab_gate' }, poi: 'lab',
        done: [['you', '경고음과 함께 문이 열린다. 안쪽 어둠 속에서 무언가 움직인다.']] },
  c3: { line: 'cure', title: '치료제 ③  실험체 X-13', giver: 'dr_han', next: 'c4',
        desc: '연구소 안의 실험체 X-13을 처치하고 조직 샘플을 회수하자.',
        obj: { t: 'have', items: { sample: 1 } }, poi: 'lab',
        done: [['dr_han', '샘플이에요… 이걸로 항체를 배양할 수 있어요. 저를 여기서 꺼내 주세요. 연구소 안쪽 사무실에 있어요!']] },
  c4: { line: 'cure', title: '치료제 ④  한 박사 구출', giver: 'dr_han', next: 'c5',
        desc: '연구소에 갇힌 한서진 박사를 찾아 [E]로 구출하고 기지까지 호위하자.',
        obj: { t: 'escort', tag: 'dr_han', to: 'base' }, poi: 'lab',
        done: [['dr_han', '살았다… 고마워요. 여기 발전기라면 배양기를 돌릴 수 있어요. 화학약품과 전자부품만 있으면요.']] },
  c5: { line: 'cure', title: '치료제 ⑤  배양기', giver: 'dr_han', next: 'c6',
        desc: '한 박사에게 화학약품 6개와 전자부품 4개를 전달하자. (연구소·병원 냉장고, 정비소 공구함, 차량)',
        obj: { t: 'deliver', items: { chem: 6, parts: 4 }, to: 'dr_han' },
        done: [['dr_han', '배양을 시작할게요. 이틀 밤이면 돼요. 하지만 배양기 열기가 놈들을 미치게 할 거예요. 기지를 지켜 주세요!']] },
  c6: { line: 'cure', title: '치료제 ⑥  마지막 두 밤', giver: 'dr_han',
        desc: '배양이 끝날 때까지 두 번의 밤 동안 코어를 지키자. 밤마다 더 많은 좀비가 몰려온다.',
        obj: { t: 'survive', n: 2 }, ending: 'cure' },
  // evacuation branch
  e1: { line: 'evac', title: '탈출 ①  잔존군 검문소', giver: 'yoon', next: 'e2',
        desc: '잔존군 검문소를 찾아가 윤태건 중사와 이야기하자. 병사들에게 먼저 총을 쏘면 협상은 끝이다.',
        obj: { t: 'talk', to: 'yoon' }, poi: 'military',
        done: [['yoon', '용케 살아 있었군. 헬기는 멀쩡하지만 연료가 바닥이다. 연료 8통을 가져와라. 그 대신 우리 보급품을 팔아 주지.']], flag: 'milFriend' },
  e2: { line: 'evac', title: '탈출 ②  헬기 연료', giver: 'yoon', next: 'e3',
        desc: '연료 8통을 윤 중사에게 전달하자. 고속도로 주유소의 주유기, 버려진 차량에서 얻을 수 있다.',
        obj: { t: 'deliver', items: { fuel: 8 }, to: 'yoon' }, poi: 'station',
        done: [['yoon', '연료는 됐다. 문제는 조종사 겸 정비공 백도윤이 붉은 새벽 교단에 끌려갔다는 거다. 교회의 사제 놈을 처리해라.']] },
  e3: { line: 'evac', title: '탈출 ③  붉은 사제', giver: 'yoon', next: 'e4',
        desc: '붉은 새벽 교회의 사제 마르코를 처치하자. 방화범들이 화염병을 던진다.',
        obj: { t: 'killTag', tags: ['priest'] }, poi: 'church',
        done: [['priest', '…불은… 꺼지지 않는다… 새벽이 오면… 너희도…'], ['you', '교회 안쪽에서 누군가 문을 두드린다. 정비공이다.']] },
  e4: { line: 'evac', title: '탈출 ④  정비공 구출', giver: 'yoon', next: 'e5',
        desc: '교회에 갇힌 정비공 백도윤을 [E]로 구출해 잔존군 검문소까지 호위하자.',
        obj: { t: 'escort', tag: 'mechanic', to: 'military' }, poi: 'church',
        done: [['yoon', '도윤이! 살아 있었군. 좋다. 헬기장에서 신호탄을 쏘면 데리러 간다. 헬기가 내릴 때까지 버텨야 한다.']] },
  e5: { line: 'evac', title: '탈출 ⑤  마지막 헬기', giver: 'yoon',
        desc: '옥상 헬기장에서 신호탄을 쏘고 헬기가 도착할 때까지 120초 동안 버티자.',
        obj: { t: 'defend', trig: 'flare', secs: 120 }, poi: 'helipad', ending: 'evac' },
  // village chains
  v0a: { line: 'v0', title: '솔빛 ①  배고픈 겨울', giver: 'elder0', next: 'v0b', desc: '박 노인에게 식량 8개를 전달하자.', obj: { t: 'deliver', items: { food: 8 }, to: 'elder0' }, reward: { cash: 120, meds: 2 },
         done: [['elder0', '고맙네. 덕분에 아이들이 이번 주는 굶지 않겠어. …그런데 부탁이 하나 더 있네.']] },
  v0b: { line: 'v0', title: '솔빛 ②  손자를 찾아서', giver: 'elder0', next: 'v0c', desc: '박 노인의 손자 민호가 초등학교에 숨어 있다. 구출해서 솔빛 마을까지 데려오자.', obj: { t: 'escort', tag: 'child', to: 'v0' }, poi: 'school', reward: { cash: 150, 'mag:sniper': 2 },
         start: [['elder0', '손자 녀석이 학교에 갔다가 돌아오지 않았어. 무전으론 살아 있다는데… 제발 데려와 주게.']],
         done: [['child', '할아버지!'], ['elder0', '…이 은혜를 어떻게 갚아야 할지. 우리 마을은 이제 자네 편일세.']] },
  v0c: { line: 'v0', title: '솔빛 ③  도끼 장', giver: 'elder0', desc: '마을을 괴롭히는 붉은 약탈단의 두목 "도끼 장"을 처치하자.', obj: { t: 'killTag', tags: ['camp0'] }, reward: { cash: 300, armor: 1 },
         done: [['elder0', '도끼 장이 죽었다고? 오늘 밤엔 다리 뻗고 자겠구먼.']] },
  v1a: { line: 'v1', title: '은행나무 ①  지붕 수리', giver: 'elder1', next: 'v1b', desc: '최 이장에게 고철 25개를 전달하자.', obj: { t: 'deliver', items: { scrap: 25 }, to: 'elder1' }, reward: { cash: 100, bandage: 4 },
         done: [['elder1', '좋아요, 이걸로 창고 지붕을 막을 수 있겠네요. 다음은 좀 위험한 일이에요.']] },
  v1b: { line: 'v1', title: '은행나무 ②  들개 사냥', giver: 'elder1', next: 'v1c', desc: '좀비견 8마리를 처치하자. 농장과 교도소 근처에 무리 지어 다닌다.', obj: { t: 'kill', kinds: ['hound'], n: 8 }, reward: { cash: 160, adrenaline: 2 },
         done: [['elder1', '이제 밭에 나가도 되겠어요. 마지막으로… 농장 펌프를 고쳐 줄 수 있을까요?']] },
  v1c: { line: 'v1', title: '은행나무 ③  농장 펌프', giver: 'elder1', desc: '햇살 농장의 우물 펌프를 전자부품 2개로 수리하자. 수리하면 매일 아침 식량을 나눠 받는다.', obj: { t: 'use', trig: 'farm_pump' }, poi: 'farm', reward: { food: 10 }, flag: 'farmFood',
         done: [['elder1', '물이 나와요! 약속대로 매일 아침 수확한 식량을 기지로 보낼게요.']] },
  v2a: { line: 'v2', title: '바람골 ①  탄약 지원', giver: 'elder2', next: 'v2b', desc: '강 대장에게 돌격소총 탄창 3개를 전달하자.', obj: { t: 'deliver', items: { 'mag:rifle': 3 }, to: 'elder2' }, reward: { armor: 1, cash: 80 },
         done: [['elder2', '탄창 고맙다. 우리 경비대가 숨 좀 돌리겠군. 이제 진짜 일을 하자고.']] },
  v2b: { line: 'v2', title: '바람골 ②  백골', giver: 'elder2', next: 'v2c', desc: '해골 약탈단 두목 "백골"을 처치하자.', obj: { t: 'killTag', tags: ['camp1'] }, reward: { cash: 250, grenade: 4 },
         done: [['elder2', '백골의 목을 땄다니. 자네라면 교도소의 그 괴물도 상대할 수 있을지 몰라.']] },
  v2c: { line: 'v2', title: '바람골 ③  골리앗', giver: 'elder2', desc: '교도소를 점거한 거대 변이체 "골리앗"을 처치하자. 돌진에 주의!', obj: { t: 'killTag', tags: ['goliath'] }, poi: 'prison', reward: { cash: 450, 'mag:launcher': 3 },
         done: [['elder2', '골리앗이 쓰러졌다! 오늘부터 자네는 바람골의 영웅이다.']] },
  v3a: { line: 'v3', title: '소금밭 ①  약이 필요해', giver: 'elder3', next: 'v3b', desc: '오 할머니에게 의약품 4개를 전달하자.', obj: { t: 'deliver', items: { meds: 4 }, to: 'elder3' }, reward: { cash: 120, food: 5 },
         done: [['elder3', '아이고, 이제 열 내리는 약이 생겼네. 착하기도 하지.']] },
  v3b: { line: 'v3', title: '소금밭 ②  광신도들', giver: 'elder3', next: 'v3c', desc: '붉은 새벽 교단의 광신도·방화범 10명을 처치하자.', obj: { t: 'kill', kinds: ['cultist', 'zealot'], n: 10 }, poi: 'church', reward: { cash: 180, molotov: 4 },
         done: [['elder3', '그 빨간 옷 입은 것들이 우리 밭에 불을 질렀어. 혼 좀 내 줬다니 속이 시원하구먼.']] },
  v3c: { line: 'v3', title: '소금밭 ③  까마귀와 들개', giver: 'elder3', desc: '까마귀 약탈단 두목 "까마귀"와 들개 약탈단 두목 "들개 왕"을 처치하자.', obj: { t: 'killTag', tags: ['camp2', 'camp3'] }, reward: { cash: 400, gold: 2 },
         done: [['elder3', '이제 길이 안전해졌으니 장사꾼들도 다시 오겠지. 고맙다, 고마워.']] },
  // community ending
  k1: { line: 'community', title: '다시 켜진 불빛', giver: 'elder0',
        desc: '네 마을 모두가 당신을 믿는다. 생존자 6명을 기지 동료로 모은 뒤, 아무 마을 대표에게나 말을 걸어 연합을 맺자.',
        obj: { t: 'crew', n: 6 }, ending: 'community' },
};
const LINE_START = { main: 'm1', cure: null, evac: null, v0: 'v0a', v1: 'v1a', v2: 'v2a', v3: 'v3a', community: null };
const ENDINGS = {
  cure: { title: '새벽의 치료제', scene: 'scene_ending_cure',
          text: '배양기가 마지막으로 울리던 새벽, 한서진 박사의 손에 푸른 빛이 담긴 유리병이 들려 있었다. 치료제는 물린 사람을 되돌리지는 못했지만, 더 이상 아무도 변하지 않게 만들었다. 무전기로 처방이 퍼져 나갔고, 도시 곳곳에서 꺼졌던 불빛이 하나둘 다시 켜졌다.' },
  evac: { title: '마지막 헬기', scene: 'scene_ending_evac',
          text: '로터가 새벽 공기를 찢으며 헬기가 옥상에서 떠올랐다. 아래에서는 좀비 떼가 헬기장 펜스를 무너뜨리고 있었다. 윤 중사가 말없이 엄지를 들어 보였다. 도시는 점점 작아졌고, 지평선 너머 어딘가에 아직 무너지지 않은 곳이 있다는 소문만이 남았다.' },
  community: { title: '다시 켜진 불빛', scene: 'scene_ending_community',
          text: '네 마을의 대표가 기지 발전기 앞에서 손을 맞잡았다. 밭에는 다시 싹이 났고, 아이들은 펜스 안에서 공을 찼다. 밤은 여전히 찾아오지만, 이제 그 밤을 혼자 버티는 사람은 없다.' },
  warlord: { title: '잿빛 왕관', scene: 'scene_ending_warlord',
          text: '마을의 대표들도, 약탈단의 두목들도 모두 쓰러졌다. 남은 사람들은 당신에게 고개를 숙였다. 기지는 요새가 되었고, 당신의 말이 곧 법이 되었다. 좀비보다 무서운 것이 무엇인지, 이 도시는 이제 알게 되었다.' },
};

// ── lore notes ─────────────────────────────────────────────────────────────
const NOTES = [
  ['경찰 무전 기록', '"3구역 폭동 진압 실패. 물린 대원들이 다시 일어남. 반복한다, 물린 자는 격리… 아니, 사살하라."'],
  ['아이의 그림일기', '오늘 엄마가 아팠다. 아빠는 문을 잠그라고 했다. 밖에서 누가 계속 문을 긁는다. 무섭다.'],
  ['한빛 연구소 회의록', 'X 계열 항체 실험 3차. 피험체 X-13은 빛에 극도로 민감하며 회복 속도가 일반 감염체의 40배. 격리 등급 상향 요청.'],
  ['찢어진 병원 차트', '환자 다수가 고열 후 24시간 내 사망, 이후 재기동. 7층 산부인과 병동 봉쇄. 무언가 그곳에서 "번식"하고 있다.'],
  ['약탈단 장부', '도끼 장 몫 40%. 백골 몫 30%. 까마귀는 마을 쪽만 턴다고 함. 들개 왕 놈은 개들을 진짜로 키운다. 미친놈.'],
  ['교단 전단지', '붉은 새벽이 온다. 불로 씻긴 자만이 다음 세상을 본다. 교회로 오라. 사제 마르코가 너를 정화하리라.'],
  ['군 보급 명령서', '잔존 병력은 헬기장 확보 후 철수. 민간인 탑승은 지휘관 재량. 연료 보급선 두절 — 현지 조달할 것.'],
  ['주유소 사장의 메모', '탱크에 아직 기름 있음. 펌프는 손으로 돌리면 나온다. 도둑놈들아, 제발 차까지 부수지는 마라.'],
  ['농장 일지', '들개들이 닭장을 다 털었다. 개라고 하기엔 눈이 이상하다. 펌프도 고장 나서 물을 길러 강까지 간다.'],
  ['교도관의 수첩', '골리앗이라 불리던 그 수감자, 감염된 뒤로 철창을 휘어 버렸다. 진압대가 전멸했다. 아무도 들어가지 마라.'],
  ['송신소 근무자 쪽지', '비상 전원으로 1분은 버틴다. 근데 송신기가 울리면 주변 놈들이 다 몰려온다. 혼자 켜지 마라.'],
  ['연구원의 유서', '서진아, 미안하다. 카드는 내가 가지고 병원으로 간다. 거기서 시료를 마저 확보할 생각이다. 문은 반드시 닫아라.'],
  ['어느 생존자의 편지', '은행나무 마을에 가면 먹을 걸 나눠 준대. 대신 훔치다 걸리면 끝장이라더라. 눈 달린 경비병들 조심해.'],
  ['구겨진 신문', '「정부, 수도권 봉쇄 발표 — "48시간 내 통제 가능"」 …그게 마지막 신문이었다.'],
  ['학교 출석부', '3학년 2반 출석 9명. 다음 날 4명. 그다음 날… 출석부에는 더 이상 아무것도 적혀 있지 않다.'],
  ['소방관의 메모', '블로터는 터진다. 절대 가까이서 쏘지 마라. 크롤러는 바닥에 붙어서 잘 안 보인다. 발밑 조심.'],
  ['사냥꾼의 조언', '스크리머가 비명을 지르면 러너들이 몰려온다. 보이면 제일 먼저 쏴라. 은신해서 다니면 눈에 덜 띈다.'],
  ['상인의 가격표', '탄창 시세 폭등. 고철과 연료는 어디서나 받는다. 금붙이는 떠돌이 상인이 제일 후하게 쳐준다.'],
  ['녹음 테이프: 실험 기록 13', '(차가운 목소리) "피험체가 구속구를 끊었다. 반복한다, 구속구를… 불을 켜! 불을—" (비명)'],
  ['녹음 테이프: 사제의 설교', '"재가 되어라. 재는 썩지 않는다. 우리는 썩지 않는 새벽이 될 것이다." (군중의 함성)'],
  ['진압대 일지', '방패를 든 놈들은 정면에선 총알이 안 먹힌다. 옆이나 뒤를 노려라. 폭발물이 제일 낫다.'],
  ['일기장 마지막 장', '밤이 오면 발전기 소리를 듣고 놈들이 온다. 그래도 끌 수 없다. 불이 꺼지면 우리도 끝이다.'],
  ['약국 영수증 뒷면', '독성 좀비는 죽을 때 녹색 가스를 뿜는다. 마스크도 소용없다. 멀리서 처리할 것.'],
  ['추적자 목격담', '아무것도 없는 줄 알았는데 갑자기 바로 옆에서 튀어나왔다. 그림자처럼 숨어 다니는 놈이 있다.'],
  ['마을 회의록', '외부인과의 거래는 허락하되 마을 창고 출입은 금지. 절도범은 마을 전체의 적으로 간주한다.'],
  ['아이의 쪽지', '할아버지 나 학교에 숨어있어. 선생님이 여기 있으면 안전하대. 근데 밖에 이상한 소리가 나.'],
  ['잔존군 병사의 편지', '어머니, 저는 괜찮습니다. 중사님이 헬기만 고치면 집으로 간다고 하셨어요. 조금만 기다려 주세요.'],
  ['연구소 출입 기록', '책임연구원 정○○, 23:41 퇴실 (출입카드 반출). 이후 연구소 봉쇄. 내부 인원 1명 잔류: 한서진.'],
  ['낡은 지도 귀퉁이', '"헬기장 — 옥상. 북쪽 펜스는 약함." 누군가 볼펜으로 동그라미를 쳐 놓았다.'],
  ['피 묻은 쪽지', '물렸다. 아직은 괜찮다. 하지만 오늘 밤이 지나면 나는 내가 아닐 것이다. 이 쪽지를 읽는 사람, 문을 잠가.'],
];
const RADIO = [
  '📻 "…여기는 소금밭 마을, 의약품과 식량을 교환합니다…"',
  '📻 "…북쪽 고속도로는 막혔다. 반복한다, 북쪽은…"',
  '📻 "…교회 근처엔 가지 마. 빨간 옷 입은 놈들이 사람을 태운다…"',
  '📻 "…누구 없어요? 학교 지하에 아이들이…" (잡음)',
  '📻 "…밤마다 더 많아지고 있어. 벽을 두 겹으로 쌓아…"',
  '📻 "…떠돌이 상인이 오늘 기지 쪽으로 간대. 금붙이 챙겨 둬…"',
  '📻 "…들개 떼가 농장 쪽에서 내려오고 있습니다. 주의…"',
  '📻 "…병원 7층에서 이상한 울음소리가…"',
  '📻 (오래된 음악이 잠깐 흘러나오다 끊긴다)',
  '📻 "…약탈단이 기지를 노린대. 낮에도 경계를 늦추지 마…"',
];

// ── state & helpers ────────────────────────────────────────────────────────
function newQuestState() {
  return { v: 1, lines: { ...LINE_START }, active: {}, done: [], prog: {}, flags: {}, notes: [], rep: [0, 0, 0, 0], ev: null, ending: null, seenBoss: [] };
}
function qBump() { G.Q.v++; }
function activeQuests() { const out = []; for (const l in G.Q.lines) { const id = G.Q.lines[l]; if (id && QUESTS[id] && (G.Q.active[id] || !QUESTS[id].line.startsWith('v'))) out.push(id); } return out; }
function questStarted(id) { const q = QUESTS[id]; return q && (!q.line.startsWith('v') || G.Q.active[id]); }
function countItem(id) { const S = G.stash; if (id.startsWith('mag:')) return (S.mags[id.slice(4)] || []).length; return S[id] || 0; }
function takeItem(id, n) { const S = G.stash; if (id.startsWith('mag:')) { const a = S.mags[id.slice(4)] || []; a.sort((p, q) => q - p).splice(0, n); } else S[id] -= n; }
function hasItems(items) { for (const k in items) if (countItem(k) < items[k]) return false; return true; }
function tagEnt(tag) { return G.ents.find(e => e.tag === tag && !e.dead); }
function poiOf(key) { return W.pois.find(p => p.key === key); }
function inRect(x, y, r, m = 0) { return r && x >= r.x - m && y >= r.y - m && x < r.x + r.w + m && y < r.y + r.h + m; }
function comm(lines, pid = -1) { fx({ k: 'comm', lines, pid }); }

function startQuest(id, silent) {
  const q = QUESTS[id]; if (!q) return;
  G.Q.lines[q.line] = id; G.Q.active[id] = 1;
  if (q.obj.t === 'survive') G.Q.prog[id] = G.nightN;
  if (q.obj.t === 'kill') G.Q.prog[id] = 0;
  if (!silent) { say(`📜 새 임무: ${q.title}`, '#ffd166', -1, 1); if (q.start) comm(q.start); }
  qBump();
}
function completeQuest(id) {
  const q = QUESTS[id]; if (!q || G.Q.done.includes(id)) return;
  G.Q.done.push(id); delete G.Q.active[id];
  say(`✔ 임무 완료: ${q.title}`, '#7dff9a', -1, 1); sfxAt('unlock', G.core.x, G.core.y);
  if (q.reward) { for (const k in q.reward) giveItem(k, q.reward[k], -1); say('보상: ' + Object.entries(q.reward).map(([k, v]) => `${itemName(k)} ${v}`).join(', '), '#ffe9a8'); }
  if (q.line.startsWith('v')) G.Q.rep[+q.line[1]]++;
  if (q.flag) G.Q.flags[q.flag] = 1;
  if (q.done) comm(q.done);
  G.Q.lines[q.line] = q.next || null;
  if (q.next && !q.line.startsWith('v')) startQuest(q.next, true);
  for (const u of q.unlock || []) startQuest(u, true);
  if (q.ending) return triggerEnding(q.ending);
  // all four villages done → community line
  if (!G.Q.lines.community && !G.Q.done.includes('k1') && [0, 1, 2, 3].every(v => G.Q.done.includes(`v${v}c`))) { G.Q.lines.community = 'k1'; say('📜 네 마을이 모두 당신을 믿습니다. 새 임무: 다시 켜진 불빛', '#ffd166', -1, 1); }
  qBump();
}
function triggerEnding(key) {
  if (G.Q.ending) return;
  G.Q.ending = key; qBump();
  fx({ k: 'ending', e: key });
}

// ── hooks called from sim ───────────────────────────────────────────────────
function questOnKill(e, src) {
  if (!G.Q) return;
  if (e.tag) {
    G.Q.flags['dead_' + e.tag] = 1;
    if (e.tag === 'broodmother') dropBag(e.x, e.y + 0.4, { keycard: 1 }, '산란체');
    if (e.tag === 'x13') dropBag(e.x, e.y + 0.4, { sample: 1 }, '실험체 X-13');
    if (e.tag === 'priest') G.Q.flags.priestDead = 1;
    if (['dr_han', 'mechanic', 'child'].includes(e.tag)) say(`${CAST[e.tag].name}이(가) 쓰러졌습니다! 내일 아침 원래 장소로 다시 피신합니다.`, '#ff6b5c', -1, 1);
    if (e.tag.startsWith('elder') && src && src.team === 'player') { G.Q.flags.eldersKilled = (G.Q.flags.eldersKilled || 0) + 1; checkWarlord(); }
    if (e.tag.startsWith('camp')) checkWarlord();
    qBump();
  }
  if (src && src.team === 'player') for (const id of activeQuests()) {
    const o = QUESTS[id].obj;
    if (o.t === 'kill' && o.kinds.includes(e.kind)) { G.Q.prog[id] = (G.Q.prog[id] || 0) + 1; qBump(); }
  }
  if (e.cat === 'mob' && e.def.por && !G.Q.notes.includes(18) && e.tag === 'x13') G.Q.notes.push(18);
  if (e.tag === 'priest' && !G.Q.notes.includes(19)) G.Q.notes.push(19);
}
function checkWarlord() {
  const bosses = [0, 1, 2, 3].every(c => G.Q.flags['dead_camp' + c]);
  if ((G.Q.flags.eldersKilled || 0) >= 3 && bosses) {
    comm([['you', '마을도, 약탈단도 이제 없다. 이 도시에 남은 힘은 오직 나뿐이다.']]);
    triggerEnding('warlord');
  }
}
function questOnDay() {
  if (!G.Q) return;
  for (const id of activeQuests()) {
    const q = QUESTS[id];
    if (q.obj.t === 'survive' && G.nightN - (G.Q.prog[id] || 0) >= q.obj.n) completeQuest(id);
  }
  if (G.Q.flags.farmFood) { giveItem('food', 3, -1); say('🌾 은행나무 마을에서 식량 3개를 보내왔습니다.', '#9fe6a0'); }
  // rescued NPCs who died come back to their hideout
  for (const s of W.npcSpawns) if (s.tag && ['dr_han', 'mechanic', 'child'].includes(s.tag) && !tagEnt(s.tag) && !escortDone(s.tag)) {
    const h = spawnHuman(s.kind, s.x, s.y, s); h.mode = 'wait';
  }
  if (SR.chance(0.75)) say(SR.pick(RADIO), '#c8d8a8');
}
function escortDone(tag) { return Object.keys(QUESTS).some(id => QUESTS[id].obj.tag === tag && G.Q.done.includes(id)); }
// a lore note might be tucked into a container
function maybeNote(c) {
  if (!G.Q || !SR.chance(0.09)) return;
  const left = NOTES.map((_, i) => i).filter(i => !G.Q.notes.includes(i) && i !== 18 && i !== 19);
  if (!left.length) return;
  const n = SR.pick(left); G.Q.notes.push(n); qBump();
  fx({ k: 'float', x: c.x, y: c.y - 0.7, text: `기록 발견: ${NOTES[n][0]}`, c: '#e8d0ff', icon: NOTES[n][0].startsWith('녹음') ? 'tape' : 'note' });
  say(`📄 기록을 발견했습니다: "${NOTES[n][0]}" — J 일지에서 읽을 수 있습니다`, '#e8d0ff');
}
// radio parts show up while the first quest is active
function questLootBonus(c, items) {
  if (G.Q.lines.main === 'm1' && countItem('radio_part') < 2 && ['locker', 'toolbox', 'desk', 'shelf'].includes(c.kind) && SR.chance(0.55)) items.radio_part = 1;
}

// per-tick: objectives that complete by themselves, defence events
function questTick() {
  if (!G.Q || G.Q.ending && G.Q.endingSeen) return;
  const ev = G.Q.ev;
  if (ev) updateDefense(ev);
  if (G.tick % 25 !== 0) return;
  for (const id of activeQuests()) {
    const q = QUESTS[id], o = q.obj;
    if (o.t === 'have' && hasItems(o.items)) completeQuest(id);
    else if (o.t === 'goto' && G.players.some(p => p && p.joined && !p.dead && inRect(p.x, p.y, poiOf(o.poi)))) completeQuest(id);
    else if (o.t === 'killTag' && o.tags.every(t => G.Q.flags['dead_' + t])) completeQuest(id);
    else if (o.t === 'kill' && (G.Q.prog[id] || 0) >= o.n) completeQuest(id);
    else if (o.t === 'escort') {
      const e = tagEnt(o.tag); if (!e || e.mode === 'wait') continue;
      const dest = o.to === 'base' ? W.base : o.to[0] === 'v' ? W.villages[+o.to[1]] : poiOf(o.to);
      if (inRect(e.x, e.y, dest)) {
        completeQuest(id);
        if (o.to === 'base') { e.mode = 'guard'; e.home = { x: G.bench.x - 2, y: G.bench.y + 1 }; }
        else if (o.to[0] === 'v') { e.team = 'village'; e.village = +o.to[1]; e.mode = 'idle'; }
        else { e.team = 'military'; e.mode = 'idle'; e.home = { x: e.x, y: e.y }; }
      }
    }
    else if (o.t === 'crew' && G.ents.filter(e => e.kind === 'survivor' && e.mode !== 'wait').length >= o.n && G.Q.flags.allianceTalk) completeQuest(id);
  }
}
// hold-to-use triggers
function triggerQuest(kind) { return activeQuests().find(id => { const o = QUESTS[id].obj; return (o.t === 'use' || o.t === 'defend') && o.trig === kind; }); }
function triggerLabel(tr) {
  const id = triggerQuest(tr.kind); if (!id) return null;
  if (G.Q.ev) return null;
  return { tower: '송신탑 제어반 켜기 (60초 방어 시작)', lab_gate: '출입카드로 연구소 문 열기', flare: '신호탄 발사 (120초 방어 시작)', farm_pump: '펌프 수리 (전자부품 2)' }[tr.kind];
}
function useTrigger(p, tr) {
  const id = triggerQuest(tr.kind); if (!id) return;
  const o = QUESTS[id].obj;
  if (tr.kind === 'lab_gate') {
    if (countItem('keycard') < 1) { say('출입카드가 필요합니다', '#ff9a8a', p.pid); return; }
    for (const s of G.structs.filter(s => s.type === 'gate')) removeStruct(s);
    sfxAt('unlock', tr.x, tr.y); completeQuest(id); return;
  }
  if (tr.kind === 'farm_pump') {
    if (countItem('parts') < 2) { say('전자부품 2개가 필요합니다', '#ff9a8a', p.pid); return; }
    takeItem('parts', 2); completeQuest(id); return;
  }
  if (o.t === 'defend') {
    G.Q.ev = { id, x: tr.x, y: tr.y, t: o.secs, total: o.secs, spawnT: 0, away: 0 };
    say(tr.kind === 'tower' ? '📡 송신기가 켜졌습니다! 60초 동안 버티세요!' : '🎆 신호탄 발사! 헬기가 올 때까지 버티세요!', '#ffd166', -1, 1);
    sfxAt('alarm', tr.x, tr.y); makeNoise(tr.x, tr.y, 30, null); qBump();
  }
}
function updateDefense(ev) {
  ev.t -= DT; ev.spawnT -= DT;
  const near = G.players.some(p => p && p.joined && !p.dead && !p.down && dist(p.x, p.y, ev.x, ev.y) < 22);
  ev.away = near ? 0 : ev.away + DT;
  if (ev.away > 12) { G.Q.ev = null; say('방어 지점을 벗어나 실패했습니다. 다시 시도하세요.', '#ff6b5c', -1, 1); qBump(); return; }
  const heavy = ev.id === 'e5';
  if (ev.spawnT <= 0 && G.ents.length < 250) {
    ev.spawnT = heavy ? 1.1 : 1.6;
    const pool = heavy ? ['walker', 'runner', 'runner', 'riot', 'hound', 'toxic', 'stalker', 'brute'] : ['walker', 'walker', 'runner', 'crawler', 'hound'];
    for (let k = 0; k < (heavy ? 3 : 2); k++) {
      const a = SR.r(0, TAU), r = SR.r(13, 18), pt = randomFreeCell(SR, ev.x + Math.cos(a) * r - 1, ev.y + Math.sin(a) * r - 1, ev.x + Math.cos(a) * r + 1, ev.y + Math.sin(a) * r + 1);
      if (!pt) continue;
      const m = spawnMob(SR.pick(pool), pt.x, pt.y, false);
      m.invest = { x: ev.x, y: ev.y, t: G.t + 60 };
      const pl = alivePlayers().sort((p, q) => dist(p.x, p.y, m.x, m.y) - dist(q.x, q.y, m.x, m.y))[0];
      if (pl) { m.target = pl; m.seenT = G.t + 3; }
    }
  }
  if (ev.t <= 0) { G.Q.ev = null; completeQuest(ev.id); }
}

// ── talking (who says what depends only on G.Q, so host and guest agree) ───
function npcKeyOf(e) { if (!e) return null; if (e.tag && CAST[e.tag]) return e.tag; if (e.kind === 'yoon') return 'yoon'; if (e.kind === 'dr_han') return 'dr_han'; return null; }
function talkOptions(key) {
  const Q = G.Q, out = { key, lines: [], acts: [] };
  const say1 = t => out.lines.push(t);
  const vi = key.startsWith('elder') ? +key[5] : -1;
  // turn-ins addressed to this NPC
  for (const id of activeQuests()) {
    const q = QUESTS[id];
    if (q.obj.t === 'deliver' && q.obj.to === key) {
      const need = Object.entries(q.obj.items).map(([k, v]) => `${itemName(k)} ${countItem(k)}/${v}`).join(', ');
      say1(`[${q.title}] ${q.desc}`); say1(`필요: ${need}`);
      out.acts.push({ label: '전달하기', a: 'deliver', id, ok: hasItems(q.obj.items) });
    }
    if (q.obj.t === 'talk' && q.obj.to === key) out.acts.push({ label: '이야기하기', a: 'talk', id, ok: true });
  }
  if (vi >= 0) {
    const line = 'v' + vi, cur = Q.lines[line];
    if (cur && !Q.active[cur]) { const q = QUESTS[cur]; say1(`[${q.title}] ${q.desc}`); out.acts.push({ label: '부탁 들어주기', a: 'accept', id: cur, ok: true }); }
    else if (cur && Q.active[cur] && QUESTS[cur].obj.t !== 'deliver') say1(`[${QUESTS[cur].title}] ${QUESTS[cur].desc}`);
    else if (!cur) say1(['자네 덕분에 마을이 살아났네.', '언제든 들러요. 이 마을은 당신 편이에요.', '바람골 경비대는 자네를 기억할 거다.', '우리 소금밭은 은혜를 잊지 않는단다.'][vi]);
    if (Q.lines.community === 'k1') {
      const crew = G.ents.filter(e => e.kind === 'survivor' && e.mode !== 'wait').length;
      say1(`[다시 켜진 불빛] 생존자 동료 ${crew}/6명`);
      out.acts.push({ label: '마을 연합 맺기', a: 'alliance', id: 'k1', ok: crew >= 6 });
    }
    if (Q.rep[vi] > 0) say1(`(신뢰도 ${Q.rep[vi]} — 이 마을 상인 가격 ${Q.rep[vi] * 8}% 할인)`);
  }
  if (key === 'radio') {
    if (Q.lines.main === 'm1') {} else if (Q.lines.main === 'm2') say1('잡음 사이로 두 개의 신호가 들린다. 송신탑으로 가서 신호를 증폭해야 한다.');
    else say1('무전기는 조용히 잡음만 낸다. 진행 중인 임무는 J 일지에서 볼 수 있다.');
  }
  if (key === 'yoon' && !out.acts.length) say1(Q.flags.milFriend ? '보급품이 필요하면 말해라. 공짜는 아니다.' : '거기 멈춰. 총 내려놓고 용건부터 말해.');
  if (key === 'yoon' && Q.flags.milFriend) out.acts.push({ label: '보급품 거래', a: 'shop', ok: true });
  if (key === 'dr_han' && !out.acts.length) say1(G.Q.lines.cure === 'c6' ? '배양은 순조로워요. 밤을 버텨 주세요.' : '여기서 기다릴게요. 조심하세요.');
  if (!out.lines.length) say1('…');
  return out;
}
function questAction(pid, c) {
  const p = G.players[pid]; if (!p) return;
  const q = QUESTS[c.id];
  switch (c.a) {
    case 'accept': if (q && q.line.startsWith('v') && G.Q.lines[q.line] === c.id && !G.Q.active[c.id]) startQuest(c.id); break;
    case 'deliver':
      if (q && G.Q.active[c.id] !== undefined && q.obj.t === 'deliver' && hasItems(q.obj.items)) { for (const k in q.obj.items) takeItem(k, q.obj.items[k]); completeQuest(c.id); }
      else if (q && activeQuests().includes(c.id) && q.obj.t === 'deliver' && hasItems(q.obj.items)) { for (const k in q.obj.items) takeItem(k, q.obj.items[k]); completeQuest(c.id); }
      break;
    case 'talk': if (q && activeQuests().includes(c.id)) completeQuest(c.id); break;
    case 'alliance': G.Q.flags.allianceTalk = 1; questTick(); break;
  }
}
