@echo off
setlocal EnableExtensions

rem ================================================================
rem EOSIAL LFMC database updater for Windows Task Scheduler
rem
rem Recommended Task Scheduler setup:
rem   Program/script: F:\Valerio\eosial-viewer\scripts\run_lfmc_update.bat
rem   Start in:       F:\Valerio\eosial-viewer
rem   Trigger:        Repeat after your LFMC product creator completes
rem ================================================================

set "REPO_ROOT=F:\Valerio\eosial-viewer"
set "LFMC_SOURCE_DIR=U:\ftp\fireurisk\lfmc\products\viirs_vnp09h1\europe"
set "LFMC_AOI_NAME=Europe"
set "CONDA_HOOK=C:\ProgramData\miniconda3\shell\condabin\conda-hook.ps1"
set "CONDA_ENV=eosial-viewer"
set "LOG_DIR=%REPO_ROOT%\logs"
set "LOG_FILE=%LOG_DIR%\lfmc_update.log"

if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"

echo.
echo ================================================================
echo [%date% %time%] Starting EOSIAL LFMC database update
echo Repo:   %REPO_ROOT%
echo Source: %LFMC_SOURCE_DIR%
echo AOI:    %LFMC_AOI_NAME%
echo Log:    %LOG_FILE%
echo ================================================================
echo.

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference = 'Continue';" ^
  "$repo = '%REPO_ROOT%';" ^
  "$source = '%LFMC_SOURCE_DIR%';" ^
  "$aoi = '%LFMC_AOI_NAME%';" ^
  "$hook = '%CONDA_HOOK%';" ^
  "$envPath = '%CONDA_ENV%';" ^
  "$log = '%LOG_FILE%';" ^
  "function LogLine([string]$msg) { $line = '[' + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + '] ' + $msg; $line | Tee-Object -FilePath $log -Append }" ^
  "LogLine 'Batch wrapper started.';" ^
  "LogLine ('Repository: ' + $repo);" ^
  "LogLine ('LFMC source: ' + $source);" ^
  "LogLine ('LFMC AOI: ' + $aoi);" ^
  "if (-not (Test-Path -LiteralPath $repo)) { LogLine ('ERROR: repository path not found: ' + $repo); exit 10 }" ^
  "if (-not (Test-Path -LiteralPath $source)) { LogLine ('ERROR: LFMC source path not found: ' + $source); exit 11 }" ^
  "if (-not (Test-Path -LiteralPath $hook)) { LogLine ('ERROR: conda hook not found: ' + $hook); exit 12 }" ^
  "Set-Location -LiteralPath $repo;" ^
  "LogLine 'Activating conda environment...';" ^
  "& $hook;" ^
  "conda activate $envPath;" ^
  "if ($LASTEXITCODE -ne 0) { LogLine ('ERROR: conda activation failed with exit code ' + $LASTEXITCODE); exit $LASTEXITCODE }" ^
  "LogLine 'Running LFMC updater...';" ^
  "python -u scripts\update_lfmc_database.py --source-dir $source --aoi-name $aoi --git 2>&1 | Tee-Object -FilePath $log -Append;" ^
  "$code = $LASTEXITCODE;" ^
  "if ($code -ne 0) { LogLine ('ERROR: LFMC updater failed with exit code ' + $code); exit $code }" ^
  "LogLine 'LFMC updater finished successfully.'" ^
  "exit $code"

set "EXIT_CODE=%ERRORLEVEL%"

echo.
echo [%date% %time%] LFMC database update finished with exit code %EXIT_CODE%.
echo See log: %LOG_FILE%
echo.

exit /b %EXIT_CODE%
