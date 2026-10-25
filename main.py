"""
main.py  -  Kivy arayuzu (internetsiz calisir)
================================================

Kivy'de bir uygulamanin 3 parcasi vardir:
  1) App sinifi      : uygulamanin kendisi; build() ana widget'i dondurur.
  2) KV dili          : arayuzun "nasil gorunecegini" anlatan bildirimsel dil
                        (HTML/CSS'e benzer).  Asagida KV = \"\"\"...\"\"\" icinde.
  3) Python mantigi   : dugmeye basilinca ne olacagi (AnaPanel'in metotlari).

KV icinde `id: t1_phi` diye isim verdigimiz widget'a Python'da
`self.ids.t1_phi` ile ulasiriz.  `on_release: root.t1_geo2cart()` ise
dugme birakildiginda AnaPanel.t1_geo2cart() metodunu cagirir.

Not: Android paketleyicisi (buildozer) giris dosyasinin adinin main.py olmasini ister.
"""
import os
import math
import traceback

os.environ.setdefault("KIVY_NO_ARGS", "1")   # Kivy'nin komut satiri argumanlarini yutmasini engelle

from kivy.app import App
from kivy.lang import Builder
from kivy.uix.tabbedpanel import TabbedPanel
from kivy.core.window import Window
from kivy.clock import Clock
from kivy.properties import BooleanProperty

import jeodezi as jz

# Model adlari (Spinner'da gorunecek)
M_IERS = "IERS 14-parametre (zamana bagli)"
M_SABIT = "7-parametre Helmert (hizsiz, t0)"
M_BW = "Bursa-Wolf 7-parametre"
M_MB = "Molodensky-Badekas (7p + Xm,Ym,Zm)"
M_ELIPS = "Yalniz elipsoit degisimi"
MODELLER = [M_IERS, M_SABIT, M_BW, M_MB, M_ELIPS]
# Arayuz adi -> jeodezi model kodu (parametre_bul anahtarinin 3. elemani)
MODEL_KODU = {M_IERS: jz.MODEL_IERS, M_SABIT: jz.MODEL_SABIT, M_BW: jz.MODEL_BW,
              M_MB: jz.MODEL_MB, M_ELIPS: jz.MODEL_ELIPS}
KONV_ADI = {"PV": "PV (Position Vector)", "CF": "CF (Coordinate Frame)"}
MANUEL_YOK = ("Bu kaynak-hedef-model kombinasyonu için kayıtlı parametre bulunamadı. "
              "Lütfen manuel parametre girişi yapın.")

