"use strict";

/**
 * windowsScript — conversa com o Windows e com o PowerPoint por PowerShell.
 *
 * Cada chamada sobe um PowerShell, faz uma tarefa e sai. O pedido vai num
 * arquivo JSON (acentos e espaços em caminhos não passam bem pela linha de
 * comando) e a resposta volta como uma linha JSON na saída padrão.
 *
 * O script fica aqui como texto e é gravado na pasta temporária na primeira
 * vez: assim não depende de `extraResources` no electron-builder.
 *
 * Tarefas:
 *   list     → fontes registradas (máquina + usuário), com o caminho e se o arquivo existe
 *   install  → instala fontes só para o usuário (sem administrador)
 *   convert  → abre o .pptx no PowerPoint e salva como PDF
 */
const fs = require("fs/promises");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { spawn } = require("child_process");

const SCRIPT = String.raw`
param([string]$JobFile)
$ErrorActionPreference = 'Stop'
$stdout = [Console]::OpenStandardOutput()
function Send($obj) {
    $json = ConvertTo-Json -InputObject $obj -Compress -Depth 8
    $bytes = [Text.Encoding]::UTF8.GetBytes($json + [char]10)
    $stdout.Write($bytes, 0, $bytes.Length)
    $stdout.Flush()
}

function Do-List($a) {
    $entries = @()
    $winFonts = Join-Path $env:WINDIR 'Fonts'
    foreach ($p in @('HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts',
                     'HKCU:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts')) {
        try {
            $key = Get-Item -Path $p -ErrorAction Stop
            foreach ($n in $key.GetValueNames()) {
                $v = [string]$key.GetValue($n)
                if (-not $v) { continue }
                if (-not [IO.Path]::IsPathRooted($v)) { $v = Join-Path $winFonts $v }
                $entries += @{ name = $n; path = $v; exists = (Test-Path -LiteralPath $v) }
            }
        } catch { }
    }
    # Fontes "na nuvem" do Office (Aptos e companhia): o PowerPoint baixa sozinho
    $cloud = Join-Path $env:LOCALAPPDATA 'Microsoft\FontCache\4\CloudFonts'
    if (Test-Path -LiteralPath $cloud) {
        foreach ($dir in (Get-ChildItem -LiteralPath $cloud -Directory -ErrorAction SilentlyContinue)) {
            $entries += @{ name = $dir.Name; path = $dir.FullName; exists = $true; cloud = $true }
        }
    }
    $hasPpt = Test-Path 'Registry::HKEY_CLASSES_ROOT\PowerPoint.Application'
    return @{ entries = $entries; powerpoint = $hasPpt }
}

function Do-Install($a) {
    Add-Type -Namespace LJ -Name Native -MemberDefinition @'
[DllImport("gdi32.dll", CharSet = CharSet.Unicode)]
public static extern int AddFontResourceW(string lpFileName);
[DllImport("user32.dll", CharSet = CharSet.Unicode)]
public static extern System.IntPtr SendMessageTimeoutW(System.IntPtr hWnd, uint Msg, System.IntPtr wParam, System.IntPtr lParam, uint fuFlags, uint uTimeout, out System.IntPtr lpdwResult);
'@
    $dir = Join-Path $env:LOCALAPPDATA 'Microsoft\Windows\Fonts'
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    $regPath = 'HKCU:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts'
    if (-not (Test-Path $regPath)) { New-Item -Path $regPath -Force | Out-Null }
    $done = @()
    foreach ($f in $a.fonts) {
        try {
            $src  = [string]$f.path
            $name = [string]$f.registryName
            $dest = Join-Path $dir ([IO.Path]::GetFileName($src))
            Copy-Item -LiteralPath $src -Destination $dest -Force
            # temporária = só nesta sessão do Windows (fonte "visualizar e imprimir")
            if (-not $a.temporary) {
                New-ItemProperty -Path $regPath -Name $name -Value $dest -PropertyType String -Force | Out-Null
            }
            $r = [LJ.Native]::AddFontResourceW($dest)
            $done += @{ path = $dest; ok = ($r -gt 0) }
        } catch {
            $done += @{ path = [string]$f.path; ok = $false; error = $_.Exception.Message }
        }
    }
    $out = [IntPtr]::Zero
    $null = [LJ.Native]::SendMessageTimeoutW([IntPtr]0xffff, 0x1D, [IntPtr]::Zero, [IntPtr]::Zero, 2, 1000, [ref]$out)
    return @{ installed = $done }
}

function Get-PPT {
    try {
        return @{ app = [Runtime.InteropServices.Marshal]::GetActiveObject('PowerPoint.Application'); owns = $false }
    } catch { }
    for ($t = 1; $t -le 3; $t++) {
        try {
            return @{ app = (New-Object -ComObject PowerPoint.Application); owns = $true }
        } catch {
            $msg = $_.Exception.Message
            if ($t -lt 3) { Start-Sleep -Seconds 2; continue }
            if ($msg -match '80080005|CO_E_SERVER_EXEC_FAILURE') {
                throw ('O Windows nao deixou o LouvorJA conversar com o PowerPoint. Normalmente acontece quando ' +
                       'um dos dois foi aberto como administrador e o outro nao, ou quando ficou um PowerPoint travado ' +
                       'em segundo plano (finalize POWERPNT.EXE no Gerenciador de Tarefas). Depois tente de novo.')
            }
            throw
        }
    }
}

function Do-Convert($a) {
    $g = Get-PPT
    $app = $g.app; $owns = $g.owns
    $stale = $false
    # O PowerPoint so enxerga fonte nova depois de reiniciar. Se ele ja estava
    # aberto e sem nenhuma apresentacao, reinicia; com apresentacao aberta, nao mexe.
    if ($a.restartIfIdle -and -not $owns) {
        $count = 0
        try { $count = $app.Presentations.Count } catch { }
        if ($count -eq 0) {
            try { $app.Quit() } catch { }
            try { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($app) } catch { }
            $app = $null
            [GC]::Collect(); [GC]::WaitForPendingFinalizers()
            Start-Sleep -Milliseconds 1200
            $g = Get-PPT
            $app = $g.app; $owns = $true
        } else { $stale = $true }
    }
    # Open(FileName, ReadOnly, Untitled, WithWindow) — msoTrue = -1, msoFalse = 0
    $withWindow = 0
    if ($a.withWindow) { $withWindow = -1 }
    # Garantia extra contra o "Modo de Exibicao Protegido" (arquivo baixado da internet)
    try { Unblock-File -LiteralPath ([string]$a.input) -ErrorAction SilentlyContinue } catch { }
    try {
        $pres = $app.Presentations.Open([string]$a.input, -1, 0, $withWindow)
    } catch {
        throw ('O PowerPoint nao conseguiu abrir este arquivo. Abra o arquivo no PowerPoint: se ele ' +
               'pedir para reparar, repare, salve e adicione de novo. (' + $_.Exception.Message + ')')
    }
    if ($a.withWindow -and $owns) { try { $app.WindowState = 2 } catch { } }
    # Cada slide vira uma imagem desenhada pelo proprio PowerPoint (fonte certa,
    # efeitos, transparencias). O PDF com essas imagens e montado no Node: o
    # leitor de PDF da projecao so precisa desenhar figuras, nunca fontes.
    $dir = [string]$a.outDir
    if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    $files = @()
    try {
        $sw = [double]$pres.PageSetup.SlideWidth
        $sh = [double]$pres.PageSetup.SlideHeight
        $width = [int]$a.width
        if ($width -lt 640) { $width = 1920 }
        $height = [int][Math]::Round($width * $sh / $sw)
        $i = 0
        $total = [int]$pres.Slides.Count
        Send @{ progress = @{ done = 0; total = $total } }
        foreach ($s in $pres.Slides) {
            $i++
            $hidden = $false
            try { $hidden = ([int]$s.SlideShowTransition.Hidden -eq -1) } catch { }
            if (-not $hidden) {
                $name = ('slide_{0:D4}.png' -f $i)
                $s.Export((Join-Path $dir $name), 'PNG', $width, $height)
                $files += $name
            }
            # Contagem para a tela do operador: "slide 12 de 40"
            Send @{ progress = @{ done = $i; total = $total } }
        }
    } finally {
        try { $pres.Close() } catch { }
    }
    if ($owns) {
        try { if ($app.Presentations.Count -eq 0) { $app.Quit() } } catch { }
    }
    return @{ files = $files; slideWidth = $sw; slideHeight = $sh; staleFonts = $stale }
}

try {
    $job = Get-Content -LiteralPath $JobFile -Raw -Encoding UTF8 | ConvertFrom-Json
    $res = switch ([string]$job.action) {
        'list'    { Do-List $job.args }
        'install' { Do-Install $job.args }
        'convert' { Do-Convert $job.args }
        default   { throw "Tarefa desconhecida: $($job.action)" }
    }
    Send @{ ok = $true; result = $res }
} catch {
    Send @{ ok = $false; error = $_.Exception.Message }
}
`;

