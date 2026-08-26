// Redireciona para o checkout da Hotmart preservando ?sck= (rastreio de origem)
// e qualquer outro parâmetro de tracking. Href fica no próprio domínio (sem
// "hotmart" nele) pra não cair em filtro cosmético de ad blocker.
export async function onRequest(context) {
  const incoming = new URL(context.request.url);
  const dest = new URL('https://go.hotmart.com/U106917086S');
  dest.searchParams.set('dp', '1');
  incoming.searchParams.forEach((value, key) => {
    if (key !== 'dp') dest.searchParams.set(key, value);
  });
  return Response.redirect(dest.toString(), 302);
}