KV = r"""
#:import jz jeodezi
#:import main __main__

# ---------- Tekrar kullanilan "sablon" widget'lar ----------
<Etiket@Label>:
    size_hint_y: None
    height: dp(40)
    halign: 'left'
    valign: 'middle'
    text_size: self.size
    font_size: '15sp'

<BilgiYazi@Label>:
    size_hint_y: None
    height: self.texture_size[1] + dp(8)
    text_size: self.width, None
    halign: 'left'
    valign: 'top'

<Giris@TextInput>:
    size_hint_y: None
    height: dp(40)
    multiline: False
    write_tab: False
    font_size: '15sp'
    padding: dp(8), dp(10)

<Secim@Spinner>:
    size_hint_y: None
    height: dp(40)
    font_size: '14sp'

<Dugme@Button>:
    size_hint_y: None
    height: dp(48)
    font_size: '15sp'
    background_normal: ''
    background_color: 0.13, 0.42, 0.75, 1

<Sonuc@TextInput>:
    readonly: True
    font_name: 'RobotoMono-Regular'
    font_size: '12.5sp'
    size_hint_y: None
    height: max(dp(300), self.minimum_height)
    background_normal: ''
    background_active: ''
    background_color: 0.07, 0.08, 0.10, 1
    foreground_color: 0.80, 1.00, 0.80, 1

<Form@GridLayout>:
    cols: 2
    spacing: dp(6)
    size_hint_y: None
    height: self.minimum_height
    cols_minimum: {0: dp(150)}

<Sayfa@BoxLayout>:
    orientation: 'vertical'
    padding: dp(10)
    spacing: dp(8)
    size_hint_y: None
    height: self.minimum_height

# ---------- Ana panel: sekmeler ----------
<AnaPanel>:
    do_default_tab: False
    tab_width: dp(185)
    tab_height: dp(44)

    # ================= SEKME 1 =================
    TabbedPanelItem:
        text: 'Cografi <-> Kartezyen'
        ScrollView:
            Sayfa:
                Form:
                    Etiket:
                        text: 'Elipsoit'
                    Secim:
                        id: t1_elips
                        text: 'GRS80'
                        values: list(jz.ELIPSOITLER)
                    Etiket:
                        text: 'Ters cozum yontemi'
                    Secim:
                        id: t1_yontem
                        text: 'iteratif'
                        values: ['iteratif', 'bowring']
                    Etiket:
                        text: 'Enlem  φ'
                    Giris:
                        id: t1_phi
                        hint_text: '39.925  veya  39 55 30.0'
                        text: '39 55 30.0'
                    Etiket:
                        text: 'Boylam  λ'
                    Giris:
                        id: t1_lam
                        hint_text: '32.8369  veya  32 50 12.84'
                        text: '32 50 12.84'
                    Etiket:
                        text: 'Elipsoidal yukseklik h (m)'
                    Giris:
                        id: t1_h
                        text: '938.000'
                Dugme:
                    text: 'Cografi  ->  Kartezyen'
                    on_release: root.t1_geo2cart()
                Form:
                    Etiket:
                        text: 'X (m)'
                    Giris:
                        id: t1_x
                    Etiket:
                        text: 'Y (m)'
                    Giris:
                        id: t1_y
                    Etiket:
                        text: 'Z (m)'
                    Giris:
                        id: t1_z
                Dugme:
                    text: 'Kartezyen  ->  Cografi'
                    on_release: root.t1_cart2geo()
                Sonuc:
                    id: t1_out

    # ================= SEKME 2 =================
    TabbedPanelItem:
        text: 'Datum / Cerceve'
        ScrollView:
            Sayfa:
                Form:
                    Etiket:
                        text: 'Kaynak sistem'
                    Secim:
                        id: t2_kaynak
                        text: 'WGS84 (G2139)'
                        values: list(jz.SISTEMLER)
                        on_text: root.parametreleri_guncelle()
                    Etiket:
                        text: 'Hedef sistem'
                    Secim:
                        id: t2_hedef
                        text: 'ITRF96 (TUREF)'
                        values: list(jz.SISTEMLER)
                        on_text: root.parametreleri_guncelle()
                    Etiket:
                        text: 'Donusum modeli'
                    Secim:
                        id: t2_model
                        text: main.M_IERS
                        values: main.MODELLER
                        on_text: root.parametreleri_guncelle()
                    Etiket:
                        text: 'Olcu epogu t (yil)'
                    Giris:
                        id: t2_epok
                        text: '2025.0'
                        disabled: t2_model.text != main.M_IERS
                        on_text: root.parametreleri_guncelle()
                    Etiket:
                        text: 'Giris koordinat turu'
                    Secim:
                        id: t2_tip
                        text: 'Kartezyen'
                        values: ['Kartezyen', 'Cografi']
                    Etiket:
                        text: 'Enlem  φ' if t2_tip.text == 'Cografi' else 'X (m)'
                    Giris:
                        id: t2_a
                        text: '4116037.2588'
                    Etiket:
                        text: 'Boylam  λ' if t2_tip.text == 'Cografi' else 'Y (m)'
                    Giris:
                        id: t2_b
                        text: '2656358.3524'
                    Etiket:
                        text: 'h (m)' if t2_tip.text == 'Cografi' else 'Z (m)'
                    Giris:
                        id: t2_c
                        text: '4072204.7958'
                BoxLayout:
                    size_hint_y: None
                    height: dp(48)
                    spacing: dp(6)
                    Dugme:
                        text: 'Donustur'
                        on_release: root.t2_donustur()
                    Dugme:
                        text: 'Kaynak <-> Hedef'
                        background_color: 0.35, 0.35, 0.40, 1
                        on_release: root.t2_yer_degistir()
                Sonuc:
                    id: t2_out

    # ================= SEKME 3 =================
    TabbedPanelItem:
        text: 'Model Parametreleri'
        ScrollView:
            Sayfa:
                BilgiYazi:
                    id: p_baslik
                    font_size: '15sp'
                    text: ''
                Form:
                    Etiket:
                        text: 'Tx (m)'
                    Giris:
                        id: p_tx
                        readonly: not root.manuel_aktif
                        background_color: (1, 1, 1, 1) if root.manuel_aktif else (0.78, 0.80, 0.84, 1)
                    Etiket:
                        text: 'Ty (m)'
                    Giris:
                        id: p_ty
                        readonly: not root.manuel_aktif
                        background_color: (1, 1, 1, 1) if root.manuel_aktif else (0.78, 0.80, 0.84, 1)
                    Etiket:
                        text: 'Tz (m)'
                    Giris:
                        id: p_tz
                        readonly: not root.manuel_aktif
                        background_color: (1, 1, 1, 1) if root.manuel_aktif else (0.78, 0.80, 0.84, 1)
                    Etiket:
                        text: 'Olcek D (ppm)'
                    Giris:
                        id: p_d
                        readonly: not root.manuel_aktif
                        background_color: (1, 1, 1, 1) if root.manuel_aktif else (0.78, 0.80, 0.84, 1)
                    Etiket:
                        text: 'Rx (yay sn)'
                    Giris:
                        id: p_rx
                        readonly: not root.manuel_aktif
                        background_color: (1, 1, 1, 1) if root.manuel_aktif else (0.78, 0.80, 0.84, 1)
                    Etiket:
                        text: 'Ry (yay sn)'
                    Giris:
                        id: p_ry
                        readonly: not root.manuel_aktif
                        background_color: (1, 1, 1, 1) if root.manuel_aktif else (0.78, 0.80, 0.84, 1)
                    Etiket:
                        text: 'Rz (yay sn)'
                    Giris:
                        id: p_rz
                        readonly: not root.manuel_aktif
                        background_color: (1, 1, 1, 1) if root.manuel_aktif else (0.78, 0.80, 0.84, 1)
                    Etiket:
                        text: 'Donukluk konvansiyonu'
                    Secim:
                        id: p_konv
                        text: 'PV (Position Vector)'
                        values: ['PV (Position Vector)', 'CF (Coordinate Frame)']
                        disabled: not root.manuel_aktif
                    Etiket:
                        text: 'Xm (m)  [yalniz M-B]'
                    Giris:
                        id: p_xm
                        disabled: t2_model.text != main.M_MB
                        readonly: not root.manuel_aktif
                        background_color: (1, 1, 1, 1) if root.manuel_aktif else (0.78, 0.80, 0.84, 1)
                    Etiket:
                        text: 'Ym (m)  [yalniz M-B]'
                    Giris:
                        id: p_ym
                        disabled: t2_model.text != main.M_MB
                        readonly: not root.manuel_aktif
                        background_color: (1, 1, 1, 1) if root.manuel_aktif else (0.78, 0.80, 0.84, 1)
                    Etiket:
                        text: 'Zm (m)  [yalniz M-B]'
                    Giris:
                        id: p_zm
                        disabled: t2_model.text != main.M_MB
                        readonly: not root.manuel_aktif
                        background_color: (1, 1, 1, 1) if root.manuel_aktif else (0.78, 0.80, 0.84, 1)
                    Etiket:
                        text: 'Ters yonde uygula'
                    CheckBox:
                        id: p_ters
                        size_hint_y: None
                        height: dp(40)
                        disabled: not root.manuel_aktif
                    Etiket:
                        text: 'Manuel parametre girisi'
                    CheckBox:
                        id: p_manuel
                        size_hint_y: None
                        height: dp(40)
                        disabled: t2_model.text not in (main.M_BW, main.M_MB)
                        on_active: root.parametreleri_guncelle()
                BilgiYazi:
                    id: p_durum
                    font_size: '14sp'
                    bold: True
                    text: ''
                BilgiYazi:
                    id: p_ayrinti
                    font_size: '12.5sp'
                    color: 0.8, 0.8, 0.8, 1
                    text: ''
                Dugme:
                    text: 'Test ornegi: EPSG 7-2 (WGS72 -> WGS84) - gercek donusum degil'
                    background_color: 0.35, 0.35, 0.40, 1
                    on_release: root.ornek_epsg()
                BilgiYazi:
                    color: 0.8, 0.8, 0.8, 1
                    font_size: '13sp'
                    text: main.PARAM_NOTU

    # ================= SEKME 4 =================
    TabbedPanelItem:
        text: 'Bilgi'
        ScrollView:
            Label:
                size_hint_y: None
                height: self.texture_size[1] + dp(30)
                text_size: self.width - dp(30), None
                padding: dp(15), dp(15)
                font_size: '14sp'
                markup: True
                text: main.BILGI
"""

