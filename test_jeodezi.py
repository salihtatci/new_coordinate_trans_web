"""
test_jeodezi.py - cekirdegin dogrulugunu bilinen orneklerle kontrol eder.
Calistirma:  python test_jeodezi.py
"""
import math
import jeodezi as jz


def yakin(a, b, tol):
    return all(abs(x - y) <= tol for x, y in zip(a, b))


def test_gidis_donus():
    """Cografi -> Kartezyen -> Cografi kapanmasi (her iki ters yontem)."""
    for el in jz.ELIPSOITLER:
        for phi, lam, h in [(0, 0, 0), (39.925, 32.8369, 938), (-33.9, 151.2, 50),
                            (89.9999, -120, 3000), (-45, -179.9, -30)]:
            X = jz.geo_to_cart(phi, lam, h, el)
            for yon in ("iteratif", "bowring"):
                p2, l2, h2, _ = jz.cart_to_geo(*X, el, yon)
                assert abs(p2 - phi) < 1e-9 and abs(l2 - lam) < 1e-9 and abs(h2 - h) < 1e-4, (el, yon, phi)
    print("OK  gidis-donus (tum elipsoitler, iki yontem)")


def test_epsg_bursa_wolf():
    """EPSG Guidance Note 7-2: Position Vector ve Coordinate Frame ornekleri."""
    X1 = (3657660.66, 255768.55, 5201382.11)
    beklenen = (3657660.78, 255778.43, 5201387.75)
    pv = jz.bursa_wolf(X1, 0, 0, 4.5, 0.219, 0, 0, 0.554, "PV")
    cf = jz.bursa_wolf(X1, 0, 0, 4.5, 0.219, 0, 0, -0.554, "CF")
    assert yakin(pv, beklenen, 0.01) and yakin(cf, beklenen, 0.01), (pv, cf)
    geri = jz.ters_cevir_7(pv, jz.bursa_wolf, 0, 0, 4.5, 0.219, 0, 0, 0.554, konvansiyon="PV")
    assert yakin(geri, X1, 1e-6)
    print("OK  EPSG 7-2 Bursa-Wolf (PV/CF) + kesin ters")


def test_mb_bw_esdegerligi():
    """Merkez = 0 iken Molodensky-Badekas == Bursa-Wolf olmali."""
    X = (4116037.2588, 2656358.3524, 4072204.7958)
    p = (12.3, -45.6, 7.8, 1.5, 0.3, -0.7, 1.1)
    assert yakin(jz.bursa_wolf(X, *p), jz.molodensky_badekas(X, *p, (0, 0, 0)), 1e-9)
    print("OK  Molodensky-Badekas(merkez=0) == Bursa-Wolf")


def test_wgs84_grs80():
    """Ayni XYZ: WGS84 ve GRS80 cografi koordinatlari mm-alti farkli olmali."""
    X = jz.geo_to_cart(45, 30, 100, "GRS80")
    p1, l1, h1, _ = jz.cart_to_geo(*X, "GRS80")
    p2, l2, h2, _ = jz.cart_to_geo(*X, "WGS84")
    assert abs(h1 - h2) < 0.0002 and abs(p1 - p2) * 3600 < 1e-4
    print(f"OK  WGS84-GRS80 farki: dh = {(h2-h1)*1000:.4f} mm, dphi = {(p2-p1)*3600*1e6:.2f} mikro-sn")


def test_itrf_zincir_kapanmasi():
    """A -> B -> A gidis-donusu ~0 olmali; t0'da hizlarin etkisi olmamali."""
    X = (4116037.2588, 2656358.3524, 4072204.7958)
    for a, b in [("ITRF2020", "ITRF96 (TUREF)"), ("WGS84 (G1762)", "ETRF2000 (ETRS89)"),
                 ("ITRF2014", "ITRF2005")]:
        Y, _ = jz.sistemler_arasi(X, a, b, 2025.0)
        Z, _ = jz.sistemler_arasi(Y, b, a, 2025.0)
        assert yakin(X, Z, 1e-4), (a, b)
    h = jz.DONUSUMLER[("ITRF2014", "ITRF2008")]
    assert yakin(h.uygula(X, h.t0, True), h.uygula(X, 0, False), 1e-12)
    print("OK  ITRF zincir gidis-donus ve t0 kontrolu")


