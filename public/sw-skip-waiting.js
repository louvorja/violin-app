// No Chrome, o skipWaiting() feito depois da instalação é o que encerra o SW antigo
// assim que ele fica livre; sem isso a versão nova espera até 5 minutos.
self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});
