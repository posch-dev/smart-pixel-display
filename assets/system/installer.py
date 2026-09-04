# Interactive setup. install.sh and install.ps1 build the venv and then hand over here.

import argparse
import asyncio
import getpass
import os
import re
import signal
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime

import tomlkit

import assets.system.updates as updates
from assets.system.version import VERSION

ROOT            = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
CONFIG          = os.path.join(ROOT, "config.toml")
CONFIG_TEMPLATE = os.path.join(ROOT, "config.example.toml")
ENV             = os.path.join(ROOT, ".env")
SERVICE_NAME    = "smartpixeldisplay"
UNIT_TEMPLATE   = os.path.join(ROOT, "assets", "system", f"{SERVICE_NAME}.service.template")
UNIT_TARGET     = f"/etc/systemd/system/{SERVICE_NAME}.service"
TASK_NAME       = "SmartPixelDisplay"
OLD_SERVICE     = "smartpixeldashboard"
OLD_TASK        = "SmartPixelDashboard"
SHORTCUTS_REPO  = "https://github.com/posch-dev/apple-shortcuts"
SCAN_SECONDS    = 6.0
LIKELY_NAMES    = ("LED", "BLE", "MATRIX", "PIXEL", "IPIXEL", "IDM", "IDOTMATRIX", "DIVOOM", "DOT")
LASTFM_KEYS     = ("LASTFM_API_KEY", "LASTFM_SECRET", "LASTFM_USERNAME")
LIBREFM_KEYS    = ("LIBREFM_USERNAME", "LIBREFM_PASSWORD")

GREEN, YELLOW, RED, DIM, RESET = "\033[0;32m", "\033[1;33m", "\033[0;31m", "\033[2m", "\033[0m"

IS_WINDOWS = os.name == "nt"
PYTHON     = os.path.join(ROOT, ".venv", "Scripts", "python.exe") if IS_WINDOWS \
             else os.path.join(ROOT, ".venv", "bin", "python")

_auto = False


def info(text):  print(f"{GREEN}[+]{RESET} {text}")
def warn(text):  print(f"{YELLOW}[!]{RESET} {text}")
def fail(text):  print(f"{RED}[x]{RESET} {text}"); sys.exit(1)


def _abort():
    print()
    fail("Aborted, nothing written.")


def _ask(prompt, default=None, secret=False, show_default=True):
    shown = f" [{default}]" if show_default and default not in (None, "") else ""
    if _auto:
        return default or ""
    try:
        answer = getpass.getpass(f"{prompt}{shown}: ") if secret else input(f"{prompt}{shown}: ")
    except (EOFError, KeyboardInterrupt):
        _abort()
    answer = answer.strip()
    return answer if answer else (default or "")


def _ask_yes_no(prompt, default=True):
    if _auto:
        return default
    while True:
        answer = _ask(f"{prompt} (y/n)", "y" if default else "n").lower()
        if answer in ("y", "yes", "j", "ja"):
            return True
        if answer in ("n", "no", "nein"):
            return False


def _ask_choice(prompt, choices, default):
    while True:
        answer = _ask(f"{prompt} ({' | '.join(choices)})", default).lower()
        if answer in choices:
            return answer
        if _auto:
            return default
        warn(f"Pick one of: {', '.join(choices)}")


def _ask_float(prompt, default, show_default=True):
    while True:
        answer = _ask(prompt, default, show_default=show_default)
        try:
            return float(answer)
        except ValueError:
            if _auto:
                return float(default)
            warn("That is not a number.")


def _ask_int(prompt, default):
    while True:
        answer = _ask(prompt, default)
        try:
            return int(answer)
        except ValueError:
            if _auto:
                return int(default)
            warn("That is not a number.")


def _normalize_mac(text):
    hex_only = re.sub(r"[^0-9a-fA-F]", "", text)
    if len(hex_only) != 12:
        return None
    return ":".join(hex_only[i:i + 2] for i in range(0, 12, 2)).upper()


def _scan_devices():
    try:
        from bleak import BleakScanner
        found = asyncio.run(BleakScanner.discover(timeout=SCAN_SECONDS))
    except Exception as exc:
        warn(f"Scan failed: {exc}")
        return []
    return sorted(found, key=lambda d: (d.name or "").lower())


