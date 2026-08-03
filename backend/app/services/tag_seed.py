"""Starter tag hierarchy shipped with the app.

Two problems this solves at once:

1. Nobody should have to build a tag tree from an empty canvas. A new install
   starts with the conventional categories already in place and extends them.
2. Packs only merge cleanly when installs agree on what a theme is called. The
   slugs here are the shared vocabulary that makes that possible, so they are
   deliberately English and deliberately boring — ``geography`` rather than
   ``geographie`` — while ``label`` carries what the user actually reads.

The seed is data, not policy: every node can be renamed, re-parented or deleted,
and ``seed.removed`` in the stored hierarchy makes a deletion stick across
upgrades. Seeding only ever adopts edges for nodes that have no parent locally,
so a user's own arrangement is never rewritten.

Kept as a Python module rather than JSON because ``Nemoris.spec`` only bundles
``assets/`` and the built frontend — a data file here would not survive
packaging, an imported module does.
"""

SEED_VERSION = 1


# (slug, label, [parent slugs]). Roots list no parents. One level deep on
# purpose: deeper structure is the user's to invent, and re-parenting a seeded
# node later only reaches installs that never touched it.
SEED_NODES = [
    # -- Roots ---------------------------------------------------------------
    ("art", "Art", []),
    ("cuisine", "Cuisine", []),
    ("economy", "Économie", []),
    ("entertainment", "Divertissement", []),
    ("geography", "Géographie", []),
    ("health", "Santé", []),
    ("history", "Histoire", []),
    ("languages", "Langues", []),
    ("nature", "Nature", []),
    ("people", "Personnalités", []),
    ("philosophy", "Philosophie", []),
    ("politics", "Politique", []),
    ("religion", "Religion", []),
    ("science", "Sciences", []),
    ("society", "Société", []),
    ("sport", "Sport", []),
    ("technology", "Technologie", []),

    # -- Géographie ----------------------------------------------------------
    ("europe", "Europe", ["geography"]),
    ("asia", "Asie", ["geography"]),
    ("africa", "Afrique", ["geography"]),
    ("north-america", "Amérique du Nord", ["geography"]),
    ("south-america", "Amérique du Sud", ["geography"]),
    # Seeded as a node rather than left local because two spellings of it are
    # merged below and the alias target has to exist.
    ("united-states", "États-Unis", ["north-america"]),
    ("oceania", "Océanie", ["geography"]),
    ("countries", "Pays", ["geography"]),
    ("capitals", "Capitales", ["geography"]),
    ("flags", "Drapeaux", ["geography"]),
    ("earth", "Terre", ["geography"]),
    ("oceans", "Océans", ["geography"]),
    ("rivers", "Fleuves et rivières", ["geography"]),
    ("islands", "Îles", ["geography"]),
    ("mountains", "Montagnes", ["geography"]),
    ("cities", "Villes", ["geography"]),

    # -- Sciences ------------------------------------------------------------
    ("physics", "Physique", ["science"]),
    ("chemistry", "Chimie", ["science"]),
    ("biology", "Biologie", ["science"]),
    ("mathematics", "Mathématiques", ["science"]),
    ("astronomy", "Astronomie", ["science"]),
    ("earth-science", "Sciences de la Terre", ["science"]),
    ("social-sciences", "Sciences humaines", ["science"]),

    # -- Histoire ------------------------------------------------------------
    ("antiquity", "Antiquité", ["history"]),
    ("middle-ages", "Moyen Âge", ["history"]),
    ("modern-era", "Époque moderne", ["history"]),
    ("contemporary-era", "Époque contemporaine", ["history"]),
    ("wars", "Guerres", ["history"]),
    ("archaeology", "Archéologie", ["history"]),

    # -- Art -----------------------------------------------------------------
    ("cinema", "Cinéma", ["art"]),
    ("literature", "Littérature", ["art"]),
    ("music", "Musique", ["art"]),
    ("painting", "Peinture", ["art"]),
    ("sculpture", "Sculpture", ["art"]),
    ("architecture", "Architecture", ["art"]),
    ("photography", "Photographie", ["art"]),
    ("comics", "Bande dessinée", ["art"]),
    ("dance", "Danse", ["art"]),

    # -- Sport ---------------------------------------------------------------
    ("football", "Football", ["sport"]),
    ("basketball", "Basketball", ["sport"]),
    ("tennis", "Tennis", ["sport"]),
    ("athletics", "Athlétisme", ["sport"]),
    ("combat-sports", "Sports de combat", ["sport"]),
    ("water-sports", "Sports nautiques", ["sport"]),
    ("winter-sports", "Sports d'hiver", ["sport"]),
    ("motorsport", "Sport automobile", ["sport"]),
    ("golf", "Golf", ["sport"]),
    ("olympics", "Jeux olympiques", ["sport"]),

    # -- Technologie ---------------------------------------------------------
    ("computing", "Informatique", ["technology"]),
    ("internet", "Internet", ["technology"]),
    ("ai", "Intelligence artificielle", ["technology"]),
    ("electronics", "Électronique", ["technology"]),
    ("transport", "Transports", ["technology"]),
    ("engineering", "Ingénierie", ["technology"]),
    ("space-exploration", "Conquête spatiale", ["technology", "astronomy"]),

    # -- Nature --------------------------------------------------------------
    ("animals", "Animaux", ["nature"]),
    ("birds", "Oiseaux", ["nature", "animals"]),
    ("insects", "Insectes", ["nature", "animals"]),
    ("marine-life", "Vie marine", ["nature", "animals"]),
    ("plants", "Plantes", ["nature"]),
    ("weather", "Météo", ["nature"]),
    ("ecology", "Écologie", ["nature"]),

    # -- Santé ---------------------------------------------------------------
    ("medicine", "Médecine", ["health"]),
    ("anatomy", "Anatomie", ["health", "science"]),
    ("nutrition", "Nutrition", ["health"]),
    ("psychology", "Psychologie", ["health"]),
    ("diseases", "Maladies", ["health"]),

    # -- Société -------------------------------------------------------------
    ("education", "Éducation", ["society"]),
    ("law", "Droit", ["society"]),
    ("media", "Médias", ["society"]),
    ("traditions", "Traditions", ["society"]),
    ("lgbtq", "LGBTQ+", ["society"]),
    ("family", "Famille", ["society"]),
    ("clothing", "Vêtements", ["society"]),

    # -- Langues -------------------------------------------------------------
    ("vocabulary", "Vocabulaire", ["languages"]),
    ("grammar", "Grammaire", ["languages"]),
    ("etymology", "Étymologie", ["languages"]),
    ("foreign-languages", "Langues étrangères", ["languages"]),
    ("writing-systems", "Écritures", ["languages"]),

    # -- Personnalités -------------------------------------------------------
    # Cross-cutting on purpose: a singer belongs under Musique *and* here, which
    # is exactly what multi-parent support is for.
    ("leaders", "Dirigeants", ["people"]),
    ("actors", "Acteurs", ["people", "cinema"]),
    ("directors", "Réalisateurs", ["people", "cinema"]),
    ("musicians", "Musiciens", ["people", "music"]),
    ("writers", "Écrivains", ["people", "literature"]),
    ("scientists", "Scientifiques", ["people", "science"]),
    ("athletes", "Sportifs", ["people", "sport"]),
    ("artists", "Artistes", ["people", "art"]),
    ("philosophers", "Philosophes", ["people", "philosophy"]),

    # -- Économie ------------------------------------------------------------
    ("money", "Monnaie", ["economy"]),
    ("business", "Entreprises", ["economy"]),
    ("trade", "Commerce", ["economy"]),
    ("finance", "Finance", ["economy"]),
    ("work", "Travail", ["economy", "society"]),

    # -- Philosophie ---------------------------------------------------------
    ("ethics", "Éthique", ["philosophy"]),
    ("logic", "Logique", ["philosophy"]),
    ("metaphysics", "Métaphysique", ["philosophy"]),

    # -- Divertissement ------------------------------------------------------
    ("video-games", "Jeux vidéo", ["entertainment"]),
    ("board-games", "Jeux de société", ["entertainment"]),
    ("television", "Télévision", ["entertainment", "media"]),
    ("humor", "Humour", ["entertainment"]),

    # -- Religion ------------------------------------------------------------
    ("christianity", "Christianisme", ["religion"]),
    ("islam", "Islam", ["religion"]),
    ("judaism", "Judaïsme", ["religion"]),
    ("buddhism", "Bouddhisme", ["religion"]),
    ("hinduism", "Hindouisme", ["religion"]),
    ("mythology", "Mythologie", ["religion"]),

    # -- Politique -----------------------------------------------------------
    ("elections", "Élections", ["politics"]),
    ("institutions", "Institutions", ["politics"]),
    ("international-relations", "Relations internationales", ["politics"]),
    ("ideologies", "Idéologies", ["politics"]),

    # -- Cuisine -------------------------------------------------------------
    ("dishes", "Plats", ["cuisine"]),
    ("ingredients", "Ingrédients", ["cuisine"]),
    ("drinks", "Boissons", ["cuisine"]),
    ("pastry", "Pâtisserie", ["cuisine"]),
    ("world-cuisine", "Cuisines du monde", ["cuisine"]),
]


