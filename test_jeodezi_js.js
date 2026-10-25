/*
 * test_jeodezi_js.js - docs/js/jeodezi.js icin test_jeodezi.py'nin birebir karsiligi.
 * Calistirma:  node web_tests/test_jeodezi_js.js
 */
"use strict";
const path = require("path");
const jz = require(path.join(__dirname, "..", "docs", "js", "jeodezi.js"));

const yakin = (a, b, tol) => a.every((x, i) => Math.abs(x - b[i]) <= tol);
const esit = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
function dogrula(kosul, mesaj) { if (!kosul) throw new Error("BASARISIZ: " + (mesaj || "")); }

function test_gidis_donus() {
  for (const el of Object.keys(jz.ELIPSOITLER)) {
    for (const [phi, lam, h] of [[0, 0, 0], [39.925, 32.8369, 938], [-33.9, 151.2, 50],
      [89.9999, -120, 3000], [-45, -179.9, -30]]) {
      const X = jz.geoToCart(phi, lam, h, el);
      for (const yon of ["iteratif", "bowring"]) {
        const [p2, l2, h2] = jz.cartToGeo(...X, el, yon);
        dogrula(Math.abs(p2 - phi) < 1e-9 && Math.abs(l2 - lam) < 1e-9 && Math.abs(h2 - h) < 1e-4, `${el} ${yon} ${phi}`);
      }
    }
  }
  console.log("OK  gidis-donus (tum elipsoitler, iki yontem)");
}

function test_epsg_bursa_wolf() {
  const X1 = [3657660.66, 255768.55, 5201382.11];
  const beklenen = [3657660.78, 255778.43, 5201387.75];
  const pv = jz.bursaWolf(X1, 0, 0, 4.5, 0.219, 0, 0, 0.554, "PV");
  const cf = jz.bursaWolf(X1, 0, 0, 4.5, 0.219, 0, 0, -0.554, "CF");
  dogrula(yakin(pv, beklenen, 0.01) && yakin(cf, beklenen, 0.01), "EPSG 7-2");
  const geri = jz.tersCevir7(pv, jz.bursaWolf, [0, 0, 4.5, 0.219, 0, 0, 0.554], "PV");
  dogrula(yakin(geri, X1, 1e-6), "kesin ters");
  console.log("OK  EPSG 7-2 Bursa-Wolf (PV/CF) + kesin ters");
}

function test_mb_bw_esdegerligi() {
  const X = [4116037.2588, 2656358.3524, 4072204.7958];
  const p = [12.3, -45.6, 7.8, 1.5, 0.3, -0.7, 1.1];
  dogrula(yakin(jz.bursaWolf(X, ...p), jz.molodenskyBadekas(X, ...p, [0, 0, 0]), 1e-9));
  console.log("OK  Molodensky-Badekas(merkez=0) == Bursa-Wolf");
}

function test_wgs84_grs80() {
  const X = jz.geoToCart(45, 30, 100, "GRS80");
  const [p1, , h1] = jz.cartToGeo(...X, "GRS80");
  const [p2, , h2] = jz.cartToGeo(...X, "WGS84");
  dogrula(Math.abs(h1 - h2) < 0.0002 && Math.abs(p1 - p2) * 3600 < 1e-4);
  console.log(`OK  WGS84-GRS80 farki: dh = ${((h2 - h1) * 1000).toFixed(4)} mm`);
}

function test_itrf_zincir_kapanmasi() {
  const X = [4116037.2588, 2656358.3524, 4072204.7958];
  for (const [a, b] of [["ITRF2020", "ITRF96 (TUREF)"], ["WGS84 (G1762)", "ETRF2000 (ETRS89)"], ["ITRF2014", "ITRF2005"]]) {
    const [Y] = jz.sistemlerArasi(X, a, b, 2025.0);
    const [Z] = jz.sistemlerArasi(Y, b, a, 2025.0);
    dogrula(yakin(X, Z, 1e-4), a + " " + b);
  }
  const h = jz.donusumAl("ITRF2014", "ITRF2008");
  dogrula(yakin(h.uygula(X, h.t0, true), h.uygula(X, 0, false), 1e-12));
  console.log("OK  ITRF zincir gidis-donus ve t0 kontrolu");
}

const ED50 = "ED50 (Hayford)", WGS_ENS = "WGS84 (EPSG ensemble)";
const X_TR = jz.geoToCart(39.925, 32.8369, 938.0, "Hayford (International 1924)");
const EPSG72 = [0, 0, 4.5, 0.219, 0, 0, 0.554];

function test_1() {
  let e = jz.parametreBul(ED50, WGS_ENS, jz.MODEL_BW);
  dogrula(e.bulundu && e.yon === "ileri" && !e.ters);
  dogrula(esit(e.T, [-84.1, -101.8, -129.7]) && e.D === 1.05 && esit(e.R, [0.0, 0.0, 0.468]));
  dogrula(e.konvansiyon === "PV" && e.kurum === "EPSG" && e.kod.includes("1784"));
  e = jz.parametreBul("WGS84 (G2139)", "ITRF96 (TUREF)", jz.MODEL_IERS, 2025.0);
  dogrula(e.bulundu && e.yon === "zincir" && e.zincir.length === 3);
  dogrula(JSON.stringify(e.zincir.map((z) => [z.a, z.b])) === JSON.stringify(
    [["WGS84 (G2139)", "ITRF2014"], ["ITRF2014", "ITRF2020"], ["ITRF2020", "ITRF96 (TUREF)"]]));
  dogrula(e.kurum.includes("IERS") && e.konvansiyon === "PV");
  console.log("OK  1) otomatik parametre secimi");
}

function test_2_3_4() {
  const t = 2025.0;
  const a = jz.parametreBul("ITRF2020", "ITRF2008", jz.MODEL_IERS, t);
  const b = jz.parametreBul("ITRF2014", "ITRF2008", jz.MODEL_IERS, t);
  const c = jz.parametreBul("ITRF2020", "ITRF2014", jz.MODEL_IERS, t);
  dogrula(!esit(a.T, b.T) && !esit(a.T, c.T) && !esit(b.T, c.T));
  dogrula(yakin(b.T, [1.6e-3, 1.9e-3, (2.4 - 0.1 * 15) * 1e-3], 1e-12));
  const iers = jz.parametreBul("ITRF2020", "ITRF96 (TUREF)", jz.MODEL_IERS, t);
  const sabit = jz.parametreBul("ITRF2020", "ITRF96 (TUREF)", jz.MODEL_SABIT, t);
  const bw = jz.parametreBul("ITRF2020", "ITRF96 (TUREF)", jz.MODEL_BW, t);
  const mb = jz.parametreBul("ITRF2020", "ITRF96 (TUREF)", jz.MODEL_MB, t);
  dogrula(iers.bulundu && sabit.bulundu && bw.bulundu && mb.bulundu);
  dogrula(!esit(iers.T, sabit.T) && !esit(bw.T, mb.T));
  dogrula(esit(mb.merkez, [4116000.0, 2656000.0, 4072000.0]));
  const bwEd = jz.parametreBul(ED50, WGS_ENS, jz.MODEL_BW);
  const mbEd = jz.parametreBul(ED50, WGS_ENS, jz.MODEL_MB);
  dogrula(bwEd.bulundu && mbEd.bulundu && !esit(bwEd.T, mbEd.T));
  dogrula(esit(mbEd.merkez, [4116000.0, 2656000.0, 4072000.0]));
  console.log("OK  2-3-4) kaynak / hedef / model degisince parametre degisiyor");
}

function test_5() {
  for (const [k, h, m] of [["BilinmeyenDatum", "ITRF96 (TUREF)", jz.MODEL_IERS],
    ["BilinmeyenDatum", WGS_ENS, jz.MODEL_BW], [ED50, "BilinmeyenHedef", jz.MODEL_MB]]) {
    const e = jz.parametreBul(k, h, m, 2025.0);
    dogrula(!e.bulundu && e.T === null && e.D === null && e.R === null, `${k} ${h} ${m}`);
    let firlatti = false;
    try { jz.donustur(X_TR, k, h, m, 2025.0); } catch (err) { firlatti = err instanceof jz.ParametreBulunamadi; }
    dogrula(firlatti, "ParametreBulunamadi bekleniyordu");
  }
  for (const ps of jz.PARAMETRE_DB.values()) dogrula(!esit([...ps.T, ps.D, ...ps.R], EPSG72));
  console.log("OK  5) kayit yoksa uyari; 0 / EPSG 7-2 ornek degeri kullanilmiyor");
}

function test_6() {
  const [ileri, e1] = jz.donustur(X_TR, ED50, WGS_ENS, jz.MODEL_BW);
  const [geri, e2] = jz.donustur(ileri, WGS_ENS, ED50, jz.MODEL_BW);
  dogrula(e2.yon === "ters" && e2.ters && e2.set === e1.set);
  dogrula(esit(e2.T, e1.T) && esit(e2.R, e1.R));
  dogrula(yakin(geri, X_TR, 1e-6));
  const kesin = jz.tersCevir7(ileri, jz.bursaWolf, [-84.1, -101.8, -129.7, 1.05, 0, 0, 0.468], "PV");
  dogrula(yakin(geri, kesin, 1e-9));
  const yanlis = jz.bursaWolf(ileri, -84.1, -101.8, -129.7, 1.05, 0, 0, 0.468, "PV");
  dogrula(Math.max(...[0, 1, 2].map((i) => Math.abs(yanlis[i] - geri[i]))) > 100);
  const [Y] = jz.donustur(X_TR, "WGS84 (G2139)", "ITRF96 (TUREF)", jz.MODEL_IERS, 2025.0);
  const [Z, e] = jz.donustur(Y, "ITRF96 (TUREF)", "WGS84 (G2139)", jz.MODEL_IERS, 2025.0);
  dogrula(yakin(Z, X_TR, 1e-4) && e.yon === "zincir");
  dogrula(jz.parametreBul("ITRF2014", "ITRF2020", jz.MODEL_IERS, 2025.0).yon === "ters");
  console.log("OK  6) ters yon: kesin ters cozum (BW) ve IERS ters zinciri");
}

function test_7() {
  const [X2, e] = jz.donustur(X_TR, ED50, WGS_ENS, jz.MODEL_BW);
  const pv = jz.bursaWolf(X_TR, ...e.T, e.D, ...e.R, "PV");
  const cf = jz.bursaWolf(X_TR, ...e.T, e.D, ...e.R, "CF");
  dogrula(e.konvansiyon === "PV" && yakin(X2, pv, 1e-9));
  dogrula(Math.max(...[0, 1, 2].map((i) => Math.abs(cf[i] - pv[i]))) > 1.0);
  const k = "TEST WGS72", h = "TEST WGS84";
  jz.SISTEMLER[k] = jz.SISTEMLER[h] = "WGS84";
  try {
    jz.parametreKaydet(new jz.ParametreSeti(k, h, jz.MODEL_BW, [0, 0, 4.5], 0.219, [0, 0, -0.554], "CF",
      { kurum: "EPSG GN 7-2 (test)" }));
    const [Y, e2] = jz.donustur([3657660.66, 255768.55, 5201382.11], k, h, jz.MODEL_BW);
    dogrula(e2.konvansiyon === "CF" && yakin(Y, [3657660.78, 255778.43, 5201387.75], 0.01));
  } finally {
    jz.parametreSil(k, h, jz.MODEL_BW);
    delete jz.SISTEMLER[k]; delete jz.SISTEMLER[h];
  }
  console.log("OK  7) Bursa-Wolf PV / CF konvansiyonu parametre setiyle birlikte korunuyor");
}

function test_8() {
  const k = "TEST La Canoa", h = "TEST REGVEN";
  jz.SISTEMLER[k] = "Hayford (International 1924)"; jz.SISTEMLER[h] = "GRS80";
  const merkez = [2464351.59, -5783466.61, 974809.81];
  try {
    jz.parametreKaydet(new jz.ParametreSeti(k, h, jz.MODEL_MB, [-270.933, 115.599, -360.226], -5.109,
      [-5.266, -1.238, 2.381], "CF", { kurum: "EPSG GN 7-2 (test)", merkez }));
    const e = jz.parametreBul(k, h, jz.MODEL_MB);
    dogrula(e.bulundu && esit(e.merkez, merkez));
    const X1 = [2550408.96, -5749912.26, 1054891.11];
    const [Y] = jz.donustur(X1, k, h, jz.MODEL_MB);
    dogrula(yakin(Y, [2550138.46, -5749799.87, 1054530.82], 0.01), String(Y));
    const bw = jz.bursaWolf(X1, ...e.T, e.D, ...e.R, "CF");
    dogrula(Math.max(...[0, 1, 2].map((i) => Math.abs(bw[i] - Y[i]))) > 10);
    const [geri, eg] = jz.donustur(Y, h, k, jz.MODEL_MB);
    dogrula(eg.ters && yakin(geri, X1, 1e-6));
    dogrula(!jz.parametreBul(k, h, jz.MODEL_BW).bulundu);
  } finally {
    jz.parametreSil(k, h, jz.MODEL_MB);
    delete jz.SISTEMLER[k]; delete jz.SISTEMLER[h];
  }
  console.log("OK  8) Molodensky-Badekas: Xm, Ym, Zm kullaniliyor (EPSG 7-2 La Canoa ornegi)");
}

function test_9() {
  const e = jz.parametreBul("ITRF2020", "ITRF96 (TUREF)", jz.MODEL_IERS, 2025.0);
  const dt = 10.0;
  dogrula(yakin(e.T, [(6.5 + 0.1 * dt) * 1e-3, (-3.9 - 0.6 * dt) * 1e-3, (-77.9 - 3.1 * dt) * 1e-3], 1e-12));
  dogrula(Math.abs(e.D - (3.98 + 0.12 * dt) * 1e-3) < 1e-12);
  dogrula(yakin(e.R, [0, 0, (0.36 + 0.02 * dt) * 1e-3], 1e-12) && e.epok === 2025.0);
  const k = "ITRF2020", h = "ITRF96 (TUREF)";
  const [Y25] = jz.donustur(X_TR, k, h, jz.MODEL_IERS, 2025.0);
  const [Y15] = jz.donustur(X_TR, k, h, jz.MODEL_IERS, 2015.0);
  const [S25] = jz.donustur(X_TR, k, h, jz.MODEL_SABIT, 2025.0);
  const [S15] = jz.donustur(X_TR, k, h, jz.MODEL_SABIT, 2015.0);
  dogrula(Math.max(...[0, 1, 2].map((i) => Math.abs(Y25[i] - Y15[i]))) > 0.01);
  dogrula(yakin(S25, S15, 1e-12) && yakin(S15, Y15, 1e-9));
  dogrula(!jz.parametreBul(k, h, jz.MODEL_IERS, null).bulundu);
  console.log("OK  9) IERS 14p olcu epogu hesaba katiliyor (P(t) dogrulandi)");
}

function test_10_aci() {
  dogrula(Math.abs(jz.aciOku("39 55 30.0") - 39.925) < 1e-12);
  dogrula(Math.abs(jz.aciOku("39°55'30\"") - 39.925) < 1e-12);
  dogrula(Math.abs(jz.aciOku("32 51 7.5 W") + (32 + 51 / 60 + 7.5 / 3600)) < 1e-12);
  dogrula(Math.abs(jz.aciOku("-32 51 7.5") + (32 + 51 / 60 + 7.5 / 3600)) < 1e-12);
  dogrula(Math.abs(jz.aciOku("39,925") - 39.925) < 1e-12);
  dogrula(Math.abs(jz.aciOku("36 30 0 G") + 36.5) < 1e-12);
  let hata = false; try { jz.aciOku("abc"); } catch (e) { hata = true; } dogrula(hata, "gecersiz aci");
  dogrula(jz.dms(39.925) === "39° 55' 30.00000\"", jz.dms(39.925));
  dogrula(jz.dms(-0.5) === "-0° 30' 00.00000\"", jz.dms(-0.5));
  dogrula(jz.dms(10.99999999999) === "11° 00' 00.00000\"", jz.dms(10.99999999999));
  console.log("OK  10) aci okuma ve DMS bicimi");
}

test_gidis_donus();
test_epsg_bursa_wolf();
test_mb_bw_esdegerligi();
test_wgs84_grs80();
test_itrf_zincir_kapanmasi();
test_1();
test_2_3_4();
test_5();
test_6();
test_7();
test_8();
test_9();
test_10_aci();
console.log("\nTum JavaScript testleri gecti.");
