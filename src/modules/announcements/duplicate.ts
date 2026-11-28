/**
 * @category helper-puro — Monta a cópia de um anúncio para o "Duplicar" do menu.
 *
 * O problema que motivou separar isto do componente: o item do menu contextual
 * vem da lista reativa, então é um `Proxy` do Vue. `structuredClone` não clona
 * `Proxy` e lança `DataCloneError` ("#<Object> could not be cloned") — o
 * "Duplicar" falhava sempre, sem criar nada.
 *
 * A cópia aqui é feita campo a campo, lendo pelo `Proxy` como qualquer outra
 * leitura: o resultado é um objeto comum, que o IndexedDB guarda e o
 * `structuredClone` aceita. A mídia vai junto por referência — `Blob` é
 * imutável e o Vue não o envolve em `Proxy` — e o `style` ganha um objeto
 * próprio, para editar a cópia sem mexer no original.
 */

interface AnuncioDuplicavel {
  id: string;
  nome: string;
  ordem: number;
  style: object;
}

export function duplicarAnuncio<T extends AnuncioDuplicavel>(
  original: T,
  ordensExistentes: readonly number[],
  novoId: string
): T {
  const ultimaOrdem = ordensExistentes.length ? Math.max(...ordensExistentes) : 0;
  return {
    ...original,
    style: { ...original.style },
    id: novoId,
    nome: `${original.nome} (cópia)`,
    ordem: ultimaOrdem + 1,
  };
}
