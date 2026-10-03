#!/usr/bin/env python3
"""Push App Store listing text (and optionally screenshots) to App Store Connect.

Reads store-assets/metadata/en-US/*.txt and uses the App Store Connect API key from the
ASC_KEY_ID / ASC_ISSUER_ID / ASC_KEY_P8 env vars (the same secrets the iOS build uses).

Apple's rules this follows:
- Promotional text can change at any time, so it is set on every version, including one in review
  or live on the store.
- Name, subtitle, description, keywords, What's New and screenshots only change on a version that is
  still editable (Prepare for Submission or rejected). Locked fields are skipped with a note.
"""
import os, sys, time, hashlib, pathlib
import jwt, requests

APP_ID = os.environ.get("ASC_APP_ID", "6445996160")
LOCALE = "en-US"
ROOT = pathlib.Path(__file__).resolve().parent.parent
META = ROOT / "store-assets" / "metadata" / LOCALE
SHOTS = ROOT / "store-assets" / "higgsfield-2026-10"
UPLOAD_SCREENSHOTS = os.environ.get("UPLOAD_SCREENSHOTS", "false").lower() == "true"
API = "https://api.appstoreconnect.apple.com/v1"
EDITABLE = {"PREPARE_FOR_SUBMISSION", "DEVELOPER_REJECTED", "REJECTED", "METADATA_REJECTED", "INVALID_BINARY"}


def token():
    # Rebuild a clean PEM however the secret was pasted (same as the iOS build workflow).
    import re, textwrap
    raw = os.environ["ASC_KEY_P8"].replace("-----BEGIN PRIVATE KEY-----", "").replace("-----END PRIVATE KEY-----", "")
    body = re.sub(r"[^A-Za-z0-9+/=]", "", raw)
    key = "-----BEGIN PRIVATE KEY-----\n" + "\n".join(textwrap.wrap(body, 64)) + "\n-----END PRIVATE KEY-----\n"
    now = int(time.time())
    return jwt.encode({"iss": os.environ["ASC_ISSUER_ID"], "iat": now, "exp": now + 1100, "aud": "appstoreconnect-v1"},
                      key, algorithm="ES256", headers={"kid": os.environ["ASC_KEY_ID"], "typ": "JWT"})


S = requests.Session()
S.headers["Authorization"] = f"Bearer {token()}"


def call(method, path, **kw):
    url = path if path.startswith("http") else API + path
    r = S.request(method, url, timeout=60, **kw)
    if r.status_code >= 400:
        raise RuntimeError(f"{method} {path} -> {r.status_code}: {r.text[:800]}")
    return r.json() if r.content else {}


def read(name):
    p = META / name
    return p.read_text().strip() if p.exists() else None


def loc_for(rel_path):
    for loc in call("GET", rel_path, params={"limit": 50})["data"]:
        if loc["attributes"]["locale"] == LOCALE:
            return loc
    return None


def patch(kind, obj_id, attrs, label):
    attrs = {k: v for k, v in attrs.items() if v is not None}
    if not attrs:
        return
    call("PATCH", f"/{kind}/{obj_id}", json={"data": {"type": kind, "id": obj_id, "attributes": attrs}})
    print(f"  updated {label}: {', '.join(attrs)}")


def upload_screenshots(version_loc_id):
    sets = {"APP_IPHONE_67": SHOTS / "6.9in-1290x2796", "APP_IPHONE_65": SHOTS / "6.5in-1242x2688"}
    existing = {s["attributes"]["screenshotDisplayType"]: s for s in
                call("GET", f"/appStoreVersionLocalizations/{version_loc_id}/appScreenshotSets")["data"]}
    for display, folder in sets.items():
        files = sorted(folder.glob("*.png"))
        if not files:
            continue
        sset = existing.get(display)
        if sset is None:
            sset = call("POST", "/appScreenshotSets", json={"data": {"type": "appScreenshotSets",
                        "attributes": {"screenshotDisplayType": display},
                        "relationships": {"appStoreVersionLocalization": {"data": {"type": "appStoreVersionLocalizations", "id": version_loc_id}}}}})["data"]
        else:
            for old in call("GET", f"/appScreenshotSets/{sset['id']}/appScreenshots")["data"]:
                call("DELETE", f"/appScreenshots/{old['id']}")
        for f in files:
            data = f.read_bytes()
            shot = call("POST", "/appScreenshots", json={"data": {"type": "appScreenshots",
                        "attributes": {"fileName": f.name, "fileSize": len(data)},
                        "relationships": {"appScreenshotSet": {"data": {"type": "appScreenshotSets", "id": sset["id"]}}}}})["data"]
            for op in shot["attributes"]["uploadOperations"]:
                chunk = data[op["offset"]: op["offset"] + op["length"]]
                headers = {h["name"]: h["value"] for h in op.get("requestHeaders", [])}
                r = requests.request(op["method"], op["url"], headers=headers, data=chunk, timeout=120)
                r.raise_for_status()
            patch("appScreenshots", shot["id"], {"uploaded": True, "sourceFileChecksum": hashlib.md5(data).hexdigest()}, f"screenshot {display} {f.name}")


def main():
    promo = read("promotional_text.txt")
    versions = call("GET", f"/apps/{APP_ID}/appStoreVersions", params={"filter[platform]": "IOS", "limit": 10})["data"]
    editable_version = None
    for v in versions:
        a = v["attributes"]
        state = a.get("appStoreState") or a.get("appVersionState")
        print(f"Version {a['versionString']} ({state})")
        loc = loc_for(f"/appStoreVersions/{v['id']}/appStoreVersionLocalizations")
        if not loc:
            print("  no en-US localization, skipped")
            continue
        if state in EDITABLE:
            editable_version = v
            patch("appStoreVersionLocalizations", loc["id"], {
                "promotionalText": promo,
                "description": read("description.txt"),
                "keywords": read("keywords.txt"),
                "whatsNew": read("release_notes.txt") if len(versions) > 1 else None,
            }, "listing text")
            if UPLOAD_SCREENSHOTS:
                upload_screenshots(loc["id"])
        elif state in {"READY_FOR_SALE", "WAITING_FOR_REVIEW", "IN_REVIEW", "PENDING_DEVELOPER_RELEASE", "READY_FOR_DISTRIBUTION", "PROCESSING_FOR_DISTRIBUTION", "ACCEPTED"}:
            try:
                patch("appStoreVersionLocalizations", loc["id"], {"promotionalText": promo}, "promotional text")
            except RuntimeError as e:
                print(f"  promotional text not changed: {e}")
            print("  description, keywords and What's New are locked on this version")

    infos = call("GET", f"/apps/{APP_ID}/appInfos")["data"]
    changed = False
    for info in infos:
        state = info["attributes"].get("state") or info["attributes"].get("appStoreState")
        if state not in EDITABLE | {"PREPARE_FOR_SUBMISSION", "DEVELOPER_REJECTED"}:
            continue
        loc = loc_for(f"/appInfos/{info['id']}/appInfoLocalizations")
        if loc:
            patch("appInfoLocalizations", loc["id"], {"name": read("name.txt"), "subtitle": read("subtitle.txt")}, "name and subtitle")
            changed = True
    if not changed:
        print("Name and subtitle are locked until a new version is created (they change together with the next version).")
    if editable_version is None:
        print("No editable version yet: create the next version in App Store Connect (or let the next build do it), then run this again.")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"ERROR: {e}")
        sys.exit(1)
