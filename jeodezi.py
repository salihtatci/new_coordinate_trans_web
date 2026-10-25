"""
jeodezi.py  -  Koordinat donusum cekirdegi (arayuzden BAGIMSIZ)
=================================================================

Bu dosyada sadece matematik var; Kivy'ye hic dokunmaz.  Boylece:
  * ayni fonksiyonlari komut satirindan / testten / baska arayuzden kullanabiliriz,
  * Android'e paketlerken ek kutuphane (numpy vb.) gerekmez -> yalnizca `math`.

ICERIK
  1) Elipsoitler (WGS84, GRS80, Hayford ...)
  2) Cografi (phi, lambda, h)  <->  Kartezyen (X, Y, Z)
  3) Helmert donusum modelleri
       - Bursa-Wolf 7 parametre (Position Vector / Coordinate Frame konvansiyonu)
       - Molodensky-Badekas 7 parametre (+ agirlik merkezi)
       - IERS 14 parametre (zamana bagli Helmert, ITRF'ler arasi)
  4) Referans sistemleri ve aralarindaki IERS/EUREF parametreleri (yol bulma ile zincirleme)
  4b) Otomatik parametre eslestirme: (kaynak, hedef, model) -> kayitli parametre seti
  5) Derece-dakika-saniye yardimcilari
"""
import math

# ---------------------------------------------------------------------------
# 1) ELIPSOITLER
#    Bir elipsoit iki sayi ile tanimlanir: buyuk yari eksen a [m] ve basiklik f.
#    WGS84 ile GRS80 arasindaki TEK fark 1/f'nin 8. hanesidir (b'de ~0.1 mm fark).
# ---------------------------------------------------------------------------
ELIPSOITLER = {
    #  ad        :  (a [m],       1/f)
    "GRS80":       (6378137.0,   298.257222101),
    "WGS84":       (6378137.0,   298.257223563),
    "Hayford (International 1924)": (6378388.0, 297.0),
    "Krassovsky 1940": (6378245.0, 298.3),
    "Bessel 1841": (6377397.155, 299.1528128),
}


def elipsoit_sabitleri(ad):
    """a, b, f, e^2 (birinci eksantriklik karesi), e'^2 (ikinci) dondurur."""
    a, invf = ELIPSOITLER[ad]
    f = 1.0 / invf
    b = a * (1.0 - f)
    e2 = f * (2.0 - f)              # e^2  = (a^2 - b^2) / a^2
    ep2 = e2 / (1.0 - e2)           # e'^2 = (a^2 - b^2) / b^2
    return a, b, f, e2, ep2


# ---------------------------------------------------------------------------
# 2) COGRAFI <-> KARTEZYEN
# ---------------------------------------------------------------------------
def geo_to_cart(phi_deg, lam_deg, h, elipsoit="GRS80"):
    """Cografi (derece, derece, m) -> Kartezyen X, Y, Z (m).

        N = a / sqrt(1 - e^2 sin^2 phi)        (meridyene dik dogrultudaki egrilik yaricapi)
        X = (N + h) cos phi cos lam
        Y = (N + h) cos phi sin lam
        Z = (N (1 - e^2) + h) sin phi
    Bu formul KAPALI (kesin) bir formuldur, iterasyon gerekmez.
    """
    a, _, _, e2, _ = elipsoit_sabitleri(elipsoit)
    phi, lam = math.radians(phi_deg), math.radians(lam_deg)
    sp, cp = math.sin(phi), math.cos(phi)
    N = a / math.sqrt(1.0 - e2 * sp * sp)
    X = (N + h) * cp * math.cos(lam)
    Y = (N + h) * cp * math.sin(lam)
    Z = (N * (1.0 - e2) + h) * sp
    return X, Y, Z


def cart_to_geo(X, Y, Z, elipsoit="GRS80", yontem="iteratif", tol=1e-12, max_iter=20):
    """Kartezyen -> Cografi.  Dondurur: (phi_deg, lam_deg, h, iterasyon_sayisi)

    Ters problem kapali degildir (phi, N'nin icinde de var), iki yol sunuyoruz:
      * "iteratif": klasik yontem.  phi0 = atan(Z / (p (1-e^2))) ile baslayip
                    h ve phi'yi sirayla guncelleriz; ~4-5 adimda 1e-12 rad'a yakinsar.
      * "bowring" : Bowring (1976) yaklasik kapali formulu; yeryuzu yakininda
                    mm'nin cok altinda dogrudur, tek adimdir.
    """
    a, b, _, e2, ep2 = elipsoit_sabitleri(elipsoit)
    p = math.hypot(X, Y)                 # ekvator duzlemindeki uzaklik
    lam = math.atan2(Y, X)               # boylam her zaman kesin

    if p < 1e-9:                         # kutup noktasi: phi = +-90, h = |Z| - b
        phi = math.copysign(math.pi / 2, Z)
        return math.degrees(phi), math.degrees(lam), abs(Z) - b, 0

    if yontem == "bowring":
        theta = math.atan2(Z * a, p * b)
        st, ct = math.sin(theta), math.cos(theta)
        phi = math.atan2(Z + ep2 * b * st ** 3, p - e2 * a * ct ** 3)
        n_iter = 1
    else:
        phi = math.atan2(Z, p * (1.0 - e2))
        n_iter = 0
        for n_iter in range(1, max_iter + 1):
            N = a / math.sqrt(1.0 - e2 * math.sin(phi) ** 2)
            h = p / math.cos(phi) - N
            phi_yeni = math.atan2(Z, p * (1.0 - e2 * N / (N + h)))
            fark = abs(phi_yeni - phi)
            phi = phi_yeni
            if fark < tol:
                break

    sp = math.sin(phi)
    N = a / math.sqrt(1.0 - e2 * sp * sp)
    # h'yi kutup yakininda da kararli hesaplayan formul:
    h = p * math.cos(phi) + Z * sp - a * a / N
    return math.degrees(phi), math.degrees(lam), h, n_iter


