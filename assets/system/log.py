import os
from datetime import datetime

_PRIORITY = {"error": 3, "warn": 4, "info": 6, "debug": 7}

_under_journal  = "JOURNAL_STREAM" in os.environ
_debug_enabled  = os.environ.get("SPD_DEBUG", "") not in ("", "0", "false", "no")


def _emit(level: str, tag: str, message: str) -> None:
    # systemd reads a <N> line prefix as syslog priority and stamps the line itself
    head = f"<{_PRIORITY[level]}>" if _under_journal else f"{datetime.now():%H:%M:%S.%f}"[:-3] + " "
    print(f"{head}[{tag}] {message}", flush=True)


def set_debug(on: bool) -> None:
    global _debug_enabled
    _debug_enabled = bool(on)


def info(tag: str, message: str) -> None:
    _emit("info", tag, message)


def warn(tag: str, message: str) -> None:
    _emit("warn", tag, message)


def error(tag: str, message: str) -> None:
    _emit("error", tag, message)


def debug(tag: str, message: str) -> None:
    if _debug_enabled:
        _emit("debug", tag, message)
