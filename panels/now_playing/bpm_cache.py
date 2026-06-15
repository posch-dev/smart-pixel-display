# BPM lookup backed by SQLite, falling back through GetSongBPM then genre estimate.

import os
import sqlite3
import requests
from dotenv import load_dotenv

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), "..", ".env"))

_DB_PATH        = os.path.join(os.path.dirname(__file__), "bpm_cache.db")
_GETSONGBPM_KEY = os.getenv("GETSONGBPM_API_KEY")

# Genre → typical BPM estimate
_GENRE_BPM: list[tuple[list[str], int]] = [
    (["hardstyle", "hardcore", "happy hardcore"],         160),
    (["drum and bass", "dnb", "jungle"],                  174),
    (["trance", "psytrance", "goa"],                      138),
    (["techno"],                                          133),
    (["house", "electro house", "deep house", "edm"],    128),
    (["dance", "eurodance", "disco"],                     124),
    (["pop", "electropop", "dance-pop", "synthpop"],      120),
    (["schlager", "austropop", "volksmucik"],              120),
    (["rock", "indie", "alternative"],                    120),
    (["metal", "heavy metal"],                            160),
    (["trap", "hip-hop", "hip hop", "rap"],                90),
    (["r&b", "rnb", "soul", "funk"],                       95),
    (["reggaeton", "latin"],                               95),
    (["jazz", "swing", "blues"],                           90),
    (["country"],                                         100),
    (["classical", "ambient", "acoustic"],                 80),
]


def _genre_bpm(genres: list[str]) -> int | None:
    if not genres:
        return None
    gl = [g.lower() for g in genres]
    for keywords, bpm in _GENRE_BPM:
        if any(any(kw in g for kw in keywords) for g in gl):
            return bpm
    return None


def _db() -> sqlite3.Connection:
    con = sqlite3.connect(_DB_PATH)
    con.execute("""
        CREATE TABLE IF NOT EXISTS bpm (
            artist       TEXT NOT NULL,
            title        TEXT NOT NULL,
            bpm          INTEGER,
            danceability INTEGER,
            acousticness INTEGER,
            PRIMARY KEY (artist, title)
        )
    """)
    con.commit()
    return con


def _normalize(s: str) -> str:
    return s.strip().lower()


def _getsongbpm_lookup(title: str, artist: str) -> dict | None:
    if not _GETSONGBPM_KEY:
        return None
    try:
        r = requests.get("https://api.getsong.co/search/", params={
            "api_key": _GETSONGBPM_KEY,
            "type":    "both",
            "lookup":  f"song:{title} artist:{artist}",
        }, timeout=10)
        r.raise_for_status()
        results = r.json().get("search", [])
        if not results or not isinstance(results, list):
            return {}
        al   = artist.lower()
        item = next(
            (i for i in results if al in i.get("artist", {}).get("name", "").lower()),
            results[0],
        )
        return {
            "bpm":          int(item["tempo"])        if item.get("tempo")        else None,
            "danceability": int(item["danceability"]) if item.get("danceability") else None,
            "acousticness": int(item["acousticness"]) if item.get("acousticness") else None,
        }
    except Exception as e:
        print(f"[bpm] getsongbpm error: {e}")
        return None


def get_track_data(title: str, artist: str, genres: list[str] | None = None) -> dict:
    # Return {bpm, danceability, acousticness}. Cache-first, then GetSongBPM, then genre estimate.
    key_artist = _normalize(artist)
    key_title  = _normalize(title)

    with _db() as con:
        row = con.execute(
            "SELECT bpm, danceability, acousticness FROM bpm WHERE artist=? AND title=?",
            (key_artist, key_title),
        ).fetchone()

    if row is not None and any(v is not None for v in row):
        return {"bpm": row[0], "danceability": row[1], "acousticness": row[2]}

    data = _getsongbpm_lookup(title, artist)

    if not data or not data.get("bpm"):
        est = _genre_bpm(genres or [])
        if est:
            return {"bpm": est, "danceability": None, "acousticness": None}
        return data or {}

    with _db() as con:
        con.execute(
            "INSERT OR REPLACE INTO bpm (artist, title, bpm, danceability, acousticness) VALUES (?, ?, ?, ?, ?)",
            (key_artist, key_title, data.get("bpm"), data.get("danceability"), data.get("acousticness")),
        )
        con.commit()
    return data