# ---------------------------------------------------------------------------
# 3) HELMERT MODELLERI
#    Birimler (girdi): T [m], olcek D [ppm], donukluk R [yay saniyesi]
#    Hesapta: D -> 1e-6 ile carpilir, R -> radyana cevrilir.
# ---------------------------------------------------------------------------
SANIYE_RAD = math.pi / (180.0 * 3600.0)     # 1" kac radyan


def _matris_vektor(M, v):
    return tuple(sum(M[i][j] * v[j] for j in range(3)) for i in range(3))


def donukluk_matrisi(rx, ry, rz, konvansiyon="PV"):
    """Kucuk aci yaklasimli donukluk matrisi (rx, ry, rz radyan).

    PV  = Position Vector  (IERS, EPSG:1033)   R = [[1,-rz, ry],[ rz,1,-rx],[-ry, rx,1]]
    CF  = Coordinate Frame (EPSG:1032)         R = PV'nin transpozu (acilarin isareti ters)
    Ayni sayilarla iki konvansiyon FARKLI sonuc verir; parametreyi aldiginiz kaynagin
    hangi konvansiyonu kullandigina mutlaka bakin!
    """
    if konvansiyon == "CF":
        rx, ry, rz = -rx, -ry, -rz
    return ((1.0, -rz, ry),
            (rz, 1.0, -rx),
            (-ry, rx, 1.0))


def bursa_wolf(XYZ, tx, ty, tz, d_ppm, rx_sn, ry_sn, rz_sn, konvansiyon="PV"):
    """Bursa-Wolf 7 parametre:   X2 = T + (1 + D) * R * X1"""
    R = donukluk_matrisi(rx_sn * SANIYE_RAD, ry_sn * SANIYE_RAD, rz_sn * SANIYE_RAD, konvansiyon)
    k = 1.0 + d_ppm * 1e-6
    RX = _matris_vektor(R, XYZ)
    return (tx + k * RX[0], ty + k * RX[1], tz + k * RX[2])


def molodensky_badekas(XYZ, tx, ty, tz, d_ppm, rx_sn, ry_sn, rz_sn, merkez, konvansiyon="PV"):
    """Molodensky-Badekas:   X2 = X1 + T + D*(X1 - Xm) + (R - I)*(X1 - Xm)
    = Xm + T + (1 + D) * R * (X1 - Xm)     (kucuk aci, birinci derece)

    Bursa-Wolf'tan farki: donukluk ve olcek dunya merkezine degil, ortak noktalarin
    agirlik merkezine (Xm) gore uygulanir.  Boylece T ile R arasindaki yuksek
    korelasyon kalkar; T dogrudan "agirlik merkezinin kaymasi" anlamina gelir.
    """
    R = donukluk_matrisi(rx_sn * SANIYE_RAD, ry_sn * SANIYE_RAD, rz_sn * SANIYE_RAD, konvansiyon)
    k = 1.0 + d_ppm * 1e-6
    dX = tuple(XYZ[i] - merkez[i] for i in range(3))
    RdX = _matris_vektor(R, dX)
    return tuple(merkez[i] + (tx, ty, tz)[i] + k * RdX[i] for i in range(3))


def ters_cevir_7(XYZ, fonk, *args, **kw):
    """Herhangi bir ileri donusumun KESIN tersini sabit-nokta iterasyonu ile bulur.
    (Parametrelerin isaretini cevirmek yalnizca birinci derece dogrudur; mm-alti
    farklar icin iterasyon daha guvenlidir.)"""
    X = list(XYZ)
    for _ in range(10):
        Y = fonk(tuple(X), *args, **kw)
        X = [X[i] - (Y[i] - XYZ[i]) for i in range(3)]
    return tuple(X)