def _looks_like_display(device):
    name = (device.name or "").upper()
    return any(word in name for word in LIKELY_NAMES)


def _print_group(label, devices, first):
    if label:
        print(f"  {label}")
    for number, device in enumerate(devices, first):
        print(f"  {number:>2}  {(device.name or 'Unknown'):<24}{device.address}")


def _list_devices(devices):
    likely = [d for d in devices if _looks_like_display(d)]
    other  = [d for d in devices if not _looks_like_display(d)]
    if not likely:
        _print_group(None, devices, 1)
        print()
        return devices
    _print_group("Most likely", likely, 1)
    if other:
        _print_group("Other devices", other, len(likely) + 1)
    print()
    return likely + other


def _pick_mac(current):
    if not _auto and _ask_yes_no("Scan for the display over Bluetooth?", True):
        info("Scanning for devices ...")
        devices = _scan_devices()
        if not devices:
            warn("No devices found.")
        ordered = _list_devices(devices) if devices else []
        while ordered:
            answer = _ask("Number of your display, manual to type the address, 0 to abort", "manual").lower()
            if answer == "0":
                _abort()
            if answer in ("manual", "type"):
                break
            if answer.isdigit() and 1 <= int(answer) <= len(ordered):
                mac = _normalize_mac(ordered[int(answer) - 1].address)
                if mac:
                    return mac
                warn("That one has no usable address, type it by hand.")
                break
            warn("Not on the list. Give a number, or manual to type the address.")
    while True:
        answer = _ask("MAC address of the display, with or without colons", current)
        mac = _normalize_mac(answer)
        if mac:
            return mac
        if _auto:
            return None
        warn("That is not a MAC address, twelve hex digits expected.")


