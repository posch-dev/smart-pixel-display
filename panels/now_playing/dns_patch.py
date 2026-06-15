# Patches socket.getaddrinfo to use 8.8.8.8 / 1.1.1.1. Import before any HTTP calls. Affects all threads.
import socket
import struct
import random
import threading

_SERVERS = ["8.8.8.8", "1.1.1.1"]
_orig    = socket.getaddrinfo
_cache: dict[str, str] = {}
_lock    = threading.Lock()


def _skip_name(data: bytes, pos: int) -> int:
    while pos < len(data):
        n = data[pos]
        if n == 0:
            return pos + 1
        if n >= 192:      # compression pointer
            return pos + 2
        pos += n + 1
    return pos


def _query(host: str, server: str) -> str | None:
    txid  = random.randint(1, 65535)
    qname = b"".join(bytes([len(p)]) + p.encode() for p in host.split(".")) + b"\x00"
    pkt   = struct.pack(">HHHHHH", txid, 0x0100, 1, 0, 0, 0) + qname + struct.pack(">HH", 1, 1)

    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
        s.settimeout(3.0)
        s.sendto(pkt, (server, 53))
        data = s.recvfrom(512)[0]

    an_count = struct.unpack(">H", data[6:8])[0]
    if an_count == 0:
        return None

    pos = _skip_name(data, 12) + 4   # skip question name + QTYPE + QCLASS
    for _ in range(an_count):
        pos = _skip_name(data, pos)
        if pos + 10 > len(data):
            break
        rtype, _, _, rdlen = struct.unpack(">HHIH", data[pos:pos+10])
        pos += 10
        if rtype == 1 and rdlen == 4 and pos + 4 <= len(data):
            return ".".join(str(b) for b in data[pos:pos+4])
        pos += rdlen
    return None


def _resolve(host: str) -> str | None:
    for srv in _SERVERS:
        try:
            ip = _query(host, srv)
            if ip:
                return ip
        except Exception:
            pass
    return None


def _patched(host, port, *args, **kwargs):
    if isinstance(host, str) and host and not host.replace(".", "").isdigit():
        with _lock:
            cached = _cache.get(host)
        if cached is None:
            # resolve without holding the lock, threads can resolve in parallel
            ip = _resolve(host)
            if ip:
                with _lock:
                    _cache[host] = ip
                cached = ip
        if cached:
            return _orig(cached, port, *args, **kwargs)
    return _orig(host, port, *args, **kwargs)


socket.getaddrinfo = _patched
print(f"[dns] patched → {_SERVERS}")
