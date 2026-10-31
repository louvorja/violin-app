import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLiturgyImport } from "../useLiturgyImport";
import { useLiturgyLibrary } from "../useLiturgyLibrary";

const success = vi.fn();
const error = vi.fn();
vi.mock("@/helpers/Snackbar", () => ({
  default: { success: (msg: string) => success(msg), error: (msg: string) => error(msg) },
}));

type YesNo = { options: { title: string; text: string }; answer: (_btn?: string) => Promise<void> };
let questions: YesNo[] = [];
vi.mock("@/helpers/Alert", () => ({
  default: {
    yesno: (options: YesNo["options"], answer: YesNo["answer"]) =>
      questions.push({ options, answer }),
  },
}));

const list = vi.fn();
const track = vi.fn();
vi.mock("@/helpers/Telemetry", () => ({
  default: { track: (...args: unknown[]) => track(...args) },
}));

vi.mock("../../i18n", () => ({
  useLiturgyI18n: () => ({
    t: (key: string) =>
      (
        ({
          "library.weekday_sunday": "Domingo",
          "library.weekday_monday": "Segunda",
          "library.weekday_tuesday": "Terça",
          "library.weekday_wednesday": "Quarta",
          "library.weekday_thursday": "Quinta",
          "library.weekday_friday": "Sexta",
          "library.weekday_saturday": "Sábado",
        }) as Record<string, string>
      )[key] ?? key,
  }),
}));

const JSON_LITURGY = JSON.stringify({
  name: "Culto de domingo",
  items: [{ tipo: "anotacao", item: "Abertura" }],
});

const JA_TWO_LITURGIES = `[Geral]
1=item_a;item_b;
2=item_c;
[item_a]
tipo=arquivo
item=18h55: Cronometro
cor=$000099FF
subtipo=arq
subitem=Arquivo C:\\\\Video.mp4
dir=C:\\\\Video.mp4
dir_info=E
[item_b]
tipo=musica
item=19h00: Louvor
cor=$000099FF
escolha=1
musica=-1
subtipo=escolha
[item_c]
tipo=categoria
item=Escola Sabatina
cor=$0000CCFF
`;

/** O que o clássico grava da v26.7 em diante: UTF-8 com BOM e linha em branco após cada seção. */
const JA_V26_7 = [
  "[Geral]",
  "1=item_a;item_b;",
  "",
  "[item_a]",
  "tipo=categoria",
  "item=Culto Divino — Oração",
  "cor=$0000CCFF",
  "",
  "[item_b]",
  "tipo=arquivo",
  "item=19h00: Vídeo de abertura",
  "cor=$000099FF",
  "subtipo=arq",
  "dir=C:\\Users\\João\\Vídeos\\abertura.mp4",
  "dir_info=E",
  "",
].join("\r\n");

/** Um arquivo do seletor, com só o que o import usa. */
function file(name: string, content: string, encoding: "latin1" | "utf8-bom" = "latin1"): File {
  const bytes = Uint8Array.from(
    encoding === "utf8-bom"
      ? Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(content, "utf8")])
      : Buffer.from(content, "latin1")
  );
  return {
    name,
    size: bytes.length,
    type: name.endsWith(".json") ? "application/json" : "",
    text: async () => content,
    arrayBuffer: async () => bytes.buffer,
  } as unknown as File;
}

/** Uma gravação que só termina quando o teste manda. */
function deferred() {
  let finish!: () => void;
  const promise = new Promise<void>((resolve) => {
    finish = resolve;
  });
  return { promise, finish };
}

const save = vi.fn();
const getByName = vi.fn();
const report = vi.fn();

function setup() {
  const library = {
    parseImport: useLiturgyLibrary().parseImport,
    getByName: (name: string) => getByName(name),
    save: (data: unknown) => save(data),
    list: () => list(),
  } as unknown as Parameters<typeof useLiturgyImport>[0];
  return useLiturgyImport(library, report);
}

