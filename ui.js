/*
 * ui.js - yalnizca gorunumle ilgili kucuk eklentiler (hesaplara dokunmaz)
 *  - rapor kartlarindaki "Kopyala" dugmesi
 *  - Konum sekmesindeki buyuk H degeri, #d-hh'yi izler
 */
"use strict";
(function () {
  // ---- raporu kopyala ----
  function kopyala(metin) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(metin);
    return new Promise(function (ok, hata) {
      try {
        var t = document.createElement("textarea");
        t.value = metin; t.setAttribute("readonly", ""); t.style.position = "fixed"; t.style.opacity = "0";
        document.body.appendChild(t); t.select();
        var basarili = document.execCommand("copy");
        document.body.removeChild(t);
        basarili ? ok() : hata(new Error("kopyalanamadi"));
      } catch (e) { hata(e); }
    });
  }
  document.querySelectorAll(".kopyala").forEach(function (b) {
    var yazi = b.querySelector("span");
    var ikon = b.querySelector("use");
    b.addEventListener("click", function () {
      var hedef = document.getElementById(b.dataset.hedef);
      if (!hedef) return;
      kopyala(hedef.textContent).then(function () {
        yazi.textContent = "Kopyalandı"; ikon.setAttribute("href", "#i-check");
      }, function () {
        yazi.textContent = "Kopyalanamadı";
      }).then(function () {
        setTimeout(function () { yazi.textContent = "Kopyala"; ikon.setAttribute("href", "#i-copy"); }, 1600);
      });
    });
  });

  // ---- buyuk H degeri ----
  var kaynak = document.getElementById("d-hh");
  var buyuk = document.getElementById("d-hh-buyuk");
  if (kaynak && buyuk) {
    var esitle = function () { buyuk.textContent = kaynak.textContent.replace(/\s*m$/, ""); };
    esitle();
    new MutationObserver(esitle).observe(kaynak, { childList: true, characterData: true, subtree: true });
  }
})();
