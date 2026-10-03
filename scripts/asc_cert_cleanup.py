#!/usr/bin/env python3
"""Revoke the throwaway "Created via API" development certificates that each CI build makes.

Every fresh GitHub Mac runner gets a new Apple Development certificate from automatic signing;
Apple caps how many can exist, and once the cap is hit the Archive step fails. Distribution
certificates and anything not made by the API are left alone. Never fails the build.
"""
import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import asc_metadata as M  # noqa: E402

try:
    certs = M.call("GET", "/certificates", params={"limit": 200})["data"]
    dev = [c for c in certs
           if c["attributes"].get("certificateType") in {"DEVELOPMENT", "IOS_DEVELOPMENT"}
           and "created via api" in (c["attributes"].get("displayName") or c["attributes"].get("name") or "").lower()]
    print(f"{len(dev)} API-made development certificates")
    for c in dev:
        try:
            M.call("DELETE", f"/certificates/{c['id']}")
            print(f"  revoked {c['id']}")
        except Exception as e:  # noqa: BLE001
            print(f"  could not revoke {c['id']}: {e}")
except Exception as e:  # noqa: BLE001
    print(f"certificate cleanup skipped: {e}")
