// Verifies the Cloudflare Access JWT so the API stays closed even if Access is misconfigured or bypassed.
// https://developers.cloudflare.com/cloudflare-one/identity/authorization-cookie/validating-json/

const decoder = new TextDecoder();
const bytes = (part: string) => Uint8Array.from(atob(part.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
const json = (part: string) => JSON.parse(decoder.decode(bytes(part)));

export async function accessEmail(request: Request, teamDomain: string, aud: string): Promise<string | null> {
  const token = request.headers.get('cf-access-jwt-assertion');
  if (!token || !teamDomain || !aud) return null;
  try {
    const [head, body, signature] = token.split('.');
    const header = json(head);
    const payload = json(body);
    const issuer = `https://${teamDomain}`;
    if (header.alg !== 'RS256' || payload.iss !== issuer || ![payload.aud].flat().includes(aud) || !(payload.exp * 1000 > Date.now())) return null;
    const { keys } = await (await fetch(`${issuer}/cdn-cgi/access/certs`)).json() as { keys: (JsonWebKey & { kid: string })[] };
    const jwk = keys.find(key => key.kid === header.kid);
    if (!jwk) return null;
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, bytes(signature), new TextEncoder().encode(`${head}.${body}`));
    return valid && typeof payload.email === 'string' ? payload.email : null;
  } catch {
    return null;
  }
}