# --- IERS 14 parametre (zamana bagli Helmert) -------------------------------
class Helmert14:
    """IERS konvansiyonu (Position Vector), ITRF'ler arasi donusum.

    P(t) = P(t0) + Pdot * (t - t0)       her parametre icin
    X2   = X1 + T + D*X1 + R*X1,  R = [[0,-R3,R2],[R3,0,-R1],[-R2,R1,0]]

    Birimler IERS tablolarindaki gibi: T [mm], D [ppb], R [mas] ; hizlar /yil.
    """

    def __init__(self, T, D, R, Tdot, Ddot, Rdot, t0, kaynak=""):
        self.T, self.D, self.R = list(T), D, list(R)
        self.Tdot, self.Ddot, self.Rdot = list(Tdot), Ddot, list(Rdot)
        self.t0, self.kaynak = t0, kaynak

    def ters(self):
        """Ters donusum: birinci derece yaklasimla tum parametrelerin isareti degisir
        (IERS'in kendi onerisi de budur; hata < 0.01 mm)."""
        n = lambda v: [-x for x in v]
        return Helmert14(n(self.T), -self.D, n(self.R), n(self.Tdot), -self.Ddot,
                         n(self.Rdot), self.t0, self.kaynak + " (ters)")

    def epoktaki_parametreler(self, t):
        dt = t - self.t0
        T = [self.T[i] + self.Tdot[i] * dt for i in range(3)]
        D = self.D + self.Ddot * dt
        R = [self.R[i] + self.Rdot[i] * dt for i in range(3)]
        return T, D, R

    def uygula(self, XYZ, t, hizlari_kullan=True):
        T, D, R = self.epoktaki_parametreler(t if hizlari_kullan else self.t0)
        tx, ty, tz = (x * 1e-3 for x in T)               # mm  -> m
        d = D * 1e-9                                     # ppb -> oran
        r1, r2, r3 = (x * 1e-3 * SANIYE_RAD for x in R)  # mas -> rad
        X, Y, Z = XYZ
        return (X + tx + d * X - r3 * Y + r2 * Z,
                Y + ty + r3 * X + d * Y - r1 * Z,
                Z + tz - r2 * X + r1 * Y + d * Z)


# ---------------------------------------------------------------------------
# 4) REFERANS SISTEMLERI
#    "Sistem" = (cerceve/datum) + (cografi koordinat icin kullanilan elipsoit)
#    Cerceve X,Y,Z'yi belirler; elipsoit yalnizca phi, lambda, h'yi etkiler.
# ---------------------------------------------------------------------------
SISTEMLER = {
    #  gorunen ad              : elipsoit
    "ITRF2020":                 "GRS80",
    "ITRF2014":                 "GRS80",
    "ITRF2008":                 "GRS80",
    "ITRF2005":                 "GRS80",
    "ITRF2000":                 "GRS80",
    "ITRF97":                   "GRS80",
    "ITRF96 (TUREF)":           "GRS80",
    "ETRF2000 (ETRS89)":        "GRS80",
    "WGS84 (G2296)":            "WGS84",
    "WGS84 (G2139)":            "WGS84",
    "WGS84 (G1762)":            "WGS84",
    # EPSG'deki "WGS 84" (EPSG:4326) bir DATUM TOPLULUGUDUR (ensemble, ~2 m dogruluk):
    # ED50 -> WGS 84 gibi EPSG donusumleri bu topluluga tanimlidir.  Isim benzerligi ile
    # G-gerceklestirmelerine (G2139 vb.) baglanmaz; IERS zincirinde de yer almaz.
    "WGS84 (EPSG ensemble)":    "WGS84",
    # IERS tablosunda yer almayan yerel datum: yalnizca Bursa-Wolf / Molodensky-Badekas
    # modelleriyle (PARAMETRE_DB'deki kayitli set veya manuel parametre) kullanilabilir.
    "ED50 (Hayford)":           "Hayford (International 1924)",
}


def enu_farki(dXYZ, phi_deg, lam_deg):
    """Geosentrik fark vektorunu (dX,dY,dZ) noktadaki yerel Dogu-Kuzey-Yukari
    (E, N, U) farkina cevirir.  Bir donusumun 'yerde' ne kadar kaydirdigini
    sezgisel olarak gormek icin kullanilir."""
    p, l = math.radians(phi_deg), math.radians(lam_deg)
    sp, cp, sl, cl = math.sin(p), math.cos(p), math.sin(l), math.cos(l)
    dX, dY, dZ = dXYZ
    e = -sl * dX + cl * dY
    n = -sp * cl * dX - sp * sl * dY + cp * dZ
    u = cp * cl * dX + cp * sl * dY + sp * dZ
    return e, n, u

