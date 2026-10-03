#!/usr/bin/env python3
"""Swap a new build into the App Store version that's in review, refresh the listing, resubmit.

Steps (App Store Connect API, same key as the iOS build):
1. Find the version being prepared / in review (the newest non-live iOS version).
2. If it's waiting for review, cancel that submission (Apple returns it to "Developer Rejected").
3. Wait until the requested build (CFBundleVersion, e.g. 216) has finished processing.
4. Attach that build to the version and mark export compliance if Apple asks for it.
5. Push the listing text (and screenshots) from store-assets/ via asc_metadata.py.
6. Submit the version for review again.
"""
import os, sys, time, pathlib

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import asc_metadata as M  # noqa: E402

BUILD = os.environ.get("BUILD_NUMBER", "").strip()
LIVE = {"READY_FOR_SALE", "READY_FOR_DISTRIBUTION", "REPLACED_WITH_NEW_VERSION", "REMOVED_FROM_SALE", "DEVELOPER_REMOVED_FROM_SALE"}
IN_FLIGHT = {"WAITING_FOR_REVIEW", "IN_REVIEW", "PENDING_DEVELOPER_RELEASE", "PROCESSING_FOR_DISTRIBUTION", "ACCEPTED"}


def state_of(v):
    a = v["attributes"]
    return a.get("appStoreState") or a.get("appVersionState")


def find_version():
    vs = M.call("GET", f"/apps/{M.APP_ID}/appStoreVersions", params={"filter[platform]": "IOS", "limit": 10})["data"]
    for v in vs:
        if state_of(v) not in LIVE:
            return v
    return None


def cancel_open_submission():
    subs = M.call("GET", "/reviewSubmissions", params={"filter[app]": M.APP_ID, "filter[platform]": "IOS", "limit": 20})["data"]
    for s in subs:
        st = s["attributes"].get("state")
        if st in {"WAITING_FOR_REVIEW", "IN_REVIEW", "UNRESOLVED_ISSUES"}:
            print(f"Cancelling review submission {s['id']} ({st})")
            M.call("PATCH", f"/reviewSubmissions/{s['id']}", json={"data": {"type": "reviewSubmissions", "id": s["id"], "attributes": {"canceled": True}}})


def wait_for(fn, what, timeout_s, every_s=30):
    end = time.time() + timeout_s
    while True:
        val = fn()
        if val:
            return val
        if time.time() > end:
            raise RuntimeError(f"Timed out waiting for {what}")
        print(f"  waiting for {what}...")
        time.sleep(every_s)


def ready_build():
    bs = M.call("GET", "/builds", params={"filter[app]": M.APP_ID, "filter[version]": BUILD, "limit": 5})["data"]
    for b in bs:
        st = b["attributes"].get("processingState")
        if st == "VALID":
            return b
        if st in {"FAILED", "INVALID"}:
            raise RuntimeError(f"Build {BUILD} processing {st}")
    return None


def main():
    if not BUILD:
        raise RuntimeError("BUILD_NUMBER is required")
    v = find_version()
    if not v:
        raise RuntimeError("No App Store version in progress")
    print(f"Version {v['attributes']['versionString']} is {state_of(v)}")

    if state_of(v) in IN_FLIGHT:
        cancel_open_submission()
        wait_for(lambda: state_of(M.call("GET", f"/appStoreVersions/{v['id']}")["data"]) in M.EDITABLE,
                 "the version to come back from review", 20 * 60, 20)
        print("Version is editable again")

    b = wait_for(ready_build, f"build {BUILD} to finish processing", 75 * 60, 60)
    if b["attributes"].get("usesNonExemptEncryption") is None:
        try:
            M.patch("builds", b["id"], {"usesNonExemptEncryption": False}, "export compliance")
        except RuntimeError as e:
            print(f"  export compliance not set: {e}")
    M.call("PATCH", f"/appStoreVersions/{v['id']}/relationships/build", json={"data": {"type": "builds", "id": b["id"]}})
    print(f"Attached build {BUILD}")

    os.environ["UPLOAD_SCREENSHOTS"] = "true"
    M.UPLOAD_SCREENSHOTS = os.environ.get("SCREENSHOTS", "true").lower() == "true"
    M.main()

    # Reuse an unsubmitted submission if Apple kept one, else start a new one.
    subs = M.call("GET", "/reviewSubmissions", params={"filter[app]": M.APP_ID, "filter[platform]": "IOS", "filter[state]": "READY_FOR_REVIEW", "limit": 5})["data"]
    if subs:
        sub = subs[0]
    else:
        sub = M.call("POST", "/reviewSubmissions", json={"data": {"type": "reviewSubmissions", "attributes": {"platform": "IOS"},
                      "relationships": {"app": {"data": {"type": "apps", "id": M.APP_ID}}}}})["data"]
    items = M.call("GET", f"/reviewSubmissions/{sub['id']}/items")["data"]
    if not items:
        M.call("POST", "/reviewSubmissionItems", json={"data": {"type": "reviewSubmissionItems", "relationships": {
            "reviewSubmission": {"data": {"type": "reviewSubmissions", "id": sub["id"]}},
            "appStoreVersion": {"data": {"type": "appStoreVersions", "id": v["id"]}}}}})
    M.call("PATCH", f"/reviewSubmissions/{sub['id']}", json={"data": {"type": "reviewSubmissions", "id": sub["id"], "attributes": {"submitted": True}}})
    print(f"Submitted version {v['attributes']['versionString']} with build {BUILD} for review")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"::error::{e}")
        sys.exit(1)
