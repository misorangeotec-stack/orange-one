@echo off
rem Nightly Expense Analysis (CFO) load - scheduled task "Orange Hub - Expense CFO loader" (22:00).
rem Output appends to .tmp\expense_cfo_loader.log; the page shows the newest finished load.
cd /d "%~dp0.."
if not exist .tmp mkdir .tmp
echo ===== %date% %time% >> .tmp\expense_cfo_loader.log
"C:\Users\account2\AppData\Local\Programs\Python\Python312\python.exe" tools\expense_cfo_loader.py >> .tmp\expense_cfo_loader.log 2>&1
