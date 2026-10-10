#!/usr/bin/env python3
"""Set iYiYi Pro's App Store pricing through the App Store Connect API.

  Regular price:      $9.99 / month (USA price point; every other storefront gets Apple's
                      equalized price for it). Existing subscribers keep what they pay now.
  Introductory offer: $0.99 paid up front for the first 2 months, new subscribers only,
                      in every storefront (replaces any older introductory offer).

Run with env vars to manage another subscription in the same way, e.g. Business Pro:
  PRO_PRODUCT_ID=com.iyiyi.app.business.monthly BASE_USD=29.00 INTRO_USD=9.99 INTRO_DURATION=ONE_MONTH
  CREATE_NAME="Business Pro" CREATE_DISPLAY="Business Pro" CREATE_DESC="..." CREATE_LEVEL=1
When CREATE_NAME is set and the subscription doesn't exist yet, it is created in the app's
subscription group with an English name/description, every storefront, and an App Review
screenshot (CREATE_SCREENSHOT, a path in the repo).

Uses the same ASC_KEY_ID / ASC_ISSUER_ID / ASC_KEY_P8 secrets as the other App Store scripts.
Safe to run more than once: it reads what is set and only changes what differs.
"""
import os, sys, time, re, textwrap, datetime
import jwt, requests

APP_ID = os.environ.get("ASC_APP_ID", "6445996160")
PRODUCT_ID = os.environ.get("PRO_PRODUCT_ID", "com.iyiyi.app.pro.all.monthly")
BASE_USD = os.environ.get("BASE_USD", "9.99")
INTRO_USD = os.environ.get("INTRO_USD", "0.99")
INTRO_DURATION = os.environ.get("INTRO_DURATION", "TWO_MONTHS")
API = "https://api.appstoreconnect.apple.com/v1"
CREATE_NAME = os.environ.get("CREATE_NAME", "").strip()
CREATE_DISPLAY = os.environ.get("CREATE_DISPLAY", CREATE_NAME).strip()
CREATE_DESC = os.environ.get("CREATE_DESC", "").strip()
CREATE_LEVEL = os.environ.get("CREATE_LEVEL", "").strip()
CREATE_SCREENSHOT = os.environ.get("CREATE_SCREENSHOT", "").strip()
REVIEW_NOTE = os.environ.get("CREATE_REVIEW_NOTE", "In the app: Profile > Go Pro, then choose the plan. "
                             "Demo account details are in the app's App Review Information.")


def token():
    raw = os.environ["ASC_KEY_P8"].replace("-----BEGIN PRIVATE KEY-----", "").replace("-----END PRIVATE KEY-----", "")
    body = re.sub(r"[^A-Za-z0-9+/=]", "", raw)
    key = "-----BEGIN PRIVATE KEY-----\n" + "\n".join(textwrap.wrap(body, 64)) + "\n-----END PRIVATE KEY-----\n"
    now = int(time.time())
    return jwt.encode({"iss": os.environ["ASC_ISSUER_ID"], "iat": now, "exp": now + 1100, "aud": "appstoreconnect-v1"},
                      key, algorithm="ES256", headers={"kid": os.environ["ASC_KEY_ID"], "typ": "JWT"})


S = requests.Session()


def call(method, path, ok=(), **kw):
    url = path if path.startswith("http") else API + path
    for attempt in range(6):
        S.headers["Authorization"] = f"Bearer {token()}"
        r = S.request(method, url, timeout=60, **kw)
        if r.status_code == 429 or r.status_code >= 500:
            time.sleep(5 * (attempt + 1))
            continue
        if r.status_code >= 400 and r.status_code not in ok:
            raise RuntimeError(f"{method} {path} -> {r.status_code}: {r.text[:1200]}")
        return r.status_code, (r.json() if r.content else {})
    raise RuntimeError(f"{method} {path}: gave up after retries")


def get_all(path, params=None):
    out, included = [], []
    params = dict(params or {})
    params.setdefault("limit", 200)
    url = path
    while url:
        _, j = call("GET", url, params=params if url == path else None)
        out += j.get("data", [])
        included += j.get("included", [])
        url = j.get("links", {}).get("next")
    return out, included


def rel(type_, id_):
    return {"data": {"type": type_, "id": id_}}


