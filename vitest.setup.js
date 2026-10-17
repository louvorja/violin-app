// O Node 25 expõe um `localStorage` próprio (sem `--localstorage-file` ele vem
// quebrado: sem `clear`) e ele sobrepõe o do jsdom. Onde o global está
// incompleto, instala um Storage em memória para os testes.
function memoryStorage() {
  const data = new Map();
  return {
    get length() {
      return data.size;
    },
    key: (index) => [...data.keys()][index] ?? null,
    getItem: (key) => (data.has(String(key)) ? data.get(String(key)) : null),
    setItem: (key, value) => void data.set(String(key), String(value)),
    removeItem: (key) => void data.delete(String(key)),
    clear: () => data.clear(),
  };
}

for (const name of ["localStorage", "sessionStorage"]) {
  let current;
  try {
    current = globalThis[name];
  } catch {
    current = undefined;
  }
  if (typeof current?.clear !== "function") {
    Object.defineProperty(globalThis, name, {
      configurable: true,
      writable: true,
      value: memoryStorage(),
    });
  }
}
