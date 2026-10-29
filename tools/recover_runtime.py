#!/usr/bin/env python3
"""Recover the installed Bun module graph without modifying the executable.

The manifest records the input and every recovered file. This reader handles
the Mach-O and ELF64 / 52-byte module records observed in version 0.1.71.
Unknown layouts fail before any files are written.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import struct
from pathlib import Path, PurePosixPath


TRAILER = b"\n---- Bun! ----\n"
FOOTER = struct.Struct("<QIIIIII")
MODULE = struct.Struct("<12I4B")
PREFIX = "/$bunfs/root/"


def checked_slice(data: bytes, offset: int, length: int, limit: int) -> bytes:
    if offset < 0 or length < 0 or offset + length > limit:
        raise ValueError("module pointer extends outside the graph")
    return data[offset : offset + length]


def macho_section(binary: bytes) -> bytes:
    if len(binary) < 32 or binary[:4] != b"\xcf\xfa\xed\xfe":
        raise ValueError("expected a little-endian 64-bit Mach-O executable")
    header = struct.unpack_from("<IiiIIIII", binary)
    command_count, command_bytes = header[4:6]
    if command_count > 512 or 32 + command_bytes > len(binary):
        raise ValueError("invalid Mach-O command table")
    position = 32
    section = None
    for _ in range(command_count):
        command, size = struct.unpack_from("<II", binary, position)
        if size < 8 or position + size > 32 + command_bytes:
            raise ValueError("invalid Mach-O command length")
        if command == 0x19:
            segment = struct.unpack_from("<II16sQQQQiiII", binary, position)
            count = segment[9]
            if 72 + count * 80 > size:
                raise ValueError("invalid Mach-O section table")
            for index in range(count):
                values = struct.unpack_from(
                    "<16s16sQQIIIIIIII", binary, position + 72 + index * 80
                )
                if values[0].rstrip(b"\0") == b"__bun":
                    if section is not None:
                        raise ValueError("multiple Bun sections are unsupported")
                    section = checked_slice(binary, values[4], values[3], len(binary))
        position += size
    if section is None or len(section) < 8:
        raise ValueError("Bun module section was not found")
    return section


def elf_section(binary: bytes) -> bytes:
    header_format = struct.Struct("<16sHHIQQQIHHHHHH")
    section_format = struct.Struct("<IIQQQQIIQQ")
    if len(binary) < header_format.size or binary[:6] != b"\x7fELF\x02\x01":
        raise ValueError("expected a little-endian ELF64 executable")
    header = header_format.unpack_from(binary)
    table_at, entry_size, count, names_index = header[6], header[11], header[12], header[13]
    if entry_size != section_format.size or not 0 < count <= 4096 or not 0 <= names_index < count:
        raise ValueError("unsupported ELF section table")
    table = checked_slice(binary, table_at, entry_size * count, len(binary))
    sections = [section_format.unpack_from(table, index * entry_size) for index in range(count)]
    names_row = sections[names_index]
    names = checked_slice(binary, names_row[4], names_row[5], len(binary))
    matches = []
    for row in sections:
        if row[0] >= len(names):
            raise ValueError("ELF section name is outside the string table")
        name = names[row[0]:].split(b"\0", 1)[0]
        if name == b".bun":
            matches.append(checked_slice(binary, row[4], row[5], len(binary)))
    if len(matches) != 1:
        raise ValueError("expected exactly one ELF Bun section")
    return matches[0]


def read_graph(binary: bytes) -> tuple[list[dict], int, dict]:
    if binary.startswith(b"\x7fELF"):
        section = elf_section(binary)
    else:
        section = macho_section(binary)
    if len(section) < 8:
        raise ValueError("Bun module section is truncated")
    length = struct.unpack_from("<Q", section)[0]
    raw = checked_slice(section, 8, length, len(section))
    if not raw.endswith(TRAILER):
        raise ValueError("Bun graph trailer differs from the supported format")
    footer_at = len(raw) - len(TRAILER) - FOOTER.size
    byte_count, table_at, table_length, entry, argv_at, argv_length, flags = (
        FOOTER.unpack_from(raw, footer_at)
    )
    if byte_count != footer_at or table_length % MODULE.size:
        raise ValueError("Bun graph offsets differ from the supported format")
    table = checked_slice(raw, table_at, table_length, byte_count)
    count = table_length // MODULE.size
    if not 0 <= entry < count:
        raise ValueError("entrypoint index is outside the module table")
    files = []
    seen = set()
    for index in range(count):
        record = MODULE.unpack_from(table, index * MODULE.size)
        name = checked_slice(raw, record[0], record[1], byte_count).decode("utf-8")
        if not name.startswith(PREFIX):
            raise ValueError(f"unexpected virtual path: {name!r}")
        relative = PurePosixPath(name[len(PREFIX):])
        if relative.is_absolute() or ".." in relative.parts or str(relative) in seen:
            raise ValueError("unsafe or duplicate module path")
        seen.add(str(relative))
        content = checked_slice(raw, record[2], record[3], byte_count)
        files.append({
            "index": index,
            "virtual_path": name,
            "path": str(relative),
            "content": content,
            "bytes": len(content),
            "sha256": hashlib.sha256(content).hexdigest(),
            "encoding": record[12],
            "loader": record[13],
            "format": record[14],
            "side": record[15],
            "has_sourcemap": record[5] > 0,
            "has_bytecode": record[7] > 0,
        })
    return files, entry, {
        "graph_bytes": len(raw),
        "flags": flags,
        "compile_argv_bytes": argv_length,
    }


def recover(executable: Path, destination: Path) -> dict:
    if destination.exists():
        raise ValueError("destination exists; choose a new recovery directory")
    binary = executable.read_bytes()
    files, entry, graph = read_graph(binary)
    manifest = {
        "executable": str(executable.resolve()),
        "executable_sha256": hashlib.sha256(binary).hexdigest(),
        "entrypoint": files[entry]["path"],
        **graph,
        "files": [{k: v for k, v in item.items() if k != "content"} for item in files],
    }
    destination.mkdir(parents=True)
    for item in files:
        target = destination / item["path"]
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(item["content"])
    (destination / "recovery-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("executable", type=Path)
    parser.add_argument("destination", type=Path)
    args = parser.parse_args()
    manifest = recover(args.executable, args.destination)
    print(json.dumps({
        "destination": str(args.destination.resolve()),
        "entrypoint": manifest["entrypoint"],
        "files": [{"path": f["path"], "bytes": f["bytes"]} for f in manifest["files"]],
    }, indent=2))


if __name__ == "__main__":
    main()
