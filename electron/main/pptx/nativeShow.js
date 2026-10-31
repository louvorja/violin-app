"use strict";

/**
 * nativeShow — o próprio PowerPoint apresenta, com animações, vídeos e áudios.
 *
 * O modo imagem (index.js) é fiel e leva o slide ao PA e ao retorno, mas cada
 * slide vira uma página parada. Quando o arquivo depende de animação ou mídia,
 * o operador escolhe este modo: o PowerPoint abre a apresentação em tela cheia
 * no monitor do PA e o LouvorJA só manda os comandos (próximo, anterior, ir
 * para, tela preta) e lê em que slide ele está.
 *
 * Windows apenas (COM). Um PowerShell fica aberto durante a apresentação:
 * pedido em JSON (base64, uma linha por comando) pela entrada padrão, resposta
 * em JSON pela saída padrão.
 */
const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");
const { pathToFileURL } = require("url");
const { PY_SCRIPT } = require("./libreShowScript.js");

const SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$stdout = [Console]::OpenStandardOutput()
function Send($obj) {
    $json = ConvertTo-Json -InputObject $obj -Compress -Depth 6
    $bytes = [Text.Encoding]::UTF8.GetBytes($json + [char]10)
    $stdout.Write($bytes, 0, $bytes.Length)
    $stdout.Flush()
}

$script:ppt = $null
$script:owns = $false
$script:pres = $null
$script:win = $null
$script:visiveis = @(1)
$script:pagina = 1

function Get-PPT {
    if ($script:ppt -ne $null) {
        try { if ($script:ppt.Presentations -ne $null) { return $script:ppt } } catch { }
        $script:ppt = $null
    }
    try {
        $script:ppt = [Runtime.InteropServices.Marshal]::GetActiveObject('PowerPoint.Application')
        $script:owns = $false
        # Um PowerPoint que está fechando ainda aparece aqui, mas sem Presentations
        if ($script:ppt.Presentations -eq $null) { throw 'fechando' }
    } catch {
        $script:ppt = $null
        for ($t = 1; $t -le 3; $t++) {
            try { $script:ppt = New-Object -ComObject PowerPoint.Application; $script:owns = $true; break }
            catch {
                if ($t -lt 3) { Start-Sleep -Seconds 2; continue }
                if ($_.Exception.Message -match '80080005|CO_E_SERVER_EXEC_FAILURE') {
                    throw ('O Windows nao deixou o LouvorJA conversar com o PowerPoint. Abra os dois do jeito normal ' +
                           '(nenhum como administrador) ou finalize POWERPNT.EXE no Gerenciador de Tarefas.')
                }
                throw
            }
        }
    }
    return $script:ppt
}

function Get-State {
    if ($script:win -eq $null) { return @{ active = $false } }
    try {
        $v = $script:win.View
        $st = [int]$v.State      # 1 rodando, 2 pausado, 3 tela preta, 4 tela branca, 5 terminou
        if ($st -eq 5) { throw 'fim' }
        # Índice na conta do PDF (só slides visíveis), para casar com as miniaturas e o retorno.
        # Na tela preta do fim da apresentação não há slide: fica o último.
        try {
            $si = [int]$v.Slide.SlideIndex
            $pg = 0
            foreach ($n in $script:visiveis) { if ($n -le $si) { $pg++ } }
            $script:pagina = [Math]::Max(1, $pg)
        } catch { }
        return @{
            active = $true
            index  = $script:pagina - 1
            total  = $script:visiveis.Count
            black  = ($st -eq 3)
        }
    } catch {
        $motivo = $_.Exception.Message
        $info = Stop-Show
        $info.motivo = [string]$motivo
        return $info
    }
}