beforeEach(() => {
  vi.useFakeTimers();
  success.mockReset();
  error.mockReset();
  track.mockReset();
  report.mockReset();
  questions = [];
  save.mockReset().mockResolvedValue(undefined);
  getByName.mockReset().mockResolvedValue(undefined);
  list.mockReset().mockResolvedValue([]);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useLiturgyImport — o loader durante o import", () => {
  it("liga o loader enquanto grava e só avisa do sucesso depois que ele sai", async () => {
    const writing = deferred();
    save.mockReturnValue(writing.promise);
    const { busy, importFile } = setup();
    const busyWhenToasted: boolean[] = [];
    success.mockImplementation(() => busyWhenToasted.push(busy.value));

    const done = importFile(file("culto.json", JSON_LITURGY));
    await vi.advanceTimersByTimeAsync(0);
    expect(busy.value).toBe(true);
    expect(success).not.toHaveBeenCalled();

    writing.finish();
    await vi.advanceTimersByTimeAsync(10);
    expect(busy.value).toBe(true);
    expect(success).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(500);
    await done;
    expect(busy.value).toBe(false);
    expect(success).toHaveBeenCalledOnce();
    expect(success).toHaveBeenCalledWith("library.import_success");
    expect(busyWhenToasted).toEqual([false]);
    expect(save).toHaveBeenCalledWith({ name: "Culto de domingo", items: expect.any(Array) });
  });

  it("arquivo inválido: o aviso de erro também vem depois do loader, e nada é gravado", async () => {
    const { busy, importFile } = setup();
    const busyWhenToasted: boolean[] = [];
    error.mockImplementation(() => busyWhenToasted.push(busy.value));

    const done = importFile(file("lixo.json", "isto não é uma liturgia"));
    await vi.advanceTimersByTimeAsync(0);
    expect(busy.value).toBe(true);

    await vi.advanceTimersByTimeAsync(500);
    await done;
    expect(error).toHaveBeenCalledWith("library.import_invalid");
    expect(busyWhenToasted).toEqual([false]);
    expect(save).not.toHaveBeenCalled();
    expect(success).not.toHaveBeenCalled();
    expect(track).toHaveBeenCalledWith(
      "liturgy_import_failed",
      expect.objectContaining({ reason: "invalid_format" })
    );
  });

  it("falha ao gravar: solta o loader, avisa o erro e registra a falha", async () => {
    save.mockRejectedValue(new Error("disco cheio"));
    const { busy, importFile } = setup();

    const done = importFile(file("culto.json", JSON_LITURGY));
    await vi.advanceTimersByTimeAsync(500);
    await done;

    expect(busy.value).toBe(false);
    expect(error).toHaveBeenCalledWith("library.import_invalid");
    expect(success).not.toHaveBeenCalled();
    expect(report).toHaveBeenCalledWith(expect.any(Error), "import_json", expect.any(Object));
  });

  it("não deixa começar outro import enquanto um está em andamento", async () => {
    const writing = deferred();
    save.mockReturnValue(writing.promise);
    const { busy, importFile } = setup();

    const first = importFile(file("um.json", JSON_LITURGY));
    await vi.advanceTimersByTimeAsync(0);
    expect(busy.value).toBe(true);

    await importFile(file("dois.json", JSON_LITURGY));
    writing.finish();
    await vi.advanceTimersByTimeAsync(500);
    await first;

    expect(save).toHaveBeenCalledOnce();
    expect(success).toHaveBeenCalledOnce();
  });
});

