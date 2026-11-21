"""
test_proj.py - cekirdegi BAGIMSIZ bir referansla (PROJ, pyproj uzerinden) karsilastirir.
Calistirma:  pip install pyproj   (bir kez)
             python test_proj.py

test_jeodezi.py cekirdegin kendi icinde tutarli oldugunu (gidis-donus, EPSG ornekleri) denetler.
Bu dosya ise ayni hesaplari PROJ ile yapip sonuclari karsilastirir; parametre tablosundaki bir
yanlisi (yanlis epok, yanlis isaret, yanlis birim) ancak boyle bir karsilastirma yakalar.
Ornek: ITRF2014 -> ETRF2000 parametreleri once 2000.0 epogundaki degerlerle t0 = 2010.0 olarak
girilmisti; test_jeodezi.py bunu yakalamadi, PROJ ile 2025.0'da 0.226 m fark cikti.

pyproj kurulu degilse test atlanir (cikis kodu 0).
"""
import math
import sys

import jeodezi as jz

try:
    import pyproj
    from pyproj import Transformer
except ImportError:
    print("pyproj kurulu degil: 'pip install pyproj' ile kurup tekrar calistirin. PROJ testi atlandi.")
    sys.exit(0)

TOL_M = 1e-6          # tum karsilastirmalarda izin verilen en buyuk fark [m]
A = 6378137.0         # aci farkini yerde metreye cevirmek icin

# Turkiye'nin farkli bolgelerinden test noktalari: (ad, enlem, boylam, h)
NOKTALAR = [
    ("Istanbul (ITU Ayazaga)", 41.1055, 29.0237, 120.0),
    ("Ankara", 39.925, 32.8369, 938.0),
    ("Izmir", 38.4237, 27.1428, 50.0),
    ("Erzurum", 39.9043, 41.2679, 1900.0),
    ("Antalya", 36.8969, 30.7133, 30.0),
]


def fark_xyz(a, b):
    return max(abs(a[i] - b[i]) for i in range(3))


def fark_yerde(phi1, lam1, phi2, lam2, phi_ref):
    """Iki enlem/boylam arasindaki farki yerde metre olarak (kuzey, dogu) verir."""
    dn = math.radians(phi1 - phi2) * A
    de = math.radians(lam1 - lam2) * A * math.cos(math.radians(phi_ref))
    return max(abs(dn), abs(de))


def test_cografi_kartezyen():
    t = Transformer.from_pipeline("+proj=cart +ellps=GRS80")
    en_buyuk = 0.0
    for ad, p, l, h in NOKTALAR:
        X = jz.geo_to_cart(p, l, h, "GRS80")
        Xp = t.transform(l, p, h)
        d = fark_xyz(X, Xp)
        en_buyuk = max(en_buyuk, d)
        assert d < TOL_M, (ad, X, Xp)
    print(f"OK  Cografi -> Kartezyen (GRS80)        en buyuk fark {en_buyuk:.1e} m")


def test_kartezyen_cografi():
    t = Transformer.from_pipeline("+proj=pipeline +step +inv +proj=cart +ellps=GRS80")
    for yontem in ("iteratif", "bowring"):
        en_buyuk = 0.0
        for ad, p, l, h in NOKTALAR:
            X = jz.geo_to_cart(p, l, h, "GRS80")
            lp, pp, hp = t.transform(*X)
            pg, lg, hg, _ = jz.cart_to_geo(*X, "GRS80", yontem=yontem)
            d = max(fark_yerde(pg, lg, pp, lp, p), abs(hg - hp))
            en_buyuk = max(en_buyuk, d)
            assert d < TOL_M, (ad, yontem, d)
        print(f"OK  Kartezyen -> Cografi ({yontem:8s})    en buyuk fark {en_buyuk:.1e} m")