# ===========================================================================
# OTOMATIK PARAMETRE ESLESTIRME (kaynak, hedef, model)
# ===========================================================================
ED50, WGS_ENS = "ED50 (Hayford)", "WGS84 (EPSG ensemble)"
X_TR = jz.geo_to_cart(39.925, 32.8369, 938.0, "Hayford (International 1924)")   # Ankara
EPSG72 = (0, 0, 4.5, 0.219, 0, 0, 0.554)     # EPSG 7-2 TEST ornegi (WGS72 -> WGS84)


def test_1_otomatik_secim():
    """1) Kaynak/hedef/model secilince dogru parametre gelir."""
    e = jz.parametre_bul(ED50, WGS_ENS, jz.MODEL_BW)
    assert e.bulundu and e.yon == "ileri" and not e.ters
    assert e.T == (-84.1, -101.8, -129.7) and e.D == 1.05 and e.R == (0.0, 0.0, 0.468)
    assert e.konvansiyon == "PV" and e.kurum == "EPSG" and "1784" in e.kod
    e = jz.parametre_bul("WGS84 (G2139)", "ITRF96 (TUREF)", jz.MODEL_IERS, 2025.0)
    assert e.bulundu and e.yon == "zincir" and len(e.zincir) == 3
    assert [(a, b) for _, a, b in e.zincir] == [("WGS84 (G2139)", "ITRF2014"),
                                                 ("ITRF2014", "ITRF2020"),
                                                 ("ITRF2020", "ITRF96 (TUREF)")]
    assert "IERS" in e.kurum and e.konvansiyon == "PV"
    print("OK  1) otomatik parametre secimi (ED50->WGS84 BW = EPSG:1784; WGS84(G2139)->ITRF96 IERS zinciri)")


def test_2_3_4_kaynak_hedef_model_degisimi():
    """2) kaynak, 3) hedef, 4) model degisince parametre degisir."""
    t = 2025.0
    a = jz.parametre_bul("ITRF2020", "ITRF2008", jz.MODEL_IERS, t)
    b = jz.parametre_bul("ITRF2014", "ITRF2008", jz.MODEL_IERS, t)     # kaynak degisti
    c = jz.parametre_bul("ITRF2020", "ITRF2014", jz.MODEL_IERS, t)     # hedef degisti
    assert a.T != b.T and a.T != c.T and b.T != c.T
    # tek adimli kayitlarda gosterilen deger = IERS tablosu P(t) (mm -> m)
    assert yakin(b.T, [(1.6 + 0.0 * 15) * 1e-3, (1.9 + 0.0 * 15) * 1e-3, (2.4 - 0.1 * 15) * 1e-3], 1e-12)
    # model degisimi: ayni cift, farkli model -> hepsi otomatik bulunur ve modele ozgudur
    iers = jz.parametre_bul("ITRF2020", "ITRF96 (TUREF)", jz.MODEL_IERS, t)
    sabit = jz.parametre_bul("ITRF2020", "ITRF96 (TUREF)", jz.MODEL_SABIT, t)
    bw = jz.parametre_bul("ITRF2020", "ITRF96 (TUREF)", jz.MODEL_BW, t)
    mb = jz.parametre_bul("ITRF2020", "ITRF96 (TUREF)", jz.MODEL_MB, t)
    assert iers.bulundu and sabit.bulundu and bw.bulundu and mb.bulundu
    assert iers.T != sabit.T and bw.T != mb.T
    assert mb.merkez == (4116000.0, 2656000.0, 4072000.0)
    bw_ed = jz.parametre_bul(ED50, WGS_ENS, jz.MODEL_BW)
    mb_ed = jz.parametre_bul(ED50, WGS_ENS, jz.MODEL_MB)
    assert bw_ed.bulundu and mb_ed.bulundu and bw_ed.T != mb_ed.T
    assert mb_ed.merkez == (4116000.0, 2656000.0, 4072000.0)
    print("OK  2-3-4) kaynak / hedef / model degisince parametre degisiyor")


def test_5_bulunamayan_ornek_deger_kullanmaz():
    """5) Gecersiz/baglantisiz sistemde kayit yoksa 0 / EPSG 7-2 ornek degerleri KULLANILMAZ."""
    for k, h, m in [("BilinmeyenDatum", "ITRF96 (TUREF)", jz.MODEL_IERS),
                    ("BilinmeyenDatum", WGS_ENS, jz.MODEL_BW),
                    (ED50, "BilinmeyenHedef", jz.MODEL_MB)]:
        e = jz.parametre_bul(k, h, m, 2025.0)
        assert not e.bulundu and e.T is None and e.D is None and e.R is None, (k, h, m)
        try:
            jz.donustur(X_TR, k, h, m, 2025.0)
            raise AssertionError("ParametreBulunamadi bekleniyordu")
        except (jz.ParametreBulunamadi, KeyError):
            pass
    for ps in jz.PARAMETRE_DB.values():                      # ornek set veritabaninda yok
        assert (*ps.T, ps.D, *ps.R) != EPSG72
    print("OK  5) kayit yoksa uyari; 0 / EPSG 7-2 ornek degeri kullanilmiyor")


