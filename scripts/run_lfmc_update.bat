@echo off
setlocal EnableExtensions

rem ================================================================
rem EOSIAL LFMC database updater for Windows Task Scheduler
rem
rem Updates all LFMC AOIs currently produced by the operational LFMC
rem pipeline. Each source directory is scanned incrementally; new or
rem changed GeoTIFFs are converted to web COGs, the LFMC manifest and
rem statistics are refreshed, and data/lfmc changes are committed/pushed.
rem ================================================================

set "REPO_ROOT=F:\Valerio\eosial-viewer"
set "EUROPE_LFMC_SOURCE=U:\ftp\fireurisk\lfmc\products\viirs_vnp09h1\europe"
set "WUSA_LFMC_SOURCE=U:\ftp\fireurisk\lfmc\products\viirs_vnp09h1\western_usa"
set "CONDA_HOOK=C:\ProgramData\miniconda3\shell\condabin\conda-hook.ps1"
set "CONDA_ENV=eosial-viewer"
set "LOG_DIR=%REPO_ROOT%\logs"

if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"
for /f %%T in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd_HHmmss"') do set "RUN_TAG=%%T"
set "LOG_FILE=%LOG_DIR%\lfmc_update_%RUN_TAG%.log"

echo.
echo ================================================================
echo [%date% %time%] Starting EOSIAL LFMC database update
echo Repo:          %REPO_ROOT%
echo Europe source: %EUROPE_LFMC_SOURCE%
echo WUSA source:   %WUSA_LFMC_SOURCE%
echo Log:           %LOG_FILE%
echo ================================================================
echo.

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference = 'Continue';" ^
  "$repo = '%REPO_ROOT%';" ^
  "$hook = '%CONDA_HOOK%';" ^
  "$envPath = '%CONDA_ENV%';" ^
  "$log = '%LOG_FILE%';" ^
  "$targets = @(@{Name='Europe'; Source='%EUROPE_LFMC_SOURCE%'}, @{Name='Western USA'; Source='%WUSA_LFMC_SOURCE%'});" ^
  "function LogLine([string]$msg) { $line = '[' + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + '] ' + $msg; $line | Tee-Object -FilePath $log -Append }" ^
  "LogLine 'Batch wrapper started.';" ^
  "LogLine ('Repository: ' + $repo);" ^
  "foreach ($target in $targets) { LogLine ('LFMC source [' + $target.Name + ']: ' + $target.Source) }" ^
  "if (-not (Test-Path -LiteralPath $repo)) { LogLine ('ERROR: repository path not found: ' + $repo); exit 10 }" ^
  "if (-not (Test-Path -LiteralPath $hook)) { LogLine ('ERROR: conda hook not found: ' + $hook); exit 12 }" ^
  "foreach ($target in $targets) { if (-not (Test-Path -LiteralPath $target.Source)) { LogLine ('ERROR: LFMC source path not found for ' + $target.Name + ': ' + $target.Source); exit 11 } }" ^
  "Set-Location -LiteralPath $repo;" ^
  "LogLine 'Activating conda environment...';" ^
  "& $hook;" ^
  "conda activate $envPath;" ^
  "if ($LASTEXITCODE -ne 0) { LogLine ('ERROR: conda activation failed with exit code ' + $LASTEXITCODE); exit $LASTEXITCODE }" ^
  "foreach ($target in $targets) {" ^
  "  $aoi = $target.Name; $source = $target.Source;" ^
  "  LogLine ('Running LFMC updater for ' + $aoi + '...');" ^
  "  python -u scripts\update_lfmc_database.py --source-dir $source --aoi-name $aoi --git 2>&1 | Tee-Object -FilePath $log -Append;" ^
  "  $code = $LASTEXITCODE;" ^
  "  if ($code -ne 0) { LogLine ('ERROR: LFMC updater failed for ' + $aoi + ' with exit code ' + $code); exit $code }" ^
  "  LogLine ('LFMC updater finished successfully for ' + $aoi + '.');" ^
  "}" ^
  "LogLine 'All LFMC AOI updates finished successfully.';" ^
  "exit 0"

set "EXIT_CODE=%ERRORLEVEL%"

echo.
echo [%date% %time%] LFMC database update finished with exit code %EXIT_CODE%.
echo See log: %LOG_FILE%
echo.

exit /b %EXIT_CODE%