PARAM_NOTU = ("Parametreler (kaynak, hedef, model) uclusune gore jeodezi.PARAMETRE_DB / IERS "
              "tablosundan otomatik secilir ve salt okunurdur; kayit yoksa alanlar BOS kalir "
              "(0 veya ornek deger yazilmaz).  Ters yon: kayitli set hedef->kaynak ise "
              "parametreler degistirilmeden iterasyonla KESIN ters cozum uygulanir.  "
              "Manuel giriste 'Ters yonde uygula' ve konvansiyon elle secilir; PV ve CF ayni "
              "sayilarla farkli sonuc verir (IERS/EPSG:1033 = PV, ISO/EPSG:1032 = CF).")

BILGI = """[b][size=18sp]Ne neyi belirler?[/size][/b]

[b]Cerceve / datum[/b] (ITRF2020, WGS84(G2139), ETRF2000 ...) noktanin [b]X, Y, Z[/b] degerini belirler.
[b]Elipsoit[/b] (GRS80, WGS84 ...) ise ayni X, Y, Z'nin [b]φ, λ, h[/b] olarak nasil ifade edilecegini belirler.

[b]WGS84 <-> GRS80[/b]: Bu iki elipsoitin a'si aynidir, yalniz 1/f farklidir (b'de ~0.105 mm).
Ayni cercevede XYZ hic degismez; φ ayni kalir (~1e-9 derece), h en fazla ~0.1 mm degisir.
Bunu 'Yalniz elipsoit degisimi' modeli ile kendiniz gorebilirsiniz.

[b]ITRF'ler arasi[/b]: IERS 14 parametre yayinlar (7 parametre + bunlarin yillik hizlari).
  P(t) = P(t0) + Pdot (t - t0)
  X2 = X1 + T + D X1 + R X1
Hizlari ihmal etmek (7-parametre, t0'da sabit) yillar ilerledikce cm duzeyinde hata yapar;
iki modeli karsilastirarak farki gorun.

[b]WGS84 gerceklestirmeleri[/b]: G1762 ~ ITRF2008, G2139 ~ ITRF2014, G2296 ~ ITRF2020
(cm duzeyinde ortusur, bu yuzden aralarinda sifir parametre kabul edilir).
[b]WGS84 (EPSG ensemble)[/b]: EPSG'deki WGS 84 toplulugu (~2 m). ED50 -> WGS 84 (EPSG:1784)
bu sisteme tanimlidir; G-gerceklestirmelerine isim benzerligiyle baglanmaz.

[b]Otomatik parametre[/b]: Model Parametreleri sekmesi (kaynak, hedef, model) uclusune gore
kayitli seti otomatik doldurur. Kayit yoksa alanlar bos kalir ve donusum yapilmaz;
'Manuel parametre girisi' ile (BW / M-B) kendi parametrenizi girebilirsiniz.

[b]Bursa-Wolf[/b]: X2 = T + (1 + D) R X1   (donukluk dunya merkezi etrafinda)
[b]Molodensky-Badekas[/b]: X2 = Xm + T + (1 + D) R (X1 - Xm)   (agirlik merkezi etrafinda)

[b]Cografi -> Kartezyen[/b] (kesin):
  N = a / sqrt(1 - e² sin² φ)
  X = (N + h) cos φ cos λ,  Y = (N + h) cos φ sin λ,  Z = (N(1 - e²) + h) sin φ
[b]Kartezyen -> Cografi[/b]: iteratif ya da Bowring yontemi.

[color=ffaa55]Uyari: Program icindeki IERS/EUREF parametreleri ders amaclidir.
Resmi islerde guncel tablolarla (itrf.ign.fr, epncb.eu) karsilastirin.[/color]
"""


