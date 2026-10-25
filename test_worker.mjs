/*
 * test_worker.mjs - worker.js'i ICGEM'in gercek davranisini taklit eden yerel bir sunucuya karsi dener.
 * Taklit edilen davranis (icgem.gfz.de uzerinde 2026-10-25'te gozlendi):
 *   POST /calcsrvpoints -> 302 Location: http://icgem.gfz.de/calc_stat/<64 hex id>
 *   GET  /calc_res_points/<id> -> hesap bitene kadar 404, sonra gzip'li .dat metni
 * Calistirma:  node icgem-proxy/test_worker.mjs            (Node 18+)
 *              node icgem-proxy/test_worker.mjs --sunucu   (yalnizca taklit sunucuyu baslatir; wrangler dev testi icin)
 */
import http from "node:http";
import zlib from "node:zlib";
import crypto from "node:crypto";
import worker, { datCoz } from "./worker.js";

const DAT = (lat, lon, N, model) => `        generated_by     ICGEM (hosted at GFZ-Potsdam)
           modelname     ${model}
     max_used_degree          2190
         tide_system     tide_free
          refsysname     WGS84
----------------------------------------------------------------------

end_of_head ================================================================
1             ${lon.toFixed(8)}   ${lat.toFixed(8)}  0.000000E+00  ${N.toExponential(12).replace("e+", "E+0")}
`;

export function taklitSunucu(port = 0, { yogun = false } = {}) {
  const isler = new Map();
  const kayit = [];
  const sunucu = http.createServer((req, res) => {
    kayit.push(req.method + " " + req.url);
    if (req.method === "POST" && req.url === "/calcsrvpoints") {
      const parcalar = [];
      req.on("data", (c) => parcalar.push(c));
      req.on("end", () => {
        const govde = Buffer.concat(parcalar).toString();
        if (yogun) { res.writeHead(200, { "Content-Type": "text/html" }); return res.end("<p>Due to high load, no new calculations are accepted.</p>"); }
        const alan = (ad) => (govde.match(new RegExp(`name="${ad}"\\r\\n\\r\\n([^\\r]*)`)) || [])[1];
        const nokta = govde.match(/filename="nokta.txt"\r\nContent-Type: text\/plain\r\n\r\n1 ([\d.\-]+) ([\d.\-]+)\n/);
        const dogru = alan("sel_func") === "geoid" && alan("sel_refsys") === "WGS84" && alan("zero_term") === "on" &&
          alan("points_format") === "i_lat_lon" && alan("trunc_max") && nokta;
        if (!dogru) { res.writeHead(400); return res.end("eksik alan"); }
        const id = crypto.createHash("sha256").update(govde.replace(/--[-\w]+/g, "")).digest("hex");
        isler.set(id, { lat: Number(nokta[1]), lon: Number(nokta[2]), sel_model: alan("sel_model"), kalan: 2 });
        res.writeHead(302, { Location: `http://icgem.gfz.de/calc_stat/${id}` });
        return res.end();
      });
      return;
    }
    const m = req.url.match(/^\/calc_res_points\/([0-9a-f]{64})$/);
    if (req.method === "GET" && m && isler.has(m[1])) {
      const is = isler.get(m[1]);
      if (is.kalan-- > 0) { res.writeHead(404, { "Content-Type": "text/html" }); return res.end("<html>404</html>"); }
      const N = 30 + is.lat / 10 + is.lon / 100;
      res.writeHead(200, { "Content-Type": "application/octet-stream", "Content-Encoding": "gzip" });
      return res.end(zlib.gzipSync(DAT(is.lat, is.lon, N, "EGM2008")));
    }
    res.writeHead(404); res.end("yok");
  });
  return new Promise((coz) => sunucu.listen(port, "127.0.0.1", () => coz({ sunucu, kayit, url: `http://127.0.0.1:${sunucu.address().port}` })));
}

function dogrula(k, m) { if (!k) throw new Error("BASARISIZ: " + m); }

async function testler() {
  // .dat ayristirici: ICGEM'in gercek ciktisi
  const gercek = DAT(39.925, 32.8369, 37.6026117694, "EGM2008").replace(/3\.\d+E\+01/, "3.760261176940E+01");
  dogrula(Math.abs(datCoz(gercek).N - 37.6026117694) < 1e-12, "datCoz");

  const { sunucu, kayit, url } = await taklitSunucu();
  const env = { ICGEM_URL: url, IZINLI_KOKEN: "https://salihtatci.github.io" };
  const istek = (q, yontem = "GET") => worker.fetch(new Request("https://proxy.test/?" + q, { method: yontem, headers: { Origin: "https://salihtatci.github.io" } }), env);
  try {
    let t0 = Date.now();
    let r = await istek("lat=39.925&lon=32.8369&model=EGM2008");
    let j = await r.json();
    dogrula(r.status === 200, "200 bekleniyordu: " + JSON.stringify(j));
    dogrula(Math.abs(j.N - (30 + 39.925 / 10 + 32.8369 / 100)) < 1e-9 && j.model === "EGM2008" && /^[0-9a-f]{64}$/.test(j.id), "N ve id: " + JSON.stringify(j));
    dogrula(r.headers.get("access-control-allow-origin") === "https://salihtatci.github.io", "CORS basligi");
    dogrula(kayit.filter((k) => k.startsWith("GET /calc_res_points")).length === 3, "2 kez 404 sonra 200: " + kayit);
    console.log(`OK  proxy akisi: POST -> 302 -> 404, 404 -> 200; N = ${j.N.toFixed(4)} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);

    r = await istek("lat=91&lon=30"); dogrula(r.status === 400, "gecersiz enlem");
    r = await istek("lat=40&lon=30&model=YOK"); dogrula(r.status === 400, "gecersiz model");
    r = await istek("lon=30"); dogrula(r.status === 400, "lat yok");
    r = await worker.fetch(new Request("https://proxy.test/", { method: "OPTIONS", headers: { Origin: "https://salihtatci.github.io" } }), env);
    dogrula(r.status === 204 && r.headers.get("access-control-allow-methods").includes("GET"), "OPTIONS");
    r = await istek("lat=40&lon=30", "POST"); dogrula(r.status === 405, "POST reddi");
    console.log("OK  girdi denetimi, OPTIONS ve yontem reddi");
  } finally { sunucu.close(); }

  const yogun = await taklitSunucu(0, { yogun: true });
  try {
    const r = await worker.fetch(new Request("https://proxy.test/?lat=40&lon=30"), { ICGEM_URL: yogun.url });
    const j = await r.json();
    dogrula(r.status === 502 && j.ayrinti.includes("high load") && r.headers.get("access-control-allow-origin") === "*", "yogunluk mesaji: " + JSON.stringify(j));
    console.log("OK  ICGEM hesap kabul etmezse anlasilir hata (502)");
  } finally { yogun.sunucu.close(); }

  const r = await worker.fetch(new Request("https://proxy.test/?lat=40&lon=30"), { ICGEM_URL: "http://127.0.0.1:9" });
  dogrula(r.status === 502 && (await r.json()).hata.includes("ulasilamadi"), "ulasilamaz sunucu");
  console.log("OK  ICGEM'e ulasilamazsa 502");
  console.log("\nTum proxy testleri gecti.");
}

if (process.argv.includes("--sunucu")) {
  const { url } = await taklitSunucu(8790);
  console.log("taklit ICGEM:", url);
} else {
  await testler();
}
