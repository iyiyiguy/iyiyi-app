"""Creates / updates iYiYi's Google Play products (the Android twins of scripts/asc_iaps.py).

  Pro subscription  iyiyi_pro_monthly  base plan "monthly" $9.99/month,
                    intro offer "intro2m": $0.99 up front for the first 2 months (new subscribers)
  UAV packs         iyiyi_uav5 / 20 / 50 / 120      (consumed in the app)
  Grenades          iyiyi_grenade10                 (consumed in the app)
  Guns              iyiyi_gun_<id>                  (kept forever)

Every other country gets Google's converted price for the US price. Safe to run again:
existing products are updated, nothing is deleted.

Auth: Application Default Credentials. In GitHub Actions that's the keyless Workload Identity
login done by google-github-actions/auth (see .github/workflows/play-products.yml).
"""
import json
import re
import os
import sys
from decimal import Decimal

import google.auth
from google.auth.transport.requests import AuthorizedSession

PKG = os.environ.get("PLAY_PACKAGE", "com.iyiyi.app")
API = f"https://androidpublisher.googleapis.com/androidpublisher/v3/applications/{PKG}"
LANG = "en-US"
REGIONS_VERSION = {"regionsVersion.version": "2022/02"}

PRO = {
    "id": "iyiyi_pro_monthly",
    "title": "iYiYi Pro",
    "benefits": ["Every Pro feature", "Laser Tag Pro perks", "Support an indie app"],
    "description": "iYiYi Pro: unlock every Pro feature.",
    "usd": "9.99",
    "intro_usd": "0.99",
    "intro_duration": "P2M",
}

# (product id, title, description, US price) - same names and prices as on iOS.
ONE_TIME = [
    ("iyiyi_uav5", "5 UAVs", "Five UAV scans for Laser Tag.", "0.99"),
    ("iyiyi_uav20", "20 UAVs", "Twenty UAV scans for Laser Tag.", "1.99"),
    ("iyiyi_uav50", "50 UAVs", "Fifty UAV scans for Laser Tag.", "3.99"),
    ("iyiyi_uav120", "120 UAVs", "120 UAV scans for Laser Tag.", "7.99"),
    ("iyiyi_grenade10", "10 Grenades", "Ten grenades for Laser Tag.", "4.99"),
    ("iyiyi_gun_burst", "Burst Rifle", "Laser Tag gun: 3 beams per tap.", "0.99"),
    ("iyiyi_gun_smg", "Pulse SMG", "Laser Tag gun: very fast automatic.", "1.99"),
    ("iyiyi_gun_scatter", "Scatter Blaster", "Laser Tag gun: five-beam spread.", "1.99"),
    ("iyiyi_gun_assault", "Assault Rifle", "Laser Tag gun: automatic fire.", "1.99"),
    ("iyiyi_gun_sniper", "Sniper Rifle", "Laser Tag gun: one-hit tag, 4x scope.", "2.99"),
    ("iyiyi_gun_marksman", "Marksman DMR", "Laser Tag gun: long-range precision.", "2.99"),
    ("iyiyi_gun_minigun", "Minigun", "Laser Tag gun: maximum fire rate.", "2.99"),
    ("iyiyi_gun_railgun", "Ion Railgun", "Laser Tag gun: heavy charged beams.", "4.99"),
]

creds, _ = google.auth.default(scopes=["https://www.googleapis.com/auth/androidpublisher"])
http = AuthorizedSession(creds)
failures = []


def call(method, path, body=None, params=None, ok=(200,)):
    r = http.request(method, f"{API}{path}", json=body, params=params)
    if r.status_code not in ok:
        raise RuntimeError(f"{method} {path} -> {r.status_code}: {r.text[:1500]}")
    return r.json() if r.text else {}


def money(usd):
    d = Decimal(usd)
    units = int(d)
    return {"currencyCode": "USD", "units": str(units), "nanos": int((d - units) * 1_000_000_000)}


def converted(usd):
    """Google's local price for every billable region, for a US price (US only if Google won't convert)."""
    try:
        res = call("POST", "/pricing:convertRegionPrices", {"price": money(usd)})
    except RuntimeError as e:
        print(f"    price conversion unavailable ({str(e)[:120]}...), using the US price only")
        return {"US": money(usd)}, {}
    regions = {code: v["price"] for code, v in res.get("convertedRegionPrices", {}).items()}
    other = res.get("convertedOtherRegionsPrice", {})
    # Use the regions version these prices were converted at (Google rejects mismatched currencies).
    ver = (res.get("regionVersion") or {}).get("version")
    if ver:
        REGIONS_VERSION["regionsVersion.version"] = ver
    return regions, other


def send_fixing_regions(method, path, build, params, regions, usd, tries=40):
    """call() that repairs 'Invalid currency for region code XX ... Expected USD' by pricing XX in
    USD (or dropping XX if Google wants another currency), then retries."""
    for _ in range(tries):
        try:
            return call(method, path, build(), params)
        except RuntimeError as e:
            m = re.search(r"Invalid currency for region code (\w+).*?Expected (\w+)", str(e))
            if not m or m.group(1) not in regions:
                raise
            code, want = m.group(1), m.group(2)
            if want == "USD":
                regions[code] = money(usd)
            else:
                regions.pop(code)
            print(f"    {code}: priced in {want if want == 'USD' else '(dropped)'}")
    raise RuntimeError(f"{path}: too many region fixes")


# ---------- one-time products (guns, UAV packs, grenades) ----------

