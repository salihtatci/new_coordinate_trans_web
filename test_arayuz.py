"""
test_arayuz.py - 'Model Parametreleri' sekmesinin otomatik doldurulmasini GERCEK Kivy
arayuzu uzerinde (gizli pencere) dener.
Calistirma:  python test_arayuz.py
"""
import os
import sys
import traceback

os.environ.setdefault("KIVY_NO_ARGS", "1")
from kivy.config import Config                       # Window olusmadan ONCE

Config.set("graphics", "window_state", "hidden")

import main                                          # noqa: E402
import jeodezi as jz                                 # noqa: E402
from kivy.clock import Clock                         # noqa: E402


def alanlar(i):
    return [w.text for w in (i.p_tx, i.p_ty, i.p_tz, i.p_d, i.p_rx, i.p_ry, i.p_rz)]


def sonuc_xyz(metin):
    d = {}
    for satir in metin.splitlines():
        s = satir.strip()
        for k in ("X2 =", "Y2 =", "Z2 ="):
            if s.startswith(k):
                d[k[0]] = float(s[len(k):])
    return d["X"], d["Y"], d["Z"]


def senaryolar(kok):
    i = kok.ids
    sec = lambda k=None, h=None, m=None: (
        k and setattr(i.t2_kaynak, "text", k), h and setattr(i.t2_hedef, "text", h),
        m and setattr(i.t2_model, "text", m))

    # 0) Varsayilan: WGS84 (G2139) -> ITRF96 (TUREF), IERS 14p, t = 2025.0
    b = i.p_baslik.text
    assert "Kaynak: WGS84 (G2139)" in b and "Hedef: ITRF96 (TUREF)" in b, b
    assert "Model: " + main.M_IERS in b and "Parametre kaynagi:" in b and "IERS" in b, b
    assert i.p_durum.text == jz.OTOMATIK and all(alanlar(i)), alanlar(i)
    assert i.p_tx.readonly and not kok.manuel_aktif
    print("OK  UI varsayilan: IERS parametreleri otomatik, salt okunur, baslik dogru")

    # 9) epok degisimi -> IERS parametreleri degisir
    a25 = alanlar(i)
    i.t2_epok.text = "2015.0"
    assert alanlar(i) != a25
    i.t2_epok.text = "2025.0"
    assert alanlar(i) == a25
    print("OK  UI epok degisince IERS parametreleri guncelleniyor")

    # 2) kaynak degisimi
    sec("ITRF2020", "ITRF2008", main.M_IERS)
    p1 = alanlar(i)
    sec(k="ITRF2014")
    assert alanlar(i) != p1 and "Kaynak: ITRF2014" in i.p_baslik.text
    # 3) hedef degisimi
    p2 = alanlar(i)
    sec(h="ETRF2000 (ETRS89)")
    assert alanlar(i) != p2 and "EUREF" in i.p_baslik.text
    print("OK  UI kaynak / hedef degisince parametreler guncelleniyor")

    # 4) model degisimi: hangi model secilirse secilsin parametreler otomatik dolar
    sec("WGS84 (G2139)", "ITRF96 (TUREF)", main.M_BW)
    assert all(alanlar(i)) and i.p_durum.text == jz.OTOMATIK
    assert i.p_xm.disabled
    bw_vals = alanlar(i)
    sec(m=main.M_MB)
    assert all(alanlar(i)) and i.p_durum.text == jz.OTOMATIK
    assert not i.p_xm.disabled
    assert i.p_xm.text == "4116000.000"
    assert alanlar(i) != bw_vals                     # M-B parametreleri BW'den farklidir
    kok.t2_donustur()
    assert "X2 =" in i.t2_out.text
    print("OK  UI model degisince (BW <-> M-B) parametreler modele gore otomatik guncelleniyor")

    # 1) ED50 -> WGS84 Bursa-Wolf (EPSG:1784, PV)
    i.t2_tip.text = "Cografi"
    i.t2_a.text, i.t2_b.text, i.t2_c.text = "39.925", "32.8369", "938.0"
    sec(ED50 := "ED50 (Hayford)", "WGS84 (EPSG ensemble)", main.M_BW)
    assert alanlar(i) == ["-84.1", "-101.8", "-129.7", "1.05", "0", "0", "0.468"], alanlar(i)
    assert i.p_konv.text.startswith("PV") and not i.p_ters.active
    assert "EPSG:1784" in i.p_baslik.text and i.p_xm.disabled and i.p_xm.text == ""
    kok.t2_donustur()
    assert "EPSG:1784" in i.t2_out.text
    ileri = sonuc_xyz(i.t2_out.text)
    exp = jz.donustur(jz.geo_to_cart(39.925, 32.8369, 938.0, "Hayford (International 1924)"),
                      ED50, "WGS84 (EPSG ensemble)", jz.MODEL_BW)[0]
    assert all(abs(ileri[k] - exp[k]) < 1e-4 for k in range(3))
    sec(m=main.M_MB)
    assert all(alanlar(i)) and i.p_xm.text == "4116000.000"  # M-B secilince M-B parametreleri gelir
    sec(m=main.M_BW)
    print("OK  UI ED50 -> WGS84 BW: EPSG:1784 degerleri ve PV otomatik geldi")

    # 6) Kaynak <-> Hedef: kesin ters
    i.t2_tip.text = "Kartezyen"
    i.t2_a.text, i.t2_b.text, i.t2_c.text = (f"{v:.4f}" for v in ileri)
    kok.t2_yer_degistir()
    assert i.t2_kaynak.text == "WGS84 (EPSG ensemble)" and i.t2_hedef.text == ED50
    assert alanlar(i)[0] == "-84.1" and i.p_ters.active and "TERSI" in i.p_baslik.text
    kok.t2_donustur()
    geri = sonuc_xyz(i.t2_out.text)
    X0 = jz.geo_to_cart(39.925, 32.8369, 938.0, "Hayford (International 1924)")
    assert all(abs(geri[k] - X0[k]) < 2e-4 for k in range(3)), (geri, X0)
    print("OK  UI Kaynak<->Hedef: ters yon kesin ters cozumle hesaplandi (gidis-donus < 0.2 mm)")

    # 12) Manuel giris
    i.p_manuel.active = True
    assert kok.manuel_aktif and not i.p_tx.readonly and not i.p_konv.disabled
    assert "Manuel" in i.p_baslik.text
    i.p_tx.text = "-87"
    sec(h="ITRF2020")                                # manuel modda kullanici degeri korunur
    assert i.p_tx.text == "-87"
    t_once = i.p_ters.active
    kok.t2_yer_degistir()
    assert i.p_ters.active != t_once                 # manuel parametrelerin yonu de degisti
    i.p_manuel.active = False
    assert not kok.manuel_aktif and i.p_tx.readonly
    sec(m=main.M_IERS)
    assert i.p_manuel.disabled                       # manuel giris yalniz BW / M-B icin
    print("OK  UI manuel parametre girisi: duzenlenebilir, yon degisimi 'ters' bayragini ceviriyor")

    # 10) EPSG 7-2 test dugmesi
    kok.ornek_epsg()
    X = sonuc_xyz(i.t2_out.text)
    assert all(abs(X[k] - v) < 0.01 for k, v in enumerate((3657660.78, 255778.43, 5201387.75))), X
    assert "TEST ORNEGI" in i.p_durum.text and kok.manuel_aktif
    i.p_manuel.active = False
    assert alanlar(i) == ["0"] * 7 and "ozdeslik" in i.p_durum.text   # G2139->G2139: ozdeslik
    sec("WGS84 (G2139)", "ITRF96 (TUREF)", main.M_BW)
    assert all(alanlar(i)) and alanlar(i) != ["0", "0", "4.5", "0.219", "0", "0", "0.554"]  # gercek parametreler dolduruldu, ornek degerler kalmadi
    print("OK  UI EPSG 7-2 test ornegi dogru; ornek degerler gercek donusume tasinmiyor")


class TestApp(main.KoordinatApp):
    kod = 1

    def build(self):
        # KV icindeki '#:import main __main__' satiri main.py'nin dogrudan calistirildigini
        # varsayar; test icin __main__ yerine main modulunu gosteriyoruz.
        sys.modules["__main__"] = main
        kok = super().build()

        def calistir(dt):
            try:
                senaryolar(kok)
                self.kod = 0
                print("\nArayuz testleri gecti.")
            except Exception:
                traceback.print_exc()
            # Gizli pencerede Kivy'nin Windows kalem/dokunma saglayicisi kapanista hata
            # verebiliyor; sonuc belli oldugu icin sureci dogrudan sonlandiriyoruz.
            sys.stdout.flush()
            sys.stderr.flush()
            os._exit(self.kod)
        Clock.schedule_once(calistir, 0.5)
        return kok


if __name__ == "__main__":
    app = TestApp()
    app.run()
    sys.exit(app.kod)