def test_bursa_wolf_pv_cf():
    """EPSG GN 7-2 ornegi (WGS72 -> WGS84), PV ve CF konvansiyonu."""
    X1 = (3657660.66, 255768.55, 5201382.11)
    for konv, conv, rz in (("PV", "position_vector", 0.554), ("CF", "coordinate_frame", -0.554)):
        X2 = jz.bursa_wolf(X1, 0, 0, 4.5, 0.219, 0, 0, rz, konv)
        t = Transformer.from_pipeline(
            f"+proj=helmert +x=0 +y=0 +z=4.5 +rx=0 +ry=0 +rz={rz} +s=0.219 +convention={conv}")
        Xp = t.transform(*X1)
        assert fark_xyz(X2, Xp) < TOL_M, (konv, X2, Xp)
    print("OK  Bursa-Wolf PV / CF (EPSG GN 7-2)     PROJ helmert ile ayni")


def test_ed50_wgs84_epsg1784():
    """Kayitli ED50 seti, PROJ'un kendi EPSG:1784 kaydiyla."""
    t = Transformer.from_pipeline("urn:ogc:def:coordinateOperation:EPSG::1784")
    en_buyuk = 0.0
    for ad, p, l, _ in NOKTALAR:
        X = jz.geo_to_cart(p, l, 0.0, "Hayford (International 1924)")
        X2, e, _ = jz.donustur(X, "ED50 (Hayford)", "WGS84 (EPSG ensemble)", jz.MODEL_BW)
        pg, lg, _, _ = jz.cart_to_geo(*X2, "WGS84")
        pp, lp = t.transform(p, l)            # EPSG eksen sirasi: enlem, boylam
        d = fark_yerde(pg, lg, pp, lp, p)
        en_buyuk = max(en_buyuk, d)
        assert d < TOL_M, (ad, d)
    assert "1784" in e.kod
    print(f"OK  ED50 -> WGS84 (EPSG:1784)           en buyuk fark {en_buyuk:.1e} m")


def test_iers_14_parametre():
    """ITRF'ler arasi zamana bagli Helmert, PROJ'un ITRF2020 / ITRF2014 tanim dosyalariyla."""
    ciftler = [("ITRF2020", "ITRF2014", "ITRF2020:ITRF2014"),
               ("ITRF2020", "ITRF2008", "ITRF2020:ITRF2008"),
               ("ITRF2020", "ITRF2005", "ITRF2020:ITRF2005"),
               ("ITRF2020", "ITRF2000", "ITRF2020:ITRF2000"),
               ("ITRF2020", "ITRF97", "ITRF2020:ITRF97"),
               ("ITRF2020", "ITRF96 (TUREF)", "ITRF2020:ITRF96"),
               ("ITRF2014", "ITRF2008", "ITRF2014:ITRF2008")]
    en_buyuk = 0.0
    for kaynak, hedef, init in ciftler:
        t = Transformer.from_pipeline(f"+init={init}")
        for epok in (2000.0, 2015.0, 2025.0):
            for ad, p, l, h in NOKTALAR:
                X = jz.geo_to_cart(p, l, h, "GRS80")
                X2, _, _ = jz.donustur(X, kaynak, hedef, jz.MODEL_IERS, epok=epok)
                Xp = t.transform(X[0], X[1], X[2], epok)
                d = fark_xyz(X2, Xp[:3])
                en_buyuk = max(en_buyuk, d)
                assert d < TOL_M, (kaynak, hedef, epok, ad, d)
    print(f"OK  IERS 14 p. ({len(ciftler)} cift, 3 epok)        en buyuk fark {en_buyuk:.1e} m")