def test_6_ters_yon():
    """6) Kaynak<->hedef: kayitli setin KESIN tersi (isaret cevirme degil)."""
    ileri, e1, _ = jz.donustur(X_TR, ED50, WGS_ENS, jz.MODEL_BW)
    geri, e2, _ = jz.donustur(ileri, WGS_ENS, ED50, jz.MODEL_BW)
    assert e2.yon == "ters" and e2.ters and e2.set is e1.set
    assert e2.T == e1.T and e2.R == e1.R                     # parametreler degistirilmedi
    assert yakin(geri, X_TR, 1e-6), [geri[i] - X_TR[i] for i in range(3)]
    kesin = jz.ters_cevir_7(ileri, jz.bursa_wolf, -84.1, -101.8, -129.7, 1.05, 0, 0, 0.468,
                            konvansiyon="PV")
    assert yakin(geri, kesin, 1e-9)
    yanlis = jz.bursa_wolf(ileri, -84.1, -101.8, -129.7, 1.05, 0, 0, 0.468, "PV")
    assert max(abs(yanlis[i] - geri[i]) for i in range(3)) > 100   # ileri set ters yonde kullanilmadi
    # IERS: ters yon Helmert14.ters ile, gidis-donus kapanir
    Y, _, _ = jz.donustur(X_TR, "WGS84 (G2139)", "ITRF96 (TUREF)", jz.MODEL_IERS, 2025.0)
    Z, e, _ = jz.donustur(Y, "ITRF96 (TUREF)", "WGS84 (G2139)", jz.MODEL_IERS, 2025.0)
    assert yakin(Z, X_TR, 1e-4) and e.yon == "zincir"
    assert jz.parametre_bul("ITRF2014", "ITRF2020", jz.MODEL_IERS, 2025.0).yon == "ters"
    print("OK  6) ters yon: kesin ters cozum (BW) ve IERS ters zinciri")


def test_7_pv_cf_korunur():
    """7) Kayitli konvansiyon otomatik kullanilir; PV/CF farki korunur."""
    X2, e, _ = jz.donustur(X_TR, ED50, WGS_ENS, jz.MODEL_BW)
    pv = jz.bursa_wolf(X_TR, *e.T, e.D, *e.R, "PV")
    cf = jz.bursa_wolf(X_TR, *e.T, e.D, *e.R, "CF")
    assert e.konvansiyon == "PV" and yakin(X2, pv, 1e-9)
    assert max(abs(cf[i] - pv[i]) for i in range(3)) > 1.0
    # CF yayinlanmis bir set kaydedilirse CF olarak uygulanir (EPSG 7-2 CF ornegi, yalniz test)
    k, h = "TEST WGS72", "TEST WGS84"
    jz.SISTEMLER[k] = jz.SISTEMLER[h] = "WGS84"
    try:
        jz.parametre_kaydet(jz.ParametreSeti(k, h, jz.MODEL_BW, (0, 0, 4.5), 0.219,
                                             (0, 0, -0.554), "CF", kurum="EPSG GN 7-2 (test)"))
        X1 = (3657660.66, 255768.55, 5201382.11)
        Y, e, _ = jz.donustur(X1, k, h, jz.MODEL_BW)
        assert e.konvansiyon == "CF" and yakin(Y, (3657660.78, 255778.43, 5201387.75), 0.01)
    finally:
        jz.parametre_sil(k, h, jz.MODEL_BW)
        del jz.SISTEMLER[k], jz.SISTEMLER[h]
    print("OK  7) Bursa-Wolf PV / CF konvansiyonu parametre setiyle birlikte korunuyor")


