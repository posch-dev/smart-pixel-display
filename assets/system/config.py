# Central config, reads and writes config.toml while preserving comments.

import os
import tomlkit
from PIL import Image

_CONFIG_PATH = os.path.join(os.path.dirname(__file__), "..", "config.toml")
_doc: tomlkit.TOMLDocument | None = None


def load() -> tomlkit.TOMLDocument:
    global _doc
    with open(_CONFIG_PATH, encoding="utf-8") as f:
        _doc = tomlkit.load(f)
    return _doc


def _save() -> None:
    with open(_CONFIG_PATH, "w", encoding="utf-8") as f:
        tomlkit.dump(_doc, f)


def _ensure() -> tomlkit.TOMLDocument:
    if _doc is None:
        load()
    return _doc


def get(section: str, key: str, default=None):
    doc = _ensure()
    return doc.get(section, {}).get(key, default)


def get_section(section: str) -> dict:
    doc = _ensure()
    return dict(doc.get(section, {}))


def set(section: str, key: str, value) -> None:
    doc = _ensure()
    if section not in doc:
        doc[section] = tomlkit.table()
    if value is None:
        doc[section].pop(key, None)
    else:
        doc[section][key] = value
    _save()


def all() -> dict:
    return dict(_ensure())


def apply_orientation(img: Image.Image) -> Image.Image:
    if get("device", "flip_vertical"):
        img = img.transpose(Image.FLIP_TOP_BOTTOM)
    if get("device", "flip_horizontal"):
        img = img.transpose(Image.FLIP_LEFT_RIGHT)
    return img
