@echo off
setlocal EnableExtensions

rem ================================================================
rem SFIDE website database updater for Windows Task Scheduler
rem
rem Recommended Task Scheduler setup:
rem   Program/script: F:\Valerio\eosial-viewer\scripts\run_sfide_update.bat
rem   Start in:       F:\Valerio\eosial-viewer
rem   Trigger:        Repeat every 30 minutes
rem ================================================================

set "REPO_ROOT=F:\Valerio\eosial-viewer"
set "SOURCE_DIR=U:\ftp\sfide\ITA"
set "OUTPUT_DIR=%REPO_ROOT%\data\fire"
set "CONDA_HOOK=C:\ProgramData\miniconda3\shell\condabin\conda-hook.ps1"
set "CONDA_ENV=C:\Users\EOSIAL\.conda\envs\lfmcenv"
set "LOG_DIR=%REPO_ROOT%\logs"
set "LOG_FILE=%LOG_DIR%\sfide_update.log"

if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"

echo.
echo ================================================================
echo [%date% %time%] Starting SFIDE website database update
echo Repo:   %REPO_ROOT%
echo Source: %SOURCE_DIR%
echo Output: %OUTPUT_DIR%
echo Log:    %LOG_FILE%
echo ================================================================
echo.

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference = 'Continue';" ^
  "$repo = '%REPO_ROOT%';" ^
  "$source = '%SOURCE_DIR%';" ^
  "$output = '%OUTPUT_DIR%';" ^
  "$hook = '%CONDA_HOOK%';" ^
  "$envPath = '%CONDA_ENV%';" ^
  "$log = '%LOG_FILE%';" ^
  "function LogLine([string]$msg) { $line = '[' + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + '] ' + $msg; $line | Tee-Object -FilePath $log -Append }" ^
  "LogLine 'Batch wrapper started.';" ^
  "LogLine ('Repository: ' + $repo);" ^
  "LogLine ('SFIDE source: ' + $source);" ^
  "LogLine ('Website output: ' + $output);" ^
  "if (-not (Test-Path -LiteralPath $repo)) { LogLine ('ERROR: repository path not found: ' + $repo); exit 10 }" ^
  "if (-not (Test-Path -LiteralPath $source)) { LogLine ('ERROR: SFIDE source path not found: ' + $source); exit 11 }" ^
  "if (-not (Test-Path -LiteralPath $hook)) { LogLine ('ERROR: conda hook not found: ' + $hook); exit 12 }" ^
  "Set-Location -LiteralPath $repo;" ^
  "LogLine 'Activating conda environment...';" ^
  "& $hook;" ^
  "conda activate $envPath;" ^
  "if ($LASTEXITCODE -ne 0) { LogLine ('ERROR: conda activation failed with exit code ' + $LASTEXITCODE); exit $LASTEXITCODE }" ^
  "LogLine 'Running updater...';" ^
  "python -u scripts\update_sfide_database.py --source-dir $source --output-dir $output --output-format fgb --git --progress-interval-seconds 5 2>&1 | Tee-Object -FilePath $log -Append;" ^
  "$code = $LASTEXITCODE;" ^
  "if ($code -eq 0) { LogLine 'Updater finished successfully.' } else { LogLine ('ERROR: updater failed with exit code ' + $code) }" ^
  "exit $code"

set "EXIT_CODE=%ERRORLEVEL%"

echo.
echo [%date% %time%] SFIDE update finished with exit code %EXIT_CODE%.
echo See log: %LOG_FILE%
echo.

exit /b %EXIT_CODE%
