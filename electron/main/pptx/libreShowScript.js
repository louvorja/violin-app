"use strict";

/**
 * Ponte em Python com o LibreOffice Impress — o modo animado de quem não tem
 * PowerPoint (Linux, ou Windows/Mac sem o Office).
 *
 * Mesmo protocolo da ponte do PowerPoint (nativeShow.js): um pedido JSON em
 * base64 por linha na entrada, uma resposta JSON por linha na saída, e
 * `{id: 0}` quando está pronta. Roda com o Python que entende `import uno`:
 * o que vem dentro do LibreOffice no Windows e no Mac, o `python3` do sistema
 * (pacote python3-uno) no Linux.
 */
const PY_SCRIPT = String.raw`# Ponte LouvorJA <-> LibreOffice Impress (modo animado).
# Pedido em JSON (base64, um por linha) pela entrada padrão; resposta em JSON
# pela saída padrão. Abre um LibreOffice próprio (perfil e canal separados) para
# não mexer no que o operador tiver aberto.
import base64
import json
import os
import subprocess
import sys
import time

import uno
from com.sun.star.beans import PropertyValue

SOFFICE = sys.argv[1]
PERFIL = sys.argv[2]          # file:///... da pasta de perfil
CANAL = sys.argv[3]           # nome do pipe

estado = {"proc": None, "ctx": None, "desk": None, "doc": None, "pres": None,
          "ctl": None, "visiveis": [], "pagina": 1}


def enviar(obj):
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()


def pv(nome, valor):
    p = PropertyValue()
    p.Name = nome
    p.Value = valor
    return p


def conectar():
    if estado["desk"] is not None:
        try:
            estado["desk"].getFrames()
            return estado["desk"]
        except Exception:
            estado["desk"] = None
    if estado["proc"] is None or estado["proc"].poll() is not None:
        estado["proc"] = subprocess.Popen(
            [SOFFICE, "-env:UserInstallation=" + PERFIL, "--norestore", "--nologo",
             "--nodefault", "--nolockcheck", "--accept=pipe,name=%s;urp;" % CANAL],
            stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    local = uno.getComponentContext()
    res = local.ServiceManager.createInstanceWithContext("com.sun.star.bridge.UnoUrlResolver", local)
    ultimo = None
    for _ in range(120):
        try:
            ctx = res.resolve("uno:pipe,name=%s;urp;StarOffice.ComponentContext" % CANAL)
            estado["ctx"] = ctx
            estado["desk"] = ctx.ServiceManager.createInstanceWithContext("com.sun.star.frame.Desktop", ctx)
            return estado["desk"]
        except Exception as e:  # o LibreOffice ainda está abrindo
            ultimo = e
            time.sleep(0.5)
    raise RuntimeError("O LibreOffice nao respondeu (%s)" % ultimo)


def pagina_atual():
    ctl = estado["ctl"]
    try:
        atual = ctl.getCurrentSlide()
        paginas = estado["doc"].getDrawPages()
        for i in range(paginas.getCount()):
            if paginas.getByIndex(i) == atual:
                pg = sum(1 for n in estado["visiveis"] if n <= i)
                estado["pagina"] = max(1, pg)
                break
    except Exception:
        pass
    return estado["pagina"]


def get_state():
    ctl = estado["ctl"]
    if ctl is None:
        return {"active": False}
    try:
        if not ctl.isRunning():
            raise RuntimeError("fim")
        return {"active": True, "index": pagina_atual() - 1,
                "total": len(estado["visiveis"]), "black": bool(ctl.isPaused())}
    except Exception as e:
        info = stop_show()
        info["motivo"] = str(e)
        return info


def stop_show():
    try:
        if estado["pres"] is not None:
            estado["pres"].end()
    except Exception:
        pass
    try:
        if estado["doc"] is not None:
            estado["doc"].close(True)
    except Exception:
        pass
    estado.update(pres=None, ctl=None, doc=None)
    return {"active": False}


def start_show(a):
    stop_show()
    desk = conectar()
    url = uno.systemPathToFileUrl(a["file"])
    # Com janela: aberto oculto, o Impress cai ao começar a apresentação.
    doc = desk.loadComponentFromURL(url, "_blank", 0, (pv("ReadOnly", True),))
    if doc is None:
        raise RuntimeError("O LibreOffice nao conseguiu abrir este arquivo.")
    paginas = doc.getDrawPages()
    visiveis = []
    for i in range(paginas.getCount()):
        try:
            vis = paginas.getByIndex(i).getPropertyValue("Visible")
        except Exception:
            vis = True
        if vis:
            visiveis.append(i)
    if not visiveis:
        visiveis = [0]
    pres = doc.getPresentation()
    pres.IsFullScreen = True
    pres.IsAlwaysOnTop = True
    pres.StartWithNavigator = False
    pres.IsEndless = False
    pres.IsMouseVisible = False
    try:
        pres.UsePen = False
    except Exception:
        pass
    tela = int(a.get("display") or 0)
    if tela > 0:
        try:
            pres.Display = tela
        except Exception:
            pass
    inicio = int(a.get("startIndex") or 0)
    if 0 < inicio < len(visiveis):
        try:
            pres.FirstPage = paginas.getByIndex(visiveis[inicio]).Name
        except Exception:
            pass
    pres.start()
    ctl = None
    for _ in range(80):
        ctl = pres.getController()
        if ctl is not None:
            break
        time.sleep(0.25)
    if ctl is None:
        raise RuntimeError("O LibreOffice nao iniciou a apresentacao.")
    # A janela de edicao do arquivo fica fora da vista: so a apresentacao aparece.
    # Leva a apresentacao para a frente (sem isso ela pode nascer atras da edicao)
    try:
        ctl.gotoSlide(paginas.getByIndex(visiveis[inicio if 0 < inicio < len(visiveis) else 0]))
    except Exception:
        pass
    estado.update(doc=doc, pres=pres, ctl=ctl, visiveis=visiveis, pagina=1)
    try:
        ctl.activate()
    except Exception:
        pass
    return get_state()


def nav(a):
    ctl = estado["ctl"]
    if ctl is None:
        return {"active": False}
    acao = a.get("action")
    if acao == "next":
        ctl.gotoNextEffect()
    elif acao == "prev":
        ctl.gotoPreviousEffect()
    elif acao == "goto":
        k = int(a.get("index") or 0)
        if 0 <= k < len(estado["visiveis"]):
            ctl.gotoSlide(estado["doc"].getDrawPages().getByIndex(estado["visiveis"][k]))
    elif acao == "black":
        if ctl.isPaused():
            ctl.resume()
        else:
            ctl.blankScreen(0)
    return get_state()


def sair():
    stop_show()
    try:
        if estado["desk"] is not None:
            estado["desk"].terminate()
    except Exception:
        pass
    p = estado["proc"]
    if p is not None:
        try:
            p.wait(timeout=10)
        except Exception:
            p.kill()
    return {"active": False}


enviar({"id": 0, "ok": True, "result": {"ready": True}})
for linha in sys.stdin:
    linha = linha.strip()
    if not linha:
        continue
    ident = -1
    try:
        msg = json.loads(base64.b64decode(linha).decode("utf-8"))
        ident = msg.get("id", -1)
        cmd = msg.get("cmd")
        args = msg.get("args") or {}
        if cmd == "start":
            res = start_show(args)
        elif cmd == "nav":
            res = nav(args)
        elif cmd == "state":
            res = get_state()
        elif cmd == "end":
            res = stop_show()
        elif cmd == "quit":
            res = sair()
        else:
            raise RuntimeError("Comando desconhecido: %s" % cmd)
        enviar({"id": ident, "ok": True, "result": res})
        if cmd == "quit":
            break
    except Exception as e:
        enviar({"id": ident, "ok": False, "error": str(e)})
sair()
`;

module.exports = { PY_SCRIPT };
