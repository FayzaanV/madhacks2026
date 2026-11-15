# Windows twin of scripts/cloud.sh. Turn Yomi's Databricks pieces on/off to save Free Edition compute.
#   .\scripts\cloud.ps1 down | up | refresh [-Ai] | status
param([ValidateSet("up", "down", "refresh", "status")][string]$Action = "status", [switch]$Ai)
$ErrorActionPreference = "Stop"

$Repo = Split-Path -Parent $PSScriptRoot
$App = "yomi"
$Warehouse = "cba268733f96d335"
$Endpoint = "projects/the-curve-ledger/branches/production/endpoints/primary"
function Db { Push-Location $HOME; try { databricks @args } finally { Pop-Location } }  # outside the repo

function Set-Db([string]$Disabled) {
  $body = "{`"spec`":{`"disabled`":$Disabled}}"
  try { Db postgres update-endpoint $Endpoint spec.disabled --json $body -o json | Out-Null; "  database: " + ($(if ($Disabled -eq "true") { "disabled" } else { "enabled" })) }
  catch { "  database: couldn't change it; it stays as is" }
}

function Show-Status {
  $a = Db apps get $App -o json | ConvertFrom-Json; "  website:   $($a.compute_status.state) | $($a.url)"
  $w = Db warehouses get $Warehouse -o json | ConvertFrom-Json; "  warehouse: $($w.state)"
  $e = (Db postgres get-endpoint $Endpoint -o json | ConvertFrom-Json).status; "  database:  $($e.current_state) $(if ($e.disabled) { '(disabled)' })"
  Db jobs list -o json | ConvertFrom-Json | ForEach-Object { "  job:       $($_.settings.name) $($_.settings.schedule.pause_status)" }
}

switch ($Action) {
  "down" { "Stopping Yomi on Databricks..."; Db apps stop $App | Out-Null; "  website: stopped"; Db warehouses stop $Warehouse | Out-Null; "  warehouse: stopped"; Set-Db "true" }
  "up" { "Starting Yomi on Databricks (takes a few minutes)..."; Set-Db "false"; Db apps start $App | Out-Null; "  website: started"; Show-Status }
  "refresh" {
    "Rebuilding Brier, calibration, Smart Money and charts (one run)..."
    Push-Location $Repo; try { databricks bundle run refresh; if ($Ai) { "Generating AI insights..."; databricks bundle run ai_insights }; "Restarting the website..."; databricks bundle run $App | Out-Null; "  done" } finally { Pop-Location }
  }
  "status" { Show-Status }
}
