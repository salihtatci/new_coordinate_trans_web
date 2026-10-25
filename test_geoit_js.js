/*
 * test_geoit_js.js - gomulu ICGEM izgarasini ICGEM nokta servisinin bagimsiz sonuclariyla karsilastirir
 * ve .dat ayristiricisini dener.   Calistirma:  node web_tests/test_geoit_js.js
 */
"use strict";
const fs = require("fs"), path = require("path");
const G = require(path.join(__dirname, "..", "docs", "js", "geoit.js"));
const kok = path.join(__dirname, "..", "docs");
const buf = fs.readFileSync(path.join(kok, G.IZGARA.dosya));
const veri = G.izgaraCoz(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
function dogrula(k, m) { if (!k) throw new Error("BASARISIZ: " + m); }

// 1) Izgara dugumleri: ICGEM gdf'deki ilk/son degerler (mm yuvarlama)
dogrula(Math.abs(veri[0] - 41.912) < 1e-6 && Math.abs(veri[veri.length - 1] - 8.177) < 1e-6, "dugum degerleri");
dogrula(G.izgaraN(42.5, 25.5, veri).N.toFixed(3) === "41.912", "kose = dugum");
console.log("OK  izgara boyutu ve dugum degerleri");

// 2) Bagimsiz ICGEM nokta sonuclari ile karsilastirma
const ref = require("./icgem_dogrulama_noktalari.json").noktalar;
let maxK = 0, maxL = 0, kt = 0;
for (const [phi, lam, N] of ref) {
  const k = G.izgaraN(phi, lam, veri, "bikubik"), l = G.izgaraN(phi, lam, veri, "bilineer");
  const dk = Math.abs(k.N - N), dl = Math.abs(l.N - N);
  maxK = Math.max(maxK, dk); maxL = Math.max(maxL, dl); kt += dk * dk;
}
console.log(`    40 nokta: bikubik max ${(maxK * 1000).toFixed(1)} mm, RMS ${(Math.sqrt(kt / ref.length) * 1000).toFixed(1)} mm; bilineer max ${(maxL * 1000).toFixed(1)} mm`);
dogrula(maxK < 0.02, "bikubik hata 2 cm'den kucuk olmali");
console.log("OK  gomulu izgara ICGEM nokta servisiyle uyumlu");

// 3) Sinirlar
dogrula(G.izgaraN(34.9, 30, veri) === null && G.izgaraN(40, 45.1, veri) === null, "disarisi null");
dogrula(G.izgaraN(35.5, 45.0, veri).yontem === "bilineer", "kenarda bilineer");
console.log("OK  izgara disi / kenar davranisi");

// 4) .dat ayristirici (ICGEM'in gercek cikti bicimi)
const dat = `        generated_by     ICGEM (hosted at GFZ-Potsdam)
           modelname     EGM2008
     max_used_degree          2190
         tide_system     tide_free
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
const d = G.icgemDatOku(dat);
dogrula(d.baslik.modelname === "EGM2008" && d.baslik.refsysname === "WGS84", "baslik");
dogrula(d.noktalar.length === 1 && Math.abs(d.noktalar[0].N - 37.6026117694) < 1e-12 && d.noktalar[0].lat === 39.925, "nokta");
let hata = false; try { G.icgemDatOku("bos dosya"); } catch (e) { hata = true; } dogrula(hata, "gecersiz dosya");
hata = false; try { G.icgemDatOku(dat.replace(/geoid/g, "gravity_anomaly")); } catch (e) { hata = true; } dogrula(hata, "geoid olmayan dosya");
console.log("OK  ICGEM .dat ayristirici");

// 5) H = h - N ve form alanlari
dogrula(Math.abs(G.ortometrik(975.6, 37.6026) - 937.9974) < 1e-9, "H");
const a = G.icgemAlanlari("EGM96");
dogrula(a.trunc_max === "360" && a.sel_func === "geoid" && a.sel_refsys === "WGS84" && a.points_format === "i_lat_lon", "alanlar");
dogrula(G.noktaDosyasi(39.925, 32.8369) === "1 39.92500000 32.83690000\n", "nokta dosyasi");
console.log("OK  H = h - N ve ICGEM form alanlari");
console.log("\nTum geoit testleri gecti.");
