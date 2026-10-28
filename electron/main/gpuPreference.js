/**
 * Placa de vídeo dedicada no computador de mesa; a integrada no notebook.
 *
 * Sem pedido explícito, o Windows entrega a placa integrada ao app num computador
 * que tem as duas: a telemetria de out/2026 mostrou 15 instalações com placa
 * dedicada rodando na integrada. No notebook isso é o desejado (bateria e calor);
 * no PC de mesa, desperdício. O Chromium escolhe o adaptador ao subir o processo de
 * GPU, antes de qualquer janela, então a decisão sai de um arquivo gravado por uma
 * detecção anterior: a primeira abertura num computador novo ainda roda no padrão.
 */
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");

const FILE = "device-class.json";
// Win32_SystemEnclosure.ChassisTypes: portátil, notebook, laptop, sub-notebook,
// tablet, conversível, destacável, entre outros com bateria interna.
const PORTABLE_CHASSIS = new Set([8, 9, 10, 11, 12, 14, 18, 21, 30, 31, 32]);

function classify(chassisTypes) {
  const types = chassisTypes.filter((t) => Number.isInteger(t) && t > 0);
  if (!types.length) return null;
  return types.some((t) => PORTABLE_CHASSIS.has(t)) ? "laptop" : "desktop";
}

function readDeviceClass(dir) {
  try {
    const saved = JSON.parse(fs.readFileSync(path.join(dir, FILE), "utf8"));
    return saved?.device_class === "desktop" || saved?.device_class === "laptop"
      ? saved.device_class
      : null;
  } catch (_) {
    return null;
  }
}

/** Antes do `ready`: pede a placa dedicada quando o computador é de mesa. */
function apply(app, dir, platform = process.platform) {
  if (platform !== "win32") return { device_class: null, high_performance: false };
  const deviceClass = readDeviceClass(dir);
  const highPerformance = deviceClass === "desktop";
  if (highPerformance) app.commandLine.appendSwitch("force_high_performance_gpu");
  return { device_class: deviceClass, high_performance: highPerformance };
}

/**
 * Descobre o tipo de gabinete uma vez, fora da abertura. O PowerShell leva cerca de
 * um segundo e o resultado não muda, então só roda quando o arquivo falta.
 */
function detect(dir, { platform = process.platform, run = execFile } = {}) {
  if (platform !== "win32" || readDeviceClass(dir)) return;
  const script = "(Get-CimInstance -ClassName Win32_SystemEnclosure).ChassisTypes -join ','";
  run(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", script],
    { windowsHide: true, timeout: 20_000 },
    (error, stdout) => {
      if (error) return;
      const chassisTypes = String(stdout).split(/[,\s]+/).filter(Boolean).map(Number);
      const deviceClass = classify(chassisTypes);
      if (!deviceClass) return;
      try {
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(
          path.join(dir, FILE),
          JSON.stringify({ device_class: deviceClass, chassis_types: chassisTypes, detected_at: new Date().toISOString() })
        );
      } catch (_) {
        // Sem gravar, a próxima abertura tenta de novo; o app segue no padrão.
      }
    }
  );
}

module.exports = { apply, detect, classify, readDeviceClass, FILE };
