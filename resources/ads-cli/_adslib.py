#!/usr/bin/env python3
"""Shared helpers for the ads CLI wrappers (gads, fbads, ads-gen-yaml).

Client identity comes from the cue google-ads profile's workspaces.yaml.
Values may contain ${VAR} references (resolved from the environment, the
same convention cue uses) and ~ or $HOME path prefixes.
"""
import os
import sys
from pathlib import Path

import yaml

META_API_VERSION = "v23.0"
SECRETS = os.path.expanduser("~/.config/cue/secrets/ads")

_REPO_ROOT = Path(__file__).resolve().parents[2]
WORKSPACES_FILE = os.environ.get(
    "ADS_WORKSPACES_FILE",
    str(_REPO_ROOT / "profiles" / "google-ads" / "workspaces.yaml"),
)


def fail(msg: str) -> "NoReturn":
    print(f"error: {msg}", file=sys.stderr)
    sys.exit(1)


def _expand(value: str) -> str:
    """Expand ${VAR} / $VAR and ~. Unresolvable ${VAR} collapses to ""."""
    out = os.path.expandvars(os.path.expanduser(value or ""))
    if out.startswith("${") and out.endswith("}"):
        return ""
    return out


def _load() -> dict:
    try:
        with open(WORKSPACES_FILE) as f:
            data = yaml.safe_load(f) or {}
    except FileNotFoundError:
        fail(f"workspaces file not found: {WORKSPACES_FILE}")
    return data.get("workspaces") or {}


def list_clients() -> list:
    return sorted(_load().keys())


def resolve_client(client: str) -> dict:
    workspaces = _load()
    if client not in workspaces:
        fail(
            f"unknown client '{client}'. Available: {', '.join(sorted(workspaces))}\n"
            f"Add it in {WORKSPACES_FILE}"
        )
    ws = workspaces[client]
    env = ws.get("env") or {}
    adc = _expand(env.get("GOOGLE_APPLICATION_CREDENTIALS", ""))
    ads_yaml = ""
    if adc.endswith("-adc.json"):
        ads_yaml = adc[: -len("-adc.json")] + ".google-ads.yaml"
    return {
        "name": ws.get("name", client),
        "google_customer_id": _expand(env.get("GOOGLE_ADS_CUSTOMER_ID", "")).replace("-", ""),
        "login_customer_id": _expand(env.get("GOOGLE_ADS_LOGIN_CUSTOMER_ID", "")).replace("-", ""),
        "adc_path": adc,
        "ads_yaml_path": ads_yaml,
        "fb_ad_account_id": _expand(env.get("FB_AD_ACCOUNT_ID", "")),
    }