# IERS parametreleri: https://itrf.ign.fr/en/solutions/transformations
# (ITRF2020 -> gecmis ITRF'ler, epok 2015.0 ; ITRF2014 -> gecmis ITRF'ler, epok 2010.0)
# EUREF: ITRF2014 -> ETRF2000 (Altamimi, EUREF TN-1, epok 2010.0)
# !! Resmi/hassas islerde degerleri guncel IERS/EUREF tablolariyla KONTROL EDIN !!
_Z = [0.0, 0.0, 0.0]
DONUSUMLER = {
    ("ITRF2020", "ITRF2014"): Helmert14([-1.4, -0.9, 1.4], -0.42, _Z,
                                        [0.0, -0.1, 0.2], 0.00, _Z, 2015.0, "IERS ITRF2020->ITRF2014"),
    ("ITRF2020", "ITRF2008"): Helmert14([0.2, 1.0, 3.3], -0.29, _Z,
                                        [0.0, -0.1, 0.1], 0.03, _Z, 2015.0, "IERS ITRF2020->ITRF2008"),
    ("ITRF2020", "ITRF2005"): Helmert14([2.7, 0.1, -1.4], 0.65, _Z,
                                        [0.3, -0.1, 0.1], 0.03, _Z, 2015.0, "IERS ITRF2020->ITRF2005"),
    ("ITRF2020", "ITRF2000"): Helmert14([-0.2, 0.8, -34.2], 2.25, _Z,
                                        [0.1, 0.0, -1.7], 0.11, _Z, 2015.0, "IERS ITRF2020->ITRF2000"),
    ("ITRF2020", "ITRF97"):   Helmert14([6.5, -3.9, -77.9], 3.98, [0.0, 0.0, 0.36],
                                        [0.1, -0.6, -3.1], 0.12, [0.0, 0.0, 0.02], 2015.0,
                                        "IERS ITRF2020->ITRF97"),
    ("ITRF2020", "ITRF96 (TUREF)"): Helmert14([6.5, -3.9, -77.9], 3.98, [0.0, 0.0, 0.36],
                                              [0.1, -0.6, -3.1], 0.12, [0.0, 0.0, 0.02], 2015.0,
                                              "IERS ITRF2020->ITRF96"),
    ("ITRF2014", "ITRF2008"): Helmert14([1.6, 1.9, 2.4], -0.02, _Z,
                                        [0.0, 0.0, -0.1], 0.03, _Z, 2010.0, "IERS ITRF2014->ITRF2008"),
    ("ITRF2014", "ETRF2000 (ETRS89)"): Helmert14([53.7, 51.2, -55.1], 1.02, [0.891, 5.390, -8.712],
                                                 [0.1, 0.1, -1.9], 0.11, [0.081, 0.490, -0.792],
                                                 2010.0, "EUREF ITRF2014->ETRF2000"),
    # WGS84'un guncel gerceklestirmeleri ilgili ITRF'e ~1-2 cm duzeyinde hizalidir.
    # NGA resmi bir donusum yayinlamaz; sifir parametre (ozdeslik) kabul edilir.
    ("WGS84 (G2296)", "ITRF2020"): Helmert14(_Z, 0, _Z, _Z, 0, _Z, 2024.0, "WGS84(G2296)~ITRF2020 (ozdes)"),
    ("WGS84 (G2139)", "ITRF2014"): Helmert14(_Z, 0, _Z, _Z, 0, _Z, 2016.0, "WGS84(G2139)~ITRF2014 (ozdes)"),
    ("WGS84 (G1762)", "ITRF2008"): Helmert14(_Z, 0, _Z, _Z, 0, _Z, 2005.0, "WGS84(G1762)~ITRF2008 (ozdes)"),
    # ED50 ve WGS84 toplulugunu grafa baglayan EPSG kayitlari (dogruluk metre duzeyi!):
    # EPSG:1783 "ED50 to ETRS89 (9)" - Position Vector, Turkiye, dogruluk 2 m.
    #   Birimler Helmert14'e gore: T [mm], D [ppb], R [mas]; hiz yok (statik datum).
    #   Hedef EPSG'de ETRS89 toplulugudur; burada ETRF2000 gerceklestirmesine baglanir
    #   (ETRF'ler arasi fark cm duzeyinde, donusum dogrulugu 2 m).
    ("ED50 (Hayford)", "ETRF2000 (ETRS89)"): Helmert14(
        [-84100.0, -101800.0, -129700.0], 1050.0, [0.0, 0.0, 468.0],
        _Z, 0, _Z, 2000.0, "EPSG:1783 ED50 to ETRS89 (9)"),
    # EPSG:1149 "ETRS89 to WGS 84 (1)" - sifir parametre (null), dogruluk 1 m.
    ("ETRF2000 (ETRS89)", "WGS84 (EPSG ensemble)"): Helmert14(
        _Z, 0, _Z, _Z, 0, _Z, 2000.0, "EPSG:1149 ETRS89 to WGS 84 (1) (null, 1 m)"),
}


def yol_bul(kaynak, hedef):
    """Sistemler bir 'graf' gibi dusunulur: dugum = sistem, kenar = bilinen donusum.
    Genislik-oncelikli arama (BFS) ile en kisa zinciri bulur.
    Ornek: WGS84(G1762) -> ITRF2008 -> ITRF2020 -> ITRF2014 -> ETRF2000
    Dondurur: [(Helmert14, 'A', 'B'), ...]
    """
    if kaynak == hedef:
        return []
    komsular = {}
    for (a, b), h in DONUSUMLER.items():
        komsular.setdefault(a, []).append((b, h))
        komsular.setdefault(b, []).append((a, h.ters()))
    from collections import deque
    kuyruk, onceki = deque([kaynak]), {kaynak: None}
    while kuyruk:
        d = kuyruk.popleft()
        if d == hedef:
            break
        for k, h in komsular.get(d, []):
            if k not in onceki:
                onceki[k] = (d, h)
                kuyruk.append(k)
    if hedef not in onceki:
        raise ValueError(f"{kaynak} -> {hedef} icin donusum zinciri bulunamadi.")
    zincir, d = [], hedef
    while onceki[d] is not None:
        a, h = onceki[d]
        zincir.append((h, a, d))
        d = a
    return zincir[::-1]


def sistemler_arasi(XYZ, kaynak, hedef, epok, hizlari_kullan=True):
    """XYZ'yi kaynak sistemden hedefe tasir. Dondurur: (XYZ_hedef, adim_raporu_listesi)"""
    rapor, X = [], tuple(XYZ)
    for h, a, b in yol_bul(kaynak, hedef):
        t_kul = epok if hizlari_kullan else h.t0
        T, D, R = h.epoktaki_parametreler(t_kul)
        Xy = h.uygula(X, epok, hizlari_kullan)
        rapor.append({
            "adim": f"{a}  ->  {b}", "kaynak": h.kaynak, "epok": t_kul,
            "T_mm": T, "D_ppb": D, "R_mas": R,
            "fark_m": [Xy[i] - X[i] for i in range(3)],
        })
        X = Xy
    return X, rapor


