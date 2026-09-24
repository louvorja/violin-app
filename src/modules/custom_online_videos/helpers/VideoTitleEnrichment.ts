/**
 * O título do oEmbed é opcional. Escritas do mesmo vídeo são serializadas para
 * que uma resposta atrasada não ressuscite um item removido nem desfaça uma edição.
 */
export function createVideoTitleEnrichment<T extends { id: string; name: string; url: string }>({
  find,
  fetchTitle,
  persist,
}: {
  find: (id: string) => T | undefined;
  fetchTitle: (videoId: string) => Promise<string | null>;
  persist: (item: T) => Promise<void>;
}) {
  const pending = new Map<string, symbol>();
  const writes = new Map<string, Promise<void>>();

  function write(id: string, action: () => Promise<void>): Promise<void> {
    const previous = writes.get(id) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(action);
    writes.set(id, next);
    const clear = () => {
      if (writes.get(id) === next) writes.delete(id);
    };
    void next.then(clear, clear);
    return next;
  }

  function invalidate(id: string): void {
    pending.delete(id);
  }

  function enrich({ id, videoId, url, temporaryName }: {
    id: string;
    videoId: string;
    url: string;
    temporaryName: string;
  }): void {
    const token = Symbol(id);
    pending.set(id, token);
    void Promise.resolve()
      .then(() => fetchTitle(videoId))
      .then((rawTitle) => {
        const title = rawTitle?.trim().slice(0, 200);
        if (!title || title === temporaryName) return;
        return write(id, async () => {
          if (pending.get(id) !== token) return;
          const current = find(id);
          if (!current || current.url !== url || current.name !== temporaryName) return;
          await persist({ ...current, name: title });
          // Uma edição pode começar enquanto o IndexedDB grava. Ela já entrou na
          // fila e gravará depois, e a UI não deve voltar a mostrar o título antigo.
          if (pending.get(id) === token && current.name === temporaryName) current.name = title;
        });
      })
      .catch(() => {
        // Título é enriquecimento opcional; o ID continua utilizável.
      })
      .finally(() => {
        if (pending.get(id) === token) pending.delete(id);
      });
  }

  return { write, invalidate, enrich };
}
