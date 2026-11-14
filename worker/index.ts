import { accessEmail } from './access.ts';

type Item = { id: string; parentId: string | null; name: string; kind: 'folder' | 'canvas'; pdf: string | null; updated: string; deleted: boolean };

const MAX_FILE = 100_000_000; // PDFs of scanned comics get big
const types: Record<string, string> = { 'application/pdf': 'pdf', 'image/webp': 'webp', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/svg+xml': 'svg' };
const id = /^[\w-]{1,100}$/;
const json = (data: unknown, status = 200) => Response.json(data, { status });
const fail = (status: number, message: string) => json({ error: message }, status);

// Asks for a gloss the size of a margin note, the way the user writes them by hand.
const PROMPT = `Kamu membantu orang Indonesia membaca teks berbahasa Inggris (sering komik atau buku lama).
Gambar adalah potongan halaman. Bagian yang ditanyakan pembaca diberi kotak merah; sisanya hanya konteks, jangan dijelaskan.
Jelaskan bagian dalam kotak merah dalam Bahasa Indonesia sesingkat catatan di pinggir halaman, sesuai artinya di kalimat itu:
- satu kata atau frasa: beri artinya, plus konteks singkat kalau ejaannya lama atau dialek (mis. "O'" = "of").
- satu kalimat atau balon kata: terjemahan bebas yang enak dibaca.
- gambar tanpa teks: sebut apa itu dalam beberapa kata.
Maksimal 25 kata. Tanpa pembuka, tanpa tanda kutip, tanpa markdown.`;

async function explain(request: Request, env: Env) {
	const { image } = (await request.json().catch(() => ({}))) as { image?: unknown };
	if (typeof image !== 'string' || !image.startsWith('data:image/') || image.length > 8_000_000) return fail(400, 'Gambar tidak valid');
	if (!env.DEEPSEEK_API_KEY) return fail(500, 'DEEPSEEK_API_KEY belum di-set');
	const response = await fetch('https://api.deepseek.com/chat/completions', {
		method: 'POST',
		headers: { authorization: `Bearer ${env.DEEPSEEK_API_KEY}`, 'content-type': 'application/json' },
		body: JSON.stringify({
			model: 'deepseek-flash',
			thinking: { type: 'disabled' },
			max_tokens: 200,
			messages: [
				{ role: 'system', content: PROMPT },
				{ role: 'user', content: [{ type: 'image_url', image_url: { url: image } }] },
			],
		}),
	});
	if (!response.ok) return fail(502, `DeepSeek ${response.status}: ${(await response.text()).slice(0, 300)}`);
	const data = (await response.json()) as { choices?: { message?: { content?: string } }[] };
	return json({ text: data.choices?.[0]?.message?.content?.trim() ?? '' });
}

/** Removes a deleted canvas's files from R2: its drawing, its PDF, and every image pasted into it. */
async function purge(env: Env, key: string, pdf: string | null | undefined) {
	const scene = await (await env.FILES.get(`canvas/${key}.json`))?.json<{ images?: Record<string, string> }>();
	const files = [...Object.values(scene?.images ?? {}), ...(pdf ? [pdf] : [])].filter(name => /^[0-9a-f-]{36}\.\w+$/.test(name));
	await env.FILES.delete([`canvas/${key}.json`, ...files.map(name => `files/${name}`)]);
}

async function api(request: Request, env: Env, path: string[]): Promise<Response> {
	const [resource, key] = path;
	const method = request.method;

	if (resource === 'items' && !key && method === 'GET') {
		type Row = { id: string; parent_id: string | null; name: string; kind: Item['kind']; pdf: string | null; updated: string };
		const { results } = await env.DB.prepare('SELECT * FROM items WHERE deleted = 0 ORDER BY name').all<Row>();
		return json(results.map(row => ({ id: row.id, parentId: row.parent_id, name: row.name, kind: row.kind, pdf: row.pdf, updated: row.updated })));
	}

	if (resource === 'items' && key && id.test(key) && method === 'PUT') {
		const item = (await request.json().catch(() => null)) as Partial<Item> | null;
		if (!item || typeof item.name !== 'string' || !item.name.trim() || item.name.length > 300 || (item.kind !== 'folder' && item.kind !== 'canvas') || typeof item.updated !== 'string' || !Number.isFinite(Date.parse(item.updated)))
			return fail(400, 'Data tidak valid');
		// Last write wins: an older copy from another device never overwrites a newer one.
		const { meta } = await env.DB.prepare(
			`INSERT INTO items (id, parent_id, name, kind, pdf, updated, deleted) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
			 ON CONFLICT(id) DO UPDATE SET parent_id = excluded.parent_id, name = excluded.name, pdf = excluded.pdf, updated = excluded.updated, deleted = excluded.deleted
			 WHERE excluded.updated > items.updated`,
		)
			.bind(key, item.parentId ?? null, item.name.trim(), item.kind, item.pdf ?? null, item.updated, item.deleted ? 1 : 0)
			.run();
		if (item.deleted && item.kind === 'canvas' && meta.changes) await purge(env, key, item.pdf);
		return json({ ok: true });
	}

	if (resource === 'canvas' && key && id.test(key)) {
		if (method === 'GET') {
			const object = await env.FILES.get(`canvas/${key}.json`);
			return object ? new Response(object.body, { headers: { 'content-type': 'application/json' } }) : json(null);
		}
		if (method === 'PUT') {
			// A save still in flight when its canvas is deleted must not bring the drawing back.
			if (await env.DB.prepare('SELECT 1 FROM items WHERE id = ?1 AND deleted = 1').bind(key).first()) return fail(410, 'Canvas sudah dihapus');
			await env.FILES.put(`canvas/${key}.json`, request.body, { httpMetadata: { contentType: 'application/json' } });
			return json({ ok: true });
		}
	}

	if (resource === 'files' && !key && method === 'POST') {
		const type = request.headers.get('content-type') ?? '';
		if (!types[type]) return fail(415, 'Jenis file tidak didukung');
		const body = await request.arrayBuffer();
		if (!body.byteLength || body.byteLength > MAX_FILE) return fail(413, 'File terlalu besar');
		const name = `${crypto.randomUUID()}.${types[type]}`;
		await env.FILES.put(`files/${name}`, body, { httpMetadata: { contentType: type } });
		return json({ key: name });
	}

	if (resource === 'files' && key && /^[0-9a-f-]{36}\.\w+$/.test(key) && method === 'GET') {
		const object = await env.FILES.get(`files/${key}`);
		if (!object) return fail(404, 'Tidak ada');
		// Names are never reused, so the browser can keep a file for good.
		return new Response(object.body, { headers: { 'content-type': object.httpMetadata?.contentType ?? 'application/octet-stream', 'cache-control': 'private, max-age=31536000, immutable' } });
	}

	if (resource === 'explain' && method === 'POST') return explain(request, env);

	return fail(404, 'Tidak ada');
}

export default {
	async fetch(request, env) {
		const url = new URL(request.url);
		if (!url.pathname.startsWith('/api/')) return fail(404, 'Tidak ada');
		if (!env.AUTH_DISABLED && !(await accessEmail(request, env.ACCESS_TEAM_DOMAIN, env.ACCESS_AUD))) return fail(401, 'Belum login');
		return api(request, env, url.pathname.split('/').slice(2));
	},
} satisfies ExportedHandler<Env>;
