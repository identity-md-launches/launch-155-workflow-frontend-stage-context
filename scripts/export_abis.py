#!/usr/bin/env python3
"""Export deployment contract ABIs from a completed Foundry build, or check for drift."""

import argparse
import json
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--check", action="store_true", help="Fail if an exported ABI differs from the build")
args = parser.parse_args()
root = Path(__file__).resolve().parent.parent

for contract in ("NoopToken", "NoopHook"):
    artifact = root / "out" / f"{contract}.sol" / f"{contract}.json"
    if not artifact.is_file():
        raise SystemExit(f"Missing {artifact.name}; run forge build first")
    abi = json.loads(artifact.read_text())["abi"]
    destination = root / "docs" / "abi" / f"{contract}.json"
    if args.check:
        if not destination.is_file() or json.loads(destination.read_text()) != abi:
            raise SystemExit(f"ABI drift: {destination.relative_to(root)}")
        print(f"Verified {destination.relative_to(root)}")
    else:
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_text(json.dumps(abi, indent=2) + "\n")
        print(f"Exported {destination.relative_to(root)}")
