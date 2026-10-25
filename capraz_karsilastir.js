/* capraz_karsilastir.js - capraz_uret.py ciktisini docs/js/jeodezi.js ile karsilastirir. */
const path = require("path");
const jz = require(path.join(__dirname, "..", "docs", "js", "jeodezi.js"));
const cases = require("./capraz_vakalar.json");
const kat = (x) => String(x).replace(/[çğıöşüÇĞİÖŞÜîâû]/g, (c) => ({î:"i",â:"a",û:"u",ç:"c",ğ:"g",ı:"i",ö:"o",ş:"s",ü:"u",Ç:"C",Ğ:"G",İ:"I",Ö:"O",Ş:"S",Ü:"U"})[c]).replace(/Proje veritabani \(ozdeslik kabulu; NGA resmi donusum yayinlamaz\)/g, "Project database (ozdeslik kabulu; NGA resmi donusum yayinlamaz)");
let hata = 0, maxd = 0, n = 0, nayr = 0;
const d = (a, b) => Math.max(...a.map((x, i) => Math.abs(x - b[i])));
for (const c of cases) {
  if (c.aci) { const v = jz.aciOku(c.aci); if (Math.abs(v - c.deger) > 1e-13 || jz.dms(v) !== c.dms) { hata++; console.log("ACI", c, v, jz.dms(v)); } continue; }
  const e = jz.parametreBul(c.k, c.h, c.m, c.ep);
  const bad = [];
  if (e.bulundu !== c.bulundu) bad.push("bulundu");
  if (e.yon !== c.yon) bad.push("yon");
  if (kat(e.kurum) !== kat(c.kurum)) bad.push("kurum " + e.kurum + " / " + c.kurum);
  if (kat(e.kod) !== kat(c.kod)) bad.push("kod");
  if (kat(e.mesaj) !== kat(c.mesaj)) bad.push("mesaj");
  if (e.ters !== c.ters) bad.push("ters");
  if ((e.T === null) !== (c.T === null) || (e.T && d(e.T, c.T) > 1e-9)) bad.push("T");
  if ((e.D === null) !== (c.D === null) || (e.D !== null && Math.abs(e.D - c.D) > 1e-12)) bad.push("D");
  if ((e.R === null) !== (c.R === null) || (e.R && d(e.R, c.R) > 1e-12)) bad.push("R");
  if (JSON.stringify(e.merkez) !== JSON.stringify(c.merkez)) bad.push("merkez");
  const nrm = (a) => kat(JSON.stringify(a)).replace(/-0\.0(?![0-9])/g, "0.0").replace(/=0 ppb/g, "=0.0 ppb").replace(/=-0 ppb/g, "=0.0 ppb");
  if (nrm(e.ayrinti) !== nrm(c.ayrinti)) { nayr++; if (nayr < 4) console.log("AYRINTI farki", c.k, c.h, c.m, "\nJS:", e.ayrinti, "\nPY:", c.ayrinti); }
  if (c.bulundu) {
    const [X2] = jz.donustur(c.X, c.k, c.h, c.m, c.ep);
    const dd = d(X2, c.X2); maxd = Math.max(maxd, dd); if (dd > 1e-8) bad.push("X2 " + dd);
    const g = jz.cartToGeo(...X2, jz.SISTEMLER[c.h]); const gb = jz.cartToGeo(...X2, jz.SISTEMLER[c.h], "bowring");
    if (Math.abs(g[0]-c.geo2[0])>1e-12 || Math.abs(g[1]-c.geo2[1])>1e-12 || Math.abs(g[2]-c.geo2[2])>1e-8) bad.push("geo");
    if (Math.abs(gb[0]-c.geo2b[0])>1e-12 || Math.abs(gb[2]-c.geo2b[2])>1e-8) bad.push("geoB");
    n++;
  }
  if (bad.length) { hata++; if (hata < 10) console.log(c.k, "->", c.h, c.m, c.ep, bad); }
}
console.log(`vaka=${cases.length} donusum=${n} hata=${hata} ayrinti_farki=${nayr} maxXYZfark=${maxd.toExponential(2)} m`);
process.exit(hata || nayr ? 1 : 0);