def sayi(metin):
    """'1.234' veya '1,234' -> float"""
    return float(metin.strip().replace(",", "."))


def hata_metni(e):
    return f"HATA: {e}\n\n(Ayrinti)\n{traceback.format_exc(limit=2)}"


class AnaPanel(TabbedPanel):
    # Manuel parametre girisi acik VE model BW/MB ise True; KV'de kutularin salt-okunurlugu buna bagli
    manuel_aktif = BooleanProperty(False)
    _eslesme = None          # son jz.parametre_bul sonucu

    # ---------------- Sekme 1 ----------------
    def t1_geo2cart(self):
        i = self.ids
        try:
            phi, lam, h = jz.aci_oku(i.t1_phi.text), jz.aci_oku(i.t1_lam.text), sayi(i.t1_h.text)
            el = i.t1_elips.text
            X, Y, Z = jz.geo_to_cart(phi, lam, h, el)
            a, b, f, e2, _ = jz.elipsoit_sabitleri(el)
            N = a / math.sqrt(1 - e2 * math.sin(math.radians(phi)) ** 2)
            i.t1_x.text, i.t1_y.text, i.t1_z.text = f"{X:.4f}", f"{Y:.4f}", f"{Z:.4f}"
            i.t1_out.text = (
                f"COGRAFI -> KARTEZYEN   [{el}]\n"
                f"a = {a:.3f} m   1/f = {1/f:.9f}   e² = {e2:.15f}\n"
                f"-----------------------------------------------\n"
                f"φ = {phi:.10f}°  ({jz.dms(phi)})\n"
                f"λ = {lam:.10f}°  ({jz.dms(lam)})\n"
                f"h = {h:.4f} m\n"
                f"N = a/sqrt(1-e²sin²φ) = {N:.4f} m\n"
                f"-----------------------------------------------\n"
                f"X = (N+h)cosφ cosλ   = {X:15.4f} m\n"
                f"Y = (N+h)cosφ sinλ   = {Y:15.4f} m\n"
                f"Z = (N(1-e²)+h)sinφ  = {Z:15.4f} m\n")
        except Exception as e:
            i.t1_out.text = hata_metni(e)

    def t1_cart2geo(self):
        i = self.ids
        try:
            X, Y, Z = sayi(i.t1_x.text), sayi(i.t1_y.text), sayi(i.t1_z.text)
            el, yon = i.t1_elips.text, i.t1_yontem.text
            phi, lam, h, n = jz.cart_to_geo(X, Y, Z, el, yon)
            # kontrol: geri hesapla, kapanma hatasi
            Xg = jz.geo_to_cart(phi, lam, h, el)
            kap = math.sqrt(sum((Xg[k] - v) ** 2 for k, v in enumerate((X, Y, Z))))
            i.t1_phi.text, i.t1_lam.text, i.t1_h.text = f"{phi:.10f}", f"{lam:.10f}", f"{h:.4f}"
            i.t1_out.text = (
                f"KARTEZYEN -> COGRAFI   [{el}, {yon}, {n} iterasyon]\n"
                f"-----------------------------------------------\n"
                f"X = {X:.4f}   Y = {Y:.4f}   Z = {Z:.4f}\n"
                f"p = sqrt(X²+Y²) = {math.hypot(X, Y):.4f} m\n"
                f"-----------------------------------------------\n"
                f"φ = {phi:.10f}°  ({jz.dms(phi)})\n"
                f"λ = {lam:.10f}°  ({jz.dms(lam)})\n"
                f"h = {h:.4f} m\n"
                f"Geri donus kapanma hatasi = {kap:.2e} m\n")
        except Exception as e:
            i.t1_out.text = hata_metni(e)

    # ---------------- Sekme 2 ----------------
    def t2_yer_degistir(self):
        """Kaynak <-> Hedef.  Otomatik modda parametre_bul yeni yonu kendisi cozer
        (kayitli set ters yondeyse kesin ters cozum).  Manuel modda kutulardaki
        parametreler ESKI yon icin girildiginden 'Ters yonde uygula' tersine cevrilir."""
        i = self.ids
        if self.manuel_aktif:
            i.p_ters.active = not i.p_ters.active
        i.t2_kaynak.text, i.t2_hedef.text = i.t2_hedef.text, i.t2_kaynak.text
        self.parametreleri_guncelle()

    def _kullanici_param(self, mb=False):
        i = self.ids
        try:
            p = [sayi(w.text) for w in (i.p_tx, i.p_ty, i.p_tz, i.p_d, i.p_rx, i.p_ry, i.p_rz)]
            merkez = ((sayi(i.p_xm.text), sayi(i.p_ym.text), sayi(i.p_zm.text)) if mb
                      else (0.0, 0.0, 0.0))
        except ValueError:
            raise ValueError("Manuel parametre girisi eksik/hatali: Tx, Ty, Tz, D, Rx, Ry, Rz"
                             + (", Xm, Ym, Zm" if mb else "") + " alanlarini doldurun.")
        konv = "CF" if i.p_konv.text.startswith("CF") else "PV"
        return p, merkez, konv, i.p_ters.active

    def t2_donustur(self):
        i = self.ids
        try:
            self.parametreleri_guncelle()
            e = self._eslesme
            kay, hed, model = i.t2_kaynak.text, i.t2_hedef.text, i.t2_model.text
            kod = MODEL_KODU[model]
            el_k, el_h = jz.SISTEMLER[kay], jz.SISTEMLER[hed]
            a, b, c = i.t2_a.text, i.t2_b.text, i.t2_c.text
            o = [f"MODEL : {model}", f"YON   : {kay} [{el_k}]  ->  {hed} [{el_h}]",
                 "=" * 56]

            # 1) Girisi Kartezyen'e getir (kaynak sistemin elipsoidi ile)
            if i.t2_tip.text == "Cografi":
                phi, lam, h = jz.aci_oku(a), jz.aci_oku(b), sayi(c)
                X1 = jz.geo_to_cart(phi, lam, h, el_k)
                o.append(f"1) Giris cografi -> kartezyen ({el_k})")
            else:
                X1 = (sayi(a), sayi(b), sayi(c))
                phi, lam, h, _ = jz.cart_to_geo(*X1, el_k)
                o.append("1) Giris zaten kartezyen")
            o.append(f"   X1 = {X1[0]:15.4f} {X1[1]:15.4f} {X1[2]:15.4f}")

            # 2) Modeli uygula
            o.append("2) Donusum")
            if model in (M_BW, M_MB) and self.manuel_aktif:
                p, merkez, konv, ters = self._kullanici_param(model == M_MB)
                if model == M_BW:
                    f, args = jz.bursa_wolf, p
                else:
                    f, args = jz.molodensky_badekas, p + [merkez]
                X2 = (jz.ters_cevir_7(X1, f, *args, konvansiyon=konv) if ters
                      else f(X1, *args, konvansiyon=konv))
                o += ["   Parametre kaynagi: Manuel giris (kullanici)",
                      f"   T[m] = {p[0]:.4f} {p[1]:.4f} {p[2]:.4f}   D = {p[3]:.4f} ppm",
                      f"   R[\"] = {p[4]:.5f} {p[5]:.5f} {p[6]:.5f}   konvansiyon = {konv}"
                      + ("   (TERS, kesin iteratif cozum)" if ters else "")]
                if model == M_MB:
                    o.append(f"   Xm  = {merkez[0]:.3f} {merkez[1]:.3f} {merkez[2]:.3f}")
            else:
                if not e.bulundu:
                    o += ["   " + (MANUEL_YOK if model in (M_BW, M_MB) else e.mesaj),
                          "   Donusum YAPILMADI (ornek/0 parametre kullanilmaz)."]
                    i.t2_out.text = "\n".join(o)
                    return
                try:
                    epok = sayi(i.t2_epok.text)
                except ValueError:
                    epok = None
                X2, e, rapor = jz.donustur(X1, kay, hed, kod, epok)
                o.append(f"   Parametre kaynagi: {e.kurum}" + (f"  [{e.kod}]" if e.kod else ""))
                if model in (M_IERS, M_SABIT):
                    if not rapor:
                        o.append("   Kaynak = hedef, donusum yok.")
                    for r in rapor:
                        T, D, R = r["T_mm"], r["D_ppb"], r["R_mas"]
                        o += [f"   * {r['adim']}   (t = {r['epok']:.2f})",
                              f"     T[mm] = {T[0]:8.3f} {T[1]:8.3f} {T[2]:8.3f}   D[ppb] = {D:7.3f}",
                              f"     R[mas]= {R[0]:8.4f} {R[1]:8.4f} {R[2]:8.4f}",
                              "     dX[mm]= " + " ".join(f"{v*1000:8.2f}" for v in r["fark_m"])]
                elif model in (M_BW, M_MB):
                    if e.yon == "ozdes":
                        o.append("   " + e.mesaj)
                    else:
                        o += [f"   T[m] = {e.T[0]:.4f} {e.T[1]:.4f} {e.T[2]:.4f}   D = {e.D:.4f} ppm",
                              f"   R[\"] = {e.R[0]:.5f} {e.R[1]:.5f} {e.R[2]:.5f}   "
                              f"konvansiyon = {e.konvansiyon} (kayitli)"]
                        if e.merkez:
                            o.append(f"   Xm  = {e.merkez[0]:.3f} {e.merkez[1]:.3f} {e.merkez[2]:.3f}")
                        if e.ters:
                            o.append(f"   Kayitli yon {e.set.kaynak} -> {e.set.hedef}; "
                                     "kesin ters cozum (ters_cevir_7) uygulandi.")
                else:  # yalniz elipsoit
                    o.append("   Cerceve ayni kabul edildi: X, Y, Z degismez.")

            # 3) Hedef elipsoit ile cografiye cevir
            phi2, lam2, h2, _ = jz.cart_to_geo(*X2, el_h)
            d = [X2[k] - X1[k] for k in range(3)]
            e_, n_, u_ = jz.enu_farki(d, phi, lam)
            o += ["=" * 56, f"SONUC ({hed})",
                  f"   X2 = {X2[0]:15.4f}",
                  f"   Y2 = {X2[1]:15.4f}",
                  f"   Z2 = {X2[2]:15.4f}",
                  f"   φ2 = {phi2:.10f}°  ({jz.dms(phi2)})",
                  f"   λ2 = {lam2:.10f}°  ({jz.dms(lam2)})",
                  f"   h2 = {h2:.4f} m  [{el_h}]",
                  "-" * 56,
                  "KAYMA (hedef - kaynak)",
                  f"   dX,dY,dZ [m] = {d[0]:.4f} {d[1]:.4f} {d[2]:.4f}",
                  f"   Dogu, Kuzey, Yukari [m] = {e_:.4f} {n_:.4f} {u_:.4f}",
                  f"   3B uzunluk = {math.sqrt(sum(v*v for v in d)):.4f} m",
                  f"   dφ = {(phi2-phi)*3600:.6f}\"  dλ = {(lam2-lam)*3600:.6f}\"  "
                  f"dh = {(h2-h)*1000:.3f} mm"]
            i.t2_out.text = "\n".join(o)
        except Exception as e:
            i.t2_out.text = hata_metni(e)

    # ---------------- Sekme 3 ----------------
    def parametreleri_guncelle(self, *_):
        """Kaynak / hedef / model / epok degisince cagrilir: (kaynak, hedef, model) icin
        kayitli parametreyi bulur ve 'Model Parametreleri' sekmesini doldurur."""
        i = self.ids
        if "p_manuel" not in i or "t2_epok" not in i:     # KV henuz tamamlanmadi
            return
        kay, hed, model = i.t2_kaynak.text, i.t2_hedef.text, i.t2_model.text
        kod = MODEL_KODU.get(model)
        try:
            epok = sayi(i.t2_epok.text)
        except ValueError:
            epok = None
        e = jz.parametre_bul(kay, hed, kod, epok)
        self._eslesme = e
        self.manuel_aktif = bool(i.p_manuel.active and kod in (jz.MODEL_BW, jz.MODEL_MB))

        yon = {"ileri": "kayitli yonde (ileri)",
               "ters": "kayitli setin TERSI (kesin ters cozum)",
               "zincir": f"zincir ({len(e.zincir)} adim)",
               "ozdes": "ozdeslik / parametresiz", "yok": "-"}[e.yon]
        baslik = [f"Kaynak: {kay}", f"Hedef: {hed}", f"Model: {model}",
                  f"Kaynak -> Hedef:  {kay}  ->  {hed}"]
        if self.manuel_aktif:
            baslik.append("Parametre kaynagi: Manuel giris (kullanici)")
        elif e.bulundu:
            baslik.append(f"Parametre kaynagi: {e.kurum}" + (f"  [{e.kod}]" if e.kod else ""))
            baslik.append(f"Yon: {yon}" + (f"   Konvansiyon: {e.konvansiyon}"
                                          if e.konvansiyon else "")
                          + (f"   Epok t = {e.epok:.2f}" if e.epok is not None else ""))
        else:
            baslik.append("Parametre kaynagi: - (kayit yok)")
        i.p_baslik.text = "\n".join(baslik)

        alanlar = (i.p_tx, i.p_ty, i.p_tz, i.p_d, i.p_rx, i.p_ry, i.p_rz)
        merkez_alan = (i.p_xm, i.p_ym, i.p_zm)
        if self.manuel_aktif:
            i.p_durum.color = (0.55, 0.80, 1.0, 1)
            i.p_durum.text = ("Manuel parametre girisi aktif: hesapta kutulardaki degerler "
                              "kullanilir (kaynak -> hedef yonunde; gerekirse 'Ters yonde uygula').")
            i.p_ayrinti.text = ("Kayitli set mevcut; manuel girisi kapatinca otomatik degerler geri "
                                "gelir." if e.bulundu and e.T is not None else "")
            return

        if e.bulundu and e.T is not None:
            for w, v in zip(alanlar, (*e.T, e.D, *e.R)):
                w.text = _yaz(v)
            for w, v in zip(merkez_alan, e.merkez or ("", "", "")):
                w.text = f"{v:.3f}" if v != "" else ""
            i.p_konv.text = KONV_ADI[e.konvansiyon]
            i.p_ters.active = e.ters
            i.p_durum.color = (0.55, 0.95, 0.55, 1)
            i.p_durum.text = e.mesaj
        else:
            for w in alanlar + merkez_alan:       # BOS birak: 0 / ornek deger YAZMA
                w.text = ""
            i.p_ters.active = False
            if e.bulundu:                         # parametresiz model (yalniz elipsoit)
                i.p_durum.color = (0.55, 0.95, 0.55, 1)
                i.p_durum.text = e.mesaj
            else:
                i.p_durum.color = (1.0, 0.67, 0.33, 1)
                i.p_durum.text = (MANUEL_YOK if kod in (jz.MODEL_BW, jz.MODEL_MB) else
                                  e.mesaj + ("" if e.mesaj != jz.BULUNAMADI else
                                             "  (Manuel giris yalniz Bursa-Wolf / "
                                             "Molodensky-Badekas modellerinde yapilabilir.)"))
        i.p_ayrinti.text = "\n".join(e.ayrinti)

    def ornek_epsg(self):
        """EPSG Guidance Note 7-2 ornegi (Position Vector):
        WGS72 (3657660.66, 255768.55, 5201382.11) -> WGS84 (3657660.78, 255778.43, 5201387.75)
        Yalnizca TEST ornegidir: manuel giris olarak doldurulur, hicbir gercek
        kaynak-hedef dönüşümüne otomatik atanmaz."""
        i = self.ids
        i.t2_model.text, i.t2_tip.text = M_BW, "Kartezyen"
        i.t2_kaynak.text = i.t2_hedef.text = "WGS84 (G2139)"
        i.p_manuel.active = True
        self.parametreleri_guncelle()
        for w, v in zip((i.p_tx, i.p_ty, i.p_tz, i.p_d, i.p_rx, i.p_ry, i.p_rz),
                        ("0", "0", "4.5", "0.219", "0", "0", "0.554")):
            w.text = v
        i.p_konv.text = "PV (Position Vector)"
        i.p_ters.active = False
        i.t2_a.text, i.t2_b.text, i.t2_c.text = "3657660.66", "255768.55", "5201382.11"
        self.switch_to(self.tab_list[-2])          # 'Datum / Cerceve' sekmesine gec
        self.t2_donustur()
        i.p_durum.text = ("TEST ORNEGI (EPSG GN 7-2, WGS72 -> WGS84): manuel giris olarak "
                          "dolduruldu; gercek bir kaynak-hedef donusumu degildir.")


