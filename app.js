/*
 * app.js - web arayuzu (main.py'deki Kivy arayuzunun karsiligi + konum / ortometrik yukseklik)
 */
(function () {
  "use strict";
  const JZ = window.JZ, G = window.GEOIT, AYAR = window.KD_AYAR || {};
  const $ = (id) => document.getElementById(id);

  // ------------------------------------------------------------------ yardimcilar
  function sayi(metin) {
    const s = String(metin).trim().replace(/,/g, ".");
    const v = Number(s);
    if (s === "" || !Number.isFinite(v)) throw new Error(`Geçersiz sayı: "${String(metin).trim()}"`);
    return v;
  }
  const ff = (x, d, w = 0) => x.toFixed(d).padStart(w);
  const hataMetni = (e) => `HATA: ${e && e.message ? e.message : e}`;
  function durumYaz(el, metin, tur = "") {
    el.textContent = metin;
    el.classList.remove("iyi", "kotu");
    if (tur) el.classList.add(tur);
  }
  function yaz(v) {                       // parametre kutusu: gereksiz sifir ve -0 olmadan
    if (Math.abs(v) < 5e-10) return "0";
    return v.toFixed(9).replace(/0+$/, "").replace(/\.$/, "");
  }
  function secenekler(sel, degerler, secili) {
    sel.innerHTML = "";
    for (const d of degerler) { const o = document.createElement("option"); o.value = d; o.textContent = d; sel.appendChild(o); }
    if (secili != null) sel.value = secili;
  }

  // ------------------------------------------------------------------ tema (Sistem / Acik / Koyu)
  const TEMA_ANAHTAR = "kd-tema";
  function temaUygula(t) {
    const kok = document.documentElement;
    if (t === "light" || t === "dark") kok.setAttribute("data-theme", t); else kok.removeAttribute("data-theme");
    const secili = t === "light" || t === "dark" ? t : "sistem";
    for (const b of document.querySelectorAll("[data-tema]")) b.setAttribute("aria-pressed", String(b.dataset.tema === secili));
    // tarayici cubugunun rengi: secim varsa ona, yoksa cihazin ayarina uy
    for (const m of document.querySelectorAll('meta[name="theme-color"]')) {
      const koyuMeta = (m.getAttribute("media") || "").includes("dark");
      if (secili === "sistem") m.setAttribute("content", koyuMeta ? "#17201F" : "#F7F9F6");
      else m.setAttribute("content", secili === "dark" ? "#17201F" : "#F7F9F6");
    }
  }
  let kayitliTema = null;
  try { kayitliTema = localStorage.getItem(TEMA_ANAHTAR); } catch (e) { kayitliTema = null; }
  temaUygula(kayitliTema);
  for (const b of document.querySelectorAll("[data-tema]")) {
    b.addEventListener("click", () => {
      const t = b.dataset.tema;
      try { if (t === "sistem") localStorage.removeItem(TEMA_ANAHTAR); else localStorage.setItem(TEMA_ANAHTAR, t); } catch (e) { /* depolama kapali */ }
      temaUygula(t);
    });
  }

  // ------------------------------------------------------------------ sekmeler
  const sekmeler = [...document.querySelectorAll('[role="tab"]')];
  function sekmeAc(sekme, odakla = false) {
    for (const s of sekmeler) {
      const secili = s === sekme;
      s.setAttribute("aria-selected", String(secili));
      s.tabIndex = secili ? 0 : -1;
      $(s.getAttribute("aria-controls")).hidden = !secili;
    }
    if (odakla) sekme.focus();
    try { history.replaceState(null, "", "#" + sekme.id.replace("sekme-", "")); } catch (e) { /* yok say */ }
  }
  sekmeler.forEach((s, i) => {
    s.addEventListener("click", () => sekmeAc(s));
    s.addEventListener("keydown", (e) => {
      let j = null;
      if (e.key === "ArrowRight") j = (i + 1) % sekmeler.length;
      else if (e.key === "ArrowLeft") j = (i - 1 + sekmeler.length) % sekmeler.length;
      else if (e.key === "Home") j = 0;
      else if (e.key === "End") j = sekmeler.length - 1;
      if (j !== null) { e.preventDefault(); sekmeAc(sekmeler[j], true); }
    });
  });
  const ilkSekme = $("sekme-" + (location.hash || "").slice(1));
  if (ilkSekme && sekmeler.includes(ilkSekme)) sekmeAc(ilkSekme);

  // ================================================================== KONUM (geolocation)
  let izgaraVeri = null, izgaraHata = null;     // gomulu ICGEM izgarasi (asagida yuklenir)

  /* Tarayicilarin verdigi yukseklik:
   *  - Android ve digerleri: WGS84 elipsoidine gore (W3C tanimi, Android Location.getAltitude) -> dogrudan h
   *  - Apple (iPhone, iPad, Mac): CoreLocation 'altitude' = deniz seviyesine gore (Apple: cogunlukla EGM2008)
   *    -> h = H_cihaz + N_NGA ;  N_NGA = N_ICGEM - 0.41 m (ICGEM sifirinci derece kurali, W0 - U0 farki)
   *  - Masaustu bilgisayarlar (Wi-Fi / IP konumu): yukseklik yok. */
  const APPLE = /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent);
  const NGA_FARK = 0.41;   // N_ICGEM - N_NGA(EGM2008): Ankara 0.413 m, Istanbul 0.411 m (GeographicLib ile karsilastirma)

  function cihazKonumu(p) {
    const c = p.coords;
    // bazi masaustu tarayicilar yukseklik yokken 0 / dogruluk 0 dondurur: bunu "yukseklik yok" say
    const varMi = Number.isFinite(c.altitude) && !(c.altitude === 0 && !(c.altitudeAccuracy > 0));
    return {
      phi: c.latitude, lam: c.longitude,
      yuk: varMi ? c.altitude : null, yukTuru: varMi ? (APPLE ? "msl" : "elipsoidal") : null,
      dogruluk: c.accuracy, yDogruluk: Number.isFinite(c.altitudeAccuracy) ? c.altitudeAccuracy : null,
      zaman: new Date(p.timestamp || Date.now()),
    };
  }

  /** Cihaz konumundan elipsoidal yukseklik. Dondurur {h|null, kaynak, not} */
  function hBul(k) {
    if (k.yuk === null) return { h: null, kaynak: null, not: "Cihaz yükseklik vermedi." };
    if (k.yukTuru === "elipsoidal") return { h: k.yuk, kaynak: "gps", not: "" };
    const s = izgaraVeri ? G.izgaraN(k.phi, k.lam, izgaraVeri) : null;
    if (!s) return { h: null, kaynak: null, not: `Cihaz yüksekliği deniz seviyesine göre verdi (${k.yuk.toFixed(1)} m); h'ye çevirmek için bu noktada N gerekli.` };
    return { h: k.yuk + s.N - NGA_FARK, kaynak: "msl",
      not: `Cihaz yüksekliği deniz seviyesine göre verdi (${k.yuk.toFixed(1)} m, Apple/EGM2008); h = ${k.yuk.toFixed(1)} + N − 0.41 m ile çevrildi.` };
  }

  const KONUM_HATA = {
    1: "Konum izni kapalı; aşağıdaki adımlarla açabilirsiniz.",
    2: "Konum belirlenemedi. Cihazın konum servisinin açık olduğundan emin olun.",
    3: "Konum isteği zaman aşımına uğradı. Açık alanda tekrar deneyin.",
  };

  // ---- konum izni kapaliysa cihaza gore yol gosterme
  const UA = navigator.userAgent;
  const IOS = /iPhone|iPad|iPod/.test(UA) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const ANDROID = /Android/.test(UA);
  const UYGULAMA_ICI = /FBAN|FBAV|FB_IAB|Instagram|Line\/|Twitter|Snapchat|TikTok|musical_ly|WhatsApp|; wv\)/i.test(UA);
  const IOS_TARAYICI = /CriOS/.test(UA) ? "Chrome" : /FxiOS/.test(UA) ? "Firefox" : /EdgiOS/.test(UA) ? "Edge" : "Safari";

  function izinAdimlari() {
    const a = [];
    if (UYGULAMA_ICI) a.push(`Sayfayı uygulamanın kendi tarayıcısında değil, <b>${IOS ? "Safari" : "Chrome"}</b>'de açın (menüden <b>Tarayıcıda aç</b>); uygulama içi tarayıcılar konumu çoğu zaman engeller.`);
    if (IOS) {
      a.push("<b>Ayarlar → Gizlilik ve Güvenlik → Konum Servisleri</b> açık olsun.");
      if (IOS_TARAYICI === "Safari") {
        a.push("Aynı listede <b>Safari Web Siteleri</b>'ne girip <b>Uygulamayı Kullanırken</b> (ya da <b>Sonraki Sefer Sor</b>) seçin; <b>Hassas Konum</b> açık olsun.");
        a.push("<b>Ayarlar → Uygulamalar → Safari → Konum</b> (eski iOS sürümlerinde <b>Ayarlar → Safari → Konum</b>) <b>Sor</b> ya da <b>İzin Ver</b> olsun.");
      } else {
        a.push(`Aynı listede <b>${IOS_TARAYICI}</b>'a girip <b>Uygulamayı Kullanırken</b> seçin; <b>Hassas Konum</b> açık olsun.`);
      }
      a.push("Sayfayı yenileyip <b>Konumumu al</b>'a yeniden basın ve çıkan soruya <b>İzin Ver</b> deyin.");
    } else if (ANDROID) {
      a.push("Telefonun konumu açık olsun (bildirim panelinde <b>Konum</b>).");
      a.push("Adres çubuğunun solundaki simgeye dokunun → <b>İzinler</b> (ya da <b>Site ayarları</b>) → <b>Konum</b> → <b>İzin ver</b>.");
      a.push("Sayfayı yenileyip <b>Konumumu al</b>'a yeniden basın.");
    } else {
      a.push("Adres çubuğunun solundaki site bilgisi simgesine tıklayın → <b>Konum</b> → <b>İzin ver</b>.");
      if (/Windows/.test(UA)) a.push("Windows'ta <b>Ayarlar → Gizlilik ve güvenlik → Konum</b> açık olsun.");
      else if (/Macintosh/.test(UA)) a.push("Mac'te <b>Sistem Ayarları → Gizlilik ve Güvenlik → Konum Servisleri</b>'nde tarayıcınız açık olsun.");
      a.push("Sayfayı yenileyip yeniden deneyin.");
    }
    return a;
  }
  function izinYardimGoster(id) {
    const k = $(id); if (!k) return;
    const ipad = IOS && !/iPhone|iPod/.test(UA);
    const yer = IOS ? (ipad ? "iPad'de" : "iPhone'da") : ANDROID ? "Android telefonda" : "Bilgisayarda";
    k.innerHTML = `<p>Bu site için konum izni kapalı. ${yer} açmak için:</p><ol>` +
      izinAdimlari().map((s) => `<li>${s}</li>`).join("") +
      "</ol><p class=\"kucuk\">İzin vermek istemezseniz enlem ve boylamı kutulara elle yazabilirsiniz; h için arazi modeli düğmesi çalışır.</p>";
    k.hidden = false;
  }
  function izinYardimGizle(id) { const k = $(id); if (k) k.hidden = true; }
  function konumOnKontrol() {
    if (!("geolocation" in navigator)) throw new Error("Bu tarayıcı konum servisini desteklemiyor.");
    if (window.isSecureContext === false)
      throw new Error("Konum yalnızca güvenli bağlantıda (https) alınabilir. Sayfayı GitHub Pages adresinden açın.");
  }

  /** Tek konum. Dondurur Promise<{phi, lam, yuk, yukTuru, h, hKaynak, hNot, dogruluk, yDogruluk, zaman}> */
  function konumIste() {
    return new Promise((coz, reddet) => {
      try { konumOnKontrol(); } catch (e) { return reddet(e); }
      navigator.geolocation.getCurrentPosition(
        (p) => { const k = cihazKonumu(p); const b = hBul(k); coz({ ...k, h: b.h, hKaynak: b.kaynak, hNot: b.not }); },
        (err) => { const e = new Error(KONUM_HATA[err.code] || ("Konum alınamadı: " + err.message)); e.kod = err.code; reddet(e); },
        { enableHighAccuracy: true, timeout: 30000, maximumAge: 0 });
    });
  }

  /** Ilk konumdan sonra GPS'in daha iyi (yukseklikli) konumunu bekler; her iyilesmede geri(k) cagrilir.
   *  Dondurur: durdurma fonksiyonu. */
  function konumIyilestir(ilk, geri, bitti, sureMs = 20000) {
    if (!("geolocation" in navigator) || typeof navigator.geolocation.watchPosition !== "function") { bitti(ilk); return () => {}; }
    let enIyi = ilk, kapandi = false, zam = null, izle = null;
    const kapat = () => {
      if (kapandi) return; kapandi = true;
      clearTimeout(zam); try { if (izle !== null) navigator.geolocation.clearWatch(izle); } catch (e) { /* yok say */ }
      bitti(enIyi);
    };
    izle = navigator.geolocation.watchPosition((p) => {
      if (kapandi) return;
      const k = cihazKonumu(p);
      const dahaIyi = (k.yuk !== null && enIyi.yuk === null) ||
        ((k.yuk !== null) === (enIyi.yuk !== null) && k.dogruluk < enIyi.dogruluk * 0.7);
      if (!dahaIyi) return;
      const b = hBul(k); enIyi = { ...k, h: b.h, hKaynak: b.kaynak, hNot: b.not };
      geri(enIyi);
      if (enIyi.yuk !== null && enIyi.dogruluk <= 15) kapat();
    }, () => {}, { enableHighAccuracy: true, maximumAge: 0, timeout: sureMs });
    zam = setTimeout(kapat, sureMs);
    return kapat;
  }
  const fmtKonum = (k) => ({ phi: k.phi.toFixed(8), lam: k.lam.toFixed(8), h: k.h === null ? "" : k.h.toFixed(3) });

  // ---- cihaz yukseklik vermezse (GPS'siz bilgisayar): arazi modelinden h
  const DEM_URL = "https://api.open-meteo.com/v1/elevation";   // Copernicus DEM GLO-90, EGM2008'e gore
  /** h = H_DEM + N - 0.41 m.  N verilmezse gomulu ICGEM izgarasindan alinir. Dondurur {h, Hdem, N}. */
  async function demIleH(phi, lam, N = null) {
    if (N === null) {
      const s = izgaraVeri ? G.izgaraN(phi, lam, izgaraVeri) : null;
      if (!s) throw new Error(izgaraVeri ? "bu noktada gömülü ızgara yok (Türkiye dışı); N'yi Konum ve yükseklik sekmesinde ICGEM'den isteyin" : "gömülü ızgara henüz yüklenmedi");
      N = s.N;
    }
    const r = await fetch(`${DEM_URL}?latitude=${phi.toFixed(6)}&longitude=${lam.toFixed(6)}`);
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !Array.isArray(j.elevation) || !Number.isFinite(j.elevation[0]))
      throw new Error(j.reason || `arazi modeli servisi yanıt vermedi (HTTP ${r.status})`);
    const Hdem = j.elevation[0];
    return { h: Hdem + N - NGA_FARK, Hdem, N };
  }
  const demNotu = (d) => `h arazi modelinden tahmin edildi: Copernicus DEM ${d.Hdem.toFixed(1)} m + N ${d.N.toFixed(3)} m − 0.41 m = ${d.h.toFixed(3)} m. ` +
    "Bu bir ölçü değil: model bina ve ağaçları içerebilir, belirsizlik birkaç metredir.";
  const demHataNotu = (e) => `Cihaz yükseklik vermedi; arazi modelinden de alınamadı (${e.message}). h'yi elle yazın.`;

  /** Konum + yukseklik: cihaz h vermezse arazi modelinden tamamlar. */
  async function konumVeH() {
    const k = await konumIste();
    if (k.h !== null) return k;
    try { const d = await demIleH(k.phi, k.lam); return { ...k, h: d.h, hKaynak: "dem", hNot: demNotu(d) }; }
    catch (e) { return { ...k, hNot: demHataNotu(e) }; }
  }
  const konumDurumu = (k, ek) => `Konum yazıldı (±${Math.round(k.dogruluk)} m), ${ek}` +
    (k.hKaynak === "dem" ? "; h arazi modelinden tahmin edildi." : k.hKaynak === "msl" ? "; h cihazın deniz seviyesi yüksekliğinden çevrildi." : k.h === null ? "; h bulunamadı." : ".");

  // ================================================================== SEKME 1: COGRAFI <-> KARTEZYEN
  secenekler($("t1-elips"), Object.keys(JZ.ELIPSOITLER), "GRS80");

  function t1Geo2Cart() {
    try {
      const phi = JZ.aciOku($("t1-phi").value), lam = JZ.aciOku($("t1-lam").value), h = sayi($("t1-h").value);
      const el = $("t1-elips").value;
      const [X, Y, Z] = JZ.geoToCart(phi, lam, h, el);
      const { a, f, e2 } = JZ.elipsoitSabitleri(el);
      const N = a / Math.sqrt(1 - e2 * Math.sin(phi * Math.PI / 180) ** 2);
      $("t1-x").value = X.toFixed(4); $("t1-y").value = Y.toFixed(4); $("t1-z").value = Z.toFixed(4);
      $("t1-out").textContent =
        `COĞRAFİ → KARTEZYEN   [${el}]\n` +
        `a = ${a.toFixed(3)} m   1/f = ${(1 / f).toFixed(9)}   e² = ${e2.toFixed(15)}\n` +
        "-----------------------------------------------\n" +
        `φ = ${phi.toFixed(10)}°  (${JZ.dms(phi)})\n` +
        `λ = ${lam.toFixed(10)}°  (${JZ.dms(lam)})\n` +
        `h = ${h.toFixed(4)} m\n` +
        `N = a/√(1−e²sin²φ) = ${N.toFixed(4)} m\n` +
        "-----------------------------------------------\n" +
        `X = (N+h)cosφ cosλ   = ${ff(X, 4, 15)} m\n` +
        `Y = (N+h)cosφ sinλ   = ${ff(Y, 4, 15)} m\n` +
        `Z = (N(1−e²)+h)sinφ  = ${ff(Z, 4, 15)} m\n`;
    } catch (e) { $("t1-out").textContent = hataMetni(e); }
  }

  function t1Cart2Geo() {
    try {
      const X = sayi($("t1-x").value), Y = sayi($("t1-y").value), Z = sayi($("t1-z").value);
      const el = $("t1-elips").value, yon = $("t1-yontem").value;
      const [phi, lam, h, n] = JZ.cartToGeo(X, Y, Z, el, yon);
      const Xg = JZ.geoToCart(phi, lam, h, el);
      const kap = Math.hypot(Xg[0] - X, Xg[1] - Y, Xg[2] - Z);
      $("t1-phi").value = phi.toFixed(10); $("t1-lam").value = lam.toFixed(10); $("t1-h").value = h.toFixed(4);
      $("t1-out").textContent =
        `KARTEZYEN → COĞRAFİ   [${el}, ${yon}, ${n} iterasyon]\n` +
        "-----------------------------------------------\n" +
        `X = ${X.toFixed(4)}   Y = ${Y.toFixed(4)}   Z = ${Z.toFixed(4)}\n` +
        `p = √(X²+Y²) = ${Math.hypot(X, Y).toFixed(4)} m\n` +
        "-----------------------------------------------\n" +
        `φ = ${phi.toFixed(10)}°  (${JZ.dms(phi)})\n` +
        `λ = ${lam.toFixed(10)}°  (${JZ.dms(lam)})\n` +
        `h = ${h.toFixed(4)} m\n` +
        `Geri dönüş kapanma hatası = ${kap.toExponential(2)} m\n`;
    } catch (e) { $("t1-out").textContent = hataMetni(e); }
  }
  $("t1-g2c").addEventListener("click", t1Geo2Cart);
  $("t1-c2g").addEventListener("click", t1Cart2Geo);

  function t1KonumYaz(k) {
    const f = fmtKonum(k);
    $("t1-elips").value = "WGS84";
    $("t1-phi").value = f.phi; $("t1-lam").value = f.lam; $("t1-h").value = f.h;
    if (k.h !== null) {
      t1Geo2Cart();
      if (k.hKaynak === "dem" || k.hKaynak === "msl") $("t1-out").textContent += "\n" + k.hNot + "\n";
    } else {
      $("t1-x").value = $("t1-y").value = $("t1-z").value = "";
      $("t1-out").textContent = (k.hNot || "Cihaz yükseklik vermedi.") + "\nh kutusuna elipsoidal yüksekliği yazıp Coğrafi → Kartezyen'e basın.";
    }
  }
  $("t1-konum").addEventListener("click", async () => {
    const d = $("t1-konum-durum"); durumYaz(d, "Konum isteniyor…");
    try { const k = await konumVeH(); izinYardimGizle("t1-izin-yardim"); t1KonumYaz(k); durumYaz(d, konumDurumu(k, "elipsoit WGS84"), k.h === null ? "kotu" : "iyi"); }
    catch (e) { durumYaz(d, e.message, "kotu"); if (e.kod === 1) izinYardimGoster("t1-izin-yardim"); }
  });

  // ================================================================== SEKME 2: DATUM / CERCEVE
  const M_IERS = "IERS 14 parametre (zamana bağlı)";
  const M_SABIT = "7 parametre Helmert (hızsız, t₀)";
  const M_BW = "Bursa-Wolf 7 parametre";
  const M_MB = "Molodensky-Badekas (7 p. + Xm, Ym, Zm)";
  const M_ELIPS = "Yalnız elipsoit değişimi";
  const MODEL_KODU = { [M_IERS]: JZ.MODEL_IERS, [M_SABIT]: JZ.MODEL_SABIT, [M_BW]: JZ.MODEL_BW, [M_MB]: JZ.MODEL_MB, [M_ELIPS]: JZ.MODEL_ELIPS };
  const KONV_ADI = { PV: "PV (Position Vector)", CF: "CF (Coordinate Frame)" };
  const MANUEL_YOK = "Bu kaynak-hedef-model kombinasyonu için kayıtlı parametre bulunamadı. Lütfen manuel parametre girişi yapın.";

  secenekler($("t2-kaynak"), Object.keys(JZ.SISTEMLER), "WGS84 (G2139)");
  secenekler($("t2-hedef"), Object.keys(JZ.SISTEMLER), "ITRF96 (TUREF)");
  secenekler($("t2-model"), Object.keys(MODEL_KODU), M_IERS);

  const P_ALAN = ["p-tx", "p-ty", "p-tz", "p-d", "p-rx", "p-ry", "p-rz"].map($);
  const P_MERKEZ = ["p-xm", "p-ym", "p-zm"].map($);
  let eslesme = null, manuelAktif = false;

  function tipEtiketleri() {
    const c = $("t2-tip").value === "Cografi";
    $("t2-a-et").textContent = c ? "Enlem φ" : "X (m)";
    $("t2-b-et").textContent = c ? "Boylam λ" : "Y (m)";
    $("t2-c-et").textContent = c ? "h (m)" : "Z (m)";
  }

  function parametreleriGuncelle() {
    const kay = $("t2-kaynak").value, hed = $("t2-hedef").value, model = $("t2-model").value;
    const kod = MODEL_KODU[model];
    let epok; try { epok = sayi($("t2-epok").value); } catch (e) { epok = null; }
    const e = JZ.parametreBul(kay, hed, kod, epok);
    eslesme = e;
    const bwmb = kod === JZ.MODEL_BW || kod === JZ.MODEL_MB;
    manuelAktif = $("p-manuel").checked && bwmb;

    // KV baglamalarinin karsiligi
    $("t2-epok").disabled = !(kod === JZ.MODEL_IERS || bwmb);
    for (const w of [...P_ALAN, ...P_MERKEZ]) w.readOnly = !manuelAktif;
    for (const w of P_MERKEZ) w.disabled = kod !== JZ.MODEL_MB;
    $("p-konv").disabled = !manuelAktif;
    $("p-ters").disabled = !manuelAktif;
    $("p-manuel").disabled = !bwmb;

    const yon = { ileri: "kayıtlı yönde (ileri)", ters: "kayıtlı setin tersi (kesin ters çözüm)",
      zincir: `zincir (${e.zincir.length} adım)`, ozdes: "özdeşlik / parametresiz", yok: "-" }[e.yon];
    const baslik = [`Kaynak: ${kay}`, `Hedef: ${hed}`, `Model: ${model}`];
    if (manuelAktif) baslik.push("Parametre kaynağı: Manuel giriş (kullanıcı)");
    else if (e.bulundu) {
      baslik.push(`Parametre kaynağı: ${e.kurum}` + (e.kod ? `  [${e.kod}]` : ""));
      baslik.push(`Yön: ${yon}` + (e.konvansiyon ? `   Konvansiyon: ${e.konvansiyon}` : "") +
        (e.epok != null ? `   Epok t = ${e.epok.toFixed(2)}` : ""));
    } else baslik.push("Parametre kaynağı: - (kayıt yok)");
    $("p-baslik").textContent = baslik.join("\n");

    const durum = $("p-durum");
    const durumAyarla = (metin, sinif) => { durum.textContent = metin; durum.className = "p-durum " + sinif; };
    if (manuelAktif) {
      durumAyarla("Manuel parametre girişi açık: hesapta kutulardaki değerler kullanılır (kaynak → hedef yönünde; gerekirse 'Ters yönde uygula').", "bilgi");
      $("p-ayrinti").textContent = e.bulundu && e.T !== null ? "Kayıtlı set mevcut; manuel girişi kapatınca otomatik değerler geri gelir." : "";
      return;
    }
    if (e.bulundu && e.T !== null) {
      [...e.T, e.D, ...e.R].forEach((v, i) => { P_ALAN[i].value = yaz(v); });
      P_MERKEZ.forEach((w, i) => { w.value = e.merkez ? e.merkez[i].toFixed(3) : ""; });
      $("p-konv").value = e.konvansiyon;
      $("p-ters").checked = e.ters;
      durumAyarla(e.mesaj, "iyi");
    } else {
      for (const w of [...P_ALAN, ...P_MERKEZ]) w.value = "";
      $("p-ters").checked = false;
      if (e.bulundu) durumAyarla(e.mesaj, "iyi");
      else durumAyarla(bwmb ? MANUEL_YOK : e.mesaj + (e.mesaj !== JZ.BULUNAMADI ? "" :
        "  (Manuel giriş yalnız Bursa-Wolf ve Molodensky-Badekas modellerinde yapılabilir.)"), "uyari");
    }
    $("p-ayrinti").textContent = e.ayrinti.join("\n");
  }

  function kullaniciParam(mb) {
    let p, merkez;
    try {
      p = P_ALAN.map((w) => sayi(w.value));
      merkez = mb ? P_MERKEZ.map((w) => sayi(w.value)) : [0, 0, 0];
    } catch (e) {
      throw new Error("Manuel parametre girişi eksik ya da hatalı: Tx, Ty, Tz, D, Rx, Ry, Rz" + (mb ? ", Xm, Ym, Zm" : "") + " alanlarını doldurun.");
    }
    return { p, merkez, konv: $("p-konv").value === "CF" ? "CF" : "PV", ters: $("p-ters").checked };
  }

  function t2Donustur() {
    const out = $("t2-out");
    try {
      parametreleriGuncelle();
      let e = eslesme;
      const kay = $("t2-kaynak").value, hed = $("t2-hedef").value, model = $("t2-model").value;
      const kod = MODEL_KODU[model];
      const elK = JZ.SISTEMLER[kay], elH = JZ.SISTEMLER[hed];
      const a = $("t2-a").value, b = $("t2-b").value, c = $("t2-c").value;
      const o = [`MODEL : ${model}`, `YÖN   : ${kay} [${elK}]  →  ${hed} [${elH}]`, "=".repeat(56)];

      let X1, phi, lam, h;
      if ($("t2-tip").value === "Cografi") {
        phi = JZ.aciOku(a); lam = JZ.aciOku(b); h = sayi(c);
        X1 = JZ.geoToCart(phi, lam, h, elK);
        o.push(`1) Giriş coğrafi → kartezyen (${elK})`);
      } else {
        X1 = [sayi(a), sayi(b), sayi(c)];
        [phi, lam, h] = JZ.cartToGeo(...X1, elK);
        o.push("1) Giriş zaten kartezyen");
      }
      o.push(`   X1 = ${ff(X1[0], 4, 15)} ${ff(X1[1], 4, 15)} ${ff(X1[2], 4, 15)}`);

      o.push("2) Dönüşüm");
      let X2;
      if ((model === M_BW || model === M_MB) && manuelAktif) {
        const { p, merkez, konv, ters } = kullaniciParam(model === M_MB);
        const f = model === M_BW ? JZ.bursaWolf : JZ.molodenskyBadekas;
        const args = model === M_BW ? p : [...p, merkez];
        X2 = ters ? JZ.tersCevir7(X1, f, args, konv) : f(X1, ...args, konv);
        o.push("   Parametre kaynağı: Manuel giriş (kullanıcı)",
          `   T[m] = ${p[0].toFixed(4)} ${p[1].toFixed(4)} ${p[2].toFixed(4)}   D = ${p[3].toFixed(4)} ppm`,
          `   R["] = ${p[4].toFixed(5)} ${p[5].toFixed(5)} ${p[6].toFixed(5)}   konvansiyon = ${konv}` +
          (ters ? "   (TERS, kesin iteratif çözüm)" : ""));
        if (model === M_MB) o.push(`   Xm  = ${merkez[0].toFixed(3)} ${merkez[1].toFixed(3)} ${merkez[2].toFixed(3)}`);
      } else {
        if (!e.bulundu) {
          o.push("   " + (model === M_BW || model === M_MB ? MANUEL_YOK : e.mesaj),
            "   Dönüşüm YAPILMADI (örnek ya da 0 parametre kullanılmaz).");
          out.textContent = o.join("\n");
          return;
        }
        let epok; try { epok = sayi($("t2-epok").value); } catch (err) { epok = null; }
        let rapor;
        [X2, e, rapor] = JZ.donustur(X1, kay, hed, kod, epok);
        o.push(`   Parametre kaynağı: ${e.kurum}` + (e.kod ? `  [${e.kod}]` : ""));
        if (model === M_IERS || model === M_SABIT) {
          if (!rapor.length) o.push("   Kaynak = hedef, dönüşüm yok.");
          for (const r of rapor) {
            const T = r.T_mm, D = r.D_ppb, R = r.R_mas;
            o.push(`   * ${r.adim}   (t = ${r.epok.toFixed(2)})`,
              `     T[mm] = ${ff(T[0], 3, 8)} ${ff(T[1], 3, 8)} ${ff(T[2], 3, 8)}   D[ppb] = ${ff(D, 3, 7)}`,
              `     R[mas]= ${ff(R[0], 4, 8)} ${ff(R[1], 4, 8)} ${ff(R[2], 4, 8)}`,
              "     dX[mm]= " + r.fark_m.map((v) => ff(v * 1000, 2, 8)).join(" "));
          }
        } else if (model === M_BW || model === M_MB) {
          if (e.yon === "ozdes") o.push("   " + e.mesaj);
          else {
            o.push(`   T[m] = ${e.T[0].toFixed(4)} ${e.T[1].toFixed(4)} ${e.T[2].toFixed(4)}   D = ${e.D.toFixed(4)} ppm`,
              `   R["] = ${e.R[0].toFixed(5)} ${e.R[1].toFixed(5)} ${e.R[2].toFixed(5)}   konvansiyon = ${e.konvansiyon} (kayıtlı)`);
            if (e.merkez) o.push(`   Xm  = ${e.merkez[0].toFixed(3)} ${e.merkez[1].toFixed(3)} ${e.merkez[2].toFixed(3)}`);
            if (e.ters) o.push(`   Kayıtlı yön ${e.set.kaynak} → ${e.set.hedef}; kesin ters çözüm (ters_cevir_7) uygulandı.`);
          }
        } else o.push("   Çerçeve aynı kabul edildi: X, Y, Z değişmez.");
      }

      const [phi2, lam2, h2] = JZ.cartToGeo(...X2, elH);
      const d = [0, 1, 2].map((k) => X2[k] - X1[k]);
      const [de, dn, du] = JZ.enuFarki(d, phi, lam);
      o.push("=".repeat(56), `SONUÇ (${hed})`,
        `   X2 = ${ff(X2[0], 4, 15)}`, `   Y2 = ${ff(X2[1], 4, 15)}`, `   Z2 = ${ff(X2[2], 4, 15)}`,
        `   φ2 = ${phi2.toFixed(10)}°  (${JZ.dms(phi2)})`,
        `   λ2 = ${lam2.toFixed(10)}°  (${JZ.dms(lam2)})`,
        `   h2 = ${h2.toFixed(4)} m  [${elH}]`,
        "-".repeat(56), "KAYMA (hedef − kaynak)",
        `   dX, dY, dZ [m] = ${d[0].toFixed(4)} ${d[1].toFixed(4)} ${d[2].toFixed(4)}`,
        `   Doğu, Kuzey, Yukarı [m] = ${de.toFixed(4)} ${dn.toFixed(4)} ${du.toFixed(4)}`,
        `   3B uzunluk = ${Math.hypot(...d).toFixed(4)} m`,
        `   dφ = ${((phi2 - phi) * 3600).toFixed(6)}"  dλ = ${((lam2 - lam) * 3600).toFixed(6)}"  dh = ${((h2 - h) * 1000).toFixed(3)} mm`);
      out.textContent = o.join("\n");
    } catch (e) { out.textContent = hataMetni(e); }
  }

  function t2YerDegistir() {
    if (manuelAktif) $("p-ters").checked = !$("p-ters").checked;
    const k = $("t2-kaynak").value;
    $("t2-kaynak").value = $("t2-hedef").value; $("t2-hedef").value = k;
    parametreleriGuncelle();
  }

  function ornekEpsg() {
    $("t2-model").value = M_BW; $("t2-tip").value = "Kartezyen"; tipEtiketleri();
    $("t2-kaynak").value = $("t2-hedef").value = "WGS84 (G2139)";
    $("p-manuel").checked = true;
    parametreleriGuncelle();
    ["0", "0", "4.5", "0.219", "0", "0", "0.554"].forEach((v, i) => { P_ALAN[i].value = v; });
    $("p-konv").value = "PV"; $("p-ters").checked = false;
    $("t2-a").value = "3657660.66"; $("t2-b").value = "255768.55"; $("t2-c").value = "5201382.11";
    t2Donustur();
    const d = $("p-durum");
    d.textContent = "TEST ÖRNEĞİ (EPSG GN 7-2, WGS72 → WGS84): manuel giriş olarak dolduruldu; gerçek bir kaynak-hedef dönüşümü değildir.";
    d.className = "p-durum bilgi";
  }

  for (const id of ["t2-kaynak", "t2-hedef", "t2-model"]) $(id).addEventListener("change", parametreleriGuncelle);
  $("t2-epok").addEventListener("input", parametreleriGuncelle);
  $("p-manuel").addEventListener("change", parametreleriGuncelle);
  $("t2-tip").addEventListener("change", tipEtiketleri);
  $("t2-donustur").addEventListener("click", t2Donustur);
  $("t2-degistir").addEventListener("click", t2YerDegistir);
  $("p-epsg").addEventListener("click", ornekEpsg);
  tipEtiketleri();
  parametreleriGuncelle();

  function t2KonumYaz(k) {
    const f = fmtKonum(k);
    $("t2-tip").value = "Cografi"; tipEtiketleri();
    $("t2-kaynak").value = "WGS84 (G2296)";      // tarayici konumu guncel WGS84 gerceklestirmesindedir
    $("t2-a").value = f.phi; $("t2-b").value = f.lam; $("t2-c").value = f.h;
    parametreleriGuncelle();
    if (k.h !== null) {
      t2Donustur();
      if (k.hKaynak === "dem" || k.hKaynak === "msl") $("t2-out").textContent += "\n\n" + k.hNot;
    } else $("t2-out").textContent = (k.hNot || "Cihaz yükseklik vermedi.") + "\nh kutusuna elipsoidal yüksekliği yazıp Dönüştür'e basın.";
  }
  $("t2-konum").addEventListener("click", async () => {
    const d = $("t2-konum-durum"); durumYaz(d, "Konum isteniyor…");
    try { const k = await konumVeH(); izinYardimGizle("t2-izin-yardim"); t2KonumYaz(k); durumYaz(d, konumDurumu(k, "kaynak WGS84 (G2296)"), k.h === null ? "kotu" : "iyi"); }
    catch (e) { durumYaz(d, e.message, "kotu"); if (e.kod === 1) izinYardimGoster("t2-izin-yardim"); }
  });

  // ================================================================== KONUM VE ORTOMETRIK YUKSEKLIK
  secenekler($("k-model"), Object.keys(G.ICGEM_MODELLER), "EGM2008");
  const nKayit = new Map();       // kaynak -> {etiket, model, N}
  let icgemBekleyen = null;       // yeni sekmede gonderilen istek {phi, lam, model}
  let proxyIptal = null;
  const ETIKET = { icgem: "ICGEM (canlı)", izgara: "Gömülü ICGEM ızgarası", elle: "Elle girilen" };
  let hKaynak = null;             // gps | msl | dem | elle
  const H_ETIKET = {
    gps: "elipsoidal yükseklik, cihazın GPS'i",
    msl: "elipsoidal yükseklik, cihazın deniz seviyesi yüksekliğinden",
    dem: "elipsoidal yükseklik, arazi modelinden tahmin",
    elle: "elipsoidal yükseklik, elle girildi",
  };
  let kullaniciDuzenledi = false, iyilestirmeDurdur = null;
  let demSira = 0;                // otomatik arazi modeli istegi sirasi (eski cevaplari yok saymak icin)

  function konumOku({ hZorunlu = false } = {}) {
    const phi = JZ.aciOku($("k-phi").value), lam = JZ.aciOku($("k-lam").value);
    if (phi < -90 || phi > 90) throw new Error("Enlem −90 ile 90 arasında olmalı.");
    if (lam < -180 || lam > 360) throw new Error("Boylam −180 ile 360 arasında olmalı.");
    let h = null;
    if ($("k-h").value.trim() !== "") h = sayi($("k-h").value);
    else if (hZorunlu) throw new Error("h boş.");
    return { phi, lam: lam > 180 ? lam - 360 : lam, h };
  }

  const m3 = (v) => (v === null || v === undefined || !Number.isFinite(v) ? "—" : v.toFixed(3) + " m");

  function tercihliN() {
    for (const k of ["icgem", "elle", "izgara"]) if (nKayit.has(k)) return [k, nKayit.get(k)];
    return [null, null];
  }

  function sonucGuncelle() {
    let h = null;
    try { if ($("k-h").value.trim() !== "") h = sayi($("k-h").value); } catch (e) { h = null; }
    const [kaynak, kayit] = tercihliN();
    const N = kayit ? kayit.N : null;
    const H = h !== null && N !== null ? G.ortometrik(h, N) : null;
    $("d-h").textContent = m3(h);
    $("d-h-kaynak").textContent = (h !== null && H_ETIKET[hKaynak]) || "elipsoidal yükseklik";
    $("d-n").textContent = m3(N);
    $("d-hh").textContent = m3(H);
    $("d-n-kaynak").textContent = kayit ? `geoit ondülasyonu (${ETIKET[kaynak]}, ${kayit.model})` : "geoit ondülasyonu";
    kesitCiz(h, N, H);

    const tb = $("k-tablo").tBodies[0];
    tb.innerHTML = "";
    if (!nKayit.size) {
      const tr = tb.insertRow(); tr.className = "bos";
      const td = tr.insertCell(); td.colSpan = 4;
      td.textContent = izgaraHata ? `Henüz N hesaplanmadı. (${izgaraHata})` : "Henüz N hesaplanmadı. Konumunuzu alın ya da enlem ve boylam yazın.";
      return;
    }
    for (const k of ["izgara", "icgem", "elle"]) {
      if (!nKayit.has(k)) continue;
      const r = nKayit.get(k), tr = tb.insertRow();
      tr.insertCell().textContent = ETIKET[k] + (r.not ? ` (${r.not})` : "");
      tr.insertCell().textContent = r.model;
      const c1 = tr.insertCell(); c1.className = "sayi"; c1.textContent = r.N.toFixed(4);
      const c2 = tr.insertCell(); c2.className = "sayi"; c2.textContent = h === null ? "h gerekli" : G.ortometrik(h, r.N).toFixed(3);
    }
    if (nKayit.has("izgara") && nKayit.has("icgem")) {
      const tr = tb.insertRow(), fark = nKayit.get("icgem").N - nKayit.get("izgara").N;
      const td = tr.insertCell(); td.colSpan = 2; td.textContent = "Fark (ICGEM − ızgara)";
      const c = tr.insertCell(); c.className = "sayi"; c.textContent = (fark * 1000).toFixed(1) + " mm";
      tr.insertCell();
    }
  }

  function izgaraHesapla({ sessiz = false } = {}) {
    const d = $("k-icgem-durum");
    nKayit.delete("izgara");
    let k;
    try { k = konumOku(); } catch (e) { if (!sessiz) durumYaz(d, e.message, "kotu"); sonucGuncelle(); return; }
    if (!izgaraVeri) {
      if (!sessiz) durumYaz(d, izgaraHata || "Izgara henüz yükleniyor, birkaç saniye sonra tekrar deneyin.", "kotu");
      sonucGuncelle(); return;
    }
    const s = G.izgaraN(k.phi, k.lam, izgaraVeri);
    if (!s) {
      if (!sessiz) durumYaz(d, `Nokta gömülü ızgaranın dışında (${G.IZGARA.guney}–${G.IZGARA.kuzey}° K, ${G.IZGARA.bati}–${G.IZGARA.dogu}° D). N için ICGEM'den isteyin.`, "kotu");
      sonucGuncelle(); return;
    }
    nKayit.set("izgara", { model: G.IZGARA.model, N: s.N, not: s.yontem === "bikubik" ? "1′, bikübik" : "1′, bilineer" });
    if (!sessiz) durumYaz(d, "N gömülü ICGEM ızgarasından hesaplandı (EGM2008, ICGEM nokta servisine göre ≤1 cm).", "iyi");
    sonucGuncelle();
  }

  function konumDegisti(kullanici = false) {   // phi/lambda degisti: eski ICGEM/elle sonuclari bu noktaya ait degil
    nKayit.delete("icgem"); nKayit.delete("elle"); $("k-n-elle").value = "";
    if (kullanici) demSira++;                   // bekleyen otomatik arazi modeli cevabi artik gecersiz
    if (kullanici && (hKaynak === "dem" || hKaynak === "msl")) {   // bu h eski noktaya aitti
      $("k-h").value = ""; hKaynak = null;
      $("k-h-not").textContent = "Konum değişti: h yeniden belirlenmeli.";
    }
    izgaraHesapla({ sessiz: true });
  }
  function iyilestirmeyiBirak() { kullaniciDuzenledi = true; if (iyilestirmeDurdur) iyilestirmeDurdur(); }
  let zamanlayici = null;
  for (const id of ["k-phi", "k-lam"]) $(id).addEventListener("input", () => {
    iyilestirmeyiBirak();
    clearTimeout(zamanlayici); zamanlayici = setTimeout(() => konumDegisti(true), 300);
  });
  $("k-h").addEventListener("input", () => {
    iyilestirmeyiBirak();
    hKaynak = $("k-h").value.trim() ? "elle" : null;
    $("k-h-not").textContent = "";
    sonucGuncelle();
  });

  function dogrulukMetni(k) {
    let m = `Yatay doğruluk ±${k.dogruluk.toFixed(0)} m`;
    if (k.dogruluk > 1000) m += IOS ? " (çok kaba: Ayarlar → Gizlilik ve Güvenlik → Konum Servisleri'nde tarayıcınız için Hassas Konum kapalı olabilir)" : " (çok kaba)";
    if (k.yuk === null) m += ". Cihaz yükseklik vermedi (bilgisayarlarda GPS olmadığı için konum Wi-Fi ya da IP'den gelir).";
    else m += k.yDogruluk !== null ? `, düşey doğruluk ±${k.yDogruluk.toFixed(0)} m.` : ", düşey doğruluk bildirilmedi.";
    return m + ` Zaman ${k.zaman.toLocaleTimeString("tr-TR")}.`;
  }

  function konumUygula(k) {
    const f = fmtKonum(k);
    $("k-phi").value = f.phi; $("k-lam").value = f.lam; $("k-h").value = f.h;
    hKaynak = k.h === null ? null : k.hKaynak;
    $("k-dogruluk").textContent = dogrulukMetni(k);
    $("k-h-not").textContent = k.yukTuru === "msl" || k.yuk === null ? k.hNot : "";
    demSira++;
    konumDegisti(false);
    t1KonumYaz(k); t2KonumYaz(k);
    if (k.h === null) demOtomatik();
  }

  /** Cihaz yukseklik vermediyse h'yi arazi modelinden hemen doldurur; GPS ya da elle h gelirse geri cekilir. */
  async function demOtomatik() {
    const sira = ++demSira;
    let k; try { k = konumOku(); } catch (e) { return; }
    const [, kayit] = tercihliN();
    $("k-h-not").textContent = "Cihaz yükseklik vermedi; h arazi modelinden isteniyor…";
    try {
      const d = await demIleH(k.phi, k.lam, kayit ? kayit.N : null);
      if (sira !== demSira || hKaynak !== null) return;     // bu arada konum degisti ya da GPS / elle h geldi
      $("k-h").value = d.h.toFixed(3); hKaynak = "dem";
      $("k-h-not").textContent = demNotu(d);
      sonucGuncelle();
      const kk = { phi: k.phi, lam: k.lam, h: d.h, hKaynak: "dem", hNot: demNotu(d) };
      t1KonumYaz(kk); t2KonumYaz(kk);
    } catch (e) {
      if (sira !== demSira || hKaynak !== null) return;
      $("k-h-not").textContent = demHataNotu(e);
    }
  }

  $("k-konum-al").addEventListener("click", async () => {
    const d = $("k-konum-durum"), btn = $("k-konum-al");
    if (iyilestirmeDurdur) { kullaniciDuzenledi = true; iyilestirmeDurdur(); }
    btn.disabled = true; durumYaz(d, "Konum isteniyor… (tarayıcı izin sorabilir)");
    let k;
    try { k = await konumIste(); }
    catch (e) { durumYaz(d, e.message, "kotu"); if (e.kod === 1) izinYardimGoster("k-izin-yardim"); btn.disabled = false; return; }
    btn.disabled = false;
    izinYardimGizle("k-izin-yardim");
    kullaniciDuzenledi = false;
    konumUygula(k);
    const tamam = () => durumYaz(d, "Konum alındı ve dönüşüm sekmelerine de yazıldı.", "iyi");
    if (k.yuk !== null && k.dogruluk <= 15) { tamam(); return; }
    durumYaz(d, "Konum alındı. Daha iyi konum ve yükseklik için GPS 20 saniye dinleniyor…", "iyi");
    iyilestirmeDurdur = konumIyilestir(k,
      (y) => {
        if (kullaniciDuzenledi) return;
        konumUygula(y);
        durumYaz(d, `GPS konumu güncellendi (±${Math.round(y.dogruluk)} m${y.yuk !== null ? ", yükseklik alındı" : ""}).`, "iyi");
      },
      (son) => {
        iyilestirmeDurdur = null;
        if (kullaniciDuzenledi) return;
        if (son.yuk === null) durumYaz(d, hKaynak === "dem"
          ? "Konum alındı. Cihaz yükseklik vermediği için h arazi modelinden tahmin edildi."
          : "Konum alındı; cihaz yükseklik vermedi. h'yi elle yazın.", "iyi");
        else tamam();
      });
  });

  // ---- h yoksa: arazi modelinden (Copernicus DEM, EGM2008'e gore) tahmin
  async function demTahmin() {
    const d = $("k-konum-durum"), btn = $("k-dem");
    let k; try { k = konumOku(); } catch (e) { durumYaz(d, "Önce konum alın ya da enlem ve boylam yazın.", "kotu"); return; }
    const [, kayit] = tercihliN();
    if (!kayit) {
      durumYaz(d, "h'yi tahmin etmek için önce bu noktada N gerekli. Gömülü ızgara yalnız Türkiye'yi kapsar; dışarıdaysanız N'yi ICGEM'den isteyin.", "kotu");
      return;
    }
    iyilestirmeyiBirak(); demSira++;
    btn.disabled = true; durumYaz(d, "Arazi yüksekliği isteniyor (Copernicus DEM, Open-Meteo)…");
    try {
      const sonuc = await demIleH(k.phi, k.lam, kayit.N);
      $("k-h").value = sonuc.h.toFixed(3); hKaynak = "dem";
      $("k-h-not").textContent = demNotu(sonuc);
      durumYaz(d, "h arazi modelinden tahmin edildi.", "iyi");
      sonucGuncelle();
    } catch (e) {
      durumYaz(d, "Arazi yüksekliği alınamadı: " + e.message, "kotu");
    } finally { btn.disabled = false; }
  }
  $("k-dem").addEventListener("click", demTahmin);

  $("k-izgara").addEventListener("click", () => izgaraHesapla());

  // ---- ICGEM
  async function icgemProxyIle(k, model) {
    const d = $("k-icgem-durum"), btn = $("k-icgem");
    if (proxyIptal) proxyIptal.abort();
    proxyIptal = new AbortController();
    const bas = Date.now();
    btn.disabled = true;
    const sayac = setInterval(() => durumYaz(d, `ICGEM hesaplıyor (${model})… ${Math.round((Date.now() - bas) / 1000)} s`), 1000);
    durumYaz(d, `ICGEM'e istek gönderildi (${model})…`);
    try {
      const j = await G.icgemProxySorgu(AYAR.icgemProxyUrl, k.phi, k.lam, model, { sinyal: proxyIptal.signal });
      nKayit.set("icgem", { model: j.model || model, N: j.N, not: j.id ? `iş ${String(j.id).slice(0, 8)}` : "" });
      durumYaz(d, `ICGEM yanıtı alındı (${Math.round((Date.now() - bas) / 1000)} s).`, "iyi");
      sonucGuncelle();
    } catch (e) {
      durumYaz(d, `ICGEM proxy hatası: ${e.message}. Aşağıdaki yolla yeni sekmede deneyebilirsiniz.`, "kotu");
      datAlaniGoster(k, model, false);
    } finally { clearInterval(sayac); btn.disabled = false; proxyIptal = null; }
  }

  function datAlaniGoster(k, model, gonderildi) {
    icgemBekleyen = { phi: k.phi, lam: k.lam, model };
    $("k-dat-alani").hidden = false;
    if (!gonderildi) {
      const p = $("k-dat-alani").querySelector("p");
      if (!$("k-yeni-sekme")) {
        const b = document.createElement("button");
        b.type = "button"; b.id = "k-yeni-sekme"; b.textContent = "ICGEM'i yeni sekmede aç";
        b.addEventListener("click", () => icgemYeniSekme());
        p.after(b);
      }
    }
  }

  function icgemYeniSekme() {
    const d = $("k-icgem-durum");
    let k; try { k = konumOku(); } catch (e) { durumYaz(d, e.message, "kotu"); return; }
    const model = $("k-model").value;
    const ok = G.icgemYeniSekmede(k.phi, k.lam, model);
    if (ok) {
      durumYaz(d, `İstek ICGEM'e yeni sekmede gönderildi (${model}). Hesap yaklaşık 25 saniye sürer. Sekme açılmadıysa açılır pencere engelleyicisini kapatıp tekrar basın.`, "iyi");
      datAlaniGoster(k, model, true);
    } else {
      durumYaz(d, "Bu tarayıcı dosyalı formu otomatik dolduramıyor. icgem.gfz.de/calcpoints sayfasında nokta dosyasını elle yükleyin.", "kotu");
      datAlaniGoster(k, model, true);
    }
  }

  $("k-icgem").addEventListener("click", () => {
    const d = $("k-icgem-durum");
    let k; try { k = konumOku(); } catch (e) { durumYaz(d, "Önce konum alın ya da enlem ve boylam yazın. " + e.message, "kotu"); return; }
    const model = $("k-model").value;
    if (AYAR.icgemProxyUrl) icgemProxyIle(k, model);
    else icgemYeniSekme();
  });

  function datIsle(metin, dosyaAdi) {
    const d = $("k-icgem-durum");
    let sonuc;
    try { sonuc = G.icgemDatOku(metin); } catch (e) { durumYaz(d, `${dosyaAdi}: ${e.message}`, "kotu"); return; }
    const n = sonuc.noktalar[0], b = sonuc.baslik;
    if (b.refsysname && b.refsysname.toUpperCase() !== "WGS84") {
      durumYaz(d, `${dosyaAdi}: referans sistem ${b.refsysname}. h WGS84 olduğu için WGS84 ile hesaplanmış dosya gerekli.`, "kotu"); return;
    }
    let k = null; try { k = konumOku(); } catch (e) { k = null; }
    if (!k) {               // konum bos: dosyadaki noktayi kullan
      $("k-phi").value = n.lat.toFixed(8); $("k-lam").value = n.lon.toFixed(8);
      konumDegisti();
    } else {
      const dphi = (n.lat - k.phi) * 111320, dlam = (((n.lon - k.lam + 540) % 360) - 180) * 111320 * Math.cos(k.phi * Math.PI / 180);
      const uzak = Math.hypot(dphi, dlam);
      if (uzak > 100) {
        durumYaz(d, `${dosyaAdi}: dosyadaki nokta (${n.lat.toFixed(6)}, ${n.lon.toFixed(6)}) şu anki konumdan ${uzak.toFixed(0)} m uzakta; N kullanılmadı.`, "kotu");
        return;
      }
    }
    const model = (b.modelname || (icgemBekleyen && icgemBekleyen.model) || "?").replace(/^egm/, "EGM");
    nKayit.set("icgem", { model, N: n.N, not: ".dat dosyası" });
    durumYaz(d, `ICGEM sonucu okundu: ${model}, N = ${n.N.toFixed(4)} m.`, "iyi");
    sonucGuncelle();
  }

  async function dosyaOku(dosya) {
    if (!dosya) return;
    if (dosya.size > 5e6) { durumYaz($("k-icgem-durum"), "Dosya çok büyük; tek noktalık ICGEM .dat dosyası bekleniyor.", "kotu"); return; }
    datIsle(await dosya.text(), dosya.name);
  }
  $("k-dat").addEventListener("change", (e) => { dosyaOku(e.target.files[0]); e.target.value = ""; });
  const alan = $("k-dat-alani");
  alan.addEventListener("dragover", (e) => { e.preventDefault(); alan.classList.add("surukle"); });
  alan.addEventListener("dragleave", () => alan.classList.remove("surukle"));
  alan.addEventListener("drop", (e) => { e.preventDefault(); alan.classList.remove("surukle"); dosyaOku(e.dataTransfer.files[0]); });

  $("k-n-elle").addEventListener("input", () => {
    const v = $("k-n-elle").value.trim();
    if (v === "") nKayit.delete("elle");
    else { try { const N = sayi(v); if (Math.abs(N) > 150) throw new Error("N ±150 m aralığında olmalı."); nKayit.set("elle", { model: "-", N }); } catch (e) { nKayit.delete("elle"); } }
    sonucGuncelle();
  });

  // ---- aktarma
  function aktar(hedef) {
    const d = $("k-konum-durum");
    let k; try { k = konumOku(); } catch (e) { durumYaz(d, e.message, "kotu"); return; }
    const kk = { phi: k.phi, lam: k.lam, h: k.h };
    if (hedef === "cografi") { t1KonumYaz(kk); sekmeAc($("sekme-cografi")); }
    else { t2KonumYaz(kk); sekmeAc($("sekme-datum")); }
  }
  $("k-aktar-cografi").addEventListener("click", () => aktar("cografi"));
  $("k-aktar-datum").addEventListener("click", () => aktar("datum"));

  // ---- yukseklik kesiti (SVG)
  function kesitCiz(h, N, H) {
    const isN = N === null ? 1 : Math.sign(N) || 1;
    const ye = (x) => 238 - 10 * Math.sin(Math.PI * x / 400);
    const yg = (x) => ye(x) - isN * (50 + 9 * Math.sin(x / 37) + 6 * Math.sin(x / 23 + 1));
    const yt = (x) => 92 + 22 * Math.sin(x / 55) + 14 * Math.sin(x / 23 + 2) - 18 * Math.exp(-((x - 250) ** 2) / 1800);
    const yol = (f) => { let s = ""; for (let x = 0; x <= 400; x += 8) s += (x ? " L" : "M") + x + " " + f(x).toFixed(1); return s; };
    $("ks-elipsoit").setAttribute("d", yol(ye));
    $("ks-geoit").setAttribute("d", yol(yg));
    $("ks-arazi").setAttribute("d", yol(yt) + " L400 300 L0 300 Z");
    const xp = 250, yp = yt(xp);
    $("ks-nokta").setAttribute("cy", yp.toFixed(1));
    $("ks-p").setAttribute("y", (yp - 10).toFixed(1));
    $("ks-yazi-geoit").setAttribute("y", (yg(12) - 6).toFixed(1));
    $("ks-yazi-elipsoit").setAttribute("y", (ye(12) + (isN > 0 ? 16 : -6)).toFixed(1));
    const g = $("ks-oklar"); g.innerHTML = "";
    const ns = "http://www.w3.org/2000/svg";
    const ok = (sinif, x, y1, y2, etiket, sag) => {
      const gr = document.createElementNS(ns, "g"); gr.setAttribute("class", "ks-ok " + sinif);
      const l = document.createElementNS(ns, "line");
      l.setAttribute("x1", x); l.setAttribute("x2", x); l.setAttribute("y1", y1.toFixed(1)); l.setAttribute("y2", y2.toFixed(1));
      gr.appendChild(l);
      for (const y of [y1, y2]) {
        const t = document.createElementNS(ns, "line");
        t.setAttribute("x1", x - 5); t.setAttribute("x2", x + 5); t.setAttribute("y1", y.toFixed(1)); t.setAttribute("y2", y.toFixed(1));
        gr.appendChild(t);
      }
      const tx = document.createElementNS(ns, "text");
      tx.setAttribute("x", sag ? x + 9 : x - 9); tx.setAttribute("y", ((y1 + y2) / 2 + 5).toFixed(1));
      tx.setAttribute("text-anchor", sag ? "start" : "end"); tx.textContent = etiket;
      gr.appendChild(tx); g.appendChild(gr);
    };
    const kisa = (v) => (v === null ? "?" : v.toFixed(2) + " m");
    ok("h", xp - 22, ye(xp), yp, "h = " + kisa(h), false);
    ok("hh", xp, yg(xp), yp + 6, "H = " + kisa(H), true);
    ok("n", xp, ye(xp), yg(xp), "N = " + kisa(N), true);
  }

  // ---- sayfa acilirken izin zaten kapaliysa yolu hemen goster (Permissions API destekleniyorsa)
  try {
    if (navigator.permissions && navigator.permissions.query) {
      navigator.permissions.query({ name: "geolocation" }).then((izin) => {
        const uygula = () => {
          if (izin.state === "denied") { durumYaz($("k-konum-durum"), "Bu site için konum izni kapalı.", "kotu"); izinYardimGoster("k-izin-yardim"); }
          else { izinYardimGizle("k-izin-yardim"); if ($("k-konum-durum").textContent === "Bu site için konum izni kapalı.") durumYaz($("k-konum-durum"), ""); }
        };
        uygula();
        if (izin.addEventListener) izin.addEventListener("change", uygula); else izin.onchange = uygula;
      }).catch(() => { /* desteklenmiyor */ });
    }
  } catch (e) { /* desteklenmiyor */ }

  // ---- izgarayi yukle
  sonucGuncelle();
  G.izgaraYukle().then((v) => { izgaraVeri = v; izgaraHata = null; izgaraHesapla({ sessiz: true }); })
    .catch((e) => {
      izgaraHata = location.protocol === "file:"
        ? "Gömülü ızgara dosyadan açılan sayfada yüklenemez; siteyi GitHub Pages'ten ya da 'python -m http.server' ile açın."
        : "Gömülü ızgara yüklenemedi: " + e.message;
      sonucGuncelle();
    });

  // test ve hata ayiklama icin
  window.KD = { konumIste, hBul, demTahmin, get hKaynak() { return hKaynak; }, izgaraHesapla, datIsle, t1Geo2Cart, t1Cart2Geo, t2Donustur, parametreleriGuncelle, nKayit, get izgaraVeri() { return izgaraVeri; } };
})();
