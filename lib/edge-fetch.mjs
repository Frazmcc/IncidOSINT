// Workers supports "manual", but rejects the standard fetch "error" mode.
// Never forward a provider key or Site service token to a redirect destination.
export async function fetchWithoutRedirect(input, init = {}) {
  const response = await fetch(input, {...init, redirect:"manual"});
  if (response.status >= 300 && response.status < 400) {
    await response.body?.cancel().catch(() => {});
    throw new Error("The provider returned an unexpected redirect. The request was stopped without forwarding your credentials.");
  }
  return response;
}
