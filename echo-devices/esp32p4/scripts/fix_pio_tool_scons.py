#!/usr/bin/env python3
"""Repair the pioarduino / PlatformIO Core ``tool-scons`` version clash.

Background
----------
PlatformIO Core treats ``tool-scons`` as a *core* package and force-installs
SCons 4.11.1 (see ``platformio/dependencies.py``) into
``~/.platformio/packages/tool-scons``.  The pioarduino platform this project
pins (``55.03.311``) still declares ``tool-scons`` 4.8.1, i.e. a
``package-version`` of ``4.40801.0`` in its ``platform.json``.

During ``pio run`` the platform calls ``Espressif32Platform.install_tool()``
-> ``_handle_existing_tool()``, which compares the ``version`` field of
``packages/tool-scons/package.json`` against the version it declared.  On
mismatch it logs "Reinstalling tool-scons due to version mismatch", deletes
``packages/tool-scons`` and re-enters ``install_tool()`` -- where the status
check now finds "no idf tools, no tools.json" and only logs
``Tool tool-scons already configured``.  The package is never restored and the
already running SCons process dies later with::

    ModuleNotFoundError: No module named 'SCons.Tool.FortranCommon'

Fix
---
Normalise the state so both checks agree: install ``tool-scons`` through Core's
package manager when it is missing or incomplete, then rewrite only the
``version`` field of ``package.json`` to the ``package-version`` the pinned
platform declares.  pioarduino then either accepts the package as is or lets its
Tool Manager replace the files with its own build of that version (SCons 4.8.1),
instead of deleting the directory and leaving nothing behind.  See
``docs/P0_INFRASTRUCTURE.md`` for the observed states and the runbook.

Usage
-----
    python scripts/fix_pio_tool_scons.py [--check]

Exit codes: 0 = tool-scons is healthy (or was repaired), 1 = could not repair.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
PLATFORMIO_INI = PROJECT_ROOT / "platformio.ini"
TOOL_NAME = "tool-scons"
# Imported lazily by SCons; disappears with the whole package directory.
SENTINEL_GLOB = "scons-local*/SCons/Tool/FortranCommon.py"


def core_dir() -> Path:
    """Return the PlatformIO core directory (``~/.platformio`` by default)."""
    env = os.environ.get("PLATFORMIO_CORE_DIR")
    return Path(env) if env else Path.home() / ".platformio"


def pinned_platform_version() -> str | None:
    """Read the platform version pinned in ``platformio.ini``.

    Accepts both the zip URL form used by this project and a plain registry
    specifier such as ``espressif32@55.03.311``.
    """
    if not PLATFORMIO_INI.is_file():
        return None
    text = PLATFORMIO_INI.read_text(encoding="utf-8")
    match = re.search(
        r"^\s*platform\s*=\s*\S*/download/(?P<ver>[^/]+)/platform-espressif32\.zip",
        text,
        re.MULTILINE,
    )
    if match:
        return match.group("ver")
    match = re.search(r"^\s*platform\s*=\s*espressif32@(?P<ver>\S+)", text, re.MULTILINE)
    return match.group("ver") if match else None


def find_platform_manifest(version: str | None) -> tuple[Path, dict] | None:
    """Locate the ``platform.json`` of the pinned (or of any) ESP32 platform."""
    platforms_dir = core_dir() / "platforms"
    if not platforms_dir.is_dir():
        return None
    fallback = None
    for manifest in sorted(platforms_dir.glob("*/platform.json")):
        try:
            data = json.loads(manifest.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        if data.get("name") != "espressif32":
            continue
        if version and data.get("version") == version:
            return manifest, data
        fallback = fallback or (manifest, data)
    return fallback


def expected_platform_version(manifest: dict) -> str | None:
    """``packages["tool-scons"]["package-version"]`` from ``platform.json``."""
    entry = (manifest.get("packages") or {}).get(TOOL_NAME) or {}
    return entry.get("package-version")


def pio_python() -> str | None:
    """Interpreter PlatformIO Core itself runs on (``penv``), else the ambient one.

    The penv copy matters: an ambient ``platformio`` (e.g. a pip install of a
    different Core release) can pin a different ``tool-scons`` and would then
    install the wrong package.
    """
    for candidate in (
        core_dir() / "penv" / "Scripts" / "python.exe",
        core_dir() / "penv" / "bin" / "python",
    ):
        if candidate.is_file():
            return str(candidate)
    return sys.executable


def _read_pinned_scons_url() -> str | None:
    """Last-resort parse of Core's ``dependencies.py`` for the SCons URL."""
    for candidate in (
        core_dir() / "penv" / "Lib" / "site-packages" / "platformio" / "dependencies.py",
        core_dir() / "penv" / "lib" / "python3.12" / "site-packages" / "platformio" / "dependencies.py",
    ):
        if candidate.is_file():
            text = candidate.read_text(encoding="utf-8")
            # The URL is written as two adjacent string literals across lines,
            # so join them before searching.
            text = re.sub(r"\"\s*\n\s*\"", "", text)
            match = re.search(
                r"https://[^\"']*scons-local-\d+\.\d+\.\d+\.tar\.gz",
                text,
            )
            if match:
                return match.group(0)
    return None


