@echo off
setlocal
cd /d "%~dp0"
set "PYTHONUTF8=1"
echo =========================================
echo GEO532 - Ilk Kurulum (Windows)
echo =========================================
where python >nul 2>nul
if errorlevel 1 (
  echo HATA: Python komutu bulunamadi.
  echo Python 3.11 veya 3.12 yukleyin ve PATH'e ekleyin: https://www.python.org/downloads/windows/
  pause
  exit /b 1
)
python --version
if exist ".venv\pyvenv.cfg" (
  echo Mevcut .venv bulundu. Baska bilgisayardan kopyalandiysa silip yeniden kurun.
) else (
  echo Yerel sanal ortam olusturuluyor...
  python -m venv .venv
  if errorlevel 1 goto :hata
)
".venv\Scripts\python.exe" -m pip install --upgrade pip
if errorlevel 1 goto :hata
".venv\Scripts\python.exe" -m pip install -r requirements.txt
if errorlevel 1 goto :hata
echo.
echo Kurulum tamam. Simdi BASLAT.bat dosyasini acabilirsiniz.
pause
exit /b 0
:hata
echo.
echo Kurulum BASARISIZ. Yukaridaki hata metnini inceleyin.
pause
exit /b 1
