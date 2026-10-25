/*
 * jeodezi.js - Koordinat donusum cekirdegi (arayuzden BAGIMSIZ)
 * ==============================================================
 * jeodezi.py'nin birebir JavaScript karsiligi. Tarayicida `window.JZ`, Node'da
 * `require('./jeodezi.js')` ile kullanilir. Yalnizca Math kullanir.
 *
 *  1) Elipsoitler
 *  2) Cografi (phi, lambda, h) <-> Kartezyen (X, Y, Z)
 *  3) Helmert modelleri: Bursa-Wolf (PV/CF), Molodensky-Badekas, IERS 14 parametre
 *  4) Referans sistemleri, IERS/EUREF/EPSG parametreleri, BFS ile zincirleme
 *  4b) Otomatik parametre eslestirme (kaynak, hedef, model)
 *  5) Derece-dakika-saniye yardimcilari
 *
 * Konvansiyonlar Python surumuyle aynidir:
 *  Bursa-Wolf / M-B girdileri: T [m], D [ppm], R [yay saniyesi]
 *  Helmert14 (IERS tablolari): T [mm], D [ppb], R [mas]; hizlar /yil
 */
(function (kok, fabrika) {
  if (typeof module === "object" && module.exports) module.exports = fabrika();
  else kok.JZ = fabrika();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const rad = (d) => (d * Math.PI) / 180;
  const der = (r) => (r * 180) / Math.PI;

  // -------------------------------------------------------------------------
  // 1) ELIPSOITLER   ad: [a (m), 1/f]
  // -------------------------------------------------------------------------
  const ELIPSOITLER = {
    "GRS80": [6378137.0, 298.257222101],
    "WGS84": [6378137.0, 298.257223563],
    "Hayford (International 1924)": [6378388.0, 297.0],
    "Krassovsky 1940": [6378245.0, 298.3],
    "Bessel 1841": [6377397.155, 299.1528128],
  };

  function elipsoitSabitleri(ad) {
    const kayit = ELIPSOITLER[ad];
    if (!kayit) throw new Error("Bilinmeyen elipsoit: " + ad);
    const [a, invf] = kayit;
    const f = 1.0 / invf;
    const b = a * (1.0 - f);
    const e2 = f * (2.0 - f);
    const ep2 = e2 / (1.0 - e2);
    return { a, b, f, e2, ep2 };
  }

  // -------------------------------------------------------------------------
  // 2) COGRAFI <-> KARTEZYEN
  // -------------------------------------------------------------------------
  function geoToCart(phiDeg, lamDeg, h, elipsoit = "GRS80") {
    const { a, e2 } = elipsoitSabitleri(elipsoit);
    const phi = rad(phiDeg), lam = rad(lamDeg);
    const sp = Math.sin(phi), cp = Math.cos(phi);
    const N = a / Math.sqrt(1.0 - e2 * sp * sp);
    return [(N + h) * cp * Math.cos(lam), (N + h) * cp * Math.sin(lam), (N * (1.0 - e2) + h) * sp];
  }

  /** Kartezyen -> Cografi. Dondurur [phiDeg, lamDeg, h, iterasyon]. */
  function cartToGeo(X, Y, Z, elipsoit = "GRS80", yontem = "iteratif", tol = 1e-12, maxIter = 20) {
    const { a, b, e2, ep2 } = elipsoitSabitleri(elipsoit);
    const p = Math.hypot(X, Y);
    const lam = Math.atan2(Y, X);
    if (p < 1e-9) {
      const phiK = (Z >= 0 ? 1 : -1) * (Math.PI / 2);
      return [der(phiK), der(lam), Math.abs(Z) - b, 0];
    }
    let phi, nIter;
    if (yontem === "bowring") {
      const theta = Math.atan2(Z * a, p * b);
      const st = Math.sin(theta), ct = Math.cos(theta);
      phi = Math.atan2(Z + ep2 * b * st ** 3, p - e2 * a * ct ** 3);
      nIter = 1;
    } else {
      phi = Math.atan2(Z, p * (1.0 - e2));
      nIter = 0;
      for (let i = 1; i <= maxIter; i++) {
        nIter = i;
        const N = a / Math.sqrt(1.0 - e2 * Math.sin(phi) ** 2);
        const h = p / Math.cos(phi) - N;
        const yeni = Math.atan2(Z, p * (1.0 - (e2 * N) / (N + h)));
        const fark = Math.abs(yeni - phi);
        phi = yeni;
        if (fark < tol) break;
      }
    }
    const sp = Math.sin(phi);
    const N = a / Math.sqrt(1.0 - e2 * sp * sp);
    const h = p * Math.cos(phi) + Z * sp - (a * a) / N;
    return [der(phi), der(lam), h, nIter];
  }

  // -------------------------------------------------------------------------
  // 3) HELMERT MODELLERI
  // -------------------------------------------------------------------------
  const SANIYE_RAD = Math.PI / (180.0 * 3600.0);

  function matrisVektor(M, v) {
    return [0, 1, 2].map((i) => M[i][0] * v[0] + M[i][1] * v[1] + M[i][2] * v[2]);
  }

  function donuklukMatrisi(rx, ry, rz, konvansiyon = "PV") {
    if (konvansiyon === "CF") { rx = -rx; ry = -ry; rz = -rz; }
    return [[1.0, -rz, ry], [rz, 1.0, -rx], [-ry, rx, 1.0]];
  }

  /** Bursa-Wolf 7 parametre: X2 = T + (1 + D) R X1 */
  function bursaWolf(XYZ, tx, ty, tz, dPpm, rxSn, rySn, rzSn, konvansiyon = "PV") {
    const R = donuklukMatrisi(rxSn * SANIYE_RAD, rySn * SANIYE_RAD, rzSn * SANIYE_RAD, konvansiyon);
    const k = 1.0 + dPpm * 1e-6;
    const RX = matrisVektor(R, XYZ);
    return [tx + k * RX[0], ty + k * RX[1], tz + k * RX[2]];
  }

  /** Molodensky-Badekas: X2 = Xm + T + (1 + D) R (X1 - Xm) */
  function molodenskyBadekas(XYZ, tx, ty, tz, dPpm, rxSn, rySn, rzSn, merkez, konvansiyon = "PV") {
    const R = donuklukMatrisi(rxSn * SANIYE_RAD, rySn * SANIYE_RAD, rzSn * SANIYE_RAD, konvansiyon);
    const k = 1.0 + dPpm * 1e-6;
    const dX = [0, 1, 2].map((i) => XYZ[i] - merkez[i]);
    const RdX = matrisVektor(R, dX);
    const T = [tx, ty, tz];
    return [0, 1, 2].map((i) => merkez[i] + T[i] + k * RdX[i]);
  }

  /** Ileri donusumun kesin tersi (sabit nokta iterasyonu). fonk(XYZ, ...args, konvansiyon) */
  function tersCevir7(XYZ, fonk, args, konvansiyon = "PV") {
    let X = XYZ.slice();
    for (let n = 0; n < 10; n++) {
      const Y = fonk(X, ...args, konvansiyon);
      X = [0, 1, 2].map((i) => X[i] - (Y[i] - XYZ[i]));
    }
    return X;
  }

  /** IERS konvansiyonu (Position Vector), zamana bagli 14 parametre. */
  class Helmert14 {
    constructor(T, D, R, Tdot, Ddot, Rdot, t0, kaynak = "") {
      this.T = T.slice(); this.D = D; this.R = R.slice();
      this.Tdot = Tdot.slice(); this.Ddot = Ddot; this.Rdot = Rdot.slice();
      this.t0 = t0; this.kaynak = kaynak;
    }
    ters() {
      const n = (v) => v.map((x) => -x);
      return new Helmert14(n(this.T), -this.D, n(this.R), n(this.Tdot), -this.Ddot,
        n(this.Rdot), this.t0, this.kaynak + " (ters)");
    }
    epoktakiParametreler(t) {
      const dt = t - this.t0;
      return {
        T: [0, 1, 2].map((i) => this.T[i] + this.Tdot[i] * dt),
        D: this.D + this.Ddot * dt,
        R: [0, 1, 2].map((i) => this.R[i] + this.Rdot[i] * dt),
      };
    }
    uygula(XYZ, t, hizlariKullan = true) {
      const p = this.epoktakiParametreler(hizlariKullan ? t : this.t0);
      const [tx, ty, tz] = p.T.map((x) => x * 1e-3);
      const d = p.D * 1e-9;
      const [r1, r2, r3] = p.R.map((x) => x * 1e-3 * SANIYE_RAD);
      const [X, Y, Z] = XYZ;
      return [X + tx + d * X - r3 * Y + r2 * Z,
        Y + ty + r3 * X + d * Y - r1 * Z,
        Z + tz - r2 * X + r1 * Y + d * Z];
    }
  }

  // -------------------------------------------------------------------------
  // 4) REFERANS SISTEMLERI   gorunen ad: elipsoit
  // -------------------------------------------------------------------------
  const SISTEMLER = {
    "ITRF2020": "GRS80",
    "ITRF2014": "GRS80",
    "ITRF2008": "GRS80",
    "ITRF2005": "GRS80",
    "ITRF2000": "GRS80",
    "ITRF97": "GRS80",
    "ITRF96 (TUREF)": "GRS80",
    "ETRF2000 (ETRS89)": "GRS80",
    "WGS84 (G2296)": "WGS84",
    "WGS84 (G2139)": "WGS84",
    "WGS84 (G1762)": "WGS84",
    "WGS84 (EPSG ensemble)": "WGS84",
    "ED50 (Hayford)": "Hayford (International 1924)",
  };

  /** Geosentrik fark -> yerel Dogu, Kuzey, Yukari */
  function enuFarki(dXYZ, phiDeg, lamDeg) {
    const p = rad(phiDeg), l = rad(lamDeg);
    const sp = Math.sin(p), cp = Math.cos(p), sl = Math.sin(l), cl = Math.cos(l);
    const [dX, dY, dZ] = dXYZ;
    return [-sl * dX + cl * dY,
      -sp * cl * dX - sp * sl * dY + cp * dZ,
      cp * cl * dX + cp * sl * dY + sp * dZ];
  }

  // IERS: https://itrf.ign.fr/en/solutions/transformations ; EUREF TN-1 ; EPSG
  const _Z = [0.0, 0.0, 0.0];
  const DONUSUMLER = new Map();          // anahtar "A|B" (ekleme sirasi korunur)
  const anahtar2 = (a, b) => a + "|" + b;
  function donusumEkle(a, b, h) { DONUSUMLER.set(anahtar2(a, b), { a, b, h }); }

  donusumEkle("ITRF2020", "ITRF2014", new Helmert14([-1.4, -0.9, 1.4], -0.42, _Z,
    [0.0, -0.1, 0.2], 0.00, _Z, 2015.0, "IERS ITRF2020->ITRF2014"));
  donusumEkle("ITRF2020", "ITRF2008", new Helmert14([0.2, 1.0, 3.3], -0.29, _Z,
    [0.0, -0.1, 0.1], 0.03, _Z, 2015.0, "IERS ITRF2020->ITRF2008"));
  donusumEkle("ITRF2020", "ITRF2005", new Helmert14([2.7, 0.1, -1.4], 0.65, _Z,
    [0.3, -0.1, 0.1], 0.03, _Z, 2015.0, "IERS ITRF2020->ITRF2005"));
  donusumEkle("ITRF2020", "ITRF2000", new Helmert14([-0.2, 0.8, -34.2], 2.25, _Z,
    [0.1, 0.0, -1.7], 0.11, _Z, 2015.0, "IERS ITRF2020->ITRF2000"));
  donusumEkle("ITRF2020", "ITRF97", new Helmert14([6.5, -3.9, -77.9], 3.98, [0.0, 0.0, 0.36],
    [0.1, -0.6, -3.1], 0.12, [0.0, 0.0, 0.02], 2015.0, "IERS ITRF2020->ITRF97"));
  donusumEkle("ITRF2020", "ITRF96 (TUREF)", new Helmert14([6.5, -3.9, -77.9], 3.98, [0.0, 0.0, 0.36],
    [0.1, -0.6, -3.1], 0.12, [0.0, 0.0, 0.02], 2015.0, "IERS ITRF2020->ITRF96"));
  donusumEkle("ITRF2014", "ITRF2008", new Helmert14([1.6, 1.9, 2.4], -0.02, _Z,
    [0.0, 0.0, -0.1], 0.03, _Z, 2010.0, "IERS ITRF2014->ITRF2008"));
  donusumEkle("ITRF2014", "ETRF2000 (ETRS89)", new Helmert14([53.7, 51.2, -55.1], 1.02,
    [0.891, 5.390, -8.712], [0.1, 0.1, -1.9], 0.11, [0.081, 0.490, -0.792],
    2010.0, "EUREF ITRF2014->ETRF2000"));
  donusumEkle("WGS84 (G2296)", "ITRF2020", new Helmert14(_Z, 0, _Z, _Z, 0, _Z, 2024.0, "WGS84(G2296)~ITRF2020 (özdeş)"));
  donusumEkle("WGS84 (G2139)", "ITRF2014", new Helmert14(_Z, 0, _Z, _Z, 0, _Z, 2016.0, "WGS84(G2139)~ITRF2014 (özdeş)"));
  donusumEkle("WGS84 (G1762)", "ITRF2008", new Helmert14(_Z, 0, _Z, _Z, 0, _Z, 2005.0, "WGS84(G1762)~ITRF2008 (özdeş)"));
  // EPSG:1783 "ED50 to ETRS89 (9)" - Position Vector, Turkiye, dogruluk 2 m
  donusumEkle("ED50 (Hayford)", "ETRF2000 (ETRS89)", new Helmert14(
    [-84100.0, -101800.0, -129700.0], 1050.0, [0.0, 0.0, 468.0],
    _Z, 0, _Z, 2000.0, "EPSG:1783 ED50 to ETRS89 (9)"));
  // EPSG:1149 "ETRS89 to WGS 84 (1)" - null, dogruluk 1 m
  donusumEkle("ETRF2000 (ETRS89)", "WGS84 (EPSG ensemble)", new Helmert14(
    _Z, 0, _Z, _Z, 0, _Z, 2000.0, "EPSG:1149 ETRS89 to WGS 84 (1) (null, 1 m)"));

  function donusumVar(a, b) { return DONUSUMLER.has(anahtar2(a, b)); }
  function donusumAl(a, b) { const k = DONUSUMLER.get(anahtar2(a, b)); return k ? k.h : undefined; }

  /** BFS ile en kisa zincir. Dondurur [{h, a, b}, ...] */
  function yolBul(kaynak, hedef) {
    if (kaynak === hedef) return [];
    const komsular = new Map();
    const ekle = (d, k, h) => { if (!komsular.has(d)) komsular.set(d, []); komsular.get(d).push([k, h]); };
    for (const { a, b, h } of DONUSUMLER.values()) { ekle(a, b, h); ekle(b, a, h.ters()); }
    const kuyruk = [kaynak];
    const onceki = new Map([[kaynak, null]]);
    while (kuyruk.length) {
      const d = kuyruk.shift();
      if (d === hedef) break;
      for (const [k, h] of komsular.get(d) || []) {
        if (!onceki.has(k)) { onceki.set(k, [d, h]); kuyruk.push(k); }
      }
    }
    if (!onceki.has(hedef)) throw new Error(`${kaynak} -> ${hedef} için dönüşüm zinciri bulunamadı.`);
    const zincir = [];
    let d = hedef;
    while (onceki.get(d) !== null) {
      const [a, h] = onceki.get(d);
      zincir.push({ h, a, b: d });
      d = a;
    }
    return zincir.reverse();
  }

  function sistemlerArasi(XYZ, kaynak, hedef, epok, hizlariKullan = true) {
    const rapor = [];
    let X = XYZ.slice();
    for (const { h, a, b } of yolBul(kaynak, hedef)) {
      const tKul = hizlariKullan ? epok : h.t0;
      const p = h.epoktakiParametreler(tKul);
      const Xy = h.uygula(X, epok, hizlariKullan);
      rapor.push({
        adim: `${a}  ->  ${b}`, kaynak: h.kaynak, epok: tKul,
        T_mm: p.T, D_ppb: p.D, R_mas: p.R,
        fark_m: [0, 1, 2].map((i) => Xy[i] - X[i]),
      });
      X = Xy;
    }
    return [X, rapor];
  }

  // -------------------------------------------------------------------------
  // 4b) OTOMATIK PARAMETRE ESLESTIRME
  // -------------------------------------------------------------------------
  const MODEL_IERS = "IERS14";
  const MODEL_SABIT = "HELMERT7_T0";
  const MODEL_BW = "BURSA_WOLF";
  const MODEL_MB = "MOLODENSKY_BADEKAS";
  const MODEL_ELIPS = "ELIPSOIT";

  const BULUNAMADI = "Bu kaynak-hedef dönüşümü için seçilen modelde kayıtlı dönüşüm parametresi bulunamadı.";
  const OTOMATIK = "Parametreler kaynak-hedef dönüşümüne göre otomatik dolduruldu.";
  const KAYNAK_YOK = "Kaynak belirtilmemiş";

  class ParametreBulunamadi extends Error {
    constructor(mesaj) { super(mesaj); this.name = "ParametreBulunamadi"; }
  }

  class ParametreSeti {
    constructor(kaynak, hedef, model, T, D, R, konvansiyon,
      { kurum = KAYNAK_YOK, kod = "", aciklama = "", merkez = null, dogruluk_m = null } = {}) {
      if (model !== MODEL_BW && model !== MODEL_MB)
        throw new Error("ParametreSeti yalnız Bursa-Wolf / Molodensky-Badekas içindir");
      if (konvansiyon !== "PV" && konvansiyon !== "CF")
        throw new Error("konvansiyon 'PV' veya 'CF' olmalı");
      if (model === MODEL_MB && merkez == null)
        throw new Error("Molodensky-Badekas için dönüklük merkezi (Xm, Ym, Zm) gerekli");
      this.kaynak = kaynak; this.hedef = hedef; this.model = model;
      this.T = T.map(Number); this.D = Number(D); this.R = R.map(Number);
      this.konvansiyon = konvansiyon;
      this.merkez = model === MODEL_MB ? merkez.slice() : null;
      this.kurum = kurum || KAYNAK_YOK; this.kod = kod; this.aciklama = aciklama;
      this.dogruluk_m = dogruluk_m;
    }
    _fonkVeArg() {
      const p = [...this.T, this.D, ...this.R];
      if (this.model === MODEL_MB) return [molodenskyBadekas, [...p, this.merkez]];
      return [bursaWolf, p];
    }
    uygula(XYZ, ters = false) {
      const [f, args] = this._fonkVeArg();
      if (ters) return tersCevir7(XYZ.slice(), f, args, this.konvansiyon);
      return f(XYZ.slice(), ...args, this.konvansiyon);
    }
  }

  const PARAMETRE_DB = new Map();
  const anahtar3 = (k, h, m) => k + "|" + h + "|" + m;
  function parametreKaydet(ps) { PARAMETRE_DB.set(anahtar3(ps.kaynak, ps.hedef, ps.model), ps); return ps; }
  function parametreSil(k, h, m) { const ps = PARAMETRE_DB.get(anahtar3(k, h, m)); PARAMETRE_DB.delete(anahtar3(k, h, m)); return ps; }

  // EPSG:1784 ED50 -> WGS 84 (30) ve EPSG:1783 ED50 -> ETRS89 (9), PV, Turkiye, 2 m
  for (const [hedefAd, kodAd] of [["WGS84 (EPSG ensemble)", "EPSG:1784  ED50 to WGS 84 (30)"],
    ["ETRF2000 (ETRS89)", "EPSG:1783  ED50 to ETRS89 (9)"]]) {
    parametreKaydet(new ParametreSeti("ED50 (Hayford)", hedefAd, MODEL_BW,
      [-84.1, -101.8, -129.7], 1.05, [0.0, 0.0, 0.468], "PV",
      { kurum: "EPSG", kod: kodAd, aciklama: "Türkiye kara+deniz, doğruluk 2 m (EPSG)", dogruluk_m: 2.0 }));
  }

  class Eslesme {
    constructor(kaynak, hedef, model) {
      this.kaynak = kaynak; this.hedef = hedef; this.model = model;
      this.bulundu = false;
      this.yon = "yok";       // ileri | ters | zincir | ozdes | yok
      this.ters = false;
      this.set = null;
      this.zincir = [];
      this.epok = null;
      this.T = null; this.D = null; this.R = null;
      this.konvansiyon = null;
      this.merkez = null;
      this.kurum = KAYNAK_YOK;
      this.kod = "";
      this.mesaj = BULUNAMADI;
      this.ayrinti = [];
    }
  }

  function helmertKurumu(h) {
    const k = h.kaynak;
    if (k.startsWith("EPSG")) return "EPSG";
    if (k.includes("özdeş")) return "Proje veritabanı (özdeşlik kabulü; NGA resmî dönüşüm yayınlamaz)";
    if (k.startsWith("IERS")) return "IERS";
    if (k.startsWith("EUREF")) return "EUREF";
    return KAYNAK_YOK;
  }

  // Python list repr'ine benzer gosterim (ornek: [0.0, -0.1, 0.2])
  const pyf = (x) => (Number.isInteger(x) ? x.toFixed(1) : String(x));
  const pyl = (v) => "[" + v.map(pyf).join(", ") + "]";

  function iersEslesme(e, epok) {
    const hiz = e.model === MODEL_IERS;
    if (hiz && epok == null) { e.mesaj = "IERS 14-parametre için geçerli bir ölçü epoğu (t) girin."; return e; }
    let zincir;
    try { zincir = yolBul(e.kaynak, e.hedef); } catch (err) { e.mesaj = BULUNAMADI; return e; }
    let T = [0, 0, 0], D = 0, R = [0, 0, 0];
    const kurumlar = [], kodlar = [];
    for (const { h, a, b } of zincir) {
      const t = hiz ? epok : h.t0;
      const p = h.epoktakiParametreler(t);
      T = T.map((x, k) => x + p.T[k]);
      R = R.map((x, k) => x + p.R[k]);
      D += p.D;
      const ku = helmertKurumu(h);
      if (!kurumlar.includes(ku)) kurumlar.push(ku);
      kodlar.push(h.kaynak);
      e.ayrinti.push(`${a} -> ${b}  [${h.kaynak}]  t0=${h.t0.toFixed(1)}` +
        (hiz ? `, t=${t.toFixed(2)}` : " (hızlar ihmal)") + "\n" +
        `   T0=${pyl(h.T)} mm  Tdot=${pyl(h.Tdot)} mm/y  D0=${pyf(h.D)} ppb  Ddot=${pyf(h.Ddot)} ppb/y\n` +
        `   R0=${pyl(h.R)} mas  Rdot=${pyl(h.Rdot)} mas/y`);
    }
    e.zincir = zincir;
    e.epok = hiz ? epok : null;
    e.T = T.map((x) => x * 1e-3);
    e.D = D * 1e-3;
    e.R = R.map((x) => x * 1e-3);
    e.konvansiyon = "PV";
    e.kurum = kurumlar.join(" + ");
    e.kod = kodlar.join(" | ");
    if (donusumVar(e.kaynak, e.hedef)) e.yon = "ileri";
    else if (donusumVar(e.hedef, e.kaynak)) {
      e.yon = "ters";
      e.ayrinti.push("Kayıtlı set ters yöndedir: IERS'in önerdiği ters dönüşüm (Helmert14.ters) kullanılır.");
    } else {
      e.yon = "zincir";
      e.ayrinti.push(`${zincir.length} adımlı zincir. Gösterilen Tx..Rz adımların toplamıdır ` +
        "(birinci derece eşdeğer, fark << 0.01 mm); hesap adım adım yapılır.");
    }
    if (hiz) e.ayrinti.push(`P(t) = P(t0) + Pdot*(t - t0) ile t = ${epok.toFixed(2)} için hesaplandı.`);
    e.bulundu = true; e.mesaj = OTOMATIK;
    return e;
  }

  const MB_MERKEZ = [4116000.0, 2656000.0, 4072000.0];

  function bwDenMb(T, D, R, konv, Xm = MB_MERKEZ) {
    const Rm = donuklukMatrisi(R[0] * SANIYE_RAD, R[1] * SANIYE_RAD, R[2] * SANIYE_RAD, konv);
    const k = 1.0 + D * 1e-6;
    const RXm = matrisVektor(Rm, Xm);
    return [0, 1, 2].map((i) => T[i] + k * RXm[i] - Xm[i]);
  }

  function setiYaz(e, ps, ters) {
    e.set = ps; e.ters = ters; e.yon = ters ? "ters" : "ileri";
    e.T = ps.T; e.D = ps.D; e.R = ps.R;
    e.konvansiyon = ps.konvansiyon; e.merkez = ps.merkez;
    e.kurum = ps.kurum; e.kod = ps.kod;
  }

  function bwMbEslesme(e, epok) {
    // 1) ayni model icin kayitli set
    for (const [k, h, ters] of [[e.kaynak, e.hedef, false], [e.hedef, e.kaynak, true]]) {
      const ps = PARAMETRE_DB.get(anahtar3(k, h, e.model));
      if (ps) {
        setiYaz(e, ps, ters);
        if (ps.aciklama) e.ayrinti.push(ps.aciklama);
        if (ters) e.ayrinti.push(`Kayıtlı set ${ps.kaynak} -> ${ps.hedef} yönündedir. Seçilen yön ` +
          "bunun tersi olduğundan parametreler DEĞİŞTİRİLMEDEN kesin ters çözüm (ters_cevir_7, iteratif) uygulanır.");
        e.bulundu = true; e.mesaj = OTOMATIK;
        return e;
      }
    }
    // 2) M-B: kayitli BW setinden esdeger M-B
    if (e.model === MODEL_MB) {
      for (const [k, h, ters] of [[e.kaynak, e.hedef, false], [e.hedef, e.kaynak, true]]) {
        const bw = PARAMETRE_DB.get(anahtar3(k, h, MODEL_BW));
        if (!bw) continue;
        const ps = new ParametreSeti(bw.kaynak, bw.hedef, MODEL_MB, bwDenMb(bw.T, bw.D, bw.R, bw.konvansiyon),
          bw.D, bw.R, bw.konvansiyon, { kurum: bw.kurum + " (BW setinden M-B eşdeğeri)", kod: bw.kod,
            merkez: MB_MERKEZ, dogruluk_m: bw.dogruluk_m });
        setiYaz(e, ps, ters);
        e.ayrinti.push(`Yayınlanmış M-B seti yok: ${bw.kod} Bursa-Wolf setinden T_MB = T_BW + [(1+D)R - I]Xm ` +
          `ile türetildi, Xm = (${MB_MERKEZ.map(pyf).join(", ")}) (örnek nokta). Sonuç Bursa-Wolf ile aynıdır.`);
        if (ters) e.ayrinti.push("Kayıtlı yön ters: kesin ters çözüm (ters_cevir_7) uygulanır.");
        e.bulundu = true; e.mesaj = OTOMATIK;
        return e;
      }
    }
    // 3) zincirden secilen epokta 7 parametre
    let zincir;
    try { zincir = yolBul(e.kaynak, e.hedef); } catch (err) { e.mesaj = BULUNAMADI; return e; }
    const t = epok != null ? epok : 2025.0;
    let T = [0, 0, 0], D = 0, R = [0, 0, 0];
    const kurumlar = [], kodlar = [];
    for (const { h, a, b } of zincir) {
      const p = h.epoktakiParametreler(t);
      T = T.map((x, k) => x + p.T[k]);
      R = R.map((x, k) => x + p.R[k]);
      D += p.D;
      const ku = helmertKurumu(h);
      if (!kurumlar.includes(ku)) kurumlar.push(ku);
      kodlar.push(h.kaynak);
      e.ayrinti.push(`${a} -> ${b}  [${h.kaynak}]`);
    }
    const Tm = T.map((x) => x * 1e-3), Dppm = D * 1e-3, Rsn = R.map((x) => x * 1e-3);
    const kurum = kurumlar.join(" + ") + ` (zincirden türetildi, t = ${t.toFixed(2)})`;
    const kod = kodlar.join(" | ");
    let ps;
    if (e.model === MODEL_BW) {
      ps = new ParametreSeti(e.kaynak, e.hedef, MODEL_BW, Tm, Dppm, Rsn, "PV", { kurum, kod });
    } else {
      ps = new ParametreSeti(e.kaynak, e.hedef, MODEL_MB, bwDenMb(Tm, Dppm, Rsn, "PV"), Dppm, Rsn, "PV",
        { kurum, kod, merkez: MB_MERKEZ });
      e.ayrinti.push(`M-B: Xm = (${MB_MERKEZ.map(pyf).join(", ")}) (örnek nokta); T_MB = T_BW + [(1+D)R - I]Xm.`);
    }
    e.set = ps; e.yon = zincir.length === 1 ? "ileri" : "zincir";
    e.zincir = zincir;
    e.T = ps.T; e.D = ps.D; e.R = ps.R;
    e.konvansiyon = "PV"; e.merkez = ps.merkez;
    e.kurum = kurum; e.kod = kod;
    e.ayrinti.push(`Kayıtlı ${e.model} seti yok: 7 parametre ${zincir.length} adımlı zincirin ` +
      `t = ${t.toFixed(2)} epoğundaki toplamıdır (birinci derece eşdeğer). Hız içeren adımlarda sonuç epoğa bağlıdır.`);
    e.bulundu = true; e.mesaj = OTOMATIK;
    return e;
  }

  function parametreBul(kaynak, hedef, model, epok = null) {
    const e = new Eslesme(kaynak, hedef, model);
    if (!(kaynak in SISTEMLER) || !(hedef in SISTEMLER)) {
      e.mesaj = "Bilinmeyen sistem: " + (!(kaynak in SISTEMLER) ? kaynak : hedef);
      return e;
    }
    if (model === MODEL_ELIPS) {
      e.bulundu = true; e.yon = "ozdes"; e.kurum = "-";
      e.mesaj = "Bu model dönüşüm parametresi kullanmaz: çerçeve aynı kabul edilir, X, Y, Z değişmez; yalnız elipsoit değişir.";
      return e;
    }
    if (![MODEL_IERS, MODEL_SABIT, MODEL_BW, MODEL_MB].includes(model)) {
      e.mesaj = "Bilinmeyen model: " + model;
      return e;
    }
    if (kaynak === hedef) {
      e.bulundu = true; e.yon = "ozdes"; e.kurum = "-";
      e.T = [0, 0, 0]; e.D = 0; e.R = [0, 0, 0]; e.konvansiyon = "PV";
      e.mesaj = "Kaynak ve hedef aynı sistem: dönüşüm yok (özdeşlik).";
      return e;
    }
    if (model === MODEL_IERS || model === MODEL_SABIT) return iersEslesme(e, epok);
    return bwMbEslesme(e, epok);
  }

  /** Dondurur [XYZ_hedef, Eslesme, rapor]. Kayit yoksa ParametreBulunamadi firlatir. */
  function donustur(XYZ, kaynak, hedef, model, epok = null) {
    const e = parametreBul(kaynak, hedef, model, epok);
    if (!e.bulundu) throw new ParametreBulunamadi(e.mesaj);
    if (e.yon === "ozdes") return [XYZ.slice(), e, []];
    if (model === MODEL_IERS || model === MODEL_SABIT) {
      const [X2, rapor] = sistemlerArasi(XYZ, kaynak, hedef, epok != null ? epok : 0.0, model === MODEL_IERS);
      return [X2, e, rapor];
    }
    return [e.set.uygula(XYZ, e.ters), e, []];
  }

  // -------------------------------------------------------------------------
  // 5) DERECE - DAKIKA - SANIYE
  // -------------------------------------------------------------------------
  function sayiZorunlu(p) {
    const v = Number(p);
    if (p === "" || !Number.isFinite(v)) throw new Error("Geçersiz sayı: " + p);
    return v;
  }

  /** '39.925', '39 55 30.12', 39°55'30.12", '-32 51 7.5', '32 51 7.5 W' (Turkce K/G/D/B) */
  function aciOku(metin) {
    let s = String(metin).trim().toUpperCase().replace(/,/g, ".");
    let isaret = 1.0;
    if (s && "NSEWKGDB".includes(s[s.length - 1])) {
      if ("SWGB".includes(s[s.length - 1])) isaret = -1.0;
      s = s.slice(0, -1);
    }
    for (const c of "°'\"″′:dDmM") s = s.split(c).join(" ");
    const parca = s.split(/\s+/).filter(Boolean);
    if (!parca.length) throw new Error("Boş açı değeri");
    if (parca[0].startsWith("-")) { isaret = -isaret; parca[0] = parca[0].slice(1); }
    let deger = 0.0;
    parca.slice(0, 3).forEach((p, i) => { deger += sayiZorunlu(p) / 60.0 ** i; });
    return isaret * deger;
  }

  function dms(deg, snHane = 5) {
    const isaret = deg < 0 ? "-" : "";
    deg = Math.abs(deg);
    let d = Math.trunc(deg);
    let m = Math.trunc((deg - d) * 60);
    let s = (deg - d - m / 60.0) * 3600.0;
    if (Number(s.toFixed(snHane)) >= 60.0) { s = 0.0; m += 1; }
    if (m >= 60) { m = 0; d += 1; }
    const sMetin = s.toFixed(snHane).padStart(3 + snHane, "0");
    return `${isaret}${d}° ${String(m).padStart(2, "0")}' ${sMetin}"`;
  }

  return {
    ELIPSOITLER, elipsoitSabitleri, geoToCart, cartToGeo,
    SANIYE_RAD, donuklukMatrisi, bursaWolf, molodenskyBadekas, tersCevir7, Helmert14,
    SISTEMLER, enuFarki, DONUSUMLER, donusumVar, donusumAl, yolBul, sistemlerArasi,
    MODEL_IERS, MODEL_SABIT, MODEL_BW, MODEL_MB, MODEL_ELIPS,
    BULUNAMADI, OTOMATIK, KAYNAK_YOK, ParametreBulunamadi, ParametreSeti,
    PARAMETRE_DB, parametreKaydet, parametreSil, Eslesme, MB_MERKEZ,
    parametreBul, donustur, aciOku, dms,
  };
});
