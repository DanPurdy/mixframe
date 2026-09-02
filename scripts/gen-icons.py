#!/usr/bin/env python3
"""Generate vinyl-record icons: 'live' (green label) and 'idle' (greyed), sizes 16/48/128."""
import math
import struct
import zlib
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / 'public' / 'icons'
OUT.mkdir(parents=True, exist_ok=True)


def render(size: int, live: bool) -> bytes:
    ss = 4  # supersample for smooth edges
    S = size * ss
    c = (S - 1) / 2
    disc_r = S * 0.48
    label_r = S * 0.19
    hole_r = S * 0.045

    if live:
        vinyl = (24, 24, 26)
        label = (29, 185, 84)
        groove = (58, 58, 62)
    else:
        vinyl = (150, 150, 152)
        label = (190, 190, 192)
        groove = (168, 168, 170)

    big = []
    for y in range(S):
        row = []
        for x in range(S):
            d = math.hypot(x - c, y - c)
            if d > disc_r:
                row.append((0, 0, 0, 0))
            elif d < hole_r:
                row.append((0, 0, 0, 0))
            elif d < label_r:
                row.append((*label, 255))
            else:
                # groove rings every ~6% of radius
                ring = (d - label_r) / (disc_r - label_r)
                col = groove if int(ring * 14) % 2 == 0 else vinyl
                row.append((*col, 255))
        big.append(row)

    # box-filter downsample
    px = bytearray()
    for y in range(size):
        px += b'\x00'
        for x in range(size):
            r = g = b = a = 0
            for dy in range(ss):
                for dx in range(ss):
                    pr, pg, pb, pa = big[y * ss + dy][x * ss + dx]
                    r += pr * pa
                    g += pg * pa
                    b += pb * pa
                    a += pa
            n = ss * ss
            if a == 0:
                px += bytes((0, 0, 0, 0))
            else:
                px += bytes((r // a, g // a, b // a, a // n))
    return bytes(px)


def png(size: int, raw: bytes) -> bytes:
    def chunk(t, d):
        c = t + d
        return struct.pack('>I', len(d)) + c + struct.pack('>I', zlib.crc32(c))

    return (
        b'\x89PNG\r\n\x1a\n'
        + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0))
        + chunk(b'IDAT', zlib.compress(raw))
        + chunk(b'IEND', b'')
    )


for state, live in (('live', True), ('idle', False)):
    for size in (16, 48, 128):
        (OUT / f'record-{state}-{size}.png').write_bytes(png(size, render(size, live)))
        print(f'record-{state}-{size}.png')
