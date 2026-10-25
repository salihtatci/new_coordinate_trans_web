/*
 * ICGEM proxy - Cloudflare Worker
 * ================================
 * ICGEM (icgem.gfz.de) tarayicilara CORS izni vermedigi icin GitHub Pages'teki site
 * ICGEM'in cevabini dogrudan okuyamaz. Bu Worker ICGEM'in nokta hesap servisini
 * sunucu tarafinda cagirir ve sonucu CORS basligiyla JSON olarak dondurur.
 *
 *   GET /?lat=39.925&lon=32.8369&model=EGM2008
 *   -> {"N": 37.6026117694, "model": "EGM2008", "id": "...", "lat": 39.925, "lon": 32.8369, ...}
 *
 * ICGEM akisi (icgem.gfz.de/calcpoints formundan cikarildi, 2026-10-25):
 *   1) POST /calcsrvpoints (multipart, nokta dosyasi)  -> 302 Location .../calc_stat/<id>
 *   2) GET  /calc_res_points/<id>  -> hesap bitene kadar 404, sonra ICGEM .dat metni
 */

const MODELLER = {
  "EGM2008": { id: "c50128797a9cb62e936337c890e4425f03f0461d7329b09a8cc8561504465340", derece: 2190 },
  "XGM2019e_2159": { id: "eeb03971cf6e533e6eeb6b010336463286dcda0846684248d5530acf8e800055", derece: 2190 },
  "EIGEN-6C4": { id: "7fd8fe44aa1518cd79ca84300aef4b41ddb2364aef9e82b7cdaabdb60a9053f1", derece: 2190 },
  "SGG-UGM-2": { id: "3b3a7e227093cbad89bbe33f515c3f2d762b24392b64cabffd890cc016293526", derece: 2190 },
  "EGM96": { id: "971b0a3b49a497910aad23cd85e066d4cd9af0aeafe7ce6301a696bed8570be3", derece: 360 },
};
const BEKLEME_MS = 3000;     // yoklama araligi
const AZAMI_YOKLAMA = 40;    // 40 x 3 s = 120 s (ucretsiz planda istek basina 50 alt istek siniri)

const uyu = (ms) => new Promise((r) => setTimeout(r, ms));

function corsBasliklari(istek, env) {
  const izinli = (env.IZINLI_KOKEN || "*").split(",").map((s) => s.trim()).filter(Boolean);
  const koken = istek.headers.get("Origin") || "";
  const ver = izinli.includes("*") ? "*" : (izinli.includes(koken) ? koken : izinli[0]);
  return {
    "Access-Control-Allow-Origin": ver,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin",
  };
}

function json(govde, durum, basliklar) {
  return new Response(JSON.stringify(govde), {
    status: durum,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...basliklar },
  });
}

/** ICGEM .dat metninden ilk noktanin N degerini ve basligi cikarir. */
export function datCoz(metin) {
  const i = metin.indexOf("end_of_head");
  if (i < 0) throw new Error("ICGEM sonucu taninamadi");
  const baslik = {};
  for (const satir of metin.slice(0, i).split(/\r?\n/)) {
    const m = satir.trim().match(/^([A-Za-z_]+)\s+(.+)$/);
    if (m) baslik[m[1]] = m[2].trim();
  }
  for (const satir of metin.slice(metin.indexOf("\n", i) + 1).split(/\r?\n/)) {
    const p = satir.trim().split(/\s+/);
    if (p.length >= 5) {
      const N = Number(p[4]);
      if (Number.isFinite(N)) return { N, lon: Number(p[1]), lat: Number(p[2]), baslik };
    }
  }
  throw new Error("ICGEM sonucunda nokta satiri yok");
}

export default {
  async fetch(istek, env = {}) {
    const cors = corsBasliklari(istek, env);
    if (istek.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (istek.method !== "GET") return json({ hata: "Yalnizca GET desteklenir." }, 405, cors);

    const icgem = (env.ICGEM_URL || "https://icgem.gfz.de").replace(/\/$/, "");
    const u = new URL(istek.url);
    const lat = Number(u.searchParams.get("lat"));
    const lon = Number(u.searchParams.get("lon"));
    const modelAd = u.searchParams.get("model") || "EGM2008";
    if (!u.searchParams.has("lat") || !Number.isFinite(lat) || lat < -90 || lat > 90)
      return json({ hata: "lat -90..90 araliginda bir sayi olmali." }, 400, cors);
    if (!u.searchParams.has("lon") || !Number.isFinite(lon) || lon < -180 || lon > 360)
      return json({ hata: "lon -180..360 araliginda bir sayi olmali." }, 400, cors);
    const model = MODELLER[modelAd];
    if (!model) return json({ hata: "Desteklenmeyen model: " + modelAd, modeller: Object.keys(MODELLER) }, 400, cors);

    // 1) hesap istegi
    const fd = new FormData();
    const alanlar = {
      sel_type: "longtime", sel_model: model.id, points_format: "i_lat_lon",
      sel_func: "geoid", sel_refsys: "WGS84", sel_tidesys: "unmodified", zero_term: "on",
      trunc_gentle: String(model.derece), trunc_max: String(model.derece),
      filter: "none", flength: "1.0", funit: "degree",
    };
    for (const [k, v] of Object.entries(alanlar)) fd.append(k, v);
    fd.append("points_file", new Blob([`1 ${lat.toFixed(8)} ${lon.toFixed(8)}\n`], { type: "text/plain" }), "nokta.txt");

    let id;
    try {
      const r = await fetch(icgem + "/calcsrvpoints", { method: "POST", body: fd, redirect: "manual" });
      const konum = r.headers.get("Location") || "";
      const m = konum.match(/calc_stat\/?#?([0-9a-f]{64})/i);
      if (!m) {
        const metin = (await r.text().catch(() => "")).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
        return json({ hata: `ICGEM hesap istegini kabul etmedi (HTTP ${r.status}).`, ayrinti: metin.slice(0, 300) }, 502, cors);
      }
      id = m[1].toLowerCase();
    } catch (e) {
      return json({ hata: "ICGEM'e ulasilamadi: " + e.message }, 502, cors);
    }

    // 2) sonucu bekle
    const bas = Date.now();
    for (let n = 0; n < AZAMI_YOKLAMA; n++) {
      let r;
      try { r = await fetch(`${icgem}/calc_res_points/${id}`); } catch (e) { await uyu(BEKLEME_MS); continue; }
      if (r.ok) {
        try {
          const s = datCoz(await r.text());
          return json({
            N: s.N, lat: s.lat, lon: s.lon, model: modelAd, id,
            refsys: s.baslik.refsysname || "WGS84", tide_system: s.baslik.tide_system || "",
            max_degree: Number(s.baslik.max_used_degree) || model.derece,
            sure_s: Math.round((Date.now() - bas) / 1000),
            sonuc_url: `${icgem}/calc_res/${id}`,
          }, 200, cors);
        } catch (e) {
          return json({ hata: e.message, id }, 502, cors);
        }
      }
      if (r.status !== 404) return json({ hata: `ICGEM sonuc sayfasi HTTP ${r.status} dondurdu.`, id }, 502, cors);
      await uyu(BEKLEME_MS);
    }
    return json({ hata: "ICGEM hesabi zamaninda bitmedi; biraz sonra tekrar deneyin.", id, sonuc_url: `${icgem}/calc_res/${id}` }, 504, cors);
  },
};