function Stop-Show([bool]$fecharPrograma = $true) {
    if ($script:win -ne $null) { try { $script:win.View.Exit() } catch { } }
    if ($script:pres -ne $null) { try { $script:pres.Close() } catch { } }
    $script:win = $null; $script:pres = $null
    $info = @{ active = $false }
    # Fecha o PowerPoint quando não sobra nenhuma apresentação do operador aberta,
    # mesmo que ele já estivesse aberto (de uma sessão anterior do LouvorJA, por
    # exemplo). Arquivo aberto pelo operador nele: fica como está. Ao trocar de
    # apresentação (Start-Show) não fecha, para não reabrir o programa à toa.
    if ($fecharPrograma -and $script:ppt -eq $null) {
        # A referência pode ter se perdido no caminho: pega o PowerPoint que estiver aberto
        try { $script:ppt = [Runtime.InteropServices.Marshal]::GetActiveObject('PowerPoint.Application') } catch { }
        $info.reconectou = ($script:ppt -ne $null)
    }
    if ($fecharPrograma -and $script:ppt -ne $null) {
        try {
            $restantes = 0
            for ($k = $script:ppt.Presentations.Count; $k -ge 1; $k--) {
                $p = $script:ppt.Presentations.Item($k)
                $semJanela = $true
                try { $semJanela = ($p.Windows.Count -eq 0) } catch { }
                $dirNome = [IO.Path]::GetFileName([IO.Path]::GetDirectoryName([string]$p.FullName))
                # Sobras do próprio LouvorJA (cópias do modo nativo, conversões sem janela)
                if ($semJanela -or ($dirNome -eq 'native' -and [string]$p.Name -like 'apresentacao*')) {
                    try { $p.Close() } catch { }
                } else { $restantes++ }
            }
            $info.restantes = $restantes
            if ($restantes -eq 0) { $script:ppt.Quit(); $info.fechou = $true }
        } catch { $info.erro = $_.Exception.Message }
        try { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($script:ppt) } catch { }
        $script:ppt = $null
        [GC]::Collect(); [GC]::WaitForPendingFinalizers()
    }
    return $info
}

