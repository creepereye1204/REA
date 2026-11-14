# Art set v2 for Cell Siege: Nightfall — everything top-down to match the in-game camera.
TEX_STYLE = ("Seamless tileable top-down ground texture of {}, orthographic view from directly above, video game terrain texture, "
             "hand-painted stylized look with fine detail, muted natural post-apocalyptic colors, flat even lighting, no shadows, "
             "no objects, no text, the texture fills the entire square frame edge to edge.")
SPRITE_STYLE = ("Top-down orthographic view from directly above of {}, isometric-free flat top view, 2D video game sprite asset for a "
                "post-apocalyptic survival shooter, hand-painted stylized, muted earthy colors, soft light from the top left, crisp clean edges, "
                "single object centered and fully inside the frame, transparent background, no text, no ground, no drop shadow.")
ICON_STYLE = ("Game inventory icon of {}, 2D hand-painted stylized game art matching a top-down post-apocalyptic survival shooter, "
              "bold dark outline, muted earthy palette with one warm accent, soft top-left light, single object centered with margin, "
              "transparent background, no text, no border.")

TEXTURES = {
    'GRASS': 'short wild green grass with a few dry yellow patches and tiny clover',
    'DIRT': 'packed brown dirt with small pebbles and dry cracks',
    'SAND': 'fine beach sand with soft wind ripples',
    'MUD': 'wet dark swamp mud with small puddles reflecting the sky',
    'ASH': 'grey volcanic ash and soot covered ground with tiny glowing embers and charred bits',
    'GRAVEL': 'loose grey gravel and small rocks',
    'RUBBLE': 'broken concrete rubble, brick fragments and dust',
    'WATER': 'deep murky blue-green water surface with gentle ripples',
    'ROAD': 'old cracked dark grey asphalt road surface with small potholes and stains, no lane markings',
    'CONCRETE': 'weathered concrete slab floor with stains and hairline cracks',
    'CAMPDIRT': 'trampled dark dirt of a campsite with ash, footprints and scraps',
    'VFLOOR': 'light packed earth village courtyard with scattered flat stones',
    'roof_red': 'red clay roof tiles in neat rows, weathered and mossy',
    'roof_metal': 'corrugated metal roof sheets, faded blue-grey paint with rust streaks',
    'roof_concrete': 'flat grey concrete rooftop with tar patches and vents',
    'roof_shingle': 'brown asphalt roof shingles, worn',
    'roof_green': 'corrugated green painted metal roof with rust',
}
SPRITES = {
    'tree1': 'a round leafy deciduous tree crown seen from above, lush green foliage clusters',
    'tree2': 'a large oak tree canopy seen from above, dark green leaves with lighter highlights',
    'tree3': 'a small birch tree crown seen from above, light green leaves',
    'pine1': 'a pine tree seen from above, star shaped dark green needle layers',
    'pine2': 'a tall fir tree seen from above, layered dark green branches',
    'deadtree1': 'a dead leafless tree seen from above, bare grey twisted branches spreading out',
    'deadtree2': 'a burnt black dead tree seen from above, charred bare branches',
    'bush1': 'a round green shrub bush seen from above',
    'bush2': 'a berry bush seen from above with small red berries among green leaves',
    'rock1': 'a large grey boulder seen from above, mossy cracks',
    'rock2': 'a cluster of three grey rocks seen from above',
    'rock3': 'a flat brown sandstone rock seen from above',
    'car_red': 'a red four door sedan car seen from directly above, dusty, windows intact',
    'car_blue': 'a blue hatchback car seen from directly above, dusty',
    'car_white': 'a white compact SUV seen from directly above, dirty',
    'car_wreck': 'a burnt out rusty wrecked car seen from directly above, no wheels, broken windows',
    'crate': 'a wooden supply crate seen from above, nailed planks',
    'ammobox': 'an olive green military ammunition box seen from above',
    'milcrate': 'a large olive green military supply crate with stenciled marks seen from above',
    'safe': 'a heavy black steel safe seen from above',
    'fridge': 'a white refrigerator seen from above',
    'cabinet': 'a wooden chest of drawers seen from above',
    'shelf': 'a metal storage shelf with boxes and cans seen from above',
    'medcab': 'a white medical cabinet with a red cross seen from above',
    'desk': 'an office desk with papers and a computer monitor seen from above',
    'toolbox': 'a red metal toolbox seen from above',
    'barrel': 'a red explosive oil drum barrel seen from above, hazard symbol',
    'pump': 'a red gas station fuel pump seen from above',
    'altar': 'a dark stone cult altar with red candles seen from above',
    'tent': 'a khaki canvas camping tent seen from above',
    'campfire': 'a campfire ring of stones with logs, unlit, seen from above',
    'sandbags': 'a short curved wall of stacked sandbags seen from above',
    'core': 'a heavy industrial power generator machine with glowing blue core seen from above',
    'bench': 'a wooden workbench with tools and a vise seen from above',
    'radio': 'a military field radio set with antenna seen from above',
    'stash': 'a wooden storage chest bound with iron seen from above',
    'labfridge': 'a laboratory sample refrigerator with glass door seen from above',
    'barn': 'a pile of hay bales and sacks seen from above',
    'grave': 'a weathered stone gravestone with a cross seen from above',
    'turret': 'a small automatic sentry gun turret on a tripod seen from above',
}
ICONS = {
    'cash': 'a small bundle of worn paper banknotes', 'wood': 'a stack of wooden planks', 'scrap': 'a pile of rusty scrap metal, bolts and gears',
    'food': 'two dented food cans', 'meds': 'a white first aid kit with a green cross', 'grenade': 'an olive frag grenade', 'mine': 'a round landmine',
    'bandage': 'a rolled bandage', 'armor': 'a grey tactical bulletproof vest', 'molotov': 'a molotov cocktail bottle with a rag', 'adrenaline': 'a yellow auto-injector pen',
    'fuel': 'a red jerry can', 'parts': 'a circuit board with wires', 'chem': 'three chemical bottles, one glowing green', 'keycard': 'a white lab keycard with a blue stripe',
    'radio_part': 'a military radio module with a short antenna', 'gold': 'two gold bars', 'watch': 'a silver wristwatch with cracked glass', 'jewel': 'a gold necklace with a red gem',
    'tape': 'an old cassette tape', 'note': 'a folded stained paper note', 'bag': 'a dirty canvas backpack', 'sample': 'a sealed glass vial with glowing cyan tissue sample',
    'flare': 'a red signal flare stick', 'mag_pistol': 'a pistol magazine with brass bullets', 'mag_smg': 'a curved submachine gun magazine', 'mag_shotgun': 'a box of red shotgun shells',
    'mag_rifle': 'an assault rifle magazine', 'mag_sniper': 'five large rifle cartridges on a clip', 'mag_launcher': 'a rocket propelled grenade warhead',
    'wpn_machete': 'a rusty machete', 'wpn_pistol': 'a black pistol, side view', 'wpn_smg': 'a compact submachine gun, side view', 'wpn_shotgun': 'a pump shotgun with wooden stock, side view',
    'wpn_rifle': 'a black assault rifle, side view', 'wpn_sniper': 'a scoped sniper rifle, side view', 'wpn_launcher': 'an olive rocket launcher, side view',
}
