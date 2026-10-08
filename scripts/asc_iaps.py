#!/usr/bin/env python3
"""Create iYiYi's one-time In-App Purchases in App Store Connect (idempotent).

  UAV packs (Consumable)       com.iYiYi.uav5 / uav20 / uav50 / uav120
  Guns (Non-Consumable)        com.iYiYi.gun.<id>

For each product it makes sure that the product exists, has an English name and description,
a USA price (other storefronts get Apple's equalized price), is available in every storefront,
and, if an image exists at store-assets/iap-review/<productId>.png (or .jpg), has that image as
its App Review screenshot. Products that already exist are only filled in where something is
missing. Uses the same ASC_KEY_ID / ASC_ISSUER_ID / ASC_KEY_P8 secrets as the other scripts.

Submitting the products for review is done in App Store Connect together with the app version
(an In-App Purchase can't be reviewed without a review screenshot).
"""
import hashlib, os, pathlib, re, sys, textwrap, time
import jwt, requests

APP_ID = os.environ.get("ASC_APP_ID", "6445996160")
ROOT = pathlib.Path(__file__).resolve().parent.parent
SHOTS = ROOT / "store-assets" / "iap-review"
API = "https://api.appstoreconnect.apple.com"

PRODUCTS = [
    # productId, type, reference name, display name, description (<=55 chars), USD
    ("com.iYiYi.uav5", "CONSUMABLE", "UAV pack 5", "5 UAVs", "Five UAV scans for Laser Tag.", "0.99"),
    ("com.iYiYi.uav20", "CONSUMABLE", "UAV pack 20", "20 UAVs", "Twenty UAV scans for Laser Tag.", "1.99"),
    ("com.iYiYi.uav50", "CONSUMABLE", "UAV pack 50", "50 UAVs", "Fifty UAV scans for Laser Tag.", "3.99"),
    ("com.iYiYi.uav120", "CONSUMABLE", "UAV pack 120", "120 UAVs", "120 UAV scans for Laser Tag.", "7.99"),
    ("com.iYiYi.gun.burst", "NON_CONSUMABLE", "Gun Burst Rifle", "Burst Rifle", "Laser Tag gun: 3 beams per tap.", "0.99"),
    ("com.iYiYi.gun.smg", "NON_CONSUMABLE", "Gun Pulse SMG", "Pulse SMG", "Laser Tag gun: very fast automatic.", "1.99"),
    ("com.iYiYi.gun.scatter", "NON_CONSUMABLE", "Gun Scatter Blaster", "Scatter Blaster", "Laser Tag gun: five-beam spread.", "1.99"),
    ("com.iYiYi.gun.assault", "NON_CONSUMABLE", "Gun Assault Rifle", "Assault Rifle", "Laser Tag gun: automatic fire.", "1.99"),
    ("com.iYiYi.gun.sniper", "NON_CONSUMABLE", "Gun Sniper Rifle", "Sniper Rifle", "Laser Tag gun: one-hit tag, 4x scope.", "2.99"),
    ("com.iYiYi.gun.marksman", "NON_CONSUMABLE", "Gun Marksman DMR", "Marksman DMR", "Laser Tag gun: long-range precision.", "2.99"),
    ("com.iYiYi.gun.minigun", "NON_CONSUMABLE", "Gun Minigun", "Minigun", "Laser Tag gun: maximum fire rate.", "2.99"),
    ("com.iYiYi.gun.railgun", "NON_CONSUMABLE", "Gun Ion Railgun", "Ion Railgun", "Laser Tag gun: heavy charged beams.", "4.99"),
]
REVIEW_NOTE = ("Laser Tag item. In the app: Arcade > Laser Tag > Shop (or the UAV button in a match). "
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
            raise RuntimeError(f"{method} {path} -> {r.status_code}: {r.text[:1500]}")
        return r.status_code, (r.json() if r.content else {})
    raise RuntimeError(f"{method} {path}: gave up")


def get_all(path, params=None):
    out, params, url = [], dict(params or {}), path
    params.setdefault("limit", 200)
    while url:
        _, j = call("GET", url, params=params if url == path else None)
        out += j.get("data", [])
        url = j.get("links", {}).get("next")
    return out


def rel(type_, id_):
    return {"data": {"type": type_, "id": id_}}


def existing_iaps():
    return {i["attributes"]["productId"]: i for i in get_all(f"/v1/apps/{APP_ID}/inAppPurchasesV2")}


def ensure_iap(pid, kind, ref, have):
    if pid in have:
        print(f"{pid}: exists ({have[pid]['attributes'].get('state')})")
        return have[pid]["id"]
    _, j = call("POST", "/v2/inAppPurchases", json={"data": {
        "type": "inAppPurchases",
        "attributes": {"name": ref, "productId": pid, "inAppPurchaseType": kind, "reviewNote": REVIEW_NOTE, "familySharable": False},
        "relationships": {"app": rel("apps", APP_ID)},
    }})
    print(f"{pid}: created")
    return j["data"]["id"]


def ensure_localization(iap_id, name, desc):
    locs = get_all(f"/v2/inAppPurchases/{iap_id}/inAppPurchaseLocalizations")
    if any(l["attributes"].get("locale") == "en-US" for l in locs):
        return
    call("POST", "/v1/inAppPurchaseLocalizations", json={"data": {
        "type": "inAppPurchaseLocalizations",
        "attributes": {"locale": "en-US", "name": name, "description": desc},
        "relationships": {"inAppPurchaseV2": rel("inAppPurchases", iap_id)},
    }})
    print("   + English name/description")


def ensure_price(iap_id, usd):
    status, j = call("GET", f"/v2/inAppPurchases/{iap_id}/iapPriceSchedule", ok=(404,))
    if status == 200 and j.get("data"):
        _, mp = call("GET", f"/v1/inAppPurchasePriceSchedules/{j['data']['id']}/manualPrices", ok=(404,))
        if mp.get("data"):
            return
    points = get_all(f"/v2/inAppPurchases/{iap_id}/pricePoints", {"filter[territory]": "USA"})
    point = next((p for p in points if p["attributes"]["customerPrice"] in (usd, usd.rstrip("0"))), None)
    if not point:
        raise RuntimeError(f"no USA price point at ${usd}")
    call("POST", "/v1/inAppPurchasePriceSchedules", json={
        "data": {"type": "inAppPurchasePriceSchedules", "relationships": {
            "inAppPurchase": rel("inAppPurchases", iap_id),
            "baseTerritory": rel("territories", "USA"),
            "manualPrices": {"data": [{"type": "inAppPurchasePrices", "id": "${price1}"}]},
        }},
        "included": [{"type": "inAppPurchasePrices", "id": "${price1}",
                      "attributes": {"startDate": None},
                      "relationships": {"inAppPurchasePricePoint": rel("inAppPurchasePricePoints", point["id"])}}],
    })
    print(f"   + price ${usd}")


_TERRITORIES = None


def ensure_availability(iap_id):
    global _TERRITORIES
    status, j = call("GET", f"/v2/inAppPurchases/{iap_id}/inAppPurchaseAvailability", ok=(404,))
    if status == 200 and j.get("data"):
        return
    if _TERRITORIES is None:
        _TERRITORIES = [t["id"] for t in get_all("/v1/territories")]
    call("POST", "/v1/inAppPurchaseAvailabilities", json={"data": {
        "type": "inAppPurchaseAvailabilities",
        "attributes": {"availableInNewTerritories": True},
        "relationships": {
            "inAppPurchase": rel("inAppPurchases", iap_id),
            "availableTerritories": {"data": [{"type": "territories", "id": t} for t in _TERRITORIES]},
        },
    }})
    print(f"   + available in {len(_TERRITORIES)} storefronts")


def ensure_screenshot(iap_id, pid):
    # Most specific first: this product, then its kind (a real in-app Shop screenshot), then default.
    kind = "uav" if ".uav" in pid else "gun" if ".gun." in pid else "other"
    names = (f"{pid}.png", f"{pid}.jpg", f"{kind}.png", f"{kind}.jpg", "default.png", "default.jpg")
    img = next((SHOTS / n for n in names if (SHOTS / n).exists()), None)
    if not img:
        print("   ! no review screenshot yet (store-assets/iap-review/<productId>.png)")
        return
    status, j = call("GET", f"/v2/inAppPurchases/{iap_id}/appStoreReviewScreenshot", ok=(404,))
    if status == 200 and j.get("data"):
        attrs = j["data"].get("attributes") or {}
        current = attrs.get("fileName")
        state = ((attrs.get("assetDeliveryState") or {}).get("state") or "").upper()
        if attrs.get("sourceFileChecksum") == hashlib.md5(img.read_bytes()).hexdigest() and state != "FAILED":
            return
        # A different (older) screenshot is attached: replace it with the better one.
        call("DELETE", f"/v1/inAppPurchaseAppStoreReviewScreenshots/{j['data']['id']}", ok=(404, 409))
        print(f"   - removed old review screenshot {current}")
    data = img.read_bytes()
    _, res = call("POST", "/v1/inAppPurchaseAppStoreReviewScreenshots", json={"data": {
        "type": "inAppPurchaseAppStoreReviewScreenshots",
        "attributes": {"fileName": img.name, "fileSize": len(data)},
        "relationships": {"inAppPurchaseV2": rel("inAppPurchases", iap_id)},
    }})
    shot = res["data"]
    for op in shot["attributes"]["uploadOperations"]:
        chunk = data[op["offset"]: op["offset"] + op["length"]]
        headers = {h["name"]: h["value"] for h in op.get("requestHeaders", [])}
        requests.request(op["method"], op["url"], data=chunk, headers=headers, timeout=120).raise_for_status()
    call("PATCH", f"/v1/inAppPurchaseAppStoreReviewScreenshots/{shot['id']}", json={"data": {
        "type": "inAppPurchaseAppStoreReviewScreenshots", "id": shot["id"],
        "attributes": {"uploaded": True, "sourceFileChecksum": hashlib.md5(data).hexdigest()},
    }})
    print(f"   + review screenshot {img.name}")


def main():
    have = existing_iaps()
    failures = 0
    for pid, kind, ref, name, desc, usd in PRODUCTS:
        try:
            iap_id = ensure_iap(pid, kind, ref, have)
            ensure_localization(iap_id, name, desc)
            ensure_price(iap_id, usd)
            ensure_availability(iap_id)
            ensure_screenshot(iap_id, pid)
        except Exception as e:  # keep going so one bad product doesn't block the rest
            failures += 1
            print(f"{pid}: FAILED {e}")
    print("Done." if not failures else f"Done with {failures} failure(s).")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
