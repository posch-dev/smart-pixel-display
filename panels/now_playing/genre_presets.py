PRESETS: dict[str, dict] = {
    "hip_hop": {
        "bass_mult":  1.7,
        "mids_mult":  0.5,
        "highs_mult": 0.65,
    },
    "trap": {
        "bass_mult":  1.8,
        "mids_mult":  0.3,
        "highs_mult": 1.2,
    },
    "electronic": {
        "bass_mult":  1.4,
        "mids_mult":  0.8,
        "highs_mult": 1.3,
    },
    "ambient": {
        "bass_mult":  0.5,
        "mids_mult":  1.1,
        "highs_mult": 0.95,
    },
    "rock": {
        "bass_mult":  1.0,
        "mids_mult":  1.2,
        "highs_mult": 1.05,
    },
    "metal": {
        "bass_mult":  1.2,
        "mids_mult":  1.3,
        "highs_mult": 1.1,
    },
    "pop": {
        "bass_mult":  1.1,
        "mids_mult":  0.9,
        "highs_mult": 1.15,
    },
    "r_and_b": {
        "bass_mult":  1.5,
        "mids_mult":  0.9,
        "highs_mult": 0.75,
    },
    "jazz": {
        "bass_mult":  0.6,
        "mids_mult":  1.3,
        "highs_mult": 1.2,
    },
    "classical": {
        "bass_mult":  0.3,
        "mids_mult":  1.0,
        "highs_mult": 1.5,
    },
    "reggae": {
        "bass_mult":  1.9,
        "mids_mult":  0.4,
        "highs_mult": 0.55,
    },
    "latin": {
        "bass_mult":  1.2,
        "mids_mult":  1.0,
        "highs_mult": 1.05,
    },
    "country": {
        "bass_mult":  0.6,
        "mids_mult":  1.0,
        "highs_mult": 1.3,
    },
    "folk": {
        "bass_mult":  0.4,
        "mids_mult":  1.0,
        "highs_mult": 1.2,
    },
    "soul": {
        "bass_mult":  1.2,
        "mids_mult":  1.1,
        "highs_mult": 0.8,
    },
    "blues": {
        "bass_mult":  0.9,
        "mids_mult":  1.4,
        "highs_mult": 1.0,
    },
    "lo_fi": {
        "bass_mult":  0.9,
        "mids_mult":  1.3,
        "highs_mult": 0.55,
    },
    "default": {
        "bass_mult":  1.0,
        "mids_mult":  1.0,
        "highs_mult": 1.1,
    },
}


GENRE_MAP: list[tuple[str, str]] = [
    ("trap",       "trap"),
    ("drill",      "trap"),

    ("hip hop",    "hip_hop"),
    ("hip-hop",    "hip_hop"),
    ("rap",        "hip_hop"),
    ("grime",      "hip_hop"),
    ("boom bap",   "hip_hop"),

    ("electronic", "electronic"),
    ("edm",        "electronic"),
    ("house",      "electronic"),
    ("techno",     "electronic"),
    ("trance",     "electronic"),
    ("dubstep",    "electronic"),
    ("drum and bass", "electronic"),
    ("dnb",        "electronic"),
    ("synthwave",  "electronic"),
    ("electro",    "electronic"),

    ("ambient",    "ambient"),
    ("chillout",   "ambient"),
    ("downtempo",  "ambient"),

    ("rock",       "rock"),
    ("punk",       "rock"),
    ("grunge",     "rock"),
    ("indie",      "rock"),
    ("alternative","rock"),
    ("emo",        "rock"),
    ("hardcore",   "rock"),

    ("metal",      "metal"),
    ("death",      "metal"),
    ("black metal","metal"),

    ("pop",        "pop"),
    ("k-pop",      "pop"),
    ("j-pop",      "pop"),
    ("dance pop",  "pop"),

    ("r&b",        "r_and_b"),
    ("rnb",        "r_and_b"),
    ("neo soul",   "r_and_b"),
    ("funk",       "r_and_b"),

    ("soul",       "soul"),
    ("gospel",     "soul"),

    ("blues",      "blues"),

    ("jazz",       "jazz"),
    ("bebop",      "jazz"),
    ("swing",      "jazz"),
    ("fusion",     "jazz"),

    ("classical",  "classical"),
    ("orchestra",  "classical"),
    ("chamber",    "classical"),
    ("opera",      "classical"),
    ("baroque",    "classical"),

    ("reggae",     "reggae"),
    ("dub",        "reggae"),
    ("dancehall",  "reggae"),
    ("ska",        "reggae"),

    ("latin",      "latin"),
    ("salsa",      "latin"),
    ("bachata",    "latin"),
    ("reggaeton",  "latin"),
    ("cumbia",     "latin"),
    ("bossa nova", "latin"),

    ("country",    "country"),
    ("bluegrass",  "country"),

    ("folk",       "folk"),
    ("acoustic",   "folk"),
    ("singer-songwriter", "folk"),

    ("lo-fi",      "lo_fi"),
    ("lofi",       "lo_fi"),
    ("lo fi",      "lo_fi"),
    ("chillhop",   "lo_fi"),
]


def get_preset(genres: list[str]) -> dict:
    for genre_str in genres:
        g = genre_str.lower()
        for keyword, preset_key in GENRE_MAP:
            if keyword in g:
                return PRESETS[preset_key]
    return PRESETS["default"]
