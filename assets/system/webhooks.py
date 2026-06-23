import asyncio
import colorsys
import json
import re
import aiohttp
import assets.system.config as config

_TIMEOUT = aiohttp.ClientTimeout(total=8)
_VAR_RE = re.compile(r"\{\{(\w+)\}\}")
_MAX_RETRIES = 2
_RETRY_DELAY = 1.0
_session: aiohttp.ClientSession | None = None


def _get_session() -> aiohttp.ClientSession:
    global _session
    if _session is None or _session.closed:
        _session = aiohttp.ClientSession(timeout=_TIMEOUT)
    return _session


def _rgb_to_hex(r, g, b):
    return f"#{r:02x}{g:02x}{b:02x}"


def _rgb_to_hsv(r, g, b):
    h, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
    return int(round(h * 360)), int(round(s * 100)), int(round(v * 100))


def _full_brightness(r, g, b):
    h, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
    if v == 0:
        return (255, 255, 255)
    fr, fg, fb = colorsys.hsv_to_rgb(h, s, 1.0)
    return (int(round(fr * 255)), int(round(fg * 255)), int(round(fb * 255)))


def _build_context(mode: str, extra: dict | None = None) -> dict:
    ctx = {"mode": mode}
    if extra:
        ctx.update(extra)
        for i in range(1, 4):
            key = f"accent{i}"
            if key in extra and isinstance(extra[key], (list, tuple)) and len(extra[key]) == 3:
                r, g, b = extra[key]
                ctx[f"{key}_r"] = str(r)
                ctx[f"{key}_g"] = str(g)
                ctx[f"{key}_b"] = str(b)
                ctx[f"{key}_hex"] = _rgb_to_hex(r, g, b)
                ctx[f"{key}_rgb"] = f"{r},{g},{b}"
                h, s, v = _rgb_to_hsv(r, g, b)
                ctx[f"{key}_h"] = str(h)
                ctx[f"{key}_s"] = str(s)
                ctx[f"{key}_v"] = str(v)
                ctx[f"{key}_hsv"] = f"{h},{s},{v}"
                fr, fg, fb = _full_brightness(r, g, b)
                ctx[f"{key}_full_r"] = str(fr)
                ctx[f"{key}_full_g"] = str(fg)
                ctx[f"{key}_full_b"] = str(fb)
                ctx[f"{key}_full_hex"] = _rgb_to_hex(fr, fg, fb)
                ctx[f"{key}_full_rgb"] = f"{fr},{fg},{fb}"
    return {k: str(v) for k, v in ctx.items()}


def _render(template: str, ctx: dict) -> str:
    return _VAR_RE.sub(lambda m: ctx.get(m.group(1), m.group(0)), template)


def _get_hooks(section: str) -> list[dict]:
    raw = config.get(section, "webhooks", [])
    if isinstance(raw, list):
        return raw
    return []


async def _fire_one(hook: dict, ctx: dict) -> None:
    url = _render(hook.get("url", ""), ctx)
    method = hook.get("method", "GET").upper()
    headers = {}
    for k, v in (hook.get("headers") or {}).items():
        headers[k] = _render(str(v), ctx)
    body = hook.get("body")
    if body:
        body = _render(str(body), ctx)

    session = _get_session()
    kwargs = {"headers": headers}
    if body and method in ("POST", "PUT", "PATCH"):
        if "content-type" not in {k.lower() for k in headers}:
            headers["Content-Type"] = "application/json"
        kwargs["data"] = body

    for attempt in range(_MAX_RETRIES + 1):
        try:
            async with session.request(method, url, **kwargs) as resp:
                print(f"[webhook] {method} {url} -> {resp.status}")
                return
        except Exception as e:
            if attempt < _MAX_RETRIES:
                print(f"[webhook] {method} {url} failed: {e} — retry {attempt + 1}/{_MAX_RETRIES}")
                await asyncio.sleep(_RETRY_DELAY)
            else:
                print(f"[webhook] {method} {url} failed: {e} — giving up")


async def fire(section: str, trigger: str, ctx_extra: dict | None = None) -> None:
    if not config.get(section, "webhooks_enabled", False):
        return
    hooks = _get_hooks(section)
    ctx = _build_context(section, ctx_extra)
    tasks = []
    for hook in hooks:
        if hook.get("trigger") == trigger:
            tasks.append(_fire_one(hook, ctx))
    if tasks:
        await asyncio.gather(*tasks, return_exceptions=True)


async def fire_device(trigger: str) -> None:
    if not config.get("device", "webhooks_enabled", False):
        return
    hooks = _get_hooks("device")
    ctx = {"trigger": trigger}
    tasks = []
    for hook in hooks:
        if hook.get("trigger") == trigger:
            tasks.append(_fire_one(hook, ctx))
    if tasks:
        await asyncio.gather(*tasks, return_exceptions=True)
