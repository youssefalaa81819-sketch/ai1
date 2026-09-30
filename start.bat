@echo off
title TOFA7-AI Launcher
echo ====================================================
echo      TOFA7-AI (نظام تفاحة للذكاء الاصطناعي الذاتي)
echo ====================================================
echo Starting local AI server...
start http://localhost:3000
node server.js
pause