let _scriptPath = null;

async function _ensureScript(tempDir) {
  const hash = crypto.createHash("sha1").update(SCRIPT).digest("hex").slice(0, 10);
  const file = path.join(tempDir, `louvorja-pptx-${hash}.ps1`);
  if (_scriptPath === file) return file;
  await fs.mkdir(tempDir, { recursive: true });
  // BOM UTF-8: sem ele o Windows PowerShell 5 lê o script como ANSI
  await fs.writeFile(file, "﻿" + SCRIPT, "utf8");
  _scriptPath = file;
  return file;
}

/**
 * Roda uma tarefa no PowerShell e devolve o `result`.
 *
 * @param {"list"|"install"|"convert"} action
 * @param {object} args
 * @param {{tempDir?: string, timeoutMs?: number, onProgress?: (p: {done: number, total: number}) => void}} [opts]
 */
async function runWindowsTask(action, args = {}, opts = {}) {
  const tempDir = opts.tempDir || path.join(os.tmpdir(), "louvorja-pptx");
  const script = await _ensureScript(tempDir);
  const jobFile = path.join(tempDir, `job-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`);
  await fs.writeFile(jobFile, JSON.stringify({ action, args }), "utf8");
  const timeoutMs = opts.timeoutMs || 5 * 60 * 1000;
  try {
    const saida = await new Promise((resolve, reject) => {
      const ps = spawn(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script, "-JobFile", jobFile],
        { windowsHide: true }
      );
      let out = "";
      let err = "";
      let pendente = "";
      // Linhas {"progress":{...}} chegam durante o trabalho; a última linha é a resposta.
      const lerLinhas = (texto) => {
        pendente += texto;
        let i;
        while ((i = pendente.indexOf("\n")) >= 0) {
          const linha = pendente.slice(0, i).trim();
          pendente = pendente.slice(i + 1);
          if (!linha) continue;
          if (linha.startsWith('{"progress"') && opts.onProgress) {
            try {
              const p = JSON.parse(linha).progress;
              if (p && Number.isFinite(p.done) && Number.isFinite(p.total)) opts.onProgress(p);
            } catch {
              /* linha cortada: ignora */
            }
            continue;
          }
          out += linha + "\n";
        }
      };
      const timer = setTimeout(() => {
        ps.kill();
        reject(new Error("O PowerPoint demorou demais para responder."));
      }, timeoutMs);
      ps.stdout.setEncoding("utf8");
      ps.stderr.setEncoding("utf8");
      ps.stdout.on("data", lerLinhas);
      ps.stderr.on("data", (d) => (err += d));
      ps.on("error", (e) => {
        clearTimeout(timer);
        reject(e);
      });
      ps.on("close", () => {
        clearTimeout(timer);
        lerLinhas("\n");
        const linha = out.trim().split(/\r?\n/).pop() || "";
        try {
          resolve(JSON.parse(linha));
        } catch {
          reject(new Error((err || out || "PowerShell não respondeu.").trim().slice(0, 500)));
        }
      });
    });
    if (!saida || saida.ok !== true) throw new Error(String(saida?.error || "Falha no PowerShell."));
    return saida.result || {};
  } finally {
    fs.unlink(jobFile).catch(() => {});
  }
}

module.exports = { runWindowsTask, SCRIPT };
