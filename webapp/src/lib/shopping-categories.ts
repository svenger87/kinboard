import {
  Apple,
  Milk,
  Croissant,
  Beef,
  Wine,
  Sparkles,
  Package,
  Pill,
  Home,
  Coffee,
  Candy,
  Archive,
  Dog,
} from "lucide-react";

// Category definitions with icons and colors. `labelKey` maps to the
// `shoppingCategories` translation namespace; consumers should resolve
// via `useTranslations("shoppingCategories")(category.labelKey)`.
export const CATEGORIES: Record<string, { icon: typeof Apple; color: string; labelKey: string }> = {
  obst_gemuese: { icon: Apple, color: "#22c55e", labelKey: "obst_gemuese" },
  milchprodukte: { icon: Milk, color: "#3b82f6", labelKey: "milchprodukte" },
  backwaren: { icon: Croissant, color: "#f59e0b", labelKey: "backwaren" },
  fleisch: { icon: Beef, color: "#ef4444", labelKey: "fleisch" },
  getraenke: { icon: Wine, color: "#8b5cf6", labelKey: "getraenke" },
  tiefkuehl: { icon: Sparkles, color: "#06b6d4", labelKey: "tiefkuehl" },
  fruehstueck: { icon: Coffee, color: "#92400e", labelKey: "fruehstueck" },
  suessigkeiten: { icon: Candy, color: "#e11d48", labelKey: "suessigkeiten" },
  vorrat: { icon: Archive, color: "#0891b2", labelKey: "vorrat" },
  haushalt: { icon: Home, color: "#f97316", labelKey: "haushalt" },
  drogerie: { icon: Pill, color: "#ec4899", labelKey: "drogerie" },
  tierbedarf: { icon: Dog, color: "#84cc16", labelKey: "tierbedarf" },
  sonstiges: { icon: Package, color: "#6b7280", labelKey: "sonstiges" },
};

