#!/usr/bin/env python3
"""Set iYiYi Pro's App Store pricing through the App Store Connect API.

  Regular price:      $9.99 / month (USA price point; every other storefront gets Apple's
                      equalized price for it). Existing subscribers keep what they pay now.
  Introductory offer: $0.99 paid up front for the first 2 months, new subscribers only,
                      in every storefront (replaces any older introductory offer).

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


def find_subscription():
    groups, _ = get_all(f"/apps/{APP_ID}/subscriptionGroups")
    for g in groups:
        subs, _ = get_all(f"/subscriptionGroups/{g['id']}/subscriptions")
        for s in subs:
            if s["attributes"].get("productId") == PRODUCT_ID:
                return s
    raise SystemExit(f"Subscription {PRODUCT_ID} not found")


def usa_point(sub_id, usd):
    pts, _ = get_all(f"/subscriptions/{sub_id}/pricePoints", {"filter[territory]": "USA"})
    for p in pts:
        if p["attributes"]["customerPrice"] in (usd, usd.rstrip("0")):
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
        and points.get((o["relationships"].get("subscriptionPricePoint", {}).get("data") or {}).get("id"), {}).get("attributes", {}).get("customerPrice") in (INTRO_USD, INTRO_USD.rstrip("0"))
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
    set_base_price(sub["id"])
    set_intro_offer(sub["id"])
    print("Done.")


if __name__ == "__main__":
    main()
