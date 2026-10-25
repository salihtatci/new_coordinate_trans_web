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
  /** Tarayicidan konum ister. Dondurur Promise<{phi, lam, h|null, dogruluk, yDogruluk}> */
  function konumIste() {
    return new Promise((coz, reddet) => {
      if (!("geolocation" in navigator)) return reddet(new Error("Bu tarayıcı konum servisini desteklemiyor."));
      if (window.isSecureContext === false)
        return reddet(new Error("Konum yalnızca güvenli bağlantıda (https) alınabilir. Sayfayı GitHub Pages adresinden açın."));
      navigator.geolocation.getCurrentPosition(
        (p) => coz({
          phi: p.coords.latitude, lam: p.coords.longitude,
          h: Number.isFinite(p.coords.altitude) ? p.coords.altitude : null,
          dogruluk: p.coords.accuracy, yDogruluk: p.coords.altitudeAccuracy,
          zaman: new Date(p.timestamp),
        }),
        (err) => {
          const m = {
            1: "Konum izni verilmedi. Tarayıcının adres çubuğundaki konum simgesinden izin verip tekrar deneyin.",
            2: "Konum belirlenemedi. Cihazın konum servisinin açık olduğundan emin olun.",
            3: "Konum isteği zaman aşımına uğradı. Açık alanda tekrar deneyin.",
          }[err.code] || ("Konum alınamadı: " + err.message);
          reddet(new Error(m));
        },
        { enableHighAccuracy: true, timeout: 30000, maximumAge: 0 });
    });
  }
  const fmtKonum = (k) => ({ phi: k.phi.toFixed(8), lam: k.lam.toFixed(8), h: k.h === null ? "" : k.h.toFixed(3) });

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
    if (k.h !== null) t1Geo2Cart();
    else { $("t1-x").value = $("t1-y").value = $("t1-z").value = ""; $("t1-out").textContent = "Cihaz yükseklik vermedi: h kutusuna elipsoidal yüksekliği yazıp Coğrafi → Kartezyen'e basın."; }
  }
  $("t1-konum").addEventListener("click", async () => {
    const d = $("t1-konum-durum"); durumYaz(d, "Konum isteniyor…");
    try { const k = await konumIste(); t1KonumYaz(k); durumYaz(d, `Konum yazıldı (±${Math.round(k.dogruluk)} m), elipsoit WGS84.`, "iyi"); }
    catch (e) { durumYaz(d, e.message, "kotu"); }
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
    if (k.h !== null) t2Donustur();
    else $("t2-out").textContent = "Cihaz yükseklik vermedi: h kutusuna elipsoidal yüksekliği yazıp Dönüştür'e basın.";
  }
  $("t2-konum").addEventListener("click", async () => {
    const d = $("t2-konum-durum"); durumYaz(d, "Konum isteniyor…");
    try { const k = await konumIste(); t2KonumYaz(k); durumYaz(d, `Konum yazıldı (±${Math.round(k.dogruluk)} m), kaynak WGS84 (G2296).`, "iyi"); }
    catch (e) { durumYaz(d, e.message, "kotu"); }
  });

  // ================================================================== KONUM VE ORTOMETRIK YUKSEKLIK
  secenekler($("k-model"), Object.keys(G.ICGEM_MODELLER), "EGM2008");
  let izgaraVeri = null, izgaraHata = null;
  const nKayit = new Map();       // kaynak -> {etiket, model, N}
  let icgemBekleyen = null;       // yeni sekmede gonderilen istek {phi, lam, model}
  let proxyIptal = null;
  const ETIKET = { icgem: "ICGEM (canlı)", izgara: "Gömülü ICGEM ızgarası", elle: "Elle girilen" };

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

  function konumDegisti() {            // phi/lambda degisti: eski ICGEM/elle sonuclari bu noktaya ait degil
    nKayit.delete("icgem"); nKayit.delete("elle"); $("k-n-elle").value = "";
    izgaraHesapla({ sessiz: true });
  }
  let zamanlayici = null;
  for (const id of ["k-phi", "k-lam"]) $(id).addEventListener("input", () => { clearTimeout(zamanlayici); zamanlayici = setTimeout(konumDegisti, 300); });
  $("k-h").addEventListener("input", sonucGuncelle);

  $("k-konum-al").addEventListener("click", async () => {
    const d = $("k-konum-durum"), btn = $("k-konum-al");
    btn.disabled = true; durumYaz(d, "Konum isteniyor… (tarayıcı izin sorabilir)");
    try {
      const k = await konumIste();
      const f = fmtKonum(k);
      $("k-phi").value = f.phi; $("k-lam").value = f.lam; $("k-h").value = f.h;
      $("k-dogruluk").textContent = `Yatay doğruluk ±${k.dogruluk.toFixed(0)} m` +
        (k.h === null ? ". Cihaz yükseklik vermedi; h'yi elle yazın." :
          (Number.isFinite(k.yDogruluk) ? `, düşey doğruluk ±${k.yDogruluk.toFixed(0)} m.` : ", düşey doğruluk bildirilmedi.")) +
        ` Zaman ${k.zaman.toLocaleTimeString("tr-TR")}.`;
      konumDegisti();
      t1KonumYaz(k); t2KonumYaz(k);
      durumYaz(d, "Konum alındı ve dönüşüm sekmelerine de yazıldı.", "iyi");
    } catch (e) { durumYaz(d, e.message, "kotu"); }
    finally { btn.disabled = false; }
  });

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
  window.KD = { konumIste, izgaraHesapla, datIsle, t1Geo2Cart, t1Cart2Geo, t2Donustur, parametreleriGuncelle, nKayit, get izgaraVeri() { return izgaraVeri; } };
})();