# ---------------------------------------------------------------------------
# 4b) OTOMATIK PARAMETRE ESLESTIRME
#     Anahtar:  (kaynak sistem, hedef sistem, model)
#     * IERS 14p / 7p (t0) : DONUSUMLER grafi uzerinde yol_bul (mevcut mekanizma)
#     * Bursa-Wolf / M-B   : once PARAMETRE_DB'deki KAYITLI (yayinlanmis) set; yoksa
#                            kayitli BW'den esdeger M-B, o da yoksa zincirden turetilen 7p.
#     Hicbir kaynak yoksa parametre UYDURULMAZ (0 / ornek deger yazilmaz) -> bulundu=False.
# ---------------------------------------------------------------------------
MODEL_IERS = "IERS14"            # zamana bagli 14 parametre
MODEL_SABIT = "HELMERT7_T0"      # ayni IERS seti, hizlar ihmal (t0'da sabit)
MODEL_BW = "BURSA_WOLF"
MODEL_MB = "MOLODENSKY_BADEKAS"
MODEL_ELIPS = "ELIPSOIT"         # yalniz elipsoit degisimi (parametresiz)

BULUNAMADI = ("Bu kaynak-hedef dönüşümü için seçilen modelde kayıtlı dönüşüm "
              "parametresi bulunamadı.")
OTOMATIK = "Parametreler kaynak-hedef dönüşümüne göre otomatik dolduruldu."
KAYNAK_YOK = "Kaynak belirtilmemiş"


class ParametreBulunamadi(ValueError):
    """Secilen (kaynak, hedef, model) icin kayitli parametre yok."""


class ParametreSeti:
    """Bursa-Wolf / Molodensky-Badekas icin KAYITLI parametre seti (tek yonlu).

    Birimler: T [m], D [ppm], R [yay saniyesi], merkez [m] (yalniz M-B).
    konvansiyon: parametrenin YAYINLANDIGI konvansiyon ("PV" veya "CF").
    kurum: parametrenin kaynagi (EPSG, IERS, EUREF, ...); bilinmiyorsa KAYNAK_YOK.
    """

    def __init__(self, kaynak, hedef, model, T, D, R, konvansiyon, kurum=KAYNAK_YOK,
                 kod="", aciklama="", merkez=None, dogruluk_m=None):
        if model not in (MODEL_BW, MODEL_MB):
            raise ValueError("ParametreSeti yalniz Bursa-Wolf / Molodensky-Badekas icindir")
        if konvansiyon not in ("PV", "CF"):
            raise ValueError("konvansiyon 'PV' veya 'CF' olmali")
        if model == MODEL_MB and merkez is None:
            raise ValueError("Molodensky-Badekas icin donukluk merkezi (Xm, Ym, Zm) gerekli")
        self.kaynak, self.hedef, self.model = kaynak, hedef, model
        self.T, self.D, self.R = tuple(T), float(D), tuple(R)
        self.konvansiyon = konvansiyon
        self.merkez = tuple(merkez) if (model == MODEL_MB) else None
        self.kurum, self.kod, self.aciklama = kurum or KAYNAK_YOK, kod, aciklama
        self.dogruluk_m = dogruluk_m

    def _fonk_ve_arg(self):
        p = [*self.T, self.D, *self.R]
        if self.model == MODEL_MB:
            return molodensky_badekas, p + [self.merkez]
        return bursa_wolf, p

    def uygula(self, XYZ, ters=False):
        """ters=False: kayitli yonde (kaynak -> hedef).
        ters=True : hedef -> kaynak; parametre isaretleri DEGISTIRILMEZ, ileri fonksiyonun
                    KESIN tersi ters_cevir_7 (sabit-nokta iterasyonu) ile cozulur."""
        f, args = self._fonk_ve_arg()
        if ters:
            return ters_cevir_7(tuple(XYZ), f, *args, konvansiyon=self.konvansiyon)
        return f(tuple(XYZ), *args, konvansiyon=self.konvansiyon)


PARAMETRE_DB = {}


def parametre_kaydet(ps):
    """Seti (kaynak, hedef, model) anahtariyla kaydeder. Ters yon AYRICA kaydedilmez;
    gerekirse parametre_bul kesin ters cozumu kendisi secer."""
    PARAMETRE_DB[(ps.kaynak, ps.hedef, ps.model)] = ps
    return ps


def parametre_sil(kaynak, hedef, model):
    return PARAMETRE_DB.pop((kaynak, hedef, model), None)


# --- Kayitli setler (yalnizca yayinlanmis, dogrulanmis degerler) -------------
# Her iki kayit da EPSG'de Position Vector (yontem 9606), Turkiye kara+deniz, dogruluk 2 m:
#   EPSG:1784 "ED50 to WGS 84 (30)"  -> hedef WGS 84 toplulugu
#   EPSG:1783 "ED50 to ETRS89 (9)"   -> hedef ETRS89 (burada ETRF2000)
# Diger hedefler (ITRF96, WGS84 G-gerceklestirmeleri ...) icin parametre isim benzerligiyle
# kopyalanmaz; _bw_mb_eslesme bunlari DONUSUMLER zincirinden secilen epokta turetir.
for hedef_ad, kod_ad in [("WGS84 (EPSG ensemble)", "EPSG:1784  ED50 to WGS 84 (30)"),
                         ("ETRF2000 (ETRS89)", "EPSG:1783  ED50 to ETRS89 (9)")]:
    parametre_kaydet(ParametreSeti(
        "ED50 (Hayford)", hedef_ad, MODEL_BW,
        T=(-84.1, -101.8, -129.7), D=1.05, R=(0.0, 0.0, 0.468), konvansiyon="PV",
        kurum="EPSG", kod=kod_ad,
        aciklama="Turkiye kara+deniz, dogruluk 2 m (EPSG)",
        dogruluk_m=2.0))