def _yaz(v):
    """Parametreyi kutuya yazmak icin: gereksiz sifirlar olmadan, -0 olmadan."""
    if abs(v) < 5e-10:
        return "0"
    return f"{v:.9f}".rstrip("0").rstrip(".")


class KoordinatApp(App):
    title = "Koordinat Donusum - Cevrimdisi"

    def build(self):
        Window.clearcolor = (0.12, 0.12, 0.14, 1)
        Window.softinput_mode = "below_target"   # Android'de klavye kutuyu ortmesin
        Builder.load_string(KV)
        kok = AnaPanel()
        kok.parametreleri_guncelle()             # varsayilan secim icin parametreleri doldur
        # Test/ekran goruntusu icin: KOORD_SCREENSHOT=dosya.png verilirse kaydedip kapanir
        yol = os.environ.get("KOORD_SCREENSHOT")
        if yol:
            adimlar = [
                lambda: kok.t1_geo2cart(),
                lambda: (kok.switch_to(kok.tab_list[2]), kok.t2_donustur()),
                lambda: kok.ornek_epsg(),
            ]

            def calistir(n):
                if n > 0:
                    Window.screenshot(name=yol)
                if n == len(adimlar):
                    print(kok.ids.t1_out.text, kok.ids.t2_out.text, sep="\n")
                    self.stop()
                    return
                adimlar[n]()
                Clock.schedule_once(lambda dt: calistir(n + 1), 1)
            Clock.schedule_once(lambda dt: calistir(0), 1.5)
        return kok


if __name__ == "__main__":
    KoordinatApp().run()