def test_itrf2014_etrf2000():
    """EUREF TN-1 = EPSG:8405 (t0 = 2010.0). PROJ: EPSG:7789 (ITRF2014) -> EPSG:7930 (ETRF2000)."""
    t = Transformer.from_crs("EPSG:7789", "EPSG:7930", always_xy=True)
    assert "ETRF2000" in t.description, t.description
    en_buyuk = 0.0
    for epok in (2005.0, 2010.0, 2025.0):
        for ad, p, l, h in NOKTALAR:
            X = jz.geo_to_cart(p, l, h, "GRS80")
            X2, _, _ = jz.donustur(X, "ITRF2014", "ETRF2000 (ETRS89)", jz.MODEL_IERS, epok=epok)
            Xp = t.transform(X[0], X[1], X[2], epok)
            d = fark_xyz(X2, Xp[:3])
            en_buyuk = max(en_buyuk, d)
            assert d < TOL_M, (epok, ad, d)
    print(f"OK  ITRF2014 -> ETRF2000 (EPSG:8405)    en buyuk fark {en_buyuk:.1e} m")


def test_tutga_gercek_veri():
    """Gullu vd. (2018), AKU FEMUBID 18, 015503: 15 TUTGA noktasi, ITRF96 ve ED50 X, Y, Z.
    EPSG:1784 ulke geneli bir settir (dogruluk 2 m); sonuc bilgi amaclidir, sinir 2 m."""
    TUTGA = [
        (4284861.931, 2538541.110, 3973109.010, 4284947.199, 2538630.823, 3973234.417),
        (4201184.690, 2528524.731, 4066866.008, 4201270.025, 2528614.539, 4066991.308),
        (4299501.236, 2505062.226, 3978556.005, 4299586.423, 2505151.942, 3978681.378),
        (4272461.050, 2616187.214, 3935905.446, 4272546.480, 2616276.901, 3936030.956),
        (4322917.187, 2609899.178, 3885322.285, 4323002.553, 2609988.816, 3885447.843),
        (4290148.202, 2488873.730, 3998465.504, 4290233.368, 2488963.465, 3998590.843),
        (4418921.703, 2438194.087, 3888315.820, 4419006.635, 2438283.716, 3888441.233),
        (4365617.137, 2579609.728, 3857311.647, 4365702.400, 2579699.338, 3857437.209),
        (4387629.038, 2493404.563, 3888738.782, 4387714.111, 2493494.195, 3888864.240),
        (4296762.968, 2463101.038, 4007371.009, 4296848.076, 2463190.779, 4007496.317),
        (4272859.808, 2421209.177, 4057249.465, 4272944.860, 2421298.966, 4057374.686),
        (4215603.138, 2602510.120, 4005097.586, 4215688.602, 2602599.874, 4005223.012),
        (4346000.446, 2450877.271, 3961390.281, 4346085.479, 2450966.967, 3961515.627),
        (4453142.026, 2442527.123, 3845873.502, 4453226.931, 2442616.717, 3845998.962),
        (4251372.878, 2566687.782, 3990718.545, 4251458.235, 2566777.517, 3990843.957),
    ]
    kt = 0.0
    for x, y, z, ex, ey, ez in TUTGA:
        X2, _, _ = jz.donustur((x, y, z), "WGS84 (EPSG ensemble)", "ED50 (Hayford)", jz.MODEL_BW)
        p, l, _, _ = jz.cart_to_geo(x, y, z, "GRS80")
        e, n, _ = jz.enu_farki((X2[0] - ex, X2[1] - ey, X2[2] - ez), p, l)
        kt += e * e + n * n
    koh = math.sqrt(kt / len(TUTGA))
    assert koh < 2.0, koh
    print(f"OK  TUTGA ITRF96 -> ED50 (EPSG:1784)    yatay KOH {koh:.2f} m (EPSG dogrulugu 2 m)")


if __name__ == "__main__":
    print(f"PROJ {pyproj.proj_version_str}, pyproj {pyproj.__version__}")
    test_cografi_kartezyen()
    test_kartezyen_cografi()
    test_bursa_wolf_pv_cf()
    test_ed50_wgs84_epsg1784()
    test_iers_14_parametre()
    test_itrf2014_etrf2000()
    test_tutga_gercek_veri()
    print("\nTum PROJ karsilastirmalari gecti.")