function Start-Show($a) {
    Stop-Show $false | Out-Null
    $app = Get-PPT
    # Apresentações que sobraram de uma sessão anterior do LouvorJA (app fechado no meio,
    # sem tempo de encerrar): estão na mesma pasta temporária e seguram o arquivo aberto.
    try {
        for ($k = $app.Presentations.Count; $k -ge 1; $k--) {
            $p = $app.Presentations.Item($k)
            # Compara pelo nome (a pasta pode vir em formato curto, EMILAY~1, de um lado só)
            $dirNome = [IO.Path]::GetFileName([IO.Path]::GetDirectoryName([string]$p.FullName))
            if ($dirNome -eq 'native' -and [string]$p.Name -like 'apresentacao*') {
                try { $p.SlideShowWindow.View.Exit() } catch { }
                try { $p.Close() } catch { }
            }
        }
    } catch { }
    try { Unblock-File -LiteralPath ([string]$a.file) -ErrorAction SilentlyContinue } catch { }
    $pres = $null
    for ($t = 1; $t -le 3 -and $pres -eq $null; $t++) {
        try {
            # Open(FileName, ReadOnly, Untitled, WithWindow): com janela, para as fontes embutidas valerem
            $pres = $app.Presentations.Open([string]$a.file, -1, 0, -1)
        } catch {
            if ($t -eq 3) { throw ('O PowerPoint nao conseguiu abrir este arquivo. (' + $_.Exception.Message + ')') }
            # O PowerPoint da apresentacao anterior pode estar terminando de fechar: espera e pega outro
            Start-Sleep -Seconds 2
            $script:ppt = $null
            $app = Get-PPT
        }
    }
    if ($script:owns) { try { $app.WindowState = 2 } catch { } }
    $s = $pres.SlideShowSettings
    $s.ShowType = 1                 # ppShowTypeSpeaker (tela cheia)
    try { $s.ShowPresenterView = 0 } catch { }
    $s.StartingSlide = 1
    $s.EndingSlide = $pres.Slides.Count
    $w = $s.Run()
    # Posiciona no monitor do PA. Chega em DIP (px a 96 dpi); a janela usa pontos = DIP x 0,75
    if ($a.bounds -ne $null) {
        $b = $a.bounds
        try {
            $w.Left = [double]$b.x * 0.75
            $w.Top = [double]$b.y * 0.75
            $w.Width = [double]$b.width * 0.75
            $w.Height = [double]$b.height * 0.75
        } catch { }
    }
    # Sem isso a barra de tarefas do Windows fica por cima do PA quando o foco volta ao
    # LouvorJA: a janela da apresentação fica "sempre no topo", como o telão do LouvorJA.
    # PowerPoint que o operador já tinha aberto: só a janela de edição deste arquivo é
    # minimizada, e só depois do Run (antes dele a apresentação nascia minimizada).
    if (-not $script:owns) { try { $pres.Windows.Item(1).WindowState = 2 } catch { } }
    try { $w.Activate() } catch { }
    $script:diag = @{}
    try {
        if (-not ('LouvorJA.Win32' -as [type])) {
            Add-Type -Namespace LouvorJA -Name Win32 -MemberDefinition @'
[DllImport("user32.dll")] public static extern bool SetWindowPos(System.IntPtr h, System.IntPtr after, int x, int y, int cx, int cy, uint flags);
[DllImport("user32.dll")] public static extern bool GetWindowRect(System.IntPtr h, out RECT r);
[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern System.IntPtr FindWindow(string cls, string title);
[System.Runtime.InteropServices.StructLayout(System.Runtime.InteropServices.LayoutKind.Sequential)]
public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
'@
        }
        $h = [IntPtr]::Zero
        try { $h = [IntPtr][long]$w.HWND } catch { }
        # Em algumas versões o HWND vem 0: a janela da apresentação tem a classe "screenClass"
        # A janela pode demorar um instante para existir depois do Run
        for ($t = 0; $t -lt 15 -and $h -eq [IntPtr]::Zero; $t++) {
            $h = [LouvorJA.Win32]::FindWindow('screenClass', [NullString]::Value)
            if ($h -eq [IntPtr]::Zero) { Start-Sleep -Milliseconds 200 }
        }
        $script:diag.tentativas = $t
        $script:diag.hwnd = [long]$h
        # HWND_TOPMOST = -1; SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE = 0x13
        $script:diag.topmost = [LouvorJA.Win32]::SetWindowPos($h, [IntPtr](-1), 0, 0, 0, 0, 0x13)
        $r = New-Object LouvorJA.Win32+RECT
        [void][LouvorJA.Win32]::GetWindowRect($h, [ref]$r)
        $script:diag.rect = @($r.Left, $r.Top, $r.Right, $r.Bottom)
    } catch { $script:diag.error = $_.Exception.Message }
    try { $script:diag.points = @($w.Left, $w.Top, $w.Width, $w.Height) } catch { }
    $script:pres = $pres
    $script:win = $w
    $script:visiveis = @()
    foreach ($sl in $pres.Slides) {
        $h = $false
        try { $h = ([int]$sl.SlideShowTransition.Hidden -eq -1) } catch { }
        if (-not $h) { $script:visiveis += [int]$sl.SlideIndex }
    }
    if ($script:visiveis.Count -eq 0) { $script:visiveis = @(1) }
    $script:pagina = 1
    $i = [int]$a.startIndex
    if ($i -gt 0 -and $i -lt $script:visiveis.Count) { try { $w.View.GotoSlide($script:visiveis[$i]) } catch { } }
    $st = Get-State
    $st.diag = $script:diag
    return $st
}

function Nav($a) {
    if ($script:win -eq $null) { return @{ active = $false } }
    $v = $script:win.View
    switch ([string]$a.action) {
        'next'  { $v.Next() }
        'prev'  { $v.Previous() }
        'goto'  {
            $k = [int]$a.index
            if ($k -ge 0 -and $k -lt $script:visiveis.Count) { $v.GotoSlide($script:visiveis[$k]) }
        }
        'black' { if ([int]$v.State -eq 3) { $v.State = 1 } else { $v.State = 3 } }
    }
    return (Get-State)
}

Send @{ id = 0; ok = $true; result = @{ ready = $true } }
$stdin = [Console]::In
while ($true) {
    $line = $stdin.ReadLine()
    if ($line -eq $null) { break }
    $line = $line.Trim()
    if ($line.Length -eq 0) { continue }
    $id = -1
    try {
        $msg = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($line)) | ConvertFrom-Json
        $id = $msg.id
        $res = switch ([string]$msg.cmd) {
            'start' { Start-Show $msg.args }
            'nav'   { Nav $msg.args }
            'state' { Get-State }
            'end'   { Stop-Show }
            'quit'  { Stop-Show }
            default { throw "Comando desconhecido: $($msg.cmd)" }
        }
        Send @{ id = $id; ok = $true; result = $res }
        if ([string]$msg.cmd -eq 'quit') { break }
    } catch {
        Send @{ id = $id; ok = $false; error = $_.Exception.Message }
    }
}
`;

/** Mensagem para quando a ponte fecha sem ter ficado pronta. */
function _motivoSaida(engine, erroTail) {
  if (engine === "libreoffice") {
    if (/No module named ['"]?uno/i.test(erroTail)) {
      return "Falta a ligação do LibreOffice com o Python. No Linux: sudo apt install python3-uno";
    }
    return `O LibreOffice não respondeu.${erroTail ? " (" + erroTail.trim().split("\n").pop() + ")" : ""}`;
  }
  return "PowerShell encerrou.";
}

/**
 * Ponte com o programa que apresenta, viva enquanto a apresentação existe:
 * um PowerShell falando com o PowerPoint (COM) ou um Python falando com o
 * LibreOffice (UNO, `libreShowScript.js`). Os dois falam o mesmo protocolo.
 */
class NativeShow {
  /**
   * @param {{tempDir: string, onState?: (s: object) => void, log?: (...a: any[]) => void,
   *   engine?: "powerpoint"|"libreoffice", soffice?: string|null, python?: string|null}} opts
   */
  constructor({ tempDir, onState = () => {}, log = console.log, engine = "powerpoint", soffice = null, python = null }) {
    this.tempDir = tempDir;
    this.onState = onState;
    this.log = log;
    this.engine = engine;
    this.soffice = soffice;
    this.python = python;
    this.ps = null;
    this.pronto = null;
    this.seq = 0;
    this.pendentes = new Map();
    this.timer = null;
    this.ultimo = { active: false };
  }

  get supported() {
    return this.engine === "libreoffice" ? !!(this.soffice && this.python) : process.platform === "win32";
  }

  async _script() {
    const libre = this.engine === "libreoffice";
    const texto = libre ? PY_SCRIPT : SCRIPT;
    const hash = crypto.createHash("sha1").update(texto).digest("hex").slice(0, 10);
    const file = path.join(this.tempDir, `louvorja-${libre ? "lo" : "pptx"}-show-${hash}.${libre ? "py" : "ps1"}`);
    await fs.mkdir(this.tempDir, { recursive: true });
    // O PowerShell 5 só lê acentos em UTF-8 com BOM; o Python não quer o BOM.
    await fs.writeFile(file, (libre ? "" : "\uFEFF") + texto, "utf8");
    return file;
  }

  _processo(script) {
    if (this.engine !== "libreoffice") {
      return spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script], {
        windowsHide: true,
      });
    }
    // LibreOffice próprio: perfil e canal separados dos do operador (e do conversor).
    const perfil = pathToFileURL(path.join(this.tempDir, "lo-show-profile")).href;
    const canal = `louvorja_show_${process.pid}`;
    return spawn(this.python, ["-u", script, this.soffice, perfil, canal], {
      windowsHide: true,
      env: { ...process.env, PYTHONIOENCODING: "utf-8" },
    });
  }

  _iniciar() {
    if (this.pronto) return this.pronto;
    this.pronto = (async () => {
      const script = await this._script();
      const ps = this._processo(script);
      this.ps = ps;
      ps.stdout.setEncoding("utf8");
      // O fim do stderr explica uma saída antes da hora (ex.: Python sem o módulo uno).
      let erroTail = "";
      ps.stderr?.setEncoding("utf8");
      ps.stderr?.on("data", (t) => (erroTail = (erroTail + t).slice(-600)));
      let pendente = "";
      await new Promise((resolve, reject) => {
        const falha = (e) => reject(e instanceof Error ? e : new Error(String(e)));
        ps.on("error", falha);
        ps.stdout.on("data", (txt) => {
          pendente += txt;
          let i;
          while ((i = pendente.indexOf("\n")) >= 0) {
            const linha = pendente.slice(0, i).trim();
            pendente = pendente.slice(i + 1);
            if (!linha) continue;
            let msg;
            try {
              msg = JSON.parse(linha);
            } catch {
              continue;
            }
            if (msg.id === 0) {
              resolve();
              continue;
            }
            const p = this.pendentes.get(msg.id);
            if (!p) continue;
            this.pendentes.delete(msg.id);
            if (msg.ok) p.resolve(msg.result || {});
            else p.reject(new Error(String(msg.error || "Falha no PowerPoint.")));
          }
        });
        ps.on("exit", () => {
          for (const p of this.pendentes.values()) p.reject(new Error("O PowerPoint parou de responder."));
          this.pendentes.clear();
          this.ps = null;
          this.pronto = null;
          this._pararConsulta();
          this._publicar({ active: false });
          falha(new Error(_motivoSaida(this.engine, erroTail)));
        });
      });
    })();
    this.pronto.catch(() => (this.pronto = null));
    return this.pronto;
  }

  async _chamar(cmd, args = {}, timeoutMs = 60000) {
    await this._iniciar();
    const id = ++this.seq;
    const linha = Buffer.from(JSON.stringify({ id, cmd, args }), "utf8").toString("base64");
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => {
        this.pendentes.delete(id);
        reject(new Error("O PowerPoint demorou demais para responder."));
      }, timeoutMs);
      this.pendentes.set(id, {
        resolve: (r) => (clearTimeout(t), resolve(r)),
        reject: (e) => (clearTimeout(t), reject(e)),
      });
      this.ps.stdin.write(linha + "\n");
    });
  }

  _publicar(estado) {
    const s = estado && typeof estado === "object" ? estado : { active: false };
    const mudou = JSON.stringify(s) !== JSON.stringify(this.ultimo);
    this.ultimo = s;
    if (mudou) this.onState(s);
    if (!s.active) this._pararConsulta();
    return s;
  }

  /** Enquanto apresenta, pergunta o slide atual (o operador pode avançar pelo próprio PowerPoint). */
  _consultar() {
    this._pararConsulta();
    this.timer = setInterval(() => {
      this._chamar("state", {}, 10000)
        .then((s) => this._publicar(s))
        .catch(() => {});
    }, 700);
  }

  _pararConsulta() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /**
   * @param {string} file  .pptx já sem a marca "baixado da internet"
   * @param {{x: number, y: number, width: number, height: number}|null} bounds  monitor do PA
   */
  /** `display`: tela do PA na numeração do LibreOffice (1 = primeira); o PowerPoint usa `bounds`. */
  async start(file, bounds, startIndex = 0, display = 0) {
    const s = await this._chamar("start", { file, bounds, startIndex, display }, 3 * 60 * 1000);
    this._publicar(s);
    if (s.active) this._consultar();
    return s;
  }

  async nav(action, index) {
    if (!this.ultimo.active) return { active: false };
    return this._publicar(await this._chamar("nav", { action, index }));
  }

  state() {
    return this.ultimo;
  }

  async end() {
    this._pararConsulta();
    if (!this.ps) return this._publicar({ active: false });
    try {
      return this._publicar(await this._chamar("end", {}, 20000));
    } catch {
      return this._publicar({ active: false });
    }
  }

  /** Fecha o PowerShell (ao sair do app). */
  dispose() {
    this._pararConsulta();
    if (this.ps) {
      try {
        const linha = Buffer.from(JSON.stringify({ id: ++this.seq, cmd: "quit", args: {} })).toString("base64");
        this.ps.stdin.write(linha + "\n");
        setTimeout(() => this.ps?.kill(), 3000);
      } catch {
        /* já saiu */
      }
    }
  }
}

module.exports = { NativeShow, SCRIPT };
