# Art set v3: top-down character sprites (they face the top of the image; the game rotates them).
CHAR_STYLE = ("Top-down view from directly above of {}, seen from straight overhead so the top of the head and the shoulders are visible, "
              "the character faces toward the top of the image, 2D video game character sprite for a gritty post-apocalyptic zombie survival shooter, "
              "flat-shaded hand-drawn indie game art with simple clean shapes, a limited muted color palette and bold readable silhouette, "
              "soft light from the top left, single character centered and fully inside the frame, transparent background, no ground, no drop shadow, "
              "no text, no letters, no logos.")
CHARS = {
    # players: the weapon is drawn by the game, so arms are empty and slightly forward
    'player_blue': 'a male survivor wearing a blue jacket, black cap and a brown backpack, arms slightly forward with empty hands',
    'player_orange': 'a female survivor wearing an orange jacket, dark ponytail and a grey backpack, arms slightly forward with empty hands',
    # zombies
    'walker1': 'a rotting green-skinned zombie in a torn white shirt and jeans, arms reaching forward',
    'walker2': 'a decayed zombie in a ripped blue office shirt and tie, arms reaching forward, bloody',
    'walker3': 'a zombie woman in a torn red dress with messy hair, arms reaching forward',
    'crawler': 'a legless zombie crawling on the ground dragging itself with its arms, gore trailing behind',
    'runner': 'a lean fast zombie in a torn tracksuit, sprinting pose, arms swinging',
    'spitter': 'a bloated-throat zombie with green acid dripping from its mouth, swollen neck sacs',
    'brute': 'a huge muscular zombie brute with torn clothes, enormous fists, hunched massive shoulders',
    'bloater': 'a grotesquely swollen fat zombie covered in yellow pustules, about to burst',
    'screamer': 'a gaunt pale zombie with a huge open screaming mouth and long thin arms',
    'hound': 'a rotting zombie dog with exposed ribs and torn fur, running pose',
    'riot': 'a zombie in black riot police armor and helmet holding a riot shield in front',
    'toxic': 'a zombie in a torn yellow hazmat suit leaking green toxic gas',
    'stalker': 'a dark shadowy thin zombie with long claws, crouched, faint smoky edges',
    'fiend': 'a hulking blood-red demonic zombie with horns, glowing ember cracks in its skin',
    'broodmother': 'a bloated pale mutant zombie matriarch with a huge swollen egg sac back and small crawlers clinging to it',
    'goliath': 'a gigantic armored zombie brute in a torn orange prison jumpsuit with broken chains on its wrists',
    'x13': 'a lean grey-skinned laboratory mutant with long clawed arms and glowing cyan veins, broken restraints',
    # humans (holding weapons)
    'bandit': 'a bandit raider with a red bandana and a leather vest, holding a pistol forward',
    'bandit_heavy': 'a bandit raider in scrap metal armor holding a shotgun forward',
    'bandit_boss': 'a bandit warlord with a shaved head, spiked shoulder armor and an assault rifle',
    'villager': 'a Korean villager in a padded work jacket and wool hat, unarmed',
    'guard': 'a village militia guard in a blue jacket and helmet holding a rifle forward',
    'trader': 'a merchant in a leather apron with a big pack of goods on his back',
    'survivor': 'a ragged survivor in a green hoodie holding a pistol forward',
    'soldier': 'a soldier in olive camouflage uniform, helmet and tactical vest holding an assault rifle forward',
    'cultist': 'a cult fanatic in a tattered crimson hooded robe holding a machete',
    'priest': 'a cult leader in ornate crimson robes with a hood and candles on his belt, holding a submachine gun',
    'scientist': 'a female scientist in a white lab coat with short black hair holding a pistol',
}
# re-rolls of v2 sprites that came out with garbled lettering
REROLL = {
    'milcrate': 'a large olive green military supply crate with plain metal latches, no markings, seen from directly above',
}