# Existing tag text → canonical seed slug. THIS RENAMES THE TAG.
#
# Keys are already slugified (lowercase, accents stripped, spaces hyphenated),
# because the migration looks them up *after* slugifying the stored tag — so
# "Géographie" arrives here as "geographie".
#
# Only true synonyms belong here: two spellings of one idea. A tag that is a
# *member* of a category (alpes, bible, spinoza) must NOT be aliased, or the
# specific tag is destroyed — those go in SEED_PLACEMENTS instead. Anything not
# listed in either map keeps its own slug as a local, unparented tag; nothing is
# ever dropped.
SEED_ALIASES = {
    # Roots the user already had, under their French spelling.
    "geographie": "geography",
    "histoire": "history",
    "sciences": "science",
    "politique": "politics",
    "technologie": "technology",
    "philosophie": "philosophy",

    # Géographie
    "terre": "earth",
    "capitales": "capitals",
    "capitale": "capitals",
    "drapeaux": "flags",
    "vexillologie": "flags",
    "fleuve": "rivers",
    "fleuves": "rivers",
    "iles": "islands",
    "ile": "islands",
    "montagnes": "mountains",
    "pays": "countries",
    "villes": "cities",
    "asie": "asia",
    "afrique": "africa",
    "amerique-du-sud": "south-america",
    "amerique-du-nord": "north-america",
    "oceanie": "oceania",

    # Sciences
    "physique": "physics",
    "chimie": "chemistry",
    "biologie": "biology",
    "mathematiques": "mathematics",
    "maths": "mathematics",
    "astronomie": "astronomy",
    "geologie": "earth-science",

    # Histoire
    "antiquite": "antiquity",
    "moyen-age": "middle-ages",
    "guerres": "wars",
    "archeologie": "archaeology",

    # Art
    "litterature": "literature",
    "musique": "music",
    "peinture": "painting",
    "bd": "comics",
    "bande-dessinee": "comics",
    "danse": "dance",
    "photographie": "photography",

    # Sport / technologie / nature / santé
    "athletisme": "athletics",
    "informatique": "computing",
    "intelligence-artificielle": "ai",
    "ia": "ai",
    "electronique": "electronics",
    "vehicule": "transport",
    "vehicules": "transport",
    "transports": "transport",
    "ingenierie": "engineering",
    "animaux": "animals",
    "oiseaux": "birds",
    "insectes": "insects",
    "plantes": "plants",
    "meteo": "weather",
    "climat": "weather",
    "ecologie": "ecology",
    "medecine": "medicine",
    "anatomie": "anatomy",
    "psychologie": "psychology",
    "maladies": "diseases",

    # Société / langues / personnalités
    "droit": "law",
    "medias": "media",
    "vetements": "clothing",
    "pride": "lgbtq",
    "lbtqia": "lgbtq",
    "lgbtqia": "lgbtq",
    "vocabulaire": "vocabulary",
    "grammaire": "grammar",
    "orthographe": "grammar",
    "etymologie": "etymology",
    "dirigeants": "leaders",
    "acteurs": "actors",
    "actrice": "actors",
    "actrices": "actors",
    "realisateurs": "directors",
    "chanteurs": "musicians",
    "musiciens": "musicians",
    "ecrivains": "writers",
    "scientifiques": "scientists",
    "sportifs": "athletes",
    "philosophes": "philosophers",

    # Économie / divertissement / religion / politique / cuisine
    "numismatique": "money",
    "monnaie": "money",
    "entreprises": "business",
    "commerce": "trade",
    "travail": "work",
    "jeux-video": "video-games",
    "jeux-de-societe": "board-games",
    "humour": "humor",
    "humoristes": "humor",
    "mythologie": "mythology",
    "christianisme": "christianity",
    "judaisme": "judaism",
    "bouddhisme": "buddhism",
    "hindouisme": "hinduism",
    "vote": "elections",
    "plats": "dishes",
    "boissons": "drinks",
    "patisserie": "pastry",

    # The one duplicate pair merged on purpose (51 + 3 uses of the same idea).
    # "éléphants"/"elephants" needs no entry — slugifying strips the accent and
    # collapses them on its own.
    "etats-unis": "united-states",
    "usa": "united-states",
}