describe("useLiturgyImport — liturgia que já existe na biblioteca", () => {
  beforeEach(() => {
    getByName.mockResolvedValue({ id: "abc", name: "Culto de domingo" });
  });

  it("sem loader enquanto o operador lê a pergunta, e sem aviso ainda", async () => {
    const { busy, importFile } = setup();

    const done = importFile(file("culto.json", JSON_LITURGY));
    await vi.advanceTimersByTimeAsync(500);
    await done;

    expect(questions).toHaveLength(1);
    expect(busy.value).toBe(false);
    expect(save).not.toHaveBeenCalled();
    expect(success).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it("responder não descarta o arquivo sem gravar nem avisar", async () => {
    const { busy, importFile } = setup();
    const done = importFile(file("culto.json", JSON_LITURGY));
    await vi.advanceTimersByTimeAsync(500);
    await done;

    await questions[0].answer("no");
    await vi.advanceTimersByTimeAsync(500);

    expect(busy.value).toBe(false);
    expect(save).not.toHaveBeenCalled();
    expect(success).not.toHaveBeenCalled();
  });

  it("responder sim liga o loader de novo enquanto sobrescreve, e o aviso vem depois", async () => {
    const { busy, importFile } = setup();
    const busyWhenToasted: boolean[] = [];
    success.mockImplementation(() => busyWhenToasted.push(busy.value));
    const done = importFile(file("culto.json", JSON_LITURGY));
    await vi.advanceTimersByTimeAsync(500);
    await done;

    const writing = deferred();
    save.mockReturnValue(writing.promise);
    const answered = questions[0].answer("yes");
    await vi.advanceTimersByTimeAsync(0);
    expect(busy.value).toBe(true);
    expect(success).not.toHaveBeenCalled();

    writing.finish();
    await vi.advanceTimersByTimeAsync(500);
    await answered;

    expect(busy.value).toBe(false);
    expect(save).toHaveBeenCalledWith({
      id: "abc",
      name: "Culto de domingo",
      items: expect.any(Array),
    });
    expect(busyWhenToasted).toEqual([false]);
    expect(track).toHaveBeenCalledWith(
      "liturgy_import_completed",
      expect.objectContaining({ overwritten: true })
    );
  });

  it("falha ao sobrescrever: solta o loader e avisa o erro", async () => {
    const { busy, importFile } = setup();
    const done = importFile(file("culto.json", JSON_LITURGY));
    await vi.advanceTimersByTimeAsync(500);
    await done;

    save.mockRejectedValue(new Error("sem permissão"));
    const answered = questions[0].answer("yes");
    await vi.advanceTimersByTimeAsync(500);
    await answered;

    expect(busy.value).toBe(false);
    expect(error).toHaveBeenCalledWith("library.import_invalid");
    expect(report).toHaveBeenCalledWith(expect.any(Error), "import_json_save", expect.any(Object));
  });
});

describe("useLiturgyImport — arquivo .ja do Delphi", () => {
  it("cada liturgia do arquivo entra na biblioteca, e o aviso vem uma vez, depois do loader", async () => {
    const { busy, importFile } = setup();
    const busyWhenToasted: boolean[] = [];
    success.mockImplementation(() => busyWhenToasted.push(busy.value));

    const done = importFile(file("liturgia.ja", JA_TWO_LITURGIES));
    await vi.advanceTimersByTimeAsync(0);
    expect(busy.value).toBe(true);
    await vi.advanceTimersByTimeAsync(500);
    await done;

    expect(save).toHaveBeenCalledTimes(2);
    expect(success).toHaveBeenCalledOnce();
    expect(busyWhenToasted).toEqual([false]);
    expect(track).toHaveBeenCalledWith(
      "liturgy_import_completed",
      expect.objectContaining({ liturgy_count: 2, format: "ja" })
    );
  });

  it("arquivo do clássico v26.7+ (UTF-8 com BOM) entra com nome, acentos e caminhos certos", async () => {
    const { importFile } = setup();
    const done = importFile(file("liturgia.ja", JA_V26_7, "utf8-bom"));
    await vi.advanceTimersByTimeAsync(500);
    await done;

    expect(error).not.toHaveBeenCalled();
    expect(save).toHaveBeenCalledOnce();
    const saved = save.mock.calls[0][0] as { name: string; items: Array<Record<string, unknown>> };
    /* O nome de categoria do arquivo é ignorado: a posição manda (1ª = domingo). */
    expect(saved.name).toBe("Domingo");
    expect(saved.items.map((i) => i.item)).toEqual([
      "Culto Divino — Oração",
      "19h00: Vídeo de abertura",
    ]);
    expect(JSON.stringify(saved.items[1])).toContain("João");
    expect(track).toHaveBeenCalledWith(
      "liturgy_import_completed",
      expect.objectContaining({ format: "ja", encoding: "utf8-bom", liturgy_count: 1 })
    );
  });

  it("no formato antigo (Windows-1252), os acentos continuam certos", async () => {
    const { importFile } = setup();
    // Sem o travessão: o `latin1` do Node não o representa (no Windows-1252 real é 0x97).
    const antigo = JA_V26_7.replace(/\r\n\r\n/g, "\r\n").replace("—", "-");
    const done = importFile(file("liturgia.ja", antigo));
    await vi.advanceTimersByTimeAsync(500);
    await done;

    expect(save).toHaveBeenCalledOnce();
    expect((save.mock.calls[0][0] as { name: string }).name).toBe("Domingo");
    expect(track).toHaveBeenCalledWith(
      "liturgy_import_completed",
      expect.objectContaining({ encoding: "cp1252" })
    );
  });

  it(".ja sem liturgia nenhuma é inválido", async () => {
    const { importFile } = setup();
    const done = importFile(file("vazio.ja", "[Outra]\nchave=valor\n"));
    await vi.advanceTimersByTimeAsync(500);
    await done;

    expect(save).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith("library.import_invalid");
  });
});

describe("useLiturgyImport — o seletor de arquivo", () => {
  let created: HTMLInputElement[] = [];

  beforeEach(() => {
    created = [];
    const original = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const element = original(tag);
      if (tag === "input") {
        created.push(element as HTMLInputElement);
        vi.spyOn(element as HTMLInputElement, "click").mockImplementation(() => {});
      }
      return element;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("abre o seletor de .json e .ja, e importa o arquivo escolhido", async () => {
    const { doImport, busy } = setup();
    doImport();

    expect(created).toHaveLength(1);
    const [input] = created;
    expect(input.type).toBe("file");
    expect(input.accept).toBe(".json,.ja");
    expect(input.click).toHaveBeenCalledOnce();

    Object.defineProperty(input, "files", { value: [file("culto.json", JSON_LITURGY)] });
    input.onchange?.(new Event("change"));
    await vi.advanceTimersByTimeAsync(0);
    expect(busy.value).toBe(true);

    await vi.advanceTimersByTimeAsync(500);
    expect(save).toHaveBeenCalledOnce();
    expect(success).toHaveBeenCalledOnce();
  });

  it("fechar o seletor sem escolher nada não importa nem liga o loader", async () => {
    const { doImport, busy } = setup();
    doImport();
    Object.defineProperty(created[0], "files", { value: [] });
    created[0].onchange?.(new Event("change"));
    await vi.advanceTimersByTimeAsync(500);

    expect(busy.value).toBe(false);
    expect(save).not.toHaveBeenCalled();
  });

  it("com um import em andamento, o botão não abre outro seletor", async () => {
    const writing = deferred();
    save.mockReturnValue(writing.promise);
    const { doImport, importFile } = setup();

    void importFile(file("um.json", JSON_LITURGY));
    await vi.advanceTimersByTimeAsync(0);
    doImport();

    expect(created).toHaveLength(0);
    writing.finish();
    await vi.advanceTimersByTimeAsync(500);
  });
});

describe("useLiturgyImport — nome do .ja pela posição", () => {
  /** `.ja` com N grupos sem item categoria — o caso do arquivo do legado. */
  function muitosGrupos(n: number): string {
    return [
      "[Geral]",
      ...Array.from({ length: n }, (_, i) => `${i + 1}=item_${i};`),
      ...Array.from(
        { length: n },
        (_, i) => `[item_${i}]\ntipo=arquivo\nitem=Item ${i}\nsubtipo=arq\ndir=C:\\v${i}.mp4\n`
      ),
    ].join("\n");
  }

  const nomesSalvos = () => save.mock.calls.map(([dados]) => (dados as { name: string }).name);

  it("a primeira liturgia é domingo, a segunda segunda-feira", async () => {
    const { importFile } = setup();
    const done = importFile(file("liturgia.ja", JA_TWO_LITURGIES));
    await vi.advanceTimersByTimeAsync(500);
    await done;

    expect(nomesSalvos()).toEqual(["Domingo", "Segunda"]);
  });

  it("nome já usado na biblioteca ganha número", async () => {
    list.mockResolvedValue([{ name: "Domingo" }]);
    const { importFile } = setup();
    const done = importFile(file("liturgia.ja", JA_TWO_LITURGIES));
    await vi.advanceTimersByTimeAsync(500);
    await done;

    expect(nomesSalvos()).toEqual(["Domingo 1", "Segunda"]);
  });

  it("importar duas vezes no mesmo dia continua numerando", async () => {
    /* A biblioteca devolve o que o primeiro import gravou. */
    list.mockResolvedValue([{ name: "Domingo" }, { name: "Segunda" }, { name: "Domingo 1" }]);
    const { importFile } = setup();
    const done = importFile(file("liturgia.ja", JA_TWO_LITURGIES));
    await vi.advanceTimersByTimeAsync(500);
    await done;

    expect(nomesSalvos()).toEqual(["Domingo 2", "Segunda 1"]);
  });

  it("depois do sétimo dia o ciclo reinicia e numera", async () => {
    const { importFile } = setup();
    const done = importFile(file("liturgia.ja", muitosGrupos(8)));
    await vi.advanceTimersByTimeAsync(500);
    await done;

    const nomes = nomesSalvos();
    expect(nomes).toHaveLength(8);
    /* Domingo, Segunda … Sábado, e o oitavo volta a ser Domingo — que já foi
     * usado neste MESMO arquivo, então entra numerado. */
    expect(nomes[0]).toBe("Domingo");
    expect(nomes[1]).toBe("Segunda");
    expect(nomes[6]).toBe("Sábado");
    expect(nomes[7]).toBe("Domingo 1");
  });

  it("ignora o nome de categoria quando o arquivo traz um", async () => {
    const { importFile } = setup();
    const done = importFile(file("liturgia.ja", JA_V26_7, "utf8-bom"));
    await vi.advanceTimersByTimeAsync(500);
    await done;

    expect(nomesSalvos()).toEqual(["Domingo"]);
  });
});
