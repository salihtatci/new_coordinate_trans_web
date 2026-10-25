# Koordinat Dönüşüm Uygulaması (Python + Kivy) — Öğrenme Rehberi

Bu rehber, uygulamayı **adım adım nasıl kurduğumuzu** ve **neden öyle yaptığımızı** anlatır.

---

## 0. Çalıştırma

```powershell
# 1) Sanal ortam (projeye özel, temiz bir Python kurulumu)
python -m venv .venv
# 2) Kivy'yi kur  (Türkçe karakterli klasör yolu yüzünden UTF-8 modunu açıyoruz)
$env:PYTHONUTF8="1"
.venv\Scripts\python -m pip install "kivy[base]"
# 3) Testler (önce matematiğin doğru olduğundan emin ol)
.venv\Scripts\python test_jeodezi.py
# 4) Uygulama
.venv\Scripts\python main.py
```

> Kurulumdan sonra **internet gerekmez**: hesapların hepsi `math` ile yerelde yapılır.

---

## 1. Proje yapısı — neden iki dosya?

| Dosya | Görevi |
|---|---|
| `jeodezi.py` | **Sadece matematik.** Kivy'yi hiç bilmez. |
| `main.py` | **Sadece arayüz.** Hesap için `jeodezi`'yi çağırır. |
| `test_jeodezi.py` | Bilinen örneklerle (EPSG) doğrulama + otomatik parametre senaryoları. |
| `test_arayuz.py` | Kivy arayüzünde otomatik parametre doldurma senaryoları (gizli pencere). |

Bu ayrıma **"iş mantığını arayüzden ayırmak"** denir. Faydası: hesabı arayüz olmadan test
edebilirsin, yarın Tkinter/web arayüzü yazsan da `jeodezi.py` aynen kalır.
Ayrıca numpy kullanmadık → Android'e paketlemek çok kolaylaşır.

---

## 2. Jeodezik kavramlar (en çok karıştırılan nokta)

```
  Çerçeve / datum  ──►  X, Y, Z   (noktanın uzaydaki yeri)
  Elipsoit         ──►  φ, λ, h   (aynı XYZ'nin "yüzey" diliyle ifadesi)
```

- **ITRF2020, ITRF2014, WGS84(G2139), ETRF2000, ED50** → *çerçeve/datum*
- **GRS80, WGS84, Hayford** → *elipsoit*

Bu yüzden **"WGS84 → GRS80"** iki farklı şey olabilir:
1. *Sadece elipsoit değişimi* (aynı XYZ): fark en fazla ~0.1 mm → model: **Yalnız elipsoit değişimi**
2. *WGS84 çerçevesi → ITRF çerçevesi*: IERS parametreleri ile → model: **IERS 14-parametre**

---

## 3. Coğrafi ⇄ Kartezyen (`jeodezi.geo_to_cart`, `cart_to_geo`)

**İleri (kapalı, kesin):**

$$N=\frac{a}{\sqrt{1-e^2\sin^2\varphi}},\quad
X=(N+h)\cos\varphi\cos\lambda,\quad Y=(N+h)\cos\varphi\sin\lambda,\quad Z=(N(1-e^2)+h)\sin\varphi$$

**Ters (iteratif):** φ, N'nin içinde de geçtiği için doğrudan çözülemez.
1. $\lambda=\operatorname{atan2}(Y,X)$ (kesin)
2. Başlangıç: $\varphi_0=\operatorname{atan2}(Z,\;p(1-e^2))$, $p=\sqrt{X^2+Y^2}$
3. Tekrarla: $N \to h=p/\cos\varphi-N \to \varphi=\operatorname{atan2}(Z,\;p(1-e^2N/(N+h)))$
4. Değişim < 1e-12 rad olunca dur (genelde 4-5 adım).

Uygulamada **Bowring** yöntemi de var: tek adımlık yaklaşık formül. İkisini karşılaştır!

---

## 4. Datum dönüşüm modelleri