class Eslesme:
    """parametre_bul'un sonucu: hangi parametre, hangi yonde, hangi kaynaktan."""

    def __init__(self, kaynak, hedef, model):
        self.kaynak, self.hedef, self.model = kaynak, hedef, model
        self.bulundu = False
        self.yon = "yok"        # "ileri" | "ters" | "zincir" | "ozdes" | "yok"
        self.ters = False       # BW/MB: kayitli set hedef->kaynak; kesin ters cozum uygulanir
        self.set = None         # ParametreSeti (BW/MB)
        self.zincir = []        # [(Helmert14, a, b), ...]  (IERS / 7p)
        self.epok = None
        # Gosterim degerleri (m, ppm, yay sn).  BW/MB'de KAYITLI degerlerin aynisi;
        # IERS'te secilen epoktaki P(t) (zincirde adimlarin toplami).
        self.T = self.D = self.R = None
        self.konvansiyon = None
        self.merkez = None
        self.kurum = KAYNAK_YOK
        self.kod = ""
        self.mesaj = BULUNAMADI
        self.ayrinti = []


def _helmert_kurumu(h):
    """DONUSUMLER kaydinin aciklama metninden kaynak kurumunu cikarir (uydurmadan)."""
    k = h.kaynak
    if k.startswith("EPSG"):
        return "EPSG"
    if "ozdes" in k:
        return "Project database (ozdeslik kabulu; NGA resmi donusum yayinlamaz)"
    if k.startswith("IERS"):
        return "IERS"
    if k.startswith("EUREF"):
        return "EUREF"
    return KAYNAK_YOK


def _iers_eslesme(e, epok):
    hiz = e.model == MODEL_IERS
    if hiz and epok is None:
        e.mesaj = "IERS 14-parametre icin gecerli bir olcu epogu (t) girin."
        return e
    try:
        zincir = yol_bul(e.kaynak, e.hedef)
    except ValueError:
        e.mesaj = BULUNAMADI
        return e
    T, D, R = [0.0, 0.0, 0.0], 0.0, [0.0, 0.0, 0.0]
    kurumlar, kodlar = [], []
    for h, a, b in zincir:
        t = epok if hiz else h.t0
        Ti, Di, Ri = h.epoktaki_parametreler(t)
        T = [T[k] + Ti[k] for k in range(3)]
        R = [R[k] + Ri[k] for k in range(3)]
        D += Di
        ku = _helmert_kurumu(h)
        if ku not in kurumlar:
            kurumlar.append(ku)
        kodlar.append(h.kaynak)
        e.ayrinti.append(
            f"{a} -> {b}  [{h.kaynak}]  t0={h.t0:.1f}"
            + (f", t={t:.2f}" if hiz else " (hizlar ihmal)") + "\n"
            f"   T0={h.T} mm  Tdot={h.Tdot} mm/y  D0={h.D} ppb  Ddot={h.Ddot} ppb/y\n"
            f"   R0={h.R} mas  Rdot={h.Rdot} mas/y")
    e.zincir, e.epok = zincir, (epok if hiz else None)
    e.T = tuple(x * 1e-3 for x in T)     # mm  -> m
    e.D = D * 1e-3                       # ppb -> ppm
    e.R = tuple(x * 1e-3 for x in R)     # mas -> yay sn
    e.konvansiyon = "PV"                 # IERS konvansiyonu
    e.kurum, e.kod = " + ".join(kurumlar), " | ".join(kodlar)
    if (e.kaynak, e.hedef) in DONUSUMLER:
        e.yon = "ileri"
    elif (e.hedef, e.kaynak) in DONUSUMLER:
        e.yon = "ters"
        e.ayrinti.append("Kayitli set ters yondedir: IERS'in onerdigi ters donusum "
                         "(Helmert14.ters) kullanilir.")
    else:
        e.yon = "zincir"
        e.ayrinti.append(f"{len(zincir)} adimli zincir. Gosterilen Tx..Rz adimlarin toplamidir "
                         "(birinci derece esdeger, fark << 0.01 mm); hesap adim adim yapilir.")
    if hiz:
        e.ayrinti.append(f"P(t) = P(t0) + Pdot*(t - t0) ile t = {epok:.2f} icin hesaplandi.")
    e.bulundu, e.mesaj = True, OTOMATIK
    return e


MB_MERKEZ = (4116000.0, 2656000.0, 4072000.0)
"""Kayitli M-B seti olmayan durumlarda kullanilan donukluk merkezi (uygulamanin varsayilan
ornek noktasi, Ankara civari).  Bu bir YAYINLANMIS M-B merkezi degildir: M-B parametreleri
Bursa-Wolf setinden T_MB = T_BW + [(1+D)R - I] Xm bagintisiyla turetilir; iki model ayni
sonucu verir (esdeger yeniden ifade)."""