def _read_env():
    values = {}
    if not os.path.exists(ENV):
        return values
    with open(ENV, encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def _write_env(values):
    lines = [f"{key}={value}" for key, value in values.items() if value]
    with open(ENV, "w", encoding="utf-8", newline="\n") as handle:
        handle.write("\n".join(lines) + "\n")
    if not IS_WINDOWS:
        os.chmod(ENV, 0o600)


class Skipped(Exception):
    pass


def _ask_env(env, key, prompt, secret=False, optional=False):
    current = env.get(key, "")
    if secret:
        shown = "(set, enter keeps it)" if current else None
        answer = _ask(prompt, shown, secret=True)
        answer = current if answer in ("", shown) else answer
    else:
        answer = _ask(prompt, current)
    if answer.lower() == "skip" and not optional:
        raise Skipped()
    return answer


def _has_keys(env, keys):
    return any(env.get(key) for key in keys)


def _detect_scrobbler(env):
    has_lastfm  = _has_keys(env, LASTFM_KEYS)
    has_librefm = _has_keys(env, LIBREFM_KEYS)
    if has_lastfm == has_librefm:
        return None
    return "lastfm" if has_lastfm else "librefm"


def _ask_nowplaying(env, doc):
    detected = _detect_scrobbler(env)
    if detected:
        label = "last.fm" if detected == "lastfm" else "libre.fm"
        info(f"Keys in .env detected for {label}")
        info(f"{label} selected as scrobbling source")
        for key in (LASTFM_KEYS if detected == "lastfm" else LIBREFM_KEYS):
            if not env.get(key):
                warn(f"Missing {key}, please enter it below")
        scrobbler = detected
    else:
        scrobbler = _ask_choice("Scrobbler", ["lastfm", "librefm"], doc["nowplaying"]["scrobbler"])
    print(f"{DIM}  Type skip at any of these to leave now playing off and move on.{RESET}")
    wanted = {}
    if scrobbler == "lastfm":
        # where to get them only helps as long as there are none
        if not _has_keys(env, LASTFM_KEYS):
            print(f"{DIM}  Create the keys first at https://www.last.fm/api/account/create{RESET}")
        wanted["LASTFM_API_KEY"]  = _ask_env(env, "LASTFM_API_KEY", "last.fm API key")
        wanted["LASTFM_SECRET"]   = _ask_env(env, "LASTFM_SECRET", "last.fm shared secret")
        wanted["LASTFM_USERNAME"] = _ask_env(env, "LASTFM_USERNAME", "last.fm username")
    else:
        wanted["LIBREFM_USERNAME"] = _ask_env(env, "LIBREFM_USERNAME", "libre.fm username")
        wanted["LIBREFM_PASSWORD"] = _ask_env(env, "LIBREFM_PASSWORD", "libre.fm password", secret=True)
    if not env.get("GETSONGBPM_API_KEY"):
        print(f"{DIM}  Optional, the bpm readout stays empty without it.{RESET}")
        print(f"{DIM}  Key from https://getsongbpm.com/api{RESET}")
    wanted["GETSONGBPM_API_KEY"] = _ask_env(env, "GETSONGBPM_API_KEY", "getsongbpm API key", optional=True)
    doc["nowplaying"]["scrobbler"] = scrobbler
    return wanted, all(wanted[key] for key in wanted if key != "GETSONGBPM_API_KEY")


def _ask_dashboard(doc):
    print(f"{DIM}  Calendar events arrive from an iPhone shortcut posting to /calendar.{RESET}")
    print(f"{DIM}  Ready made shortcuts: {SHORTCUTS_REPO}{RESET}")
    weather = doc["dashboard"]["weather"]
    weather["provider"] = _ask_choice("Weather provider", ["openmeteo", "wttr", "nws"], weather["provider"])
    weather["units"]    = _ask_choice("Units", ["metric", "imperial"], weather["units"])
    if weather["provider"] == "wttr":
        location = _ask("City name, empty to use coordinates", weather.get("location", ""))
        if location:
            weather["location"] = location
    # the template ships Point Nemo, showing that as the default helps nobody
    untouched = weather["lat"] == _load_template()["dashboard"]["weather"]["lat"]
    print(f"{DIM}  Coordinates of the place the weather is for, in decimal degrees.{RESET}")
    weather["lat"] = _ask_float("Latitude", weather["lat"], show_default=not untouched)
    weather["lon"] = _ask_float("Longitude", weather["lon"], show_default=not untouched)


def _local_time():
    # the panel follows the clock of this machine, so show what that is
    now = datetime.now().astimezone()
    return f"{now:%Y-%m-%d %H:%M} (UTC{now:%z})"


def _lan_ip():
    probe = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        probe.connect(("8.8.8.8", 80))
        return probe.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        probe.close()


def _is_admin():
    if not IS_WINDOWS:
        return os.geteuid() == 0
    import ctypes
    try:
        return bool(ctypes.windll.shell32.IsUserAnAdmin())
    except Exception:
        return False


def _run(command, check=True):
    result = subprocess.run(command, cwd=ROOT, capture_output=True, text=True)
    if check and result.returncode != 0:
        output = (result.stderr or result.stdout).strip()
        warn(output.splitlines()[-1] if output else f"{command[0]} failed")
    return result.returncode == 0


def _drop_old_unit():
    old_target = f"/etc/systemd/system/{OLD_SERVICE}.service"
    if not os.path.exists(old_target):
        return
    prefix = [] if _is_admin() else ["sudo"]
    _run(prefix + ["systemctl", "disable", "--now", OLD_SERVICE], check=False)
    _run(prefix + ["rm", "-f", old_target], check=False)
    info(f"Removed the old {OLD_SERVICE} unit.")


def _install_unit():
    _drop_old_unit()
    user = os.environ.get("SUDO_USER") or os.environ.get("USER") or "pi"
    with open(UNIT_TEMPLATE, encoding="utf-8") as handle:
        unit = handle.read().replace("__USER__", user).replace("__WORKDIR__", ROOT)
    if _is_admin():
        with open(UNIT_TARGET, "w", encoding="utf-8") as handle:
            handle.write(unit)
    else:
        written = subprocess.run(["sudo", "tee", UNIT_TARGET], input=unit, text=True, capture_output=True)
        if written.returncode != 0:
            warn("No root and sudo failed, autostart skipped.")
            return False
    prefix = [] if _is_admin() else ["sudo"]
    return _run(prefix + ["systemctl", "daemon-reload"]) and _run(prefix + ["systemctl", "enable", SERVICE_NAME])


def _install_task():
    _run(["schtasks", "/delete", "/f", "/tn", OLD_TASK], check=False)
    trigger = "onstart" if _is_admin() else "onlogon"
    command = f'"{PYTHON}" "{os.path.join(ROOT, "startup.py")}"'
    created = _run(["schtasks", "/create", "/f", "/tn", TASK_NAME, "/sc", trigger, "/tr", command])
    if created:
        info(f"Task scheduler entry {TASK_NAME} created, trigger {trigger}.")
    return created


def _service_installed():
    if IS_WINDOWS:
        return _run(["schtasks", "/query", "/tn", TASK_NAME], check=False)
    return os.path.exists(UNIT_TARGET)


def _start(port):
    if not IS_WINDOWS and _service_installed():
        prefix = [] if _is_admin() else ["sudo"]
        _run(prefix + ["systemctl", "restart", SERVICE_NAME])
    else:
        creation = subprocess.CREATE_NEW_PROCESS_GROUP if IS_WINDOWS else 0
        subprocess.Popen([PYTHON, os.path.join(ROOT, "startup.py")], cwd=ROOT,
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                         creationflags=creation, start_new_session=not IS_WINDOWS)
    return _wait_for_api(port)


def _wait_for_api(port, seconds=30):
    deadline = time.time() + seconds
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{port}/version", timeout=2):
                return True
        except Exception:
            time.sleep(1)
    return False


def _start_commands():
    if IS_WINDOWS:
        return (f'  "%USERPROFILE%\\smart-pixel-display\\.venv\\Scripts\\python.exe" '
                f'"%USERPROFILE%\\smart-pixel-display\\startup.py"',
                r"  .\.venv\Scripts\python.exe startup.py")
    return ("  ~/smart-pixel-display/.venv/bin/python ~/smart-pixel-display/startup.py",
            "  ./.venv/bin/python startup.py")


def _print_done(port, running, autostart):
    from_home, from_repo = _start_commands()
    starter = "install.ps1" if IS_WINDOWS else "./install.sh"
    print()
    if running:
        info("Running.")
    else:
        warn("The service did not answer yet, check the log below.")
    print()
    print(f"  Web UI:   http://{_lan_ip()}:{port}")
    print(f"            http://{socket.gethostname()}:{port}")
    print()
    if autostart and not IS_WINDOWS:
        print(f"  Stop:     sudo systemctl stop {SERVICE_NAME}")
        print(f"  Start:    sudo systemctl start {SERVICE_NAME}")
        print(f"  Log:      journalctl -u {SERVICE_NAME} -f")
    elif autostart:
        print(f"  Stop:     schtasks /end /tn {TASK_NAME}")
        print(f"  Start:    schtasks /run /tn {TASK_NAME}")
    else:
        print("  Stop:     ctrl-c in the window it runs in")
        print("  Start, from your home directory:")
        print(from_home)
        print("  Start, from the repo directory:")
        print(from_repo)
    print()
    print(f"  Update:        {starter} --update")
    print(f"  Check for one: {starter} --check-update")
    print()


def _check_update(quiet=False):
    try:
        tag, url = updates.fetch_latest()
    except (urllib.error.URLError, TimeoutError, OSError, ValueError) as exc:
        if not quiet:
            warn(f"Could not reach GitHub: {exc}")
        return None
    if updates.is_newer(tag):
        info(f"Version {tag} is out, you are on {VERSION}.")
        print(f"  {url}")
        return tag
    if not quiet:
        info(f"Up to date, {VERSION} is the latest.")
    return None


def _update():
    tag = _check_update()
    if not tag:
        return 0
    starter = os.path.join(ROOT, "install.ps1" if IS_WINDOWS else "install.sh")
    if not _run(["git", "fetch", "--tags", "--quiet"]) or not _run(["git", "checkout", "--quiet", tag]):
        fail("Checkout failed, the working tree is probably not clean.")
    info(f"On {tag}, reinstalling ...")
    flags   = ["--yes", "--no-autostart", "--no-start"]
    command = ["powershell", "-File", starter] + flags if IS_WINDOWS else ["bash", starter] + flags
    if not _run(command):
        fail("The reinstall failed, the code is on the new tag but the service was not restarted.")
    return _restart_service()


def _restart_service():
    running = os.environ.get("SPD_RESTART_PID")
    if running and not IS_WINDOWS:
        info("Handing the running service a term, systemd brings it back.")
        os.kill(int(running), signal.SIGTERM)
        return 0
    if not IS_WINDOWS and _service_installed():
        prefix = [] if _is_admin() else ["sudo"]
        _run(prefix + ["systemctl", "restart", SERVICE_NAME])
        return 0
    warn("Start the service yourself, the code is updated.")
    return 0


def _load_template():
    with open(CONFIG_TEMPLATE, encoding="utf-8") as handle:
        return tomlkit.load(handle)


def _flat_keys(node, prefix=""):
    flat = {}
    for key, value in node.items():
        path = prefix + key
        if hasattr(value, "items"):
            flat.update(_flat_keys(value, path + "."))
        else:
            flat[path] = value
    return flat


def _optional_keys():
    # optional settings sit in the template as a commented example, they are known but not missing
    optional = set()
    section  = ""
    with open(CONFIG_TEMPLATE, encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if line.startswith("["):
                section = line.strip("[]").strip()
            commented = re.match(r"#\s*([A-Za-z0-9_]+)\s*=", line)
            if commented:
                optional.add(f"{section}.{commented.group(1)}")
    return optional


def _salvage_config(path):
    # the file as a whole does not parse any more, most single lines still do
    found   = {}
    section = ""
    with open(path, encoding="utf-8", errors="replace") as handle:
        for line in handle:
            line = line.strip()
            if line.startswith("["):
                section = line.strip("[]").strip()
                continue
            if not line or line.startswith("#") or "=" not in line:
                continue
            try:
                parsed = tomlkit.parse(line)
            except Exception:
                continue
            for key, value in parsed.items():
                found[f"{section}.{key}" if section else key] = value
    return found


def _restore(doc, values):
    for path, value in values.items():
        parts = path.split(".")
        node  = doc
        for part in parts[:-1]:
            if part not in node:
                node[part] = tomlkit.table()
            node = node[part]
        node[parts[-1]] = value
    return len(values)


def _offer_salvage():
    found = _salvage_config(CONFIG)
    if not found:
        warn("Nothing readable in it, starting from the template.")
        return None
    print()
    print(f"  {len(found)} settings survived:")
    for path, value in found.items():
        print(f"    {path}={value}")
    print()
    if not _ask_yes_no("Keep these settings?", True):
        return None
    return found


def _check_drift(doc):
    template = _flat_keys(_load_template())
    have     = set(_flat_keys(doc))
    for path in sorted(have - set(template) - _optional_keys()):
        warn(f"{path} is not in the template, left as it is.")
    missing = sorted(set(template) - have)
    if not missing:
        return
    warn(f"config.toml is missing {len(missing)} settings from the template:")
    for path in missing:
        print(f"    {path}")
    if not _ask_yes_no("Add them with their default values?", True):
        return
    added = _restore(doc, {path: template[path] for path in missing})
    with open(CONFIG, "w", encoding="utf-8", newline="\n") as handle:
        tomlkit.dump(doc, handle)
    info(f"Added {added} settings to config.toml.")


def _install(args):
    doc          = None
    env          = _read_env()
    env_wanted   = {}
    env_existed  = os.path.exists(ENV)
    have_config  = os.path.exists(CONFIG)
    port         = 12832
    mac          = None
    panels       = {}
    salvaged     = None
    current      = None

    if have_config:
        try:
            with open(CONFIG, encoding="utf-8") as handle:
                current = tomlkit.load(handle)
        except Exception as exc:
            warn(f"config.toml is broken: {exc}")
            salvaged    = _offer_salvage()
            have_config = False

    if have_config and not args.reconfigure:
        info("config.toml is already there, left untouched. Use --reconfigure to change it.")
        port = current.get("expert", {}).get("port", port)
        _check_drift(current)
    else:
        doc = current if have_config else _load_template()
        if salvaged:
            info(f"Restored {_restore(doc, salvaged)} settings into a fresh config.")

        print()
        mac = _pick_mac(_normalize_mac(doc["device"]["mac_address"]))
        if mac:
            doc["device"]["mac_address"] = mac
        port = _ask_int("Port for the web ui and the api", doc["expert"]["port"])
        doc["expert"]["port"] = port

        print()
        for section, label in (("clock", "clock"), ("verse_of_day", "verse of the day")):
            panels[section] = _ask_yes_no(f"Enable the {label} panel?", bool(doc[section]["enabled"]))
            doc[section]["enabled"] = panels[section]

        panels["nowplaying"] = _ask_yes_no("Enable the now playing panel?", True)
        if panels["nowplaying"]:
            try:
                env_wanted, complete = _ask_nowplaying(env, doc)
            except Skipped:
                env_wanted, complete = {}, False
            if not complete:
                panels["nowplaying"] = False
                warn("No credentials, now playing stays off. Run the installer with --reconfigure to add them.")
        doc["nowplaying"]["enabled"] = panels["nowplaying"]

        panels["dashboard"] = _ask_yes_no("Enable the dashboard panel?", bool(doc["dashboard"]["enabled"]))
        doc["dashboard"]["enabled"] = panels["dashboard"]
        if panels["dashboard"]:
            _ask_dashboard(doc)

    print()
    if args.autostart:
        autostart = True
    elif args.no_autostart:
        autostart = False
    else:
        autostart = _ask_yes_no("Start on boot?", True)

    env_new     = dict(env)
    env_new.update({key: value for key, value in env_wanted.items() if value})
    env_changed = env_new != env

    print()
    print("  Summary")
    if doc is not None:
        print(f"    display     {mac or 'not set'}")
        print(f"    port        {port}")
        print(f"    time        {_local_time()}")
        for section, enabled in panels.items():
            print(f"    {section:<14}{'on' if enabled else 'off'}")
        print(f"    config      {CONFIG}")
        if env_changed:
            print(f"    secrets     {ENV}")
    print(f"    autostart   {'yes' if autostart else 'no'}")
    print()
    if not _ask_yes_no("Write this?", True):
        _abort()

    if doc is not None:
        with open(CONFIG, "w", encoding="utf-8", newline="\n") as handle:
            tomlkit.dump(doc, handle)
        info(f"Wrote {os.path.basename(CONFIG)}.")
    if env_changed:
        _write_env(env_new)
        info(f"{'Updated' if env_existed else 'Wrote'} .env.")

    if autostart:
        autostart = _install_task() if IS_WINDOWS else _install_unit()

    if doc is not None and not mac:
        warn("No MAC address, the display cannot be reached. Set device.mac_address in config.toml.")
        return 1

    if args.no_start:
        return 0
    running = _start(port)
    _print_done(port, running, autostart)
    return 0 if running else 1


def main():
    parser = argparse.ArgumentParser(prog="install", description="smart pixel display setup")
    parser.add_argument("--yes", "-y", action="store_true", help="take every default, ask nothing")
    parser.add_argument("--autostart", action="store_true", help="set up autostart without asking")
    parser.add_argument("--no-autostart", action="store_true", help="skip autostart")
    parser.add_argument("--reconfigure", action="store_true", help="ask again even though config.toml exists")
    parser.add_argument("--update", action="store_true", help="pull the latest release and restart")
    parser.add_argument("--check-update", action="store_true", help="ask github whether a newer release is out")
    parser.add_argument("--no-start", action="store_true", help="do not start the service at the end")
    parser.add_argument("--fresh", action="store_true", help="handled by the starter, rebuilds the venv")
    args = parser.parse_args()

    global _auto
    _auto = args.yes or not sys.stdin.isatty()
    if _auto and not (args.update or args.check_update):
        info("Non interactive, taking every default.")

    if args.check_update:
        _check_update()
        return 0
    if args.update:
        return _update()
    if not os.path.exists(CONFIG_TEMPLATE):
        fail(f"Config template missing at {CONFIG_TEMPLATE}")
    return _install(args)


if __name__ == "__main__":
    sys.exit(main())
