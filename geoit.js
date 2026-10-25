/*
 * geoit.js - Geoit ondulasyonu (N) ve ortometrik yukseklik (H = h - N)
 * =====================================================================
 * Uc N kaynagi:
 *   1) Gomulu ICGEM izgarasi : EGM2008, 1' aralik, Turkiye (ICGEM hesap servisinden alindi).
 *   2) ICGEM canli (otomatik): ICGEM CORS izni vermedigi icin bir proxy gerekir
 *                              (icgem-proxy/ klasorundeki Cloudflare Worker).
 *   3) ICGEM canli (yeni sekme): form ICGEM'e gonderilir, sonuc .dat dosyasi siteye birakilir.
 * Tarayicida `window.GEOIT`, Node'da require ile kullanilir.
 */
(function (kok, fabrika) {
  if (typeof module === "object" && module.exports) module.exports = fabrika();
  else kok.GEOIT = fabrika();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // -------------------------------------------------------------------------
  // 1) GOMULU IZGARA
  // -------------------------------------------------------------------------
  /** egm2008_tr_1dk.bin: uint16 (little-endian), mm cinsinden N, satirlar kuzeyden
   *  guneye, her satir batidan doguya. ICGEM calcgrid ciktisindan uretildi. */
  const IZGARA = {
    dosya: "egm2008_tr_1dk.bin",
    model: "EGM2008",
    maksDerece: 2190,
    fonksiyonel: "geoid (ICGEM: height_anomaly_ell + topografya terimi, ETOPO1)",
    referans: "WGS84",
    gelgit: "tide free (modelin kendi sistemi)",
    sifirDereceTerimi: "dahil (ICGEM: yalniz GM farki)",
    kuzey: 42.5, guney: 35.5, bati: 25.5, dogu: 45.0,
    adim: 1 / 60,
    satir: 421, sutun: 1171,
    olcek: 0.001,               // mm -> m
    kaynakUrl: "https://icgem.gfz.de/calcgrid",
    olusturma: "2026-10-25",
  };

  /** ArrayBuffer -> Float64Array (metre). Boyut tutmazsa hata verir. */
  function izgaraCoz(buf) {
    const beklenen = IZGARA.satir * IZGARA.sutun * 2;
    if (buf.byteLength !== beklenen)
      throw new Error(`Izgara boyutu hatali: ${buf.byteLength} bayt (beklenen ${beklenen})`);
    const dv = new DataView(buf);
    const n = IZGARA.satir * IZGARA.sutun;
    const v = new Float64Array(n);
    for (let i = 0; i < n; i++) v[i] = dv.getUint16(2 * i, true) * IZGARA.olcek;
    return v;
  }

  async function izgaraYukle(url = IZGARA.dosya) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`Izgara indirilemedi (${r.status})`);
    return izgaraCoz(await r.arrayBuffer());
  }

  function izgaraIcinde(phi, lam) {
    return phi >= IZGARA.guney && phi <= IZGARA.kuzey && lam >= IZGARA.bati && lam <= IZGARA.dogu;
  }

  // Keys (1981) kubik evrisim cekirdegi, a = -0.5
  function kubik(t) {
    const a = -0.5, x = Math.abs(t);
    if (x <= 1) return (a + 2) * x ** 3 - (a + 3) * x ** 2 + 1;
    if (x < 2) return a * x ** 3 - 5 * a * x ** 2 + 8 * a * x - 4 * a;
    return 0;
  }

  /** Izgaradan N (m). yontem: "bikubik" (varsayilan) | "bilineer". Disarida ise null. */
  function izgaraN(phi, lam, veri, yontem = "bikubik") {
    if (!veri || !Number.isFinite(phi) || !Number.isFinite(lam) || !izgaraIcinde(phi, lam)) return null;
    const { satir: NR, sutun: NC, kuzey, bati, adim } = IZGARA;
    const y = (kuzey - phi) / adim;          // satir (0 = kuzey)
    const x = (lam - bati) / adim;           // sutun (0 = bati)
    const r0 = Math.min(Math.floor(y), NR - 2), c0 = Math.min(Math.floor(x), NC - 2);
    const fy = y - r0, fx = x - c0;
    const deger = (r, c) => veri[r * NC + c];
    const kubikOlur = r0 >= 1 && r0 + 2 <= NR - 1 && c0 >= 1 && c0 + 2 <= NC - 1;
    if (yontem === "bikubik" && kubikOlur) {
      let N = 0;
      for (let i = -1; i <= 2; i++) {
        const wy = kubik(fy - i);
        let satirToplam = 0;
        for (let j = -1; j <= 2; j++) satirToplam += kubik(fx - j) * deger(r0 + i, c0 + j);
        N += wy * satirToplam;
      }
      return { N, yontem: "bikubik" };
    }
    const N = (1 - fy) * ((1 - fx) * deger(r0, c0) + fx * deger(r0, c0 + 1)) +
      fy * ((1 - fx) * deger(r0 + 1, c0) + fx * deger(r0 + 1, c0 + 1));
    return { N, yontem: "bilineer" };
  }

  // -------------------------------------------------------------------------
  // 2-3) ICGEM NOKTA HESAP SERVISI
  // -------------------------------------------------------------------------
  const ICGEM_URL = "https://icgem.gfz.de";
  /** ICGEM'deki model kimlikleri (/json_modelmap) ve azami dereceleri (/model_detail). */
  const ICGEM_MODELLER = {
    "EGM2008": { id: "c50128797a9cb62e936337c890e4425f03f0461d7329b09a8cc8561504465340", derece: 2190 },
    "XGM2019e_2159": { id: "eeb03971cf6e533e6eeb6b010336463286dcda0846684248d5530acf8e800055", derece: 2190 },
    "EIGEN-6C4": { id: "7fd8fe44aa1518cd79ca84300aef4b41ddb2364aef9e82b7cdaabdb60a9053f1", derece: 2190 },
    "SGG-UGM-2": { id: "3b3a7e227093cbad89bbe33f515c3f2d762b24392b64cabffd890cc016293526", derece: 2190 },
    "EGM96": { id: "971b0a3b49a497910aad23cd85e066d4cd9af0aeafe7ce6301a696bed8570be3", derece: 360 },
  };

  /** /calcsrvpoints formunun alanlari (ICGEM'in kendi formundan alindi). */
  function icgemAlanlari(model) {
    const m = ICGEM_MODELLER[model];
    if (!m) throw new Error("Bilinmeyen ICGEM modeli: " + model);
    return {
      sel_type: "longtime", sel_model: m.id, points_format: "i_lat_lon",
      sel_func: "geoid", sel_refsys: "WGS84", sel_tidesys: "unmodified", zero_term: "on",
      trunc_gentle: String(m.derece), trunc_max: String(m.derece),
      filter: "none", flength: "1.0", funit: "degree",
    };
  }

  function noktaDosyasi(phi, lam) {
    return `1 ${phi.toFixed(8)} ${lam.toFixed(8)}\n`;
  }

  function koordinatDenetle(phi, lam) {
    if (!Number.isFinite(phi) || phi < -90 || phi > 90) throw new Error("Enlem -90..90 araliginda olmali.");
    if (!Number.isFinite(lam) || lam < -180 || lam > 360) throw new Error("Boylam -180..360 araliginda olmali.");
  }

  /** ICGEM formunu yeni sekmede gonderir (CORS gerektirmeyen ust duzey form gonderimi).
   *  Dondurur: true (gonderildi) | false (tarayici dosya alanini desteklemiyor). */
  function icgemYeniSekmede(phi, lam, model = "EGM2008", belge = document) {
    koordinatDenetle(phi, lam);
    const f = belge.createElement("form");
    f.method = "post"; f.enctype = "multipart/form-data";
    f.action = ICGEM_URL + "/calcsrvpoints"; f.target = "_blank"; f.style.display = "none";
    for (const [k, v] of Object.entries(icgemAlanlari(model))) {
      const i = belge.createElement("input"); i.type = "hidden"; i.name = k; i.value = v; f.appendChild(i);
    }
    const dosya = belge.createElement("input"); dosya.type = "file"; dosya.name = "points_file";
    try {
      const dt = new DataTransfer();
      dt.items.add(new File([noktaDosyasi(phi, lam)], "nokta.txt", { type: "text/plain" }));
      dosya.files = dt.files;
    } catch (e) { return false; }
    if (!dosya.files || dosya.files.length !== 1) return false;
    f.appendChild(dosya);
    belge.body.appendChild(f);
    f.submit();
    setTimeout(() => f.remove(), 1000);
    return true;
  }

  /** ICGEM nokta ciktisini (.dat) cozer.  Dondurur {baslik: {...}, noktalar: [{id, lon, lat, h, N}]} */
  function icgemDatOku(metin) {
    const i = metin.indexOf("end_of_head");
    if (i < 0) throw new Error("ICGEM dosyasi taninamadi ('end_of_head' yok).");
    const baslik = {};
    for (const satir of metin.slice(0, i).split(/\r?\n/)) {
      const m = satir.trim().match(/^([A-Za-z_]+)\s+(.+)$/);
      if (m) baslik[m[1]] = m[2].trim();
    }
    const sutunlar = [...metin.slice(0, i).matchAll(/^\s*(\d+)\s+(\S+)/gm)].map((m) => m[2]);
    if (!/geoid/i.test(metin.slice(0, i)))
      throw new Error("Dosyada 'geoid' fonksiyoneli yok (farkli bir buyukluk hesaplanmis).");
    const noktalar = [];
    for (const satir of metin.slice(metin.indexOf("\n", i) + 1).split(/\r?\n/)) {
      const p = satir.trim().split(/\s+/);
      if (p.length < 5) continue;
      const [id, lon, lat, h, N] = p.map(Number);
      if ([lon, lat, N].every(Number.isFinite)) noktalar.push({ id: p[0], lon, lat, h, N });
    }
    if (!noktalar.length) throw new Error("ICGEM dosyasinda nokta verisi bulunamadi.");
    return { baslik, sutunlar, noktalar };
  }

  /** Istege bagli proxy: GET {proxy}?lat=..&lon=..&model=.. -> {N, model, ...} */
  async function icgemProxySorgu(proxyUrl, phi, lam, model = "EGM2008", { zamanAsimiMs = 120000, sinyal } = {}) {
    koordinatDenetle(phi, lam);
    const u = new URL(proxyUrl);
    u.searchParams.set("lat", phi.toFixed(8));
    u.searchParams.set("lon", lam.toFixed(8));
    u.searchParams.set("model", model);
    const kontrol = new AbortController();
    const zam = setTimeout(() => kontrol.abort(), zamanAsimiMs);
    if (sinyal) sinyal.addEventListener("abort", () => kontrol.abort());
    try {
      const r = await fetch(u.toString(), { signal: kontrol.signal });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || typeof j.N !== "number") throw new Error(j.hata || `Proxy yaniti gecersiz (HTTP ${r.status})`);
      return j;
    } catch (e) {
      if (e.name === "AbortError") throw new Error("ICGEM yaniti zaman asimina ugradi.");
      throw e;
    } finally { clearTimeout(zam); }
  }

  // -------------------------------------------------------------------------
  // ORTOMETRIK YUKSEKLIK
  // -------------------------------------------------------------------------
  /** H = h - N  (h: WGS84 elipsoit yuksekligi, N: geoit ondulasyonu) */
  function ortometrik(h, N) {
    if (!Number.isFinite(h) || !Number.isFinite(N)) throw new Error("h ve N sayi olmali.");
    return h - N;
  }

  return {
    IZGARA, izgaraCoz, izgaraYukle, izgaraIcinde, izgaraN,
    ICGEM_URL, ICGEM_MODELLER, icgemAlanlari, noktaDosyasi, icgemYeniSekmede, icgemDatOku, icgemProxySorgu,
    ortometrik,
  };
});
