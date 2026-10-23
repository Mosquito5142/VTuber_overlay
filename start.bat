@echo off
chcp 65001 >nul
rem ดับเบิลคลิกไฟล์นี้เพื่อเปิด Avata-Overlay
cd /d "%~dp0"
title Avata-Overlay

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  ไม่พบ Node.js ในเครื่อง
  echo  กำลังเปิดหน้าดาวน์โหลด ให้ติดตั้งรุ่น LTS แล้วดับเบิลคลิก start.bat อีกครั้ง
  echo.
  start "" https://nodejs.org/
  pause
  exit /b 1
)

set NEED_INSTALL=
if not exist "node_modules\ws" set NEED_INSTALL=1
if not exist "node_modules\uiohook-napi" set NEED_INSTALL=1
if defined NEED_INSTALL (
  echo.
  echo  กำลังติดตั้งส่วนประกอบ ^(ครั้งแรกใช้เวลาสักครู่ ต้องต่ออินเทอร์เน็ต^) ...
  echo.
  call npm install
  if errorlevel 1 (
    echo.
    echo  ติดตั้งไม่สำเร็จ ตรวจอินเทอร์เน็ตแล้วลองใหม่อีกครั้ง
    pause
    exit /b 1
  )
)

echo.
echo  กำลังเปิด Avata-Overlay ... เบราว์เซอร์จะเปิดหน้าควบคุมขึ้นมาเอง
echo  เปิดหน้าต่างนี้ค้างไว้ตลอดตอนสตรีม
echo.
call npm start
pause
