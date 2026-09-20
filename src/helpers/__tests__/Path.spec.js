// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock de Platform antes de importar Path
vi.mock("@/helpers/Platform", () => ({
  default: { isDesktop: false },
}));

import Path from "../Path.js";
import Platform from "@/helpers/Platform";
import { API_URL_DB, API_URL_FILES } from "@/config/Api";

// As URLs vêm de `config/Api`, que as calcula uma vez, na carga do módulo.
// Cravar as variáveis de ambiente aqui não teria efeito: quando o `beforeEach`
// roda, o Path já importou os valores. Por isso o alvo é a própria config —
// o que estes testes fixam é a montagem do caminho, não o endereço do servidor.
const DB_URL = API_URL_DB;
const FILES_URL = API_URL_FILES;

beforeEach(() => {
  Platform.isDesktop = false;
});

describe("Path.db — modo web", () => {
  it("retorna URL com barra simples para chave sem prefixo", () => {
    expect(Path.db("pt_musics")).toBe(`${DB_URL}/pt_musics`);
  });

  it("remove barra inicial do path antes de montar URL", () => {
    expect(Path.db("/pt_musics")).toBe(`${DB_URL}/pt_musics`);
  });

  it("funciona com chaves alfanuméricas e hífen/underscore", () => {
    expect(Path.db("music_123")).toBe(`${DB_URL}/music_123`);
    expect(Path.db("bible-pt")).toBe(`${DB_URL}/bible-pt`);
  });

  it("lança erro para chaves inválidas (espaço, /, etc.)", () => {
    expect(() => Path.db("pt musics")).toThrow(/chave inválida/);
    expect(() => Path.db("a/b")).toThrow(/chave inválida/);
    expect(() => Path.db("a.b")).toThrow(/chave inválida/);
  });
});

describe("Path.db — modo desktop", () => {
  beforeEach(() => {
    Platform.isDesktop = true;
  });

  it("retorna URL com protocolo louvorja://", () => {
    expect(Path.db("pt_musics")).toBe("louvorja://json_db/pt_musics");
  });

  it("remove barra inicial ao construir URL do protocolo", () => {
    expect(Path.db("/bible_pt")).toBe("louvorja://json_db/bible_pt");
  });
});

describe("Path.file — modo web", () => {
  it("concatena VITE_URL_FILES com o path", () => {
    expect(Path.file("/audio/123.mp3")).toBe(`${FILES_URL}/audio/123.mp3`);
  });

  it("funciona sem barra inicial no path", () => {
    expect(Path.file("img/thumb.jpg")).toBe(`${FILES_URL}/img/thumb.jpg`);
  });

  it("lança erro para path com traversal (..)", () => {
    expect(() => Path.file("../etc/passwd")).toThrow(/caminho inválido/);
  });

  it("preserva URL HTTPS completa da API", () => {
    expect(Path.file("https://cdn.louvorja.com/images/x.jpg")).toBe(
      "https://cdn.louvorja.com/images/x.jpg"
    );
    expect(() => Path.file("ftp://server/file")).toThrow(/caminho inválido/);
  });
});

describe("Path.file — modo desktop", () => {
  beforeEach(() => {
    Platform.isDesktop = true;
  });

  it("retorna URL com protocolo louvorja://files/", () => {
    expect(Path.file("/audio/123.mp3")).toBe("louvorja://files/audio/123.mp3");
  });

  it("adiciona barra inicial se ausente", () => {
    expect(Path.file("img/thumb.jpg")).toBe("louvorja://files/img/thumb.jpg");
  });

  it("preserva a origem remota ao criar a URL do protocolo", () => {
    expect(Path.file("https://cdn.louvorja.com/musics/pt/hino.opus")).toBe(
      "louvorja://files/musics/pt/hino.opus?source=https%3A%2F%2Fcdn.louvorja.com%2Fmusics%2Fpt%2Fhino.opus"
    );
  });
});

describe("Path.local", () => {
  it("codifica acento e espaço em caminho Unix", () => {
    expect(Path.local("/home/ana/Área de trabalho/hino.mp3")).toBe(
      "louvorja://local/home/ana/%C3%81rea%20de%20trabalho/hino.mp3"
    );
  });

  it("codifica #, ? e %, que truncariam ou quebrariam a URL", () => {
    expect(Path.local("/m/Hino #1?.mp3")).toBe("louvorja://local/m/Hino%20%231%3F.mp3");
    expect(Path.local("/m/100% Deus.mp3")).toBe("louvorja://local/m/100%25%20Deus.mp3");
  });

  it("mantém a letra do drive e troca barras invertidas no Windows", () => {
    expect(Path.local("C:\\Users\\ana\\Música\\a.mp3")).toBe(
      "louvorja://local/C:/Users/ana/M%C3%BAsica/a.mp3"
    );
  });

  it("volta ao caminho original quando decodificado como o protocolo faz", () => {
    const raw = "/home/ana/Hino #1 (ao vivo)?.mp3";
    const { pathname } = new URL(Path.local(raw));
    expect(decodeURIComponent(pathname)).toBe(raw);
  });
});
