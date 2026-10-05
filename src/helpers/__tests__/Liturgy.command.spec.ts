import { describe, it, expect, beforeEach } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import $liturgy from "@/helpers/Liturgy";
import $userdata from "@/helpers/UserData";
import { KEYS } from "@/constants/UserDataKeys";

/**
 * `getFromCommand` — a resolução do dia para comandos remotos.
 *
 * O bug que motivou este arquivo: a rota `GET /api/liturgy` (sem `day`) devolve
 * a lista de **hoje**, mas o `ACTIVE_DAY` só é sincronizado para hoje quando o
 * módulo de liturgia **abre** na sessão — antes disso ele aponta para o dia da
 * última sessão e o `liturgy-execute` não achava o item ("item não encontrado",
 * com o POST já respondido 200). Aqui ficam os três degraus: dia do cliente →
 * hoje → dia ativo.
 */
function seedDay(day: number, ids: string[]): void {
  $userdata.set(
    `${KEYS.MODULES.LITURGY.DAYS}.${day}`,
    ids.map((id) => ({ id, tipo: "anotacao", item: `item ${id}` }))
  );
}

function seedActiveDay(day: number): void {
  $userdata.set(KEYS.MODULES.LITURGY.ACTIVE_DAY, day);
}

describe("Liturgy.getFromCommand", () => {
  beforeEach(() => {
    // Store novo por teste — o helper lê só do store, sem tocar no disco.
    setActivePinia(createPinia());
  });

  it("regressão: acha o item de HOJE mesmo com o ACTIVE_DAY de outra sessão", () => {
    const hoje = new Date().getDay();
    seedActiveDay((hoje + 3) % 7); // dia ativo defasado (só o módulo corrige)
    seedDay(hoje, ["item-hoje"]);

    expect($liturgy.getFromCommand("item-hoje")?.id).toBe("item-hoje");
  });

  it("dia explícito do cliente: busca naquele dia, mesmo hoje e ativo errados", () => {
    const hoje = new Date().getDay();
    seedActiveDay(hoje); // módulo já aberto → dia ativo = hoje
    seedDay(hoje, []); // hoje vazio
    seedDay(5, ["item-sexta"]);

    expect($liturgy.getFromCommand("item-sexta", 5)?.id).toBe("item-sexta");
    // Sem o day, o fallback (hoje → ativo) não encontra — era exatamente o
    // caso que o espelhamento puro perderia.
    expect($liturgy.getFromCommand("item-sexta")).toBeNull();
  });

  it("sem day: hoje primeiro e, na falta, o dia ativo (o par da rota)", () => {
    const hoje = new Date().getDay();
    const ativo = (hoje + 3) % 7;
    seedActiveDay(ativo);
    seedDay(hoje, []); // hoje vazio → a rota cairia no dia ativo
    seedDay(ativo, ["item-ativo"]);

    expect($liturgy.getFromCommand("item-ativo")?.id).toBe("item-ativo");
  });

  it("day fora de 0..6 é ignorado (não vira outro dia por clamp)", () => {
    const hoje = new Date().getDay();
    const vazio = [0, 1, 2, 3, 4, 5, 6].find((d) => d !== hoje && d !== 6) as number;
    seedActiveDay(vazio);
    seedDay(hoje, []);
    seedDay(vazio, []);
    seedDay(6, ["item-sabado"]); // só no sábado

    // Sem a faixa 0..6, 99 viraria sábado (clampDay) e acharia o item errado.
    expect($liturgy.getFromCommand("item-sabado", 99)).toBeNull();
    expect($liturgy.getFromCommand("item-sabado", 6)?.id).toBe("item-sabado");
  });

  it("id desconhecido devolve null", () => {
    expect($liturgy.getFromCommand("nao-existe")).toBeNull();
  });
});