// Comprehensive German grocery keyword list for auto-detection
export const CATEGORY_KEYWORDS: Record<string, string[]> = {
  obst_gemuese: [
    // Obst / Fruits
    "apfel", "äpfel", "birne", "birnen", "banane", "bananen", "orange", "orangen", "mandarine",
    "clementine", "zitrone", "zitronen", "limette", "limetten", "grapefruit", "pomelo",
    "traube", "trauben", "weintraube", "erdbeere", "erdbeeren", "himbeere", "himbeeren",
    "blaubeere", "blaubeeren", "heidelbeere", "heidelbeeren", "brombeere", "brombeeren",
    "johannisbeere", "stachelbeere", "kirsche", "kirschen", "sauerkirsche", "süßkirsche",
    "pflaume", "pflaumen", "zwetschge", "mirabelle", "pfirsich", "pfirsiche", "nektarine",
    "aprikose", "aprikosen", "mango", "mangos", "ananas", "papaya", "passionsfrucht",
    "maracuja", "litschi", "lychee", "granatapfel", "feige", "feigen", "dattel", "datteln",
    "melone", "honigmelone", "wassermelone", "galiamelone", "cantaloup", "kiwi", "kiwis",
    "avocado", "avocados", "kokosnuss", "kokos", "physalis", "rhabarber", "quitte",
    // Gemüse / Vegetables
    "tomate", "tomaten", "kirschtomate", "cocktailtomate", "fleischtomate", "strauchtomate",
    "gurke", "gurken", "salatgurke", "einlegegurke", "paprika", "paprikas", "peperoni",
    "chili", "chilischote", "jalapeño", "zwiebel", "zwiebeln", "rote zwiebel", "frühlingszwiebel",
    "lauchzwiebel", "schalotte", "schalotten", "knoblauch", "knoblauchzehe", "bärlauch",
    "kartoffel", "kartoffeln", "süßkartoffel", "batate", "karotte", "karotten", "möhre", "möhren",
    "pastinake", "petersilienwurzel", "schwarzwurzel", "topinambur", "meerrettich",
    "salat", "kopfsalat", "eisbergsalat", "romana", "lollo rosso", "lollo bianco", "eichblatt",
    "spinat", "blattspinat", "mangold", "pak choi", "brokkoli", "brokoli", "blumenkohl",
    "romanesco", "zucchini", "zucchinis", "aubergine", "auberginen", "kürbis", "hokkaido",
    "butternut", "spaghettikürbis", "pilz", "pilze", "champignon", "champignons", "steinpilz",
    "pfifferling", "austernpilz", "shiitake", "portobello", "kräuterseitling",
    "lauch", "porree", "stangensellerie", "knollensellerie", "sellerie", "fenchel",
    "radieschen", "rettich", "kohlrabi", "mais", "maiskolben", "zuckermais",
    "erbse", "erbsen", "zuckererbse", "grüne bohne", "kidneybohne",
    "weiße bohne", "kichererbse", "kichererbsen", "linse", "linsen", "rote linsen",
    "spargel", "grüner spargel", "weißer spargel", "artischocke",
    "rote bete", "rote beete", "ingwer", "kurkuma", "galgant",
    "kohl", "rotkohl", "blaukraut", "weißkohl", "sauerkraut", "chinakohl", "grünkohl",
    "rosenkohl", "wirsing", "spitzkohl",
    "rucola", "rauke", "feldsalat", "rapunzel", "chicorée", "endivie", "radicchio",
    "kresse", "sprossen", "alfalfa", "mungobohnensprossen", "sojasprossen",
    "obst", "gemüse", "früchte", "beeren", "salate", "frischgemüse", "bio-gemüse",
    // Kräuter / Herbs
    "kräuter", "basilikum", "petersilie", "schnittlauch", "dill", "minze", "pfefferminze",
    "koriander", "thymian", "rosmarin", "oregano", "majoran", "salbei", "lorbeer",
    "estragon", "liebstöckel", "bohnenkraut", "zitronenmelisse", "zitronengras",
  ],
  milchprodukte: [
    // Milch / Milk
    "milch", "vollmilch", "fettarme milch", "magermilch", "h-milch", "frischmilch",
    "laktosefreie milch", "biomilch", "weidemilch", "heumilch", "ziegenmilch", "schafmilch",
    "hafermilch", "sojamilch", "mandelmilch", "reismilch", "kokosmilch", "cashewmilch",
    "buttermilch", "molke", "kondensmilch", "kaffeemilch", "barista",
    // Käse / Cheese
    "käse", "schnittkäse", "hartkäse", "weichkäse", "frischkäse", "streichkäse", "scheibenkäse",
    "mozzarella", "burrata", "parmesan", "parmigiano", "pecorino", "grana padano",
    "gouda", "edamer", "emmentaler", "gruyère", "appenzeller", "bergkäse", "tilsiter",
    "cheddar", "chester", "leerdammer", "maasdamer", "butterkäse",
    "brie", "camembert", "gorgonzola", "roquefort", "blauschimmel", "stilton",
    "feta", "hirtenkäse", "schafskäse", "ziegenkäse", "halloumi",
    "ricotta", "mascarpone", "hüttenkäse", "cottage cheese", "körniger frischkäse",
    "philadelphia", "buko", "boursin", "kiri", "babybel", "mini babybel",
    "raclette", "fondue", "ofenkäse", "grillkäse", "reibekäse", "pizzakäse",
    // Joghurt & Quark
    "joghurt", "naturjoghurt", "fruchtjoghurt", "griechischer joghurt", "skyr",
    "quark", "magerquark", "sahnequark", "kräuterquark", "fruchtquark", "speisequark",
    "kefir", "ayran", "lassi", "trinkjoghurt", "actimel", "yakult",
    // Sahne & Butter
    "sahne", "schlagsahne", "süße sahne", "saure sahne", "schmand", "crème fraîche",
    "kaffeesahne", "kochsahne", "sprühsahne", "schlagfix",
    "butter", "süßrahmbutter", "sauerrahmbutter", "irische butter", "kerrygold",
    "margarine", "lätta", "rama", "becel", "flora", "halbfettmargarine",
    // Eier
    "eier", "hühnerei", "bio-eier", "freilandeier", "bodenhaltung", "wachteleier",
    // Desserts
    "pudding", "vanillepudding", "schokopudding", "grießpudding", "milchreis",
    "panna cotta", "mousse", "crème brûlée", "tiramisu",
    // Marken
    "landliebe", "weihenstephan", "müller milch", "ehrmann", "danone", "activia", "almette",
  ],
  backwaren: [
    // Brot / Bread
    "brot", "weißbrot", "graubrot", "mischbrot", "vollkornbrot", "schwarzbrot", "roggenbrot",
    "dinkelbrot", "mehrkornbrot", "körnerbrot", "eiweißbrot", "toastbrot", "toast",
    "pumpernickel", "knäckebrot", "zwieback", "reiswaffel", "maiswaffel",
    "ciabatta", "focaccia", "baguette", "stangenbrot", "fladenbrot", "pita", "naan",
    "tortilla", "wrap", "wraps", "taco", "lavash",
    // Brötchen / Rolls
    "brötchen", "semmel", "schrippe", "weck", "rundstück", "kaisersemmel",
    "laugenbrötchen", "laugenstange", "brezel", "laugenbrezel", "brezen",
    "croissant", "hörnchen", "franzbrötchen", "rosinenbrötchen", "milchbrötchen",
    "vollkornbrötchen", "körnerbrötchen", "ciabattabrötchen",
    // Kuchen & Gebäck
    "kuchen", "torte", "sahnetorte", "obsttorte", "käsekuchen", "marmorkuchen",
    "apfelkuchen", "streuselkuchen", "blechkuchen", "rührkuchen", "biskuit",
    "muffin", "muffins", "cupcake", "brownie", "brownies", "donut", "donuts",
    "berliner", "krapfen", "pfannkuchen", "eierkuchen", "crêpe", "crêpes",
    "waffel", "waffeln", "belgische waffel", "lütticher waffel",
    "strudel", "apfelstrudel", "plunder", "teilchen", "nussecke", "bienenstich",
    "baklava", "zimtschnecke", "hefezopf", "brioche",
    // Kekse & Süßes
    "keks", "kekse", "plätzchen", "cookie", "cookies", "butterkeks", "vollkornkeks",
    "spekulatius", "lebkuchen", "printen", "makrone", "makronen", "florentiner",
    "waffelröllchen", "löffelbiskuit", "amaretti", "cantuccini",
    // Marken
    "harry", "golden toast", "lieken", "mestemacher", "wasa",
  ],
  fleisch: [
    // Rind / Beef
    "fleisch", "rindfleisch", "rind", "rindersteak", "rumpsteak", "ribeye", "entrecote",
    "filet", "rinderfilet", "roastbeef", "tafelspitz", "rinderbrust",
    "gulasch", "rindergulasch", "suppenfleisch", "rinderhack", "hackfleisch", "gehacktes",
    "tatar", "rindertatar", "burger patty", "frikadelle",
    // Schwein / Pork
    "schweinefleisch", "schwein", "schweinefilet", "schweinebraten", "schnitzel",
    "schweineschnitzel", "kotelett", "schweinekotelett", "kassler", "kasseler",
    "schweinebauch", "bauchfleisch", "eisbein", "haxe", "schweinehaxe",
    "schweinegulasch", "geschnetzeltes", "gyros", "schweinerücken",
    // Geflügel / Poultry
    "hähnchen", "huhn", "hühnchen", "hähnchenbrust", "hähnchenfilet", "hähnchenschenkel",
    "hähnchenflügel", "chicken wings", "chicken nuggets",
    "pute", "putenbrust", "putenfilet", "putenschnitzel", "truthahn",
    "ente", "entenbrust", "entenkeule", "gans", "gänsebrust", "gänsekeule",
    // Lamm & Wild
    "lamm", "lammfleisch", "lammkeule", "lammkotelett", "lammfilet",
    "kalb", "kalbfleisch", "kalbsschnitzel", "kalbsleber",
    "wild", "wildfleisch", "reh", "hirsch", "wildschwein", "kaninchen", "hase",
    // Wurst / Sausages
    "wurst", "würstchen", "bratwurst", "rostbratwurst", "currywurst", "bockwurst",
    "wiener", "wiener würstchen", "frankfurter", "weißwurst", "leberkäse", "fleischwurst",
    "salami", "cervelatwurst", "mettwurst", "teewurst", "leberwurst", "blutwurst",
    "mortadella", "lyoner", "jagdwurst", "bierschinken", "gelbwurst",
    "chorizo", "cabanossi", "landjäger", "knacker", "debreziner",
    // Schinken / Ham
    "schinken", "kochschinken", "hinterschinken", "vorderschinken", "lachsschinken",
    "schwarzwälder schinken", "parmaschinken", "serranoschinken", "prosciutto",
    "speck", "bacon", "frühstücksspeck", "bauchspeck", "räucherspeck", "pancetta",
    // Fisch / Fish
    "fisch", "lachs", "lachsfilet", "räucherlachs", "graved lachs", "wildlachs",
    "thunfisch", "thunfischfilet", "thunfischsteak",
    "forelle", "regenbogenforelle", "lachsforelle", "räucherforelle",
    "kabeljau", "dorsch", "seelachs", "alaska seelachs", "pangasius", "tilapia",
    "hering", "matjes", "rollmops", "brathering", "bismarckhering",
    "makrele", "räuchermakrele", "sardine", "sardinen", "sardelle", "anchovis",
    "scholle", "seezunge", "heilbutt", "rotbarsch", "zander", "barsch",
    "karpfen", "aal", "räucheraal", "wels",
    // Meeresfrüchte / Seafood
    "garnele", "garnelen", "shrimp", "shrimps", "krabben", "nordseekrabben",
    "scampi", "langustine", "hummer", "lobster", "krebs",
    "muschel", "muscheln", "miesmuschel", "jakobsmuschel", "venusmuschel",
    "tintenfisch", "calamari", "kalmar", "oktopus", "pulpo", "sepia",
    "meeresfrüchte", "frutti di mare",
    // Marken & Sonstiges
    "iglo", "costa", "frosta", "followfish", "rügenwalder", "herta", "gutfried",
  ],
  getraenke: [
    // Wasser / Water
    "wasser", "mineralwasser", "stilles wasser", "sprudelwasser", "sprudel",
    "tafelwasser", "heilwasser", "quellwasser",
    "gerolsteiner", "apollinaris", "volvic", "evian", "vittel", "san pellegrino",
    // Saft / Juice
    "saft", "fruchtsaft", "direktsaft", "nektar", "fruchtnektar", "smoothie",
    "orangensaft", "apfelsaft", "traubensaft", "multivitaminsaft", "multivitamin",
    "ananassaft", "grapefruitsaft", "tomatensaft", "karottensaft", "gemüsesaft",
    "kirschsaft", "johannisbeersaft", "cranberrysaft", "mangosaft",
    "hohes c", "granini", "valensina", "innocent", "true fruits",
    // Limonade / Soft Drinks
    "limo", "limonade", "brause", "zitronenlimonade", "orangenlimonade",
    "cola", "coca cola", "coca-cola", "pepsi", "fritz cola", "afri cola", "vita cola",
    "fanta", "sprite", "7up", "schweppes", "bitter lemon", "tonic", "ginger ale",
    "mezzo mix", "spezi", "paulaner spezi",
    "bionade", "lemonaid", "now", "proviant", "fritz limo", "vio bio",
    // Schorle
    "schorle", "apfelschorle", "rhabarberschorle", "weinschorle", "johannisbeerschorle",
    // Eistee / Ice Tea
    "eistee", "ice tea", "lipton", "fuze tea", "arizona", "nestea",
    // Energy Drinks
    "energy", "energy drink", "energydrink", "red bull", "monster", "rockstar",
    "28 black", "effect", "relentless", "burn",
    // Kaffee / Coffee
    "kaffee", "filterkaffee", "espresso", "cappuccino", "latte macchiato",
    "milchkaffee", "café au lait", "mokka", "cold brew", "eiskaffee",
    "kaffeebohnen", "kaffeepulver", "instantkaffee", "kaffeekapseln", "kaffeepads",
    "nespresso", "dolce gusto", "tassimo", "senseo",
    "jacobs", "tchibo", "dallmayr", "melitta", "lavazza", "illy", "segafredo",
    // Tee / Tea
    "tee", "schwarztee", "grüntee", "grüner tee", "weißer tee", "oolong",
    "früchtetee", "kräutertee", "pfefferminztee", "kamillentee", "fencheltee",
    "rooibos", "mate", "club mate", "chai", "chai latte",
    "teekanne", "meßmer", "twinings", "yogi tea",
    // Kakao / Cocoa
    "kakao", "trinkschokolade", "heiße schokolade", "hot chocolate",
    "nesquik", "kaba", "ovomaltine", "caotina",
    // Alkohol / Alcohol
    "bier", "pils", "pilsener", "weizen", "weißbier", "hefeweizen", "helles",
    "export", "kölsch", "alt", "schwarzbier", "bock", "doppelbock", "märzen",
    "radler", "alster", "diesel", "biermischgetränk", "alkoholfrei", "malzbier",
    "beck's", "becks", "krombacher", "bitburger", "warsteiner", "veltins", "jever",
    "paulaner", "erdinger", "franziskaner", "augustiner", "hasseröder", "radeberger",
    "wein", "rotwein", "weißwein", "rosé", "rosewein", "glühwein",
    "riesling", "chardonnay", "sauvignon blanc", "grauburgunder", "weißburgunder",
    "merlot", "cabernet", "pinot noir", "spätburgunder", "dornfelder", "primitivo",
    "prosecco", "sekt", "champagner", "cremant", "cava", "freixenet", "rotkäppchen",
    "aperitif", "aperol", "campari", "martini", "vermouth", "lillet",
    "schnaps", "korn", "wodka", "vodka", "gin", "whisky", "whiskey", "rum",
    "tequila", "mezcal", "cognac", "brandy", "weinbrand", "grappa", "obstler",
    "likör", "amaretto", "baileys", "kahlua", "cointreau", "jägermeister",
    "absolut", "smirnoff", "bacardi", "havana club", "captain morgan", "jack daniels",
    // Sonstige
    "getränk", "getränke", "drink", "drinks", "erfrischungsgetränk", "durstlöscher",
    "sirup", "holundersirup", "zitronensirup", "ahornsirup", "grenadine",
  ],
  tiefkuehl: [
    // Tiefkühlkost allgemein
    "tiefkühl", "tiefkuehl", "tk", "gefroren", "gefrorene", "frozen", "frost",
    // Pizza
    "pizza", "tiefkühlpizza", "tk-pizza", "steinofenpizza", "holzofenpizza",
    "dr. oetker", "wagner", "original wagner", "gustavo gusto",
    // Pommes & Kartoffeln
    "pommes", "pommes frites", "fritten", "wedges", "kartoffelecken", "kroketten",
    "rösti", "kartoffelpuffer", "reibekuchen", "gnocchi",
    // Fisch TK
    "fischstäbchen", "fish sticks", "backfisch", "schlemmerfilet", "tk-fisch",
    "tk-lachs", "tk-garnelen", "tk-shrimps", "tk-calamari",
    // Fleisch TK
    "tk-hähnchen", "tk-schnitzel", "tk-frikadellen", "tk-burger",
    // Gemüse TK
    "tiefkühlgemüse", "tk-gemüse", "tk-spinat", "tk-erbsen", "tk-bohnen",
    "tk-brokkoli", "tk-blumenkohl", "tk-möhren", "rahmspinat",
    "tk-kräuter", "tiefkühlkräuter", "tk-petersilie", "tk-schnittlauch",
    // Obst TK
    "tiefkühlobst", "tk-obst", "tk-beeren", "tk-himbeeren", "tk-erdbeeren",
    "tk-heidelbeeren", "gefrorene früchte", "smoothie mix",
    // Eis / Ice Cream
    "eis", "speiseeis", "eiscreme", "ice cream", "gelato",
    "vanilleeis", "schokoladeneis", "erdbeereis", "straciatella",
    "magnum", "cornetto", "solero", "nogger", "bum bum", "flutschfinger",
    "häagen-dazs", "ben & jerry", "ben and jerry", "langnese", "schöller", "mövenpick",
    "wassereis", "sorbet", "frozen yogurt", "eistorte",
    // Fertiggerichte TK
    "tiefkühlgericht", "tk-gericht", "fertiggericht",
    "lasagne", "tk-lasagne", "cannelloni", "aufläufe",
    // Backwaren TK
    "tk-brötchen", "aufbackbrötchen", "tk-baguette", "tk-croissant",
    "tk-kuchen", "tk-torte", "tk-strudel",
    // Marken
    "iglo", "frosta", "bofrost", "eismann",
  ],
  fruehstueck: [
    // Brotaufstriche / Spreads
    "nutella", "nuss-nougat", "nougatcreme", "schokocreme", "schokoaufstrich",
    "brotaufstrich", "aufstrich", "streichcreme",
    "erdnussbutter", "erdnusscreme", "mandelmus", "haselnussmus", "cashewmus", "nussmus",
    "marmelade", "konfitüre", "gelee", "erdbeermarmelade", "aprikosenmarmelade",
    "himbeermarmelade", "orangenmarmelade", "pflaumenmus", "fruchtaufstrich",
    "honig", "waldhonig", "blütenhonig", "akazienhonig", "manuka", "bienenhonig",
    "ovomaltine", "nutoka", "nusspli", "nudossi",
    // Müsli & Cerealien
    "müsli", "haferflocken", "cornflakes", "cerealien", "crunchy", "granola",
    "porridge", "overnight oats", "knuspermüsli", "früchtemüsli", "schokomüsli",
    "bircher", "birchermusli", "basismüsli", "nussmüsli", "beerenmüsli",
    "choco pops", "frosties", "cini minis", "smacks", "loops", "fruit loops",
    "kölln", "vitalis", "seitenbacher", "weetabix", "kelloggs", "nestle cereals",
  ],
  suessigkeiten: [
    // Schokolade
    "schokolade", "tafelschokolade", "vollmilchschokolade", "zartbitterschokolade",
    "weiße schokolade", "nussschokolade", "schokoladenriegel",
    "milka", "lindt", "ritter sport", "kinderschokolade", "kinder schokolade",
    "kinder bueno", "kinder riegel", "duplo", "hanuta", "knoppers", "balisto",
    "snickers", "mars", "twix", "bounty", "kitkat", "lion", "m&m", "maltesers",
    "toblerone", "merci", "ferrero rocher", "mon chéri", "raffaello", "toffifee",
    "after eight", "yogurette", "schokoriegel", "praline", "pralinen",
    // Süßigkeiten
    "gummibärchen", "haribo", "goldbären", "weingummi", "lakritz", "katjes",
    "nimm2", "maoam", "trolli", "hitschler", "fruchtgummi",
    "bonbon", "bonbons", "lutscher", "lolly", "kaubonbon", "karamell",
    "tic tac", "mentos", "vivil", "fisherman's friend", "halls",
    // Kekse & Gebäck
    "oreo", "leibniz", "prinzenrolle", "doppelkeks", "schokokeks",
    // Chips & Salziges
    "chips", "kartoffelchips", "pringles", "lorenz", "chio", "funny frisch",
    "lays", "crunchips", "stapelchips", "gemüsechips",
    "erdnüsse", "cashews", "nüsse", "studentenfutter", "mandeln gesalzen", "pistazien",
    "erdnussflips", "flips", "pombär",
    "popcorn", "nachos", "salzstangen", "cracker", "tuc", "ritz", "grissini",
    "brezeln mini", "salzbrezel",
    // Riegel
    "riegel", "müsliriegel", "proteinriegel", "energieriegel",
    "corny", "nature valley", "trek", "clif bar", "be-kind", "nakd",
  ],
  vorrat: [
    // Pasta & Nudeln
    "nudeln", "pasta", "spaghetti", "penne", "fusilli", "farfalle", "rigatoni",
    "tagliatelle", "fettuccine", "linguine", "lasagneplatten",
    "tortellini", "ravioli", "spätzle", "maultaschen",
    "eiernudeln", "vollkornnudeln", "dinkelnudeln", "glasnudeln", "reisnudeln",
    "barilla", "de cecco", "buitoni", "miracoli",
    // Reis & Getreide
    "reis", "basmati", "jasminreis", "langkornreis", "rundkornreis", "risotto",
    "wildreis", "naturreis", "vollkornreis", "parboiled",
    "couscous", "bulgur", "quinoa", "hirse", "amaranth", "buchweizen", "polenta",
    "uncle bens", "ben's original",
    // Hülsenfrüchte & Konserven
    "dose", "konserve", "dosentomaten", "tomatenmark", "passierte tomaten", "pelati",
    "kidneybohnen dose", "kichererbsen dose", "mais dose", "erbsen dose",
    "bohnen dose", "linsen dose", "champignons dose", "thunfisch dose",
    "ananas dose", "pfirsich dose", "mandarin dose", "obstkonserve",
    "sauerkraut dose", "rotkohl dose", "gurken eingelegt", "essiggurken",
    // Saucen & Dips
    "ketchup", "senf", "mayonnaise", "mayo", "remoulade",
    "bbq sauce", "barbecue", "worcester", "sojasauce", "tabasco", "sriracha",
    "tomatensoße", "bolognese", "pesto", "carbonara", "arrabiata",
    "salatdressing", "balsamico", "essig", "öl", "olivenöl", "sonnenblumenöl",
    "rapsöl", "kokosöl", "sesamöl", "kürbiskernöl", "leinöl",
    "heinz", "knorr", "maggi", "thomy", "develey", "händlmaier",
    // Gewürze & Kräuter
    "salz", "pfeffer", "zucker", "mehl", "backpulver", "hefe", "trockenhefe",
    "vanillezucker", "puderzucker", "brauner zucker", "rohrzucker",
    "paprika pulver", "curry", "zimt", "muskat", "nelken", "kardamom",
    "chilipulver", "cayenne", "kümmel", "kreuzkümmel", "koriander gemahlen",
    "oregano getrocknet", "basilikum getrocknet", "thymian getrocknet",
    "gewürzmischung", "gyrosgewürz", "grillgewürz", "bratengewürz",
    "gemüsebrühe", "hühnerbrühe", "rinderbrühe", "brühwürfel", "fond",
    "fuchs", "ostmann", "kotányi", "ankerkraut",
    // Backen
    "backmischung", "kuchenbackmischung", "browniemix", "muffinmix",
    "schokotropfen", "schokostreusel", "zuckerstreusel", "dekoration",
    "marzipan", "fondant", "lebensmittelfarbe", "vanilleextrakt",
    "tortenguss", "sahnesteif", "gelatine", "agar agar", "speisestärke",
    "mandeln gemahlen", "haselnüsse gemahlen", "kokosraspel",
    "rosinen", "sultaninen", "cranberries getrocknet",
    "dr. oetker backen", "ruf",
    // Fertiggerichte & Convenience
    "mikrowelle", "aufwärmen", "instant",
    "tütensuppe", "dosensuppe", "eintopf", "ravioli dose",
    "fix", "fix für", "knorr fix", "maggi fix",
    "pfanni", "kartoffelpüree", "kartoffelbrei",
    // Internationale Küche
    "sushi", "nori", "wasabi", "ingwer eingelegt",
    "tortilla chips", "salsa", "guacamole",
    "kokosmilch dose", "currypaste", "sambal oelek", "fischsauce",
    "tofu", "tempeh", "seitan", "fleischersatz", "veggie",
  ],
  haushalt: [
    // Reinigungsmittel
    "spülmittel", "geschirrspülmittel", "handspülmittel", "spülmaschinenreiniger",
    "klarspüler", "spülmaschinentabs", "spültabs", "geschirrspültabs",
    "waschmittel", "vollwaschmittel", "colorwaschmittel", "feinwaschmittel", "wollwaschmittel",
    "flüssigwaschmittel", "waschpulver", "waschmittelkapseln", "pods",
    "weichspüler", "wäscheduft", "hygienespüler",
    "putzmittel", "reiniger", "allzweckreiniger", "universalreiniger",
    "badreiniger", "kalkentferner", "schimmelentferner", "sanitärreiniger",
    "glasreiniger", "fensterreiniger", "spiegelreiniger",
    "küchenreiniger", "fettlöser", "backofenreiniger", "herdreiniger",
    "bodenreiniger", "laminatreiniger", "parkettreiniger", "fliesenreiniger",
    "wc-reiniger", "toilettenreiniger", "urinsteinentferner", "wc-stein", "wc-tabs",
    "rohrreiniger", "abflussreiniger", "desinfektionsmittel", "hygiene",
    "scheuermilch", "essigreiniger", "zitronenreiniger",
    "sagrotan", "domestos", "cillit bang", "bref", "viss", "meister proper",
    // Papierprodukte
    "toilettenpapier", "klopapier", "wc-papier", "küchenrolle", "küchenpapier",
    "taschentücher", "tempo", "zewa", "hakle", "charmin",
    // Müll & Aufbewahrung
    "müllbeutel", "müllsack", "mülltüte", "abfallbeutel", "biotüte",
    "gefrierbeutel", "frischhaltebeutel", "zip-beutel", "ziploc",
    "frischhaltefolie", "alufolie", "aluminiumfolie", "backpapier", "butterbrotpapier",
    // Reinigungszubehör
    "schwamm", "spülschwamm", "topfschwamm", "scheuerschwamm",
    "lappen", "putzlappen", "mikrofasertuch", "fenstertuch", "bodentuch",
    "bürste", "spülbürste", "wc-bürste", "scheuerbürste", "handfeger",
    "besen", "schrubber", "wischmop", "mopp", "wischer",
    "staubsaugerbeutel", "staubtücher", "swiffer",
    "handschuhe", "gummihandschuhe", "putzhandschuhe", "einweghandschuhe",
    // Sonstiges Haushalt
    "kerze", "kerzen", "teelichter", "duftkerze", "stumpenkerze",
    "streichhölzer", "streichholz", "feuerzeug", "anzünder",
    "batterie", "batterien", "akkus", "glühbirne", "glühlampe", "led lampe",
    "klebeband", "tesafilm", "paketband", "isolierband",
    // Marken
    "fairy", "pril", "frosch", "ecover", "sonett", "persil", "ariel", "lenor",
  ],
  drogerie: [
    // Körperpflege / Body Care
    "shampoo", "haarshampoo", "anti-schuppen", "trockenshampoo",
    "spülung", "conditioner", "haarkur", "haarmaske", "haaröl",
    "haarspray", "haargel", "haarwachs", "schaumfestiger", "hitzeschutz",
    "duschgel", "duschbad", "duschcreme", "showergel", "körperseife",
    "seife", "handseife", "flüssigseife", "kernseife", "stückseife",
    "deo", "deodorant", "antitranspirant", "deoroller", "deospray", "deostick",
    "bodylotion", "körperlotion", "körpermilch", "körperbutter", "körperöl",
    "handcreme", "fußcreme", "schrundensalbe",
    "peeling", "körperpeeling", "gesichtspeeling", "duschpeeling",
    // Gesichtspflege / Face Care
    "gesichtscreme", "tagescreme", "nachtcreme", "feuchtigkeitscreme",
    "augencreme", "anti-aging", "falten", "serum", "gesichtsserum", "hyaluron",
    "gesichtswasser", "mizellenwater", "reinigungsmilch",
    "gesichtsmaske", "tuchmaske", "peel-off", "tonerde",
    "lippenpflege", "lippenbalsam", "labello", "lipgloss",
    // Rasur / Shaving
    "rasierer", "nassrasierer", "einwegrasierer", "rasierklingen", "rasierhobel",
    "rasierschaum", "rasiergel", "rasiercreme", "rasieröl",
    "aftershave", "after shave", "rasierwasser",
    // Zahnpflege / Dental Care
    "zahnpasta", "zahncreme", "zahnpflege", "whitening", "sensitiv",
    "zahnbürste", "handzahnbürste", "elektrische zahnbürste", "aufsteckbürsten",
    "zahnseide", "dental floss", "interdentalbürsten", "munddusche",
    "mundwasser", "mundspülung",
    // Hygiene
    "wattepads", "watte", "wattestäbchen", "q-tips",
    "damenhygiene", "binde", "binden", "slipeinlagen", "tampons", "o.b.",
    "menstruationstasse", "periodenunterwäsche",
    "windel", "windeln", "pampers", "babylove", "lillydoo", "feuchttücher",
    // Gesundheit / Health
    "pflaster", "pflasterstrips", "wundpflaster", "blasenpflaster",
    "verband", "mullbinde", "kompresse", "desinfektionsspray",
    "nasenspray", "nasentropfen", "meerwasser nasenspray",
    "hustensaft", "hustenbonbons", "halstabletten",
    "schmerzmittel", "kopfschmerztabletten", "ibuprofen", "aspirin", "paracetamol",
    "magentabletten", "rennie", "maaloxan", "iberogast",
    "vitamin", "vitamine", "vitamin c", "vitamin d", "zink",
    "omega 3", "magnesium", "calcium", "eisen", "nahrungsergänzung",
    // Kosmetik / Cosmetics
    "kosmetik", "make-up", "makeup", "schminke",
    "foundation", "puder", "concealer", "rouge", "bronzer", "highlighter",
    "mascara", "wimperntusche", "eyeliner", "kajal", "augenbraue",
    "lippenstift", "lipstick", "lipliner",
    "nagellack", "nagellackentferner", "nagelpflege", "nagelfeile",
    "abschminktücher", "make-up entferner", "mizellenwasser",
    // Sonnenschutz
    "sonnencreme", "sonnenmilch", "sonnenspray", "lsf", "sonnenschutz", "after sun",
    // Marken
    "nivea", "dove", "rexona", "axe", "balea", "alverde", "lavera", "weleda",
    "l'oréal", "loreal", "garnier", "schwarzkopf", "syoss", "head & shoulders",
    "gillette", "wilkinson", "oral-b", "elmex", "meridol", "sensodyne", "colgate",
    "penaten", "bübchen", "hipp", "dm", "rossmann", "müller drogerie",
  ],
  tierbedarf: [
    // Hundefutter
    "hundefutter", "hundenahrung", "hundeleckerli", "kauknochen", "hundekuchen",
    "trockenfutter hund", "nassfutter hund", "hundefutter dose",
    "pedigree", "chappi", "rinti", "cesar", "frolic", "beneful",
    // Katzenfutter
    "katzenfutter", "katzennahrung", "katzenleckerli", "katzensnack",
    "trockenfutter katze", "nassfutter katze", "katzenfutter dose",
    "whiskas", "sheba", "felix", "gourmet", "perfect fit", "miamor",
    // Sonstiges Tierbedarf
    "tierfutter", "leckerli", "vogelfutter", "fischfutter", "hamsterfutter",
    "katzenstreu", "streu", "heu", "stroh",
  ],
  sonstiges: [
    // Baby & Kindernahrung
    "babynahrung", "babybrei", "gläschen", "milchpulver", "folgemilch",
    "kindermilch", "quetschie", "fruchtriegel kind",
    "alete", "hipp baby", "bebivita", "milupa",
    // Sonstiges
    "geschenk", "gutschein", "blumen", "zeitschrift", "zeitung",
  ],
};

