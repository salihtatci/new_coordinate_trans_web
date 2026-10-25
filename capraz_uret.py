"""capraz_uret.py - jeodezi.py (Python) ile 2.000+ rastgele donusum vakasi uretir;
capraz_karsilastir.js ayni vakalari docs/js/jeodezi.js ile hesaplayip karsilastirir.
Calistirma:  python web_tests/capraz_uret.py  &&  node web_tests/capraz_karsilastir.js
"""
import sys, json, random, os
KOK = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, KOK)
import jeodezi as jz
random.seed(7)
S = list(jz.SISTEMLER); M = [jz.MODEL_IERS, jz.MODEL_SABIT, jz.MODEL_BW, jz.MODEL_MB, jz.MODEL_ELIPS]
cases = []
for k in S:
    for h in S:
        for m in M:
            for ep in ([2025.0, 2010.5] if m != jz.MODEL_ELIPS else [None]) + [None]:
                phi, lam, hh = random.uniform(35, 43), random.uniform(25, 45), random.uniform(-50, 4000)
                el = jz.SISTEMLER[k]
                X = jz.geo_to_cart(phi, lam, hh, el)
                e = jz.parametre_bul(k, h, m, ep)
                c = dict(k=k, h=h, m=m, ep=ep, X=list(X), bulundu=e.bulundu, yon=e.yon, kurum=e.kurum, kod=e.kod,
                         T=list(e.T) if e.T is not None else None, D=e.D, R=list(e.R) if e.R is not None else None,
                         merkez=list(e.merkez) if e.merkez else None, ayrinti=e.ayrinti, mesaj=e.mesaj, ters=e.ters)
                if e.bulundu:
                    X2, e2, rap = jz.donustur(X, k, h, m, ep)
                    c["X2"] = list(X2)
                    c["geo2"] = list(jz.cart_to_geo(*X2, jz.SISTEMLER[h]))[:3]
                    c["geo2b"] = list(jz.cart_to_geo(*X2, jz.SISTEMLER[h], "bowring"))[:3]
                    c["enu"] = list(jz.enu_farki([X2[i]-X[i] for i in range(3)], phi, lam))
                cases.append(c)
for t in ["39 55 30.0", "32 51 7.5 W", "-0 30 0", "41.1055", "29°01'25.3\"E", "36 30 0 G", "40 0 59.999999 K"]:
    v = jz.aci_oku(t); cases.append(dict(aci=t, deger=v, dms=jz.dms(v)))
json.dump(cases, open(os.path.join(KOK, "web_tests", "capraz_vakalar.json"), "w"))
print(len(cases))
