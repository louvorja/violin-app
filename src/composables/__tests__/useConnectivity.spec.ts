import { describe, it, expect, beforeEach } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useConnectivity, reportNetworkResult, _resetConnectivity } from "@/composables/useConnectivity";
import $appdata from "@/helpers/AppData";
import { KEYS } from "@/constants/UserDataKeys";

/**
 * O app roda ao vivo, com o culto acontecendo. Errar para o lado de "está
 * offline" é pior do que demorar a perceber: a interface degrada, botões
 * apagam e o operador não entende por quê.
 *
 * Daí as duas regras que este teste protege: duas falhas seguidas para cair
 * (uma só pode ser um arquivo grande que estourou o prazo) e um único sucesso
 * para voltar (aí não há dúvida — o servidor respondeu).
 */
describe("useConnectivity", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    _resetConnectivity();
    $appdata.set(KEYS.SHELL.IS_ONLINE, true);
  });

  it("começa online", () => {
    expect(useConnectivity().isOnline.value).toBe(true);
  });

  it("uma falha isolada não derruba", () => {
    const { isOnline } = useConnectivity();
    reportNetworkResult(false);
    expect(isOnline.value).toBe(true);
  });

  it("duas falhas seguidas derrubam", () => {
    const { isOnline } = useConnectivity();
    reportNetworkResult(false);
    reportNetworkResult(false);
    expect(isOnline.value).toBe(false);
  });

  it("um sucesso no meio zera a contagem", () => {
    const { isOnline } = useConnectivity();
    reportNetworkResult(false);
    reportNetworkResult(true);
    reportNetworkResult(false);
    expect(isOnline.value).toBe(true);
  });

  it("um único sucesso traz de volta", () => {
    const { isOnline } = useConnectivity();
    reportNetworkResult(false);
    reportNetworkResult(false);
    expect(isOnline.value).toBe(false);
    reportNetworkResult(true);
    expect(isOnline.value).toBe(true);
  });

  it("escreve no estado global que o player já lia", () => {
    // `IS_ONLINE` decide entre tocar em streaming e baixar o blob inteiro. O
    // composable assumiu essa chave em vez de criar outra, para não haver duas
    // versões da verdade.
    useConnectivity();
    reportNetworkResult(false);
    reportNetworkResult(false);
    expect($appdata.get(KEYS.SHELL.IS_ONLINE)).toBe(false);
  });

  it("guardNetwork libera com rede e barra sem rede", () => {
    const { guardNetwork } = useConnectivity();
    expect(guardNetwork()).toBe(true);
    reportNetworkResult(false);
    reportNetworkResult(false);
    expect(guardNetwork()).toBe(false);
  });

  it("registra desde quando está fora", () => {
    const { offlineSince } = useConnectivity();
    expect(offlineSince.value).toBe(null);
    reportNetworkResult(false);
    reportNetworkResult(false);
    expect(typeof offlineSince.value).toBe("number");
  });
});
