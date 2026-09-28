"""Reading .safetensors files (the format Model2Vec models ship in) with numpy.

The format is an 8-byte little-endian header length, a JSON header naming each
tensor's dtype, shape and byte range, then the raw data.
"""

from __future__ import annotations

import json
import struct
from pathlib import Path

import numpy as np

_DTYPES = {"F32": np.float32, "F16": np.float16, "F64": np.float64, "I64": np.int64, "I32": np.int32, "U8": np.uint8}
MAX_HEADER = 100 * 1024 * 1024


def load(path: Path) -> dict[str, np.ndarray]:
    data = path.read_bytes()
    if len(data) < 8:
        raise ValueError("not a safetensors file")
    (header_len,) = struct.unpack("<Q", data[:8])
    if header_len > min(MAX_HEADER, len(data) - 8):
        raise ValueError("not a safetensors file")
    header = json.loads(data[8 : 8 + header_len])
    base = 8 + header_len
    out: dict[str, np.ndarray] = {}
    for name, info in header.items():
        if name == "__metadata__":
            continue
        start, end = info["data_offsets"]
        raw = data[base + start : base + end]
        if info["dtype"] == "BF16":
            # bfloat16 is the top half of a float32.
            arr = (np.frombuffer(raw, dtype="<u2").astype(np.uint32) << 16).view(np.float32)
        elif info["dtype"] in _DTYPES:
            arr = np.frombuffer(raw, dtype=np.dtype(_DTYPES[info["dtype"]]).newbyteorder("<"))
        else:
            raise ValueError(f"unsupported tensor type {info['dtype']}")
        out[name] = arr.reshape(info["shape"])
    return out


def save(path: Path, tensors: dict[str, np.ndarray]) -> None:
    """Write tensors (used by tests and the comparison script)."""
    names = {np.float32: "F32", np.float16: "F16", np.float64: "F64", np.int64: "I64", np.int32: "I32", np.uint8: "U8"}
    header: dict[str, dict] = {}
    blobs = []
    offset = 0
    for name, arr in tensors.items():
        arr = np.ascontiguousarray(arr)
        blob = arr.astype(arr.dtype.newbyteorder("<")).tobytes()
        header[name] = {"dtype": names[arr.dtype.type], "shape": list(arr.shape), "data_offsets": [offset, offset + len(blob)]}
        blobs.append(blob)
        offset += len(blob)
    head = json.dumps(header).encode()
    path.write_bytes(struct.pack("<Q", len(head)) + head + b"".join(blobs))