def _bw_den_mb(T, D, R, konv, Xm=MB_MERKEZ):
    """Bursa-Wolf (T, D, R) setini, ayni donusumu veren M-B oteleme vektorune cevirir."""
    Rm = donukluk_matrisi(R[0] * SANIYE_RAD, R[1] * SANIYE_RAD, R[2] * SANIYE_RAD, konv)
    k = 1.0 + D * 1e-6
    RXm = _matris_vektor(Rm, Xm)
    return tuple(T[i] + k * RXm[i] - Xm[i] for i in range(3))


def _bw_mb_eslesme(e, epok):
    """Bursa-Wolf / Molodensky-Badekas icin parametre secimi (oncelik sirasiyla):
      1) PARAMETRE_DB'de ayni model icin kayitli set (ileri veya kesin ters)
      2) Model M-B ise ve kayitli BW seti varsa: BW'den esdeger M-B turetilir
      3) DONUSUMLER zincirinden secilen epokta 7 parametre turetilir (BW; M-B ise esdegeri)
    Hicbiri yoksa bulundu=False (parametre uydurulmaz)."""
    # 1) ayni model icin kayitli set
    for anahtar, ters in (((e.kaynak, e.hedef, e.model), False),
                          ((e.hedef, e.kaynak, e.model), True)):
        ps = PARAMETRE_DB.get(anahtar)
        if ps is not None:
            e.set, e.ters, e.yon = ps, ters, ("ters" if ters else "ileri")
            e.T, e.D, e.R = ps.T, ps.D, ps.R
            e.konvansiyon, e.merkez = ps.konvansiyon, ps.merkez
            e.kurum, e.kod = ps.kurum, ps.kod
            if ps.aciklama:
                e.ayrinti.append(ps.aciklama)
            if ters:
                e.ayrinti.append(f"Kayitli set {ps.kaynak} -> {ps.hedef} yonundedir. Secilen yon "
                                 "bunun tersi oldugundan parametreler DEGISTIRILMEDEN kesin ters "
                                 "cozum (ters_cevir_7, iteratif) uygulanir.")
            e.bulundu, e.mesaj = True, OTOMATIK
            return e

    # 2) M-B: kayitli BW setinden esdeger M-B
    if e.model == MODEL_MB:
        for anahtar, ters in (((e.kaynak, e.hedef, MODEL_BW), False),
                              ((e.hedef, e.kaynak, MODEL_BW), True)):
            bw = PARAMETRE_DB.get(anahtar)
            if bw is None:
                continue
            T_mb = _bw_den_mb(bw.T, bw.D, bw.R, bw.konvansiyon)
            ps = ParametreSeti(bw.kaynak, bw.hedef, MODEL_MB, T_mb, bw.D, bw.R, bw.konvansiyon,
                               kurum=bw.kurum + " (BW setinden M-B esdegeri)", kod=bw.kod,
                               merkez=MB_MERKEZ, dogruluk_m=bw.dogruluk_m)
            e.set, e.ters, e.yon = ps, ters, ("ters" if ters else "ileri")
            e.T, e.D, e.R = ps.T, ps.D, ps.R
            e.konvansiyon, e.merkez = ps.konvansiyon, ps.merkez
            e.kurum, e.kod = ps.kurum, ps.kod
            e.ayrinti.append(f"Yayinlanmis M-B seti yok: {bw.kod} Bursa-Wolf setinden "
                             f"T_MB = T_BW + [(1+D)R - I]Xm ile turetildi, Xm = {MB_MERKEZ} "
                             "(ornek nokta). Sonuc Bursa-Wolf ile aynidir.")
            if ters:
                e.ayrinti.append("Kayitli yon ters: kesin ters cozum (ters_cevir_7) uygulanir.")
            e.bulundu, e.mesaj = True, OTOMATIK
            return e

    # 3) DONUSUMLER zincirinden secilen epokta 7 parametre
    try:
        zincir = yol_bul(e.kaynak, e.hedef)
    except ValueError:
        e.mesaj = BULUNAMADI
        return e
    t = epok if epok is not None else 2025.0
    T, D, R = [0.0, 0.0, 0.0], 0.0, [0.0, 0.0, 0.0]
    kurumlar, kodlar = [], []
    for h, a, b in zincir:
        Ti, Di, Ri = h.epoktaki_parametreler(t)
        T = [T[k] + Ti[k] for k in range(3)]
        R = [R[k] + Ri[k] for k in range(3)]
        D += Di
        ku = _helmert_kurumu(h)
        if ku not in kurumlar:
            kurumlar.append(ku)
        kodlar.append(h.kaynak)
        e.ayrinti.append(f"{a} -> {b}  [{h.kaynak}]")
    T_m = tuple(x * 1e-3 for x in T)       # mm  -> m
    D_ppm = D * 1e-3                        # ppb -> ppm
    R_sn = tuple(x * 1e-3 for x in R)       # mas -> yay sn
    kurum = " + ".join(kurumlar) + f" (zincirden turetildi, t = {t:.2f})"
    kod = " | ".join(kodlar)
    if e.model == MODEL_BW:
        ps = ParametreSeti(e.kaynak, e.hedef, MODEL_BW, T_m, D_ppm, R_sn, "PV", kurum=kurum, kod=kod)
    else:
        ps = ParametreSeti(e.kaynak, e.hedef, MODEL_MB, _bw_den_mb(T_m, D_ppm, R_sn, "PV"),
                           D_ppm, R_sn, "PV", kurum=kurum, kod=kod, merkez=MB_MERKEZ)
        e.ayrinti.append(f"M-B: Xm = {MB_MERKEZ} (ornek nokta); T_MB = T_BW + [(1+D)R - I]Xm.")
    e.set, e.yon = ps, ("ileri" if len(zincir) == 1 else "zincir")
    e.zincir = zincir
    e.T, e.D, e.R = ps.T, ps.D, ps.R
    e.konvansiyon, e.merkez = "PV", ps.merkez
    e.kurum, e.kod = kurum, kod
    e.ayrinti.append(f"Kayitli {e.model} seti yok: 7 parametre {len(zincir)} adimli zincirin "
                     f"t = {t:.2f} epogundaki toplamidir (birinci derece esdeger). Hiz iceren "
                     "adimlarda sonuc epoga baglidir.")
    e.bulundu, e.mesaj = True, OTOMATIK
    return e


