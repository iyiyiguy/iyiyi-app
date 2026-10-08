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


def add_iaps(sub_id):
    """Put every in-app purchase that's waiting for its first review into this submission
    (Apple requires first-time in-app purchases to be reviewed together with an app version)."""
    iaps, url = [], f"/apps/{M.APP_ID}/inAppPurchasesV2"
    params = {"limit": 200}
    while url:
        j = M.call("GET", url, params=params)
        iaps += j.get("data", [])
        url, params = j.get("links", {}).get("next"), None
    for i in iaps:
        a = i["attributes"]
        if a.get("state") != "READY_TO_SUBMIT":
            print(f"  IAP {a.get('productId')}: {a.get('state')}")
            continue
        try:
            M.call("POST", "/reviewSubmissionItems", json={"data": {"type": "reviewSubmissionItems", "relationships": {
                "reviewSubmission": {"data": {"type": "reviewSubmissions", "id": sub_id}},
                "inAppPurchaseV2": {"data": {"type": "inAppPurchases", "id": i["id"]}}}}})
            print(f"  + IAP {a.get('productId')} added to the submission")
        except RuntimeError as e:
            msg = str(e)
            if "409" in msg and ("already" in msg.lower() or "ITEM_ALREADY" in msg):
                print(f"  IAP {a.get('productId')} already in the submission")
                continue
            try:  # older route: submit the in-app purchase on its own; it rides along with the version
                M.call("POST", "/inAppPurchaseSubmissions", json={"data": {"type": "inAppPurchaseSubmissions", "relationships": {
                    "inAppPurchaseV2": {"data": {"type": "inAppPurchases", "id": i["id"]}}}}})
                print(f"  + IAP {a.get('productId')} submitted with the version")
            except RuntimeError as e2:
                print(f"  ! IAP {a.get('productId')} not added: {msg[:200]} / {str(e2)[:200]}")


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

    # Notes for the reviewer (demo account hints, answers to the previous rejection).
    notes = M.read("review_notes.txt")
    if notes:
        try:
            detail = M.call("GET", f"/appStoreVersions/{v['id']}/appStoreReviewDetail")["data"]
            M.patch("appStoreReviewDetails", detail["id"], {"notes": notes}, "review notes")
        except Exception as e:  # noqa: BLE001
            print(f"  review notes not updated: {e}")

    os.environ["UPLOAD_SCREENSHOTS"] = "true"
    M.UPLOAD_SCREENSHOTS = os.environ.get("SCREENSHOTS", "true").lower() == "true"
    M.main()

    # Reuse an open (unsubmitted) submission if Apple kept one, else start a new one. Adding the
    # version can be refused (409) for a few minutes while new screenshots are still processing,
    # so that step retries.
    open_states = {"READY_FOR_REVIEW", "UNRESOLVED_ISSUES"}
    subs = M.call("GET", "/reviewSubmissions", params={"filter[app]": M.APP_ID, "filter[platform]": "IOS", "limit": 20})["data"]
    opened = [x for x in subs if x["attributes"].get("state") in open_states]

    def has_version(x):
        items = M.call("GET", f"/reviewSubmissions/{x['id']}/items", params={"include": "appStoreVersion"})["data"]
        return any((i.get("relationships", {}).get("appStoreVersion", {}).get("data") or {}).get("id") == v["id"] for i in items)

    # A rejected version lives in its "Unresolved Issues" submission: resubmit that one. Any other
    # open draft (e.g. in-app purchases added by hand in App Store Connect) is cancelled so its
    # items can join the version's submission.
    sub = next((x for x in opened if has_version(x)), None) or \
        next((x for x in opened if x["attributes"].get("state") == "UNRESOLVED_ISSUES"), None) or \
        next(iter(opened), None)
    for x in opened:
        if sub is not None and x["id"] != sub["id"] and x["attributes"].get("state") == "READY_FOR_REVIEW":
            try:
                M.call("PATCH", f"/reviewSubmissions/{x['id']}", json={"data": {"type": "reviewSubmissions", "id": x["id"], "attributes": {"canceled": True}}})
                print(f"Cancelled extra draft submission {x['id']} so its items can be resubmitted with the version")
                time.sleep(10)
            except RuntimeError as e:
                print(f"  could not cancel draft {x['id']}: {str(e)[:200]}")
    if sub is None:
        sub = M.call("POST", "/reviewSubmissions", json={"data": {"type": "reviewSubmissions", "attributes": {"platform": "IOS"},
                      "relationships": {"app": {"data": {"type": "apps", "id": M.APP_ID}}}}})["data"]
    print(f"Using review submission {sub['id']} ({sub['attributes'].get('state')})")
    for attempt in range(12):
        items = M.call("GET", f"/reviewSubmissions/{sub['id']}/items", params={"include": "appStoreVersion"})["data"]
        if any((i.get("relationships", {}).get("appStoreVersion", {}).get("data") or {}).get("id") == v["id"] for i in items):
            break
        try:
            M.call("POST", "/reviewSubmissionItems", json={"data": {"type": "reviewSubmissionItems", "relationships": {
                "reviewSubmission": {"data": {"type": "reviewSubmissions", "id": sub["id"]}},
                "appStoreVersion": {"data": {"type": "appStoreVersions", "id": v["id"]}}}}})
            break
        except RuntimeError as e:
            if "409" not in str(e) or attempt == 11:
                raise
            print(f"  not accepted yet ({str(e)[:300]}), retrying in 60s")
            time.sleep(60)
    add_iaps(sub["id"])
    # After a rejection the version can stay "not ready to be submitted yet" for a while once the
    # new build is attached; the final submit retries too.
    for attempt in range(15):
        try:
            M.call("PATCH", f"/reviewSubmissions/{sub['id']}", json={"data": {"type": "reviewSubmissions", "id": sub["id"], "attributes": {"submitted": True}}})
            break
        except RuntimeError as e:
            if "409" not in str(e) or attempt == 14:
                raise
            print(f"  version not ready to submit yet ({str(e)[:200]}), retrying in 60s")
            time.sleep(60)
    print(f"Submitted version {v['attributes']['versionString']} with build {BUILD} for review")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print("::error::" + " ".join(str(e).split())[:3000])
        sys.exit(1)
