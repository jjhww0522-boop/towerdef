"""Read-only prerequisite check. Never print credentials or read browser profiles."""

import importlib.metadata
import importlib.util
import json
import os
from pathlib import Path
import shutil
import sys


def installed(module):
    return importlib.util.find_spec(module) is not None


def version(package):
    try:
        return importlib.metadata.version(package)
    except importlib.metadata.PackageNotFoundError:
        return None


root = Path(__file__).resolve().parents[2]
report = {
    "python": ".".join(map(str, sys.version_info[:3])),
    "python_supported": sys.version_info >= (3, 12),
    "uv_available": shutil.which("uv") is not None,
    "jev_installed": installed("jev_ultrafast"),
    "jev_version": version("jev-ultrafast"),
    "browser_harness_installed": installed("browser_harness"),
    "browser_harness_version": version("browser-harness"),
    "TYPESAFE_API_KEY_present": bool(os.environ.get("TYPESAFE_API_KEY")),
    "TEXT_MODEL_API_KEY_present": bool(os.environ.get("TEXT_MODEL_API_KEY")),
    "project_env_exists": (root / ".env").is_file(),
    "paid_run_performed": False,
    "live_ready": False,
    "remaining_gates": [
        "Verify pinned dependencies in a separate environment.",
        "Verify Harness uses a fresh disposable Chrome profile for every trial.",
        "Set an explicit approved API budget and model configuration.",
        "Connect JEV traces to the independent DOM/server verifier.",
    ],
}
print(json.dumps(report, indent=2))