def parametre_bul(kaynak, hedef, model, epok=None):
    """(kaynak, hedef, model) icin parametre setini bulur.  Dondurur: Eslesme.
    Bulunamazsa Eslesme.bulundu = False ve parametre alanlari None kalir."""
    e = Eslesme(kaynak, hedef, model)
    if kaynak not in SISTEMLER or hedef not in SISTEMLER:
        e.mesaj = f"Bilinmeyen sistem: {kaynak if kaynak not in SISTEMLER else hedef}"
        return e
    if model == MODEL_ELIPS:
        e.bulundu, e.yon, e.kurum = True, "ozdes", "-"
        e.mesaj = ("Bu model donusum parametresi kullanmaz: cerceve ayni kabul edilir, "
                   "X, Y, Z degismez; yalniz elipsoit degisir.")
        return e
    if model not in (MODEL_IERS, MODEL_SABIT, MODEL_BW, MODEL_MB):
        e.mesaj = f"Bilinmeyen model: {model}"
        return e
    if kaynak == hedef:
        e.bulundu, e.yon, e.kurum = True, "ozdes", "-"
        e.T, e.D, e.R, e.konvansiyon = (0.0, 0.0, 0.0), 0.0, (0.0, 0.0, 0.0), "PV"
        e.mesaj = "Kaynak ve hedef ayni sistem: donusum yok (ozdeslik)."
        return e
    if model in (MODEL_IERS, MODEL_SABIT):
        return _iers_eslesme(e, epok)
    return _bw_mb_eslesme(e, epok)


def donustur(XYZ, kaynak, hedef, model, epok=None):
    """Otomatik secilen parametrelerle donusum.  Dondurur: (XYZ_hedef, Eslesme, rapor).
    Kayitli parametre yoksa ParametreBulunamadi firlatir (ornek/0 deger KULLANILMAZ)."""
    e = parametre_bul(kaynak, hedef, model, epok)
    if not e.bulundu:
        raise ParametreBulunamadi(e.mesaj)
    if e.yon == "ozdes":
        return tuple(XYZ), e, []
    if model in (MODEL_IERS, MODEL_SABIT):
        X2, rapor = sistemler_arasi(XYZ, kaynak, hedef,
                                    epok if epok is not None else 0.0, model == MODEL_IERS)
        return X2, e, rapor
    return e.set.uygula(XYZ, ters=e.ters), e, []


# ---------------------------------------------------------------------------
# 5) DERECE - DAKIKA - SANIYE
# ---------------------------------------------------------------------------
def aci_oku(metin):
    """'39.925', '39 55 30.12', 39°55'30.12"', '-32 51 7.5' veya '32 51 7.5 W' kabul eder."""
    s = metin.strip().upper().replace(",", ".")
    isaret = 1.0
    if s and s[-1] in "NSEWKGDB":            # N/S/E/W ve Turkce K/G/D/B
        if s[-1] in "SWGB":
            isaret = -1.0
        s = s[:-1]
    for c in "°'\"″′:dDmM":
        s = s.replace(c, " ")
    parca = s.split()
    if not parca:
        raise ValueError("Bos aci degeri")
    if parca[0].startswith("-"):
        isaret, parca[0] = -isaret, parca[0][1:]
    deger = 0.0
    for i, p in enumerate(parca[:3]):
        deger += float(p) / (60.0 ** i)
    return isaret * deger


def dms(deg, sn_hane=5):
    isaret = "-" if deg < 0 else ""
    deg = abs(deg)
    d = int(deg)
    m = int((deg - d) * 60)
    s = (deg - d - m / 60.0) * 3600.0
    if round(s, sn_hane) >= 60.0:
        s, m = 0.0, m + 1
    if m >= 60:
        m, d = 0, d + 1
    return f"{isaret}{d}° {m:02d}' {s:0{3 + sn_hane}.{sn_hane}f}\""


if __name__ == "__main__":
    # Kucuk bir deneme: Ankara civari bir nokta
    phi, lam, h = 39.925, 32.8369, 938.0
    X = geo_to_cart(phi, lam, h, "GRS80")
    print("GRS80  XYZ :", ["%.4f" % v for v in X])
    print("geri donus :", cart_to_geo(*X, "GRS80"))
    print("WGS84 phi,lam,h (ayni XYZ):", cart_to_geo(*X, "WGS84"))
    Y, r = sistemler_arasi(X, "ITRF2020", "ITRF96 (TUREF)", 2025.0)
    for a in r:
        print(a["adim"], ["%.4f" % v for v in a["fark_m"]])
