@echo off
chcp 65001 >nul
setlocal EnableExtensions

title FolioLedger 本機預覽伺服器
cd /d "%~dp0"

set "PORT=3000"
set "URL=http://localhost:%PORT%"

echo ==================================================
echo   FolioLedger 一鍵本機啟動工具
echo   專案路徑: %CD%
echo ==================================================
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo [錯誤] 找不到 Node.js，請先安裝 Node.js LTS 版本後再執行。
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo [安裝] 偵測到尚未安裝依賴套件，正在執行 npm install...
  call npm.cmd install
  if errorlevel 1 (
    echo [錯誤] npm install 失敗，請檢查網路或 Node.js 環境。
    pause
    exit /b 1
  )
)

netstat -ano 2>nul | findstr /R /C:":%PORT% .*LISTENING" >nul
if not errorlevel 1 (
  echo [資訊] 偵測到 %URL% 已在執行中，直接為您開啟瀏覽器...
  start "" "%URL%"
  timeout /t 2 >nul
  exit /b 0
)

echo [啟動中] 正在啟動 Next.js 本機伺服器 (%URL%) ...
echo          就緒後將自動開啟瀏覽器；關閉此視窗或按 Ctrl+C 即可停止。
echo.

start "" /b powershell -NoProfile -WindowStyle Hidden -Command "$deadline=(Get-Date).AddSeconds(30); while((Get-Date) -lt $deadline){ try{ $r=Invoke-WebRequest -Uri '%URL%' -UseBasicParsing -TimeoutSec 2; if($r.StatusCode -ge 200){ break } }catch{}; Start-Sleep -Milliseconds 600 }; Start-Process '%URL%'"

call npm.cmd run dev

echo.
echo 伺服器已停止。
pause
endlocal
