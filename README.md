# ICGEM proxy (isteğe bağlı)

ICGEM (icgem.gfz.de) tarayıcılara başka sitelerden veri okuma izni (CORS) vermez. Bu yüzden GitHub Pages'teki site ICGEM'e hesap isteğini gönderebilir ama sonucu kendisi okuyamaz. Bu klasördeki küçük Cloudflare Worker isteği sunucu tarafında yapar ve sonucu siteye CORS başlığıyla döndürür. Kurulursa sitedeki **ICGEM'den iste** düğmesi tamamen otomatik çalışır; kurulmazsa site ICGEM'i yeni sekmede açar ve sonuç dosyası (`.dat`) sayfaya bırakılır.

```
GET https://icgem-proxy.<hesabınız>.workers.dev/?lat=39.925&lon=32.8369&model=EGM2008
→ {"N": 37.6026117694, "model": "EGM2008", "id": "...", "sure_s": 24, ...}
```

Desteklenen modeller: `EGM2008`, `XGM2019e_2159`, `EIGEN-6C4`, `SGG-UGM-2`, `EGM96`. Fonksiyonel `geoid`, referans sistem WGS84, sıfırıncı derece terimi dahil.

## Kurulum (ücretsiz Cloudflare hesabı, ~5 dakika)

**Panelden:**

1. [dash.cloudflare.com](https://dash.cloudflare.com) → **Workers & Pages** → **Create** → **Create Worker**. Ad olarak `icgem-proxy` yazıp **Deploy**'a basın.
2. **Edit code**'a girin, editördeki kodu silip `worker.js` dosyasının içeriğini yapıştırın, **Deploy**'a basın.
3. Worker'ın **Settings → Variables and Secrets** bölümüne `IZINLI_KOKEN = https://salihtatci.github.io` değişkenini ekleyin (yalnız sizin siteniz kullanabilsin diye).

**Komut satırından:**

```bash
cd icgem-proxy
npx wrangler login
npx wrangler deploy
```

## Siteye bağlama

`docs/js/config.js` dosyasında adresi yazın ve depoya yükleyin:

```js
window.KD_AYAR = {
  icgemProxyUrl: "https://icgem-proxy.<hesabınız>.workers.dev",
};
```

## Deneme

Tarayıcıda `https://icgem-proxy.<hesabınız>.workers.dev/?lat=39.925&lon=32.8369` adresini açın. Yaklaşık 25 saniye sonra `"N": 37.6026...` dönmelidir.

Yerel test (Node 18+, internet gerekmez; ICGEM'in davranışını taklit eden bir sunucu kullanır):

```bash
node icgem-proxy/test_worker.mjs
```

## Nasıl çalışır

ICGEM'in nokta hesap formu (`/calcpoints`) incelenerek çıkarılan akış:

1. `POST /calcsrvpoints` (multipart form, tek satırlık nokta dosyası) → `302`, `Location: .../calc_stat/<64 haneli iş kimliği>`
2. `GET /calc_res_points/<kimlik>` → hesap bitene kadar `404`, bitince ICGEM `.dat` metni
3. `.dat` içindeki 5. sütun (geoid, metre) `N` olarak döndürülür.

Her istek ICGEM'de gerçek bir hesap başlatır; servisi gereksiz yere yormamak için site isteği yalnızca düğmeye basıldığında gönderir. ICGEM yoğunluk nedeniyle yeni hesap kabul etmezse proxy `502` ve ICGEM'in mesajını döndürür.