def new_onetime(pid, title, desc, usd):
    """Google Play one-time products API (the old inappproducts API is retired)."""
    regions, _ = converted(usd)
    build = lambda: {
        "packageName": PKG,
        "productId": pid,
        "listings": [{"languageCode": LANG, "title": title, "description": desc}],
        "purchaseOptions": [{
            "purchaseOptionId": "default",
            "buyOption": {"legacyCompatible": True},
            "regionalPricingAndAvailabilityConfigs": [
                {"regionCode": code, "price": price, "availability": "AVAILABLE"} for code, price in regions.items()
            ],
        }],
    }
    send_fixing_regions("PATCH", f"/onetimeproducts/{pid}", build,
                        {"allowMissing": "true", "updateMask": "listings,purchaseOptions", **REGIONS_VERSION}, regions, usd)
    call("POST", f"/onetimeproducts/{pid}/purchaseOptions:batchUpdateStates", {
        "requests": [{"activatePurchaseOptionRequest": {"packageName": PKG, "productId": pid, "purchaseOptionId": "default"}}]
    })
    return "saved + active"


for pid, title, desc, usd in ONE_TIME:
    try:
        what = new_onetime(pid, title, desc, usd)
        print(f"OK  {pid:22} ${usd}  {what}")
    except Exception as e:  # keep going so one bad product doesn't block the rest
        failures.append(pid)
        print(f"ERR {pid}: {e}")


# ---------- Pro subscription ----------

def pro_subscription():
    pid = PRO["id"]
    regions, other = converted(PRO["usd"])
    def build():
      base_plan = {
        "basePlanId": "monthly",
        "autoRenewingBasePlanType": {"billingPeriodDuration": "P1M", "legacyCompatible": True,
                                     "resubscribeState": "RESUBSCRIBE_STATE_ACTIVE"},
        "regionalConfigs": [{"regionCode": c, "newSubscriberAvailability": True, "price": p} for c, p in regions.items()],
    }
      if other.get("usdPrice") and other.get("eurPrice"):
        base_plan["otherRegionsConfig"] = {"usdPrice": other["usdPrice"], "eurPrice": other["eurPrice"],
                                           "newSubscriberAvailability": True}
      return {
        "packageName": PKG,
        "productId": pid,
        "listings": [{"languageCode": LANG, "title": PRO["title"], "benefits": PRO["benefits"],
                      "description": PRO["description"]}],
        "basePlans": [base_plan],
      }
    r = http.get(f"{API}/subscriptions/{pid}")
    if r.status_code == 200:
        send_fixing_regions("PATCH", f"/subscriptions/{pid}", build, {"updateMask": "listings,basePlans", **REGIONS_VERSION}, regions, PRO["usd"])
        print(f"OK  {pid:22} ${PRO['usd']}/month  updated")
    else:
        send_fixing_regions("POST", "/subscriptions", build, {"productId": pid, **REGIONS_VERSION}, regions, PRO["usd"])
        print(f"OK  {pid:22} ${PRO['usd']}/month  created")

    state = call("GET", f"/subscriptions/{pid}")
    bp = next((b for b in state.get("basePlans", []) if b["basePlanId"] == "monthly"), {})
    if bp.get("state") != "ACTIVE":
        call("POST", f"/subscriptions/{pid}/basePlans/monthly:activate",
             {"packageName": PKG, "productId": pid, "basePlanId": "monthly"})
        print("    base plan 'monthly' activated")

    # Intro offer: $0.99 paid once for the first 2 months, new subscribers only.
    intro, intro_other = converted(PRO["intro_usd"])
    offer_id = "intro2m"
    def build_offer():
      phase = {
        "recurrenceCount": 1,
        "duration": PRO["intro_duration"],
        "regionalConfigs": [{"regionCode": c, "price": p} for c, p in intro.items() if c in regions],
    }
      if intro_other.get("usdPrice") and intro_other.get("eurPrice"):
        phase["otherRegionsConfig"] = {"usdPrice": intro_other["usdPrice"], "eurPrice": intro_other["eurPrice"]}
      offer = {
        "packageName": PKG,
        "productId": pid,
        "basePlanId": "monthly",
        "offerId": offer_id,
        "phases": [phase],
        "targeting": {"acquisitionRule": {"scope": {"thisSubscription": {}}}},
        "regionalConfigs": [{"regionCode": c, "newSubscriberAvailability": True} for c in regions if c in intro],
    }
      if "otherRegionsConfig" in phase:
        offer["otherRegionsConfig"] = {"otherRegionsNewSubscriberAvailability": True}
      return offer
    base = f"/subscriptions/{pid}/basePlans/monthly/offers"
    r = http.get(f"{API}{base}/{offer_id}")
    if r.status_code == 200:
        send_fixing_regions("PATCH", f"{base}/{offer_id}", build_offer, {"updateMask": "phases,targeting,regionalConfigs,otherRegionsConfig", **REGIONS_VERSION}, intro, PRO["intro_usd"])
    else:
        send_fixing_regions("POST", base, build_offer, {"offerId": offer_id, **REGIONS_VERSION}, intro, PRO["intro_usd"])
    o = call("GET", f"{base}/{offer_id}")
    if o.get("state") != "ACTIVE":
        call("POST", f"{base}/{offer_id}:activate",
             {"packageName": PKG, "productId": pid, "basePlanId": "monthly", "offerId": offer_id})
    print(f"    intro offer '{offer_id}': ${PRO['intro_usd']} for the first 2 months  active")


try:
    pro_subscription()
except Exception as e:
    failures.append(PRO["id"])
    print(f"ERR {PRO['id']}: {e}")

print()
if failures:
    print(f"{len(failures)} product(s) failed: {', '.join(failures)}")
    sys.exit(1)
print(f"All {len(ONE_TIME) + 1} Google Play products are set up.")