def find_subscription():
    groups, _ = get_all(f"/apps/{APP_ID}/subscriptionGroups")
    for g in groups:
        subs, _ = get_all(f"/subscriptionGroups/{g['id']}/subscriptions")
        for s in subs:
            if s["attributes"].get("productId") == PRODUCT_ID:
                return s
    if not CREATE_NAME:
        raise SystemExit(f"Subscription {PRODUCT_ID} not found")
    if not groups:
        raise SystemExit("No subscription group to create the subscription in")
    # Put it in the group that already holds the Pro plan, so people can switch between them.
    group = next((g for g in groups if any(
        s["attributes"].get("productId") == "com.iyiyi.app.pro.all.monthly"
        for s in get_all(f"/subscriptionGroups/{g['id']}/subscriptions")[0])), groups[0])
    attrs = {"name": CREATE_NAME, "productId": PRODUCT_ID, "subscriptionPeriod": "ONE_MONTH",
             "familySharable": False, "reviewNote": REVIEW_NOTE}
    if CREATE_LEVEL:
        attrs["groupLevel"] = int(CREATE_LEVEL)
    body = {"data": {"type": "subscriptions", "attributes": attrs,
                     "relationships": {"group": rel("subscriptionGroups", group["id"])}}}
    status, j = call("POST", "/subscriptions", ok=(409,), json=body)
    if status == 409 and "groupLevel" in attrs:
        print(f"  could not set level {CREATE_LEVEL} ({j.get('errors', [{}])[0].get('detail', '')[:160]}); creating without it")
        attrs.pop("groupLevel")
        status, j = call("POST", "/subscriptions", json=body)
    elif status == 409:
        raise RuntimeError(f"create subscription: {j}")
    print(f"Created subscription {PRODUCT_ID} in group {group['attributes'].get('referenceName')}")
    return j["data"]


def ensure_localization(sub_id):
    locs, _ = get_all(f"/subscriptions/{sub_id}/subscriptionLocalizations")
    if any(l["attributes"].get("locale") == "en-US" for l in locs) or not CREATE_NAME:
        return
    call("POST", "/subscriptionLocalizations", json={"data": {
        "type": "subscriptionLocalizations",
        "attributes": {"locale": "en-US", "name": CREATE_DISPLAY, "description": CREATE_DESC[:55]},
        "relationships": {"subscription": rel("subscriptions", sub_id)}}})
    print("  + English name/description")


def ensure_availability(sub_id):
    status, j = call("GET", f"/subscriptions/{sub_id}/subscriptionAvailability", ok=(404,))
    if (status == 200 and j.get("data")) or not CREATE_NAME:
        return
    terrs, _ = get_all("/territories")
    call("POST", "/subscriptionAvailabilities", json={"data": {
        "type": "subscriptionAvailabilities",
        "attributes": {"availableInNewTerritories": True},
        "relationships": {"subscription": rel("subscriptions", sub_id),
                          "availableTerritories": {"data": [{"type": "territories", "id": t["id"]} for t in terrs]}}}})
    print(f"  + available in {len(terrs)} storefronts")


def ensure_review_screenshot(sub_id):
    if not CREATE_SCREENSHOT:
        return
    import hashlib, pathlib
    img = pathlib.Path(__file__).resolve().parent.parent / CREATE_SCREENSHOT
    if not img.exists():
        print(f"  ! review screenshot {CREATE_SCREENSHOT} not found")
        return
    status, j = call("GET", f"/subscriptions/{sub_id}/appStoreReviewScreenshot", ok=(404,))
    if status == 200 and j.get("data"):
        return
    data = img.read_bytes()
    _, res = call("POST", "/subscriptionAppStoreReviewScreenshots", json={"data": {
        "type": "subscriptionAppStoreReviewScreenshots",
        "attributes": {"fileName": img.name, "fileSize": len(data)},
        "relationships": {"subscription": rel("subscriptions", sub_id)}}})
    shot = res["data"]
    for op in shot["attributes"]["uploadOperations"]:
        chunk = data[op["offset"]: op["offset"] + op["length"]]
        headers = {h["name"]: h["value"] for h in op.get("requestHeaders", [])}
        requests.request(op["method"], op["url"], data=chunk, headers=headers, timeout=120).raise_for_status()
    call("PATCH", f"/subscriptionAppStoreReviewScreenshots/{shot['id']}", json={"data": {
        "type": "subscriptionAppStoreReviewScreenshots", "id": shot["id"],
        "attributes": {"uploaded": True, "sourceFileChecksum": hashlib.md5(data).hexdigest()}}})
    print(f"  + review screenshot {img.name}")


def usa_point(sub_id, usd):
    pts, _ = get_all(f"/subscriptions/{sub_id}/pricePoints", {"filter[territory]": "USA"})
    for p in pts:
        if abs(float(p["attributes"]["customerPrice"]) - float(usd)) < 0.001:
            return p
    raise SystemExit(f"No USA price point at ${usd}")


def equalized(point):
    """The USA point plus Apple's equivalent point in every other storefront: [(territory, pointId)]."""
    eq, inc = get_all(f"/subscriptionPricePoints/{point['id']}/equalizations", {"include": "territory"})
    out = [("USA", point["id"])]
    for p in eq:
        terr = p.get("relationships", {}).get("territory", {}).get("data", {}).get("id")
        if terr and terr != "USA":
            out.append((terr, p["id"]))
    return out