| Model | Formül | Ne zaman? |
|---|---|---|
| **Bursa-Wolf** (7 p.) | $X_2 = T + (1+D)\,R\,X_1$ | Klasik datum dönüşümü (ED50→WGS84 vb.) |
| **Molodensky-Badekas** (7 p. + merkez) | $X_2 = X_m + T + (1+D)\,R\,(X_1-X_m)$ | Bölgesel ağ; T–R korelasyonu azalır |
| **IERS 14 p.** | $P(t)=P(t_0)+\dot P(t-t_0)$, sonra $X_2=X_1+T+DX_1+RX_1$ | ITRF'ler arası (zamana bağlı) |
| **7 p. hızsız** | IERS ama hızlar = 0 | Hızları ihmal etmenin hatasını görmek için |

**Dönüklük konvansiyonu tuzağı:** Aynı sayılar PV (Position Vector) ile CF (Coordinate Frame)
konvansiyonlarında **zıt işaretli** dönüklük demektir. Parametreyi aldığın kaynağın hangisini
kullandığına bak (IERS = PV).

**Zincirleme (`yol_bul`)**: Sistemleri bir **graf** olarak düşündük (düğüm = sistem, kenar =
bilinen dönüşüm). BFS ile en kısa yol bulunur, örn.
`WGS84(G2139) → ITRF2014 → ITRF2020 → ITRF96`. Ters yön için parametre işaretleri değişir.

---

## 5. Kivy'nin mantığı (`main.py`)

```python
class KoordinatApp(App):        # 1) Uygulama
    def build(self):
        Builder.load_string(KV) # 2) Görünüm KV dilinde
        return AnaPanel()       # 3) Ana widget (sekmeler)
```

KV dilinden bir parça:

```yaml
Giris:                       # <Giris@TextInput> şablonundan türetilmiş kutu
    id: t1_phi               # Python'da: self.ids.t1_phi.text
Dugme:
    text: 'Coğrafi -> Kartezyen'
    on_release: root.t1_geo2cart()   # basınca AnaPanel.t1_geo2cart() çalışır
Etiket:
    text: 'Enlem' if t2_tip.text == 'Cografi' else 'X (m)'   # otomatik güncellenir!
```

Son satır Kivy'nin en güçlü özelliği: **bağlama (binding)**. `t2_tip` değişince etiket kendiliğinden değişir.

---

## 6. Android'e paketleme (APK) — internetsiz telefonda çalıştırmak için

Buildozer **Linux** ister; Windows'ta **WSL (Ubuntu)** kullan:

```bash
pip install buildozer cython
buildozer init                  # buildozer.spec oluşur
# buildozer.spec içinde:
#   title = Koordinat Donusum
#   requirements = python3,kivy
#   source.include_exts = py,png,kv
buildozer -v android debug      # bin/ klasöründe .apk oluşur
```

`main.py` adı zorunludur — bu yüzden dosyayı öyle adlandırdık.

---

## 7. Kendini dene (alıştırmalar)

1. Ankara noktasını GRS80 ve WGS84 ile Kartezyen'e çevir; X, Y, Z farkını mm cinsinden yorumla.
2. ITRF2020 → ITRF96 dönüşümünü **IERS 14 p.** ve **7 p. hızsız** modelle 2025.0 epoğunda yap; fark kaç cm?
3. `Model Parametreleri` → *EPSG örneği* düğmesine bas; sonucu EPSG 7-2 dokümanındaki
   (3657660.78, 255778.43, 5201387.75) ile karşılaştır. Sonra konvansiyonu CF yap, ne değişti?
4. `jeodezi.py` içine yeni bir elipsoit (örn. *Clarke 1880*) ekle; arayüzde kendiliğinden çıktığını gör.
5. (İleri) `DONUSUMLER` sözlüğüne ITRF2014 → ITRF2000 parametrelerini ekle.

> ⚠️ Programdaki IERS/EUREF parametreleri ders amaçlıdır; resmi işlerde
> [itrf.ign.fr](https://itrf.ign.fr) ve EUREF tablolarıyla doğrula.