# Existing tag → seed parents. THIS KEEPS THE TAG and only files it.
#
# For tags that are members of a category rather than another name for it: the
# Alps are *a* mountain range, Spinoza is *a* philosopher. Aliasing those would
# delete a useful tag; parenting them makes "train on Montagnes" reach them while
# "Alpes" stays its own thing.
#
# Applied only when the tag has no local parent already, so nothing a user
# arranged themselves is ever moved.
SEED_PLACEMENTS = {
    # Géographie
    "france": ["europe", "countries"],
    "allemagne": ["europe", "countries"],
    "italie": ["europe", "countries"],
    "royaume-uni": ["europe", "countries"],
    "suede": ["europe", "countries"],
    "suisse": ["europe", "countries"],
    "portugal": ["europe", "countries"],
    "grece": ["europe", "countries"],
    "russie": ["europe", "countries"],
    "japon": ["asia", "countries"],
    "inde": ["asia", "countries"],
    "maroc": ["africa", "countries"],
    "tanzanie": ["africa", "countries"],
    "afrique-du-sud": ["africa", "countries"],
    "bresil": ["south-america", "countries"],
    "kiribati": ["oceania", "countries"],
    "paris": ["cities"],
    "lyon": ["cities"],
    "alpes": ["mountains"],
    "atlantique": ["oceans"],
    "seine": ["rivers"],
    "archipel": ["islands"],
    "bretagne": ["france"],
    "finistere": ["france"],
    "aisne": ["france"],
    "nevada": ["united-states"],

    # Sciences / nature / santé
    "espace": ["astronomy"],
    "lune": ["astronomy"],
    "sociologie": ["social-sciences"],
    "anthropologie": ["social-sciences"],
    "lumiere": ["physics"],
    "relativite": ["physics"],
    "gaz": ["chemistry"],
    "chiens": ["animals"],
    "elephants": ["animals"],
    "pingouin": ["birds"],
    "fourmis": ["insects"],
    "requin": ["marine-life"],
    "peche": ["marine-life"],
    "ouragan": ["weather"],
    "nephrologie": ["medicine"],
    "phobie": ["psychology"],
    "mort": ["biology"],

    # Histoire
    "rome-antique": ["antiquity"],
    "bataille": ["wars"],
    "guerre-de-cent-ans": ["wars", "middle-ages"],
    "guerre-froide": ["wars", "contemporary-era"],
    "wwii": ["wars", "contemporary-era"],
    "resistance": ["wars", "contemporary-era"],
    "esclavage": ["history"],
    "titanic": ["contemporary-era"],
    "assassinat": ["history"],
    "veme-republique": ["contemporary-era", "institutions"],
    "senat": ["institutions"],
    "feminisme": ["ideologies"],

    # Art / divertissement
    "gravure": ["art"],
    "impressionnisme": ["painting"],
    "louvre": ["art"],
    "instrument-de-musique": ["music"],
    "rock": ["music"],
    "punk": ["music"],
    "doublage": ["cinema"],
    "mythologie-grecque": ["mythology"],
    "dragon": ["mythology"],
    "roi-arthur": ["mythology", "middle-ages"],
    "essai": ["literature"],
    "pac-man": ["video-games"],
    "mascotte": ["entertainment"],

    # Sport
    "nba": ["basketball"],
    "fifa": ["football"],
    "rugby": ["sport"],
    "mma": ["combat-sports"],
    "muay-thai": ["combat-sports"],
    "voile": ["water-sports"],
    "patinage": ["winter-sports"],
    "curling": ["winter-sports"],

    # Technologie
    "linux": ["computing"],
    "metro": ["transport"],
    "automobile": ["transport"],
    "aviation": ["transport"],

    # Religion / philosophie / personnalités
    "bible": ["christianity", "literature"],
    "mahomet": ["islam"],
    "spinoza": ["philosophers"],
    "descartes": ["philosophers"],
    "einstein": ["scientists"],
    "leonard-de-vinci": ["artists", "scientists"],
    "hemingway": ["writers"],
    "shakespeare": ["writers"],
    "beyonce": ["musicians"],
    "coldplay": ["musicians"],
    "daft-punk": ["musicians"],
    "dalida": ["musicians"],
    "gorillaz": ["musicians"],
    "imagine-dragons": ["musicians"],
    "lady-gaga": ["musicians"],
    "beatles": ["musicians"],
    "renaud": ["musicians"],
    "stupeflip": ["musicians"],
    "bourvil": ["actors"],
    "les-inconnus": ["humor"],
    "maradona": ["athletes"],
    "pele": ["athletes"],
    "george-best": ["athletes"],
    "economiste": ["economy"],

    # Langues / société / cuisine
    "latin": ["foreign-languages"],
    "arabe": ["foreign-languages"],
    "langue-des-signes": ["foreign-languages"],
    "divorce": ["family"],
    "loto": ["board-games"],
    "riz": ["ingredients"],
    "ketchup": ["ingredients"],
    "cocktail": ["drinks"],
    "the": ["drinks"],
}