def current_usa_price(sub_id):
    prices, inc = get_all(f"/subscriptions/{sub_id}/prices", {"include": "subscriptionPricePoint,territory", "filter[territory]": "USA"})
    points = {i["id"]: i for i in inc if i["type"] == "subscriptionPricePoints"}
    today = datetime.date.today().isoformat()
    best = None
    for p in prices:
        start = p["attributes"].get("startDate") or "0000"
        if start <= today and (best is None or start > (best["attributes"].get("startDate") or "0000")):
            best = p
    if not best:
        return None
    pid = best["relationships"]["subscriptionPricePoint"]["data"]["id"]
    return points.get(pid, {}).get("attributes", {}).get("customerPrice")


def set_base_price(sub_id):
    cur = current_usa_price(sub_id)
    print(f"Current USA price: {cur}")
    if cur and float(cur) == float(BASE_USD):
        print("Base price already set.")
        return
    pairs = equalized(usa_point(sub_id, BASE_USD))
    print(f"Setting ${BASE_USD}/month in {len(pairs)} storefronts (existing subscribers keep their price)...")
    done = 0
    for terr, pid in pairs:
        body = {"data": {"type": "subscriptionPrices",
                         "attributes": {"preserveCurrentPrice": True},
                         "relationships": {"subscription": {"data": {"type": "subscriptions", "id": sub_id}},
                                           "subscriptionPricePoint": {"data": {"type": "subscriptionPricePoints", "id": pid}},
                                           "territory": {"data": {"type": "territories", "id": terr}}}}}
        status, j = call("POST", "/subscriptionPrices", ok=(409,), json=body)
        if status == 409:
            print(f"  {terr}: skipped ({j.get('errors', [{}])[0].get('detail', 'conflict')[:160]})")
        else:
            done += 1
    print(f"Base price set in {done} storefronts.")


def set_intro_offer(sub_id):
    offers, inc = get_all(f"/subscriptions/{sub_id}/introductoryOffers", {"include": "subscriptionPricePoint,territory"})
    points = {i["id"]: i for i in inc if i["type"] == "subscriptionPricePoints"}
    usa = [o for o in offers if o.get("relationships", {}).get("territory", {}).get("data", {}).get("id") == "USA"]
    for o in usa:
        a = o["attributes"]
        pid = (o["relationships"].get("subscriptionPricePoint", {}).get("data") or {}).get("id")
        print(f"Existing USA intro offer: {a.get('offerMode')} {a.get('duration')} x{a.get('numberOfPeriods')} at {points.get(pid, {}).get('attributes', {}).get('customerPrice')}")
    already = any(
        o["attributes"].get("offerMode") == "PAY_UP_FRONT" and o["attributes"].get("duration") == INTRO_DURATION
        and abs(float(points.get((o["relationships"].get("subscriptionPricePoint", {}).get("data") or {}).get("id"), {}).get("attributes", {}).get("customerPrice") or -1) - float(INTRO_USD)) < 0.001
        for o in usa
    )
    if already:
        print("Intro offer already set.")
        return
    print(f"Removing {len(offers)} old introductory offer(s)...")
    for o in offers:
        call("DELETE", f"/subscriptionIntroductoryOffers/{o['id']}", ok=(404, 409))
    pairs = equalized(usa_point(sub_id, INTRO_USD))
    print(f"Creating ${INTRO_USD} for {INTRO_DURATION} (paid up front) in {len(pairs)} storefronts...")
    done = 0
    for terr, pid in pairs:
        body = {"data": {"type": "subscriptionIntroductoryOffers",
                         "attributes": {"offerMode": "PAY_UP_FRONT", "duration": INTRO_DURATION, "numberOfPeriods": 1},
                         "relationships": {"subscription": {"data": {"type": "subscriptions", "id": sub_id}},
                                           "territory": {"data": {"type": "territories", "id": terr}},
                                           "subscriptionPricePoint": {"data": {"type": "subscriptionPricePoints", "id": pid}}}}}
        status, j = call("POST", "/subscriptionIntroductoryOffers", ok=(409,), json=body)
        if status == 409:
            print(f"  {terr}: skipped ({j.get('errors', [{}])[0].get('detail', 'conflict')[:160]})")
        else:
            done += 1
    print(f"Intro offer created in {done} storefronts.")


def main():
    sub = find_subscription()
    print(f"Subscription: {sub['attributes'].get('name')} ({PRODUCT_ID}), state {sub['attributes'].get('state')}")
    ensure_localization(sub["id"])
    ensure_availability(sub["id"])
    set_base_price(sub["id"])
    set_intro_offer(sub["id"])
    ensure_review_screenshot(sub["id"])
    print("Done.")


if __name__ == "__main__":
    main()
