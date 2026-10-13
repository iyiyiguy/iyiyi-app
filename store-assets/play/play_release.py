"""Promotes an uploaded Android build to a Google Play track and updates the store listing.

  PLAY_VERSION_CODE  version code to release (required, e.g. 181; must already be uploaded)
  PLAY_TRACK         track to release on (default production)
  PLAY_TITLE         listing title (default: store-assets/metadata/en-US/name.txt)
Also replaces the app icon with store-assets/play/play-icon-512.png and uses
store-assets/play/release_notes.txt as the "What's new" text. Committing the edit sends it
for review (managed publishing is off, so it goes live as soon as Google approves it).

Auth: Application Default Credentials (keyless Workload Identity login in GitHub Actions).
"""
import os
import sys

import google.auth
from google.auth.transport.requests import AuthorizedSession

PKG = os.environ.get("PLAY_PACKAGE", "com.iyiyi.app")
API = f"https://androidpublisher.googleapis.com/androidpublisher/v3/applications/{PKG}"
UPLOAD = f"https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications/{PKG}"
LANG = "en-US"


def ok(r, what):
    if r.status_code >= 300:
        print(f"::error::{what}: HTTP {r.status_code} {r.text[:1500]}")
        sys.exit(1)
    return r.json() if r.text else {}


def main(vc=None, track=None):
    vc = str(vc or os.environ.get("PLAY_VERSION_CODE", "")).strip()
    if not vc.isdigit():
        print("::error::PLAY_VERSION_CODE is required")
        sys.exit(1)
    track = (track or os.environ.get("PLAY_TRACK", "production")).strip() or "production"
    title = os.environ.get("PLAY_TITLE", "").strip() or open("store-assets/metadata/en-US/name.txt").read().strip()
    notes = open("store-assets/play/release_notes.txt").read().strip()[:500]

    creds, _ = google.auth.default(scopes=["https://www.googleapis.com/auth/androidpublisher"])
    s = AuthorizedSession(creds)

    edit = ok(s.post(f"{API}/edits", json={}), "create edit")["id"]
    E = f"{API}/edits/{edit}"
    print("edit", edit)

    bundles = ok(s.get(f"{E}/bundles"), "list bundles").get("bundles", [])
    codes = sorted(int(b["versionCode"]) for b in bundles)
    print("uploaded version codes (latest 5):", codes[-5:])
    if int(vc) not in codes:
        print(f"::error::version code {vc} is not uploaded")
        sys.exit(1)

    listing = ok(s.get(f"{E}/listings/{LANG}"), "get listing")
    print("current title:", listing.get("title"))
    ok(s.patch(f"{E}/listings/{LANG}", json={"title": title}), "set title")
    print("title ->", title)

    ok(s.delete(f"{E}/listings/{LANG}/icon"), "clear icon")
    with open("store-assets/play/play-icon-512.png", "rb") as f:
        ok(s.post(f"{UPLOAD}/edits/{edit}/listings/{LANG}/icon?uploadType=media",
                  data=f.read(), headers={"Content-Type": "image/png"}), "upload icon")
    print("icon replaced")

    current = ok(s.get(f"{E}/tracks/{track}"), f"get {track} track")
    for r in current.get("releases", []):
        if vc in r.get("versionCodes", []) and r.get("status") in ("completed", "inProgress"):
            print(f"{track} already has version code {vc} ({r.get('status')}); nothing to do")
            s.delete(E)
            return
    body = {"track": track, "releases": [{
        "versionCodes": [vc],
        "status": "completed",
        "releaseNotes": [{"language": LANG, "text": notes}],
    }]}
    ok(s.put(f"{E}/tracks/{track}", json=body), f"set {track} track")
    print(f"{track} -> version code {vc}")

    res = ok(s.post(f"{E}:commit"), "commit edit")
    print("committed edit", res.get("id"), "- sent to Google for review")


if __name__ == "__main__":
    main()