/**
 * Detect category from item name using longest-match-wins strategy.
 * This prevents e.g. "Kaffeebohnen" from matching "bohne" (obst_gemuese)
 * instead of "kaffeebohnen" (getraenke).
 */
export function detectCategory(itemName: string): string {
  const nameLower = itemName.toLowerCase();

  let bestCategory = "sonstiges";
  let bestMatchLength = 0;

  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    for (const keyword of keywords) {
      if (nameLower.includes(keyword) && keyword.length > bestMatchLength) {
        bestMatchLength = keyword.length;
        bestCategory = category;
      }
    }
  }

  return bestCategory;
}

// Mapping from Bring! section names to our local category keys
export const BRING_TO_LOCAL_CATEGORY: Record<string, string> = {
  // Fresh
  "Obst & Gemüse": "obst_gemuese",
  "Milch & Käse": "milchprodukte",
  "Brot & Gebäck": "backwaren",
  "Fleisch & Fisch": "fleisch",
  "Getränke": "getraenke",
  // Frozen
  "Fertig- & Tiefkühlprodukte": "tiefkuehl",
  "Tiefkühl": "tiefkuehl",
  // Breakfast
  "Frühstück": "fruehstueck",
  "Brotaufstriche & Aufstriche": "fruehstueck",
  "Müsli & Cerealien": "fruehstueck",
  // Sweets & Snacks
  "Süßigkeiten & Snacks": "suessigkeiten",
  "Snacks & Süsswaren": "suessigkeiten",
  "Snacks": "suessigkeiten",
  "Süßwaren": "suessigkeiten",
  // Pantry
  "Zutaten & Gewürze": "vorrat",
  "Getreideprodukte": "vorrat",
  "Fertiggerichte": "vorrat",
  "Gewürze & Saucen": "vorrat",
  "Pasta & Reis": "vorrat",
  "Backen": "vorrat",
  "Öl & Essig": "vorrat",
  "Teigwaren": "vorrat",
  "Konserven": "vorrat",
  // Household & Care
  "Haushalt": "haushalt",
  "Baumarkt & Garten": "haushalt",
  "Pflege & Gesundheit": "drogerie",
  "Drogerie": "drogerie",
  "Baby": "drogerie",
  // Pets
  "Tierbedarf": "tierbedarf",
  "Haustier": "tierbedarf",
  // Coffee & Tea (Bring! sometimes uses this section)
  "Kaffee & Tee": "getraenke",
  "Kaffee": "getraenke",
  "Tee": "getraenke",
};