def test_8_molodensky_badekas_merkez():
    """8) M-B'de Xm, Ym, Zm kullanilir (EPSG GN 7-2 La Canoa -> REGVEN, EPSG:1771, CF)."""
    k, h = "TEST La Canoa", "TEST REGVEN"
    jz.SISTEMLER[k], jz.SISTEMLER[h] = "Hayford (International 1924)", "GRS80"
    merkez = (2464351.59, -5783466.61, 974809.81)
    try:
        jz.parametre_kaydet(jz.ParametreSeti(
            k, h, jz.MODEL_MB, (-270.933, 115.599, -360.226), -5.109,
            (-5.266, -1.238, 2.381), "CF", kurum="EPSG GN 7-2 (test)", merkez=merkez))
        e = jz.parametre_bul(k, h, jz.MODEL_MB)
        assert e.bulundu and e.merkez == merkez
        X1 = (2550408.96, -5749912.26, 1054891.11)
        Y, _, _ = jz.donustur(X1, k, h, jz.MODEL_MB)
        assert yakin(Y, (2550138.46, -5749799.87, 1054530.82), 0.01), Y
        bw = jz.bursa_wolf(X1, *e.T, e.D, *e.R, "CF")             # merkez yok sayilirsa
        assert max(abs(bw[i] - Y[i]) for i in range(3)) > 10
        geri, eg, _ = jz.donustur(Y, h, k, jz.MODEL_MB)           # ters yon
        assert eg.ters and yakin(geri, X1, 1e-6)
        assert not jz.parametre_bul(k, h, jz.MODEL_BW).bulundu    # model bagimsiz
    finally:
        jz.parametre_sil(k, h, jz.MODEL_MB)
        del jz.SISTEMLER[k], jz.SISTEMLER[h]
    print("OK  8) Molodensky-Badekas: Xm, Ym, Zm kullaniliyor (EPSG 7-2 La Canoa ornegi)")


def test_9_iers_epok():
    """9) IERS 14p: P(t) = P(t0) + Pdot (t - t0); epok sonucu degistirir."""
    e = jz.parametre_bul("ITRF2020", "ITRF96 (TUREF)", jz.MODEL_IERS, 2025.0)
    dt = 2025.0 - 2015.0
    assert yakin(e.T, [(6.5 + 0.1 * dt) * 1e-3, (-3.9 - 0.6 * dt) * 1e-3, (-77.9 - 3.1 * dt) * 1e-3], 1e-12)
    assert abs(e.D - (3.98 + 0.12 * dt) * 1e-3) < 1e-12
    assert yakin(e.R, [0, 0, (0.36 + 0.02 * dt) * 1e-3], 1e-12) and e.epok == 2025.0
    k, h = "ITRF2020", "ITRF96 (TUREF)"
    Y25, _, _ = jz.donustur(X_TR, k, h, jz.MODEL_IERS, 2025.0)
    Y15, _, _ = jz.donustur(X_TR, k, h, jz.MODEL_IERS, 2015.0)
    S25, _, _ = jz.donustur(X_TR, k, h, jz.MODEL_SABIT, 2025.0)
    S15, _, _ = jz.donustur(X_TR, k, h, jz.MODEL_SABIT, 2015.0)
    assert max(abs(Y25[i] - Y15[i]) for i in range(3)) > 0.01        # cm duzeyi
    assert yakin(S25, S15, 1e-12) and yakin(S15, Y15, 1e-9)           # 7p epoktan bagimsiz
    assert not jz.parametre_bul(k, h, jz.MODEL_IERS, None).bulundu    # epoksuz hesap yok
    print("OK  9) IERS 14p olcu epogu hesaba katiliyor (P(t) dogrulandi)")


def test_10_epsg72_hala_dogru():
    """10) EPSG 7-2 test ornegi hala dogru (manuel giris yolu = ham fonksiyonlar)."""
    X1, beklenen = (3657660.66, 255768.55, 5201382.11), (3657660.78, 255778.43, 5201387.75)
    assert yakin(jz.bursa_wolf(X1, *EPSG72, "PV"), beklenen, 0.01)
    test_epsg_bursa_wolf()
    print("OK  10) EPSG 7-2 ornegi hala dogru")


if __name__ == "__main__":
    test_gidis_donus()
    test_epsg_bursa_wolf()
    test_mb_bw_esdegerligi()
    test_wgs84_grs80()
    test_itrf_zincir_kapanmasi()
    test_1_otomatik_secim()
    test_2_3_4_kaynak_hedef_model_degisimi()
    test_5_bulunamayan_ornek_deger_kullanmaz()
    test_6_ters_yon()
    test_7_pv_cf_korunur()
    test_8_molodensky_badekas_merkez()
    test_9_iers_epok()
    test_10_epsg72_hala_dogru()
    print("\nTum testler gecti.")