def core_dependency() -> str | None:
    """``tool-scons`` entry of Core's dependency table (package URL or registry spec)."""
    python = pio_python()
    if python:
        code = (
            "from platformio.dependencies import get_core_dependencies\n"
            f"print(get_core_dependencies().get({TOOL_NAME!r}, ''))\n"
        )
        try:
            proc = subprocess.run(
                [python, "-c", code], check=False, capture_output=True, text=True
            )
        except OSError:
            proc = None
        if proc is not None and proc.returncode == 0:
            value = (proc.stdout or "").strip()
            if value:
                return value
    return _read_pinned_scons_url()


def expected_core_version() -> str | None:
    """SCons version PlatformIO Core pins, when its dependency is a URL."""
    dependency = core_dependency() or ""
    match = re.search(r"scons-local-(?P<ver>\d+\.\d+\.\d+)\.tar\.gz", dependency)
    return match.group("ver") if match else None


def install_tool_scons() -> bool:
    """Install ``tool-scons`` the same way PlatformIO Core does at startup.

    ``pio pkg install -t tool-scons@<url>`` is not supported by the CLI, so the
    core helper ``get_core_package_dir()`` (which honours whatever the Core itself
    pins in ``platformio/dependencies.py``, a package URL or a registry spec) is
    used instead. It runs on the penv interpreter, i.e. the Core ``pio`` uses.
    """
    python = pio_python()
    if python is None:
        print("! Could not find a Python interpreter with PlatformIO installed.")
        return False
    code = (
        "from platformio.package.manager.core import get_core_package_dir\n"
        f"print(get_core_package_dir({TOOL_NAME!r}))\n"
    )
    cmd = [python, "-c", code]
    print(f"  running: {' '.join(cmd)}")
    return subprocess.run(cmd, check=False).returncode == 0


def package_json_version(tool_dir: Path) -> str | None:
    try:
        data = json.loads((tool_dir / "package.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return data.get("version")


def patch_package_json(tool_dir: Path, version: str) -> bool:
    """Rewrite the ``version`` field of ``package.json`` (nothing else)."""
    package_json = tool_dir / "package.json"
    try:
        data = json.loads(package_json.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        print(f"! Cannot read {package_json}: {exc}")
        return False
    data["version"] = version
    package_json.write_text(
        json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    return True


def scons_sentinel(tool_dir: Path) -> Path | None:
    return next(tool_dir.glob(SENTINEL_GLOB), None)


def main(argv: list[str]) -> int:
    check_only = "--check" in argv[1:]
    tool_dir = core_dir() / "packages" / TOOL_NAME

    located = find_platform_manifest(pinned_platform_version())
    if not located:
        print(f"! No espressif32 platform found under {core_dir() / 'platforms'}")
        return 1
    manifest_path, manifest = located
    expected = expected_platform_version(manifest)
    if not expected:
        print(f"! {manifest_path} declares no '{TOOL_NAME}' package-version")
        return 1

    core_dependency_value = core_dependency()
    core_version = expected_core_version()
    print(f"Platform       : {manifest.get('version')} ({manifest_path.parent.name})")
    print(f"Platform wants : {TOOL_NAME} {expected}")
    print(f"Core pins      : {TOOL_NAME} {core_dependency_value or '<unknown>'}")

    if not (tool_dir / "scons.py").is_file():
        if check_only:
            print(f"! {tool_dir} is missing or incomplete; run without --check to repair")
            return 1
        if not core_dependency_value:
            print("! Cannot determine which SCons package to install.")
            return 1
        print(f"Installing {TOOL_NAME} {core_version or core_dependency_value} ...")
        if not install_tool_scons():
            print("! Installation failed.")
            return 1

    current = package_json_version(tool_dir)
    print(f"Installed      : {TOOL_NAME} {current} ({tool_dir})")

    if current != expected:
        if check_only:
            print("! Version mismatch: pioarduino will delete tool-scons on the next build.")
            return 1
        print(f"Patching {tool_dir / 'package.json'} -> version {expected} ...")
        if not patch_package_json(tool_dir, expected):
            return 1

    sentinel = scons_sentinel(tool_dir)
    if sentinel is None:
        print(f"! No {SENTINEL_GLOB} found; reinstall {TOOL_NAME} {core_version or ''}".rstrip())
        return 1

    print(f"OK: {TOOL_NAME} {expected} is consistent with the platform ({sentinel.name} present).")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))