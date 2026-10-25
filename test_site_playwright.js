/*
 * test_site_playwright.js - siteyi gercek bir tarayicida (Chromium) uctan uca dener.
 * Kullanim:  (docs klasorunu bir sunucuda yayinlayin)  python -m http.server 8765 -d docs
 *            node web_tests/test_site_playwright.js http://localhost:8765/ [ekran_klasoru]
 * Not: konum (geolocation), ICGEM ve proxy cagrilari test icinde taklit edilir.
 */
"use strict";
const { chromium } = require("playwright");
const path = require("path");
const URL0 = process.argv[2] || "http://localhost:8765/";
const EKRAN = process.argv[3] || null;

const DAT = `        generated_by     ICGEM (hosted at GFZ-Potsdam)
           modelname     EGM2008
     max_used_degree          2190
         tide_system     tide_free
    zero_degree_term     included
          refsysname     WGS84
description of columns -----------------------------------------------
 1 identifier (from input)
 2 longitude  (from input)    [degree]
 3 latitude   (from input)    [degree]
 4 h_over_ell (from input)     [meter]
 -------------------------------------
 5 geoid                       [meter]  h_anomaly_ell + Topo-Term
----------------------------------------------------------------------

end_of_head ================================================================
1             32.83690000   39.92500000  0.000000E+00  3.760261176940E+01
`;

function dogrula(k, m) { if (!k) throw new Error("BASARISIZ: " + m); }
const sayiAl = (s) => Number(String(s).replace(/[^\d.\-]/g, ""));

function konumTaklidi(sonuc) {
  return `(() => {
    const s = ${JSON.stringify(sonuc)};
    const geo = { getCurrentPosition(ok, hata) { setTimeout(() => {
      if (s.hata) hata({ code: s.hata, message: "taklit" });
      else ok({ coords: { latitude: s.lat, longitude: s.lon, altitude: s.alt, accuracy: s.acc, altitudeAccuracy: s.altAcc }, timestamp: Date.now() });
    }, 50); }, watchPosition() { return 0; }, clearWatch() {} };
    Object.defineProperty(navigator, "geolocation", { get: () => geo, configurable: true });
  })();`;
}

async function sayfaAc(tarayici, konum, ayar = {}) {
  const ctx = await tarayici.newContext({ viewport: ayar.viewport || { width: 1280, height: 900 }, colorScheme: ayar.renk || "light" });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, body: "", contentType: "text/css" }));
  if (konum) await ctx.addInitScript(konumTaklidi(konum));
  const sayfa = await ctx.newPage();
  const hatalar = [];
  sayfa.on("pageerror", (e) => hatalar.push("pageerror: " + e.message));
  sayfa.on("console", (m) => { if (m.type() === "error" && !m.text().includes("status of 502")) hatalar.push("console: " + m.text()); });  // 502: kasitli proxy hatasi senaryosu
  await sayfa.goto(URL0 + (ayar.hash || ""));
  await sayfa.waitForFunction(() => window.KD && window.KD.izgaraVeri, null, { timeout: 15000 });
  return { ctx, sayfa, hatalar };
}

(async () => {
  const tarayici = await chromium.launch();
  try {
    // ---------------------------------------------------------------- 1) konum + izgara + aktarim
    {
      const { ctx, sayfa, hatalar } = await sayfaAc(tarayici, { lat: 39.925, lon: 32.8369, alt: 975.6, acc: 12, altAcc: 8 });
      await sayfa.click("#k-konum-al");
      await sayfa.waitForFunction(() => document.getElementById("k-konum-durum").classList.contains("iyi"));
      dogrula(await sayfa.inputValue("#k-phi") === "39.92500000" && await sayfa.inputValue("#k-h") === "975.600", "konum kutulara yazildi");
      const N = sayiAl(await sayfa.textContent("#d-n"));
      const H = sayiAl(await sayfa.textContent("#d-hh"));
      dogrula(Math.abs(N - 37.6026) < 0.01, "izgara N ~ ICGEM nokta degeri: " + N);
      dogrula(Math.abs(H - (975.6 - N)) < 0.0015, "H = h - N: " + H);
      dogrula((await sayfa.textContent("#k-tablo")).includes("Gömülü ICGEM ızgarası"), "tablo izgara satiri");
      dogrula((await sayfa.textContent("#k-dogruluk")).includes("±12 m"), "dogruluk yazisi");
      // dönüşüm sekmelerine yazildi
      dogrula(await sayfa.inputValue("#t1-phi") === "39.92500000" && await sayfa.inputValue("#t1-elips") === "WGS84", "t1 konum");
      const X = sayiAl(await sayfa.inputValue("#t1-x"));
      const Xb = await sayfa.evaluate(() => JZ.geoToCart(39.925, 32.8369, 975.6, "WGS84")[0]);
      dogrula(Math.abs(X - Xb) < 1e-4, "t1 X hesaplandi");
      dogrula(await sayfa.inputValue("#t2-tip") === "Cografi" && await sayfa.inputValue("#t2-kaynak") === "WGS84 (G2296)", "t2 konum");
      dogrula((await sayfa.textContent("#t2-out")).includes("SONUÇ (ITRF96 (TUREF))"), "t2 donusum calisti");
      // kesit cizimi etiketleri
      const svg = await sayfa.textContent("#ks-oklar");
      dogrula(svg.includes("h = 975.60 m") && svg.includes("N = ") && svg.includes("H = "), "kesit etiketleri: " + svg);
      if (EKRAN) await sayfa.screenshot({ path: path.join(EKRAN, "web_konum.png"), fullPage: true });

      // -------------------------------------------------------------- 2) ICGEM yeni sekme + .dat
      let govde = null;
      await ctx.route("https://icgem.gfz.de/**", async (r) => {
        govde = r.request().postData();
        await r.fulfill({ status: 200, contentType: "text/html", body: "<p>ICGEM taklidi</p>" });
      });
      const [sekme] = await Promise.all([ctx.waitForEvent("page"), sayfa.click("#k-icgem")]);
      await sekme.waitForLoadState();
      dogrula(sekme.url() === "https://icgem.gfz.de/calcsrvpoints", "ICGEM sekmesi: " + sekme.url());
      dogrula(govde && govde.includes('name="sel_model"') && govde.includes("c50128797a9cb62e936337c890e4425f03f0461d7329b09a8cc8561504465340"), "model kimligi gonderildi");
      dogrula(govde.includes('name="sel_func"\r\n\r\ngeoid') && govde.includes('name="sel_refsys"\r\n\r\nWGS84'), "fonksiyonel ve refsys");
      dogrula(govde.includes('filename="nokta.txt"') && govde.includes("1 39.92500000 32.83690000"), "nokta dosyasi gonderildi");
      await sekme.close();
      dogrula(await sayfa.isVisible("#k-dat-alani"), ".dat alani gorunur");
      await sayfa.setInputFiles("#k-dat", { name: "EGM2008_x.dat", mimeType: "application/octet-stream", buffer: Buffer.from(DAT) });
      await sayfa.waitForFunction(() => document.getElementById("k-tablo").textContent.includes("ICGEM (canlı)"));
      const N2 = sayiAl(await sayfa.textContent("#d-n"));
      dogrula(Math.abs(N2 - 37.603) < 1e-9, "ICGEM N tercih edildi: " + N2);
      dogrula((await sayfa.textContent("#k-tablo")).includes("Fark (ICGEM − ızgara)"), "fark satiri");
      // uzak nokta reddedilir
      await sayfa.setInputFiles("#k-dat", { name: "uzak.dat", mimeType: "text/plain", buffer: Buffer.from(DAT.replace("39.92500000", "39.99500000")) });
      dogrula((await sayfa.textContent("#k-icgem-durum")).includes("uzakta"), "uzak nokta reddi");
      // elle N
      await sayfa.fill("#k-n-elle", "37.5");
      dogrula((await sayfa.textContent("#k-tablo")).includes("Elle girilen"), "elle satiri");
      // konum degisince eski ICGEM sonucu silinir
      await sayfa.fill("#k-phi", "41.1055"); await sayfa.fill("#k-lam", "29.0237");
      await sayfa.waitForTimeout(500);
      const tablo = await sayfa.textContent("#k-tablo");
      dogrula(!tablo.includes("ICGEM (canlı)") && !tablo.includes("Elle girilen"), "konum degisince eski sonuclar silindi");
      dogrula(Math.abs(sayiAl(await sayfa.textContent("#d-n")) - 37.6888) < 0.01, "yeni noktada izgara N");
      // izgara disi
      await sayfa.fill("#k-phi", "52.5"); await sayfa.fill("#k-lam", "13.4"); await sayfa.waitForTimeout(450);
      await sayfa.click("#k-izgara");
      dogrula((await sayfa.textContent("#k-icgem-durum")).includes("dışında"), "izgara disi mesaji");
      dogrula(await sayfa.textContent("#d-n") === "—", "izgara disinda N yok");

      // -------------------------------------------------------------- 3) proxy yolu
      await sayfa.evaluate(() => { window.KD_AYAR.icgemProxyUrl = "https://proxy.ornek.test/"; });
      let proxyIstek = null;
      await ctx.route("https://proxy.ornek.test/**", async (r) => {
        proxyIstek = r.request().url();
        await new Promise((s) => setTimeout(s, 1200));
        await r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" },
          body: JSON.stringify({ N: 49.1234, model: "XGM2019e_2159", id: "abc123def456" }) });
      });
      await sayfa.selectOption("#k-model", "XGM2019e_2159");
      await sayfa.click("#k-icgem");
      await sayfa.waitForFunction(() => document.getElementById("k-tablo").textContent.includes("ICGEM (canlı)"), null, { timeout: 10000 });
      dogrula(proxyIstek.includes("lat=52.50000000") && proxyIstek.includes("lon=13.40000000") && proxyIstek.includes("model=XGM2019e_2159"), "proxy istegi: " + proxyIstek);
      dogrula(Math.abs(sayiAl(await sayfa.textContent("#d-n")) - 49.123) < 1e-9, "proxy N");
      // proxy hatasi -> yeni sekme secenegi
      await ctx.unroute("https://proxy.ornek.test/**");
      await ctx.route("https://proxy.ornek.test/**", (r) => r.fulfill({ status: 502, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ hata: "ICGEM'e ulasilamadi" }) }));
      await sayfa.click("#k-icgem");
      await sayfa.waitForFunction(() => document.getElementById("k-icgem-durum").classList.contains("kotu"));
      dogrula((await sayfa.textContent("#k-icgem-durum")).includes("ICGEM'e ulasilamadi") && await sayfa.isVisible("#k-yeni-sekme"), "proxy hatasi yonlendirmesi");

      // -------------------------------------------------------------- 4) aktar dugmesi + sekme klavye
      await sayfa.fill("#k-phi", "39 55 30.0"); await sayfa.fill("#k-lam", "32 50 12.84"); await sayfa.fill("#k-h", "938");
      await sayfa.click("#k-aktar-cografi");
      dogrula(await sayfa.isVisible("#panel-cografi") && await sayfa.inputValue("#t1-x") === "4116037.2588", "aktar -> cografi (WGS84 X)");
      await sayfa.focus("#sekme-cografi"); await sayfa.keyboard.press("ArrowRight");
      dogrula(await sayfa.isVisible("#panel-datum"), "klavye ile sekme degisti");
      dogrula(hatalar.length === 0, "konsol hatasi yok: " + hatalar.join(" | "));
      await ctx.close();
    }
    console.log("OK  konum, izgara N, H = h - N, ICGEM yeni sekme + .dat, proxy, aktarim");

    // ---------------------------------------------------------------- 5) konum hatalari
    {
      const { ctx, sayfa } = await sayfaAc(tarayici, { hata: 1 });
      await sayfa.click("#k-konum-al");
      await sayfa.waitForFunction(() => document.getElementById("k-konum-durum").classList.contains("kotu"));
      dogrula((await sayfa.textContent("#k-konum-durum")).includes("izni verilmedi"), "izin reddi mesaji");
      await ctx.close();
      const b = await sayfaAc(tarayici, { lat: 41.1055, lon: 29.0237, alt: null, acc: 30, altAcc: null });
      await b.sayfa.click("#k-konum-al");
      await b.sayfa.waitForFunction(() => document.getElementById("k-konum-durum").classList.contains("iyi"));
      dogrula(await b.sayfa.inputValue("#k-h") === "", "yukseklik yoksa h bos");
      dogrula((await b.sayfa.textContent("#k-dogruluk")).includes("yükseklik vermedi"), "yukseklik yok mesaji");
      dogrula(await b.sayfa.textContent("#d-hh") === "—" && (await b.sayfa.textContent("#k-tablo")).includes("h gerekli"), "h yoksa H yok");
      dogrula((await b.sayfa.textContent("#t1-out")).includes("yükseklik vermedi"), "t1 h yok mesaji");
      await b.ctx.close();
    }
    console.log("OK  konum izni reddi ve yuksekliksiz konum");

    // ---------------------------------------------------------------- 6) donusum sekmeleri (Kivy test senaryolari)
    {
      const { ctx, sayfa, hatalar } = await sayfaAc(tarayici, null, { hash: "#cografi" });
      dogrula(await sayfa.isVisible("#panel-cografi"), "hash ile sekme acildi");
      await sayfa.click("#t1-g2c");
      dogrula(await sayfa.inputValue("#t1-x") === "4116037.2588" && await sayfa.inputValue("#t1-z") === "4072204.7958", "GRS80 geo->cart");
      await sayfa.selectOption("#t1-yontem", "bowring"); await sayfa.click("#t1-c2g");
      dogrula((await sayfa.textContent("#t1-out")).includes("39° 55' 30.00000\""), "cart->geo DMS");

      await sayfa.click("#sekme-datum");
      await sayfa.click("#t2-donustur");
      let out = await sayfa.textContent("#t2-out");
      dogrula(out.includes("4116037.2835") && out.includes("2656358.3705") && out.includes("4072204.7063"), "IERS zinciri Python ile ayni");
      // epok degisince parametre degisir
      const tx1 = await sayfa.inputValue("#p-tx");
      await sayfa.fill("#t2-epok", "2015.0");
      dogrula(await sayfa.inputValue("#p-tx") !== tx1, "epok parametreyi degistirdi");
      // ED50 -> WGS84 BW: EPSG:1784
      await sayfa.selectOption("#t2-kaynak", "ED50 (Hayford)");
      await sayfa.selectOption("#t2-hedef", "WGS84 (EPSG ensemble)");
      await sayfa.selectOption("#t2-model", "Bursa-Wolf 7 parametre");
      dogrula(await sayfa.inputValue("#p-tx") === "-84.1" && await sayfa.inputValue("#p-rz") === "0.468" && await sayfa.inputValue("#p-konv") === "PV", "EPSG:1784 dolduruldu");
      dogrula((await sayfa.textContent("#p-baslik")).includes("EPSG:1784"), "parametre kaynagi basligi");
      dogrula(await sayfa.evaluate(() => document.getElementById("p-tx").readOnly), "otomatik mod salt okunur");
      await sayfa.selectOption("#t2-tip", "Cografi");
      dogrula(await sayfa.textContent("#t2-a-et") === "Enlem φ", "etiket baglama");
      await sayfa.fill("#t2-a", "39.925"); await sayfa.fill("#t2-b", "32.8369"); await sayfa.fill("#t2-c", "938");
      await sayfa.click("#t2-donustur");
      out = await sayfa.textContent("#t2-out");
      const ileri = await sayfa.evaluate(() => JZ.donustur(JZ.geoToCart(39.925, 32.8369, 938, "Hayford (International 1924)"), "ED50 (Hayford)", "WGS84 (EPSG ensemble)", JZ.MODEL_BW)[0]);
      dogrula(out.includes(ileri[0].toFixed(4)), "ED50 BW sonucu");
      // kaynak <-> hedef: kesin ters
      await sayfa.click("#t2-degistir");
      dogrula(await sayfa.isChecked("#p-ters") && (await sayfa.textContent("#p-baslik")).includes("tersi"), "ters yon isaretlendi");
      await sayfa.selectOption("#t2-tip", "Kartezyen");
      await sayfa.fill("#t2-a", ileri[0].toFixed(4)); await sayfa.fill("#t2-b", ileri[1].toFixed(4)); await sayfa.fill("#t2-c", ileri[2].toFixed(4));
      await sayfa.click("#t2-donustur");
      out = await sayfa.textContent("#t2-out");
      const X0 = await sayfa.evaluate(() => JZ.geoToCart(39.925, 32.8369, 938, "Hayford (International 1924)"));
      const X2 = ["X2", "Y2", "Z2"].map((k) => Number(out.match(new RegExp(k + " =\\s+([\\d.\\-]+)"))[1]));
      dogrula(X2.every((v, i) => Math.abs(v - X0[i]) < 2e-4), "kesin ters gidis-donus");
      // kayit yok -> BOS alanlar, donusum yapilmaz
      await sayfa.selectOption("#t2-kaynak", "ED50 (Hayford)"); await sayfa.selectOption("#t2-hedef", "ITRF2020");
      await sayfa.selectOption("#t2-model", "Yalnız elipsoit değişimi");
      dogrula(await sayfa.inputValue("#p-tx") === "", "parametresiz model bos");
      // manuel giris
      await sayfa.selectOption("#t2-model", "Bursa-Wolf 7 parametre");
      dogrula(!(await sayfa.isDisabled("#p-manuel")), "manuel secilebilir");
      await sayfa.check("#p-manuel");
      dogrula(!(await sayfa.evaluate(() => document.getElementById("p-tx").readOnly)) && !(await sayfa.isDisabled("#p-konv")), "manuel duzenlenebilir");
      await sayfa.selectOption("#t2-model", "IERS 14 parametre (zamana bağlı)");
      dogrula(await sayfa.isDisabled("#p-manuel"), "IERS'te manuel kapali");
      // EPSG 7-2 test dugmesi
      await sayfa.click("#p-epsg");
      out = await sayfa.textContent("#t2-out");
      const XE = ["X2", "Y2", "Z2"].map((k) => Number(out.match(new RegExp(k + " =\\s+([\\d.\\-]+)"))[1]));
      dogrula([3657660.78, 255778.43, 5201387.75].every((v, i) => Math.abs(XE[i] - v) < 0.01), "EPSG 7-2: " + XE);
      dogrula((await sayfa.textContent("#p-durum")).includes("TEST ÖRNEĞİ"), "test ornegi notu");
      await sayfa.uncheck("#p-manuel");
      dogrula(await sayfa.inputValue("#p-tx") === "0" && (await sayfa.textContent("#p-durum")).includes("özdeşlik"), "manuel kapaninca ozdeslik");
      // gecersiz giris
      await sayfa.fill("#t2-a", "abc"); await sayfa.click("#t2-donustur");
      dogrula((await sayfa.textContent("#t2-out")).startsWith("HATA:"), "hata mesaji");
      if (EKRAN) await sayfa.screenshot({ path: path.join(EKRAN, "web_datum.png"), fullPage: true });
      dogrula(hatalar.length === 0, "konsol hatasi yok: " + hatalar.join(" | "));
      await ctx.close();
    }
    console.log("OK  cografi/kartezyen ve datum sekmeleri (Kivy senaryolari)");

    // ---------------------------------------------------------------- 7) mobil + karanlik tema goruntusu, tasma kontrolu
    for (const [ad, ayar] of [["mobil", { viewport: { width: 390, height: 844 } }], ["karanlik", { renk: "dark" }]]) {
      const { ctx, sayfa, hatalar } = await sayfaAc(tarayici, { lat: 38.516, lon: 35.49, alt: 1080.2, acc: 9, altAcc: 6 }, ayar);
      await sayfa.click("#k-konum-al");
      await sayfa.waitForFunction(() => document.getElementById("k-konum-durum").classList.contains("iyi"));
      const tasma = await sayfa.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      dogrula(tasma <= 0, `${ad}: yatay tasma ${tasma}px`);
      if (EKRAN) await sayfa.screenshot({ path: path.join(EKRAN, `web_${ad}.png`), fullPage: true });
      dogrula(hatalar.length === 0, "konsol hatasi yok: " + hatalar.join(" | "));
      await ctx.close();
    }
    console.log("OK  mobil (390 px) ve karanlik tema, yatay tasma yok");
    console.log("\nTum tarayici testleri gecti.");
  } finally { await tarayici.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
