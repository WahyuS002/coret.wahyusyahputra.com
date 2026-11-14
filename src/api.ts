export type Item = { id: string; parentId: string | null; name: string; kind: 'folder' | 'canvas'; pdf: string | null; updated: string; deleted?: boolean };
/** What a canvas keeps in R2. `images` maps an Excalidraw file id to its upload in R2; PDF pages are not in it, they are rendered from the PDF. */
export type Scene = { elements: readonly unknown[]; images: Record<string, string> };

async function call<T>(path: string, init?: RequestInit): Promise<T> {
	const response = await fetch(`/api/${path}`, init);
	if (!response.ok) throw new Error(((await response.json().catch(() => null)) as { error?: string } | null)?.error ?? `${response.status}`);
	return response.json();
}

const put = (body: unknown): RequestInit => ({ method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

export const listItems = () => call<Item[]>('items');
export const saveItem = (item: Item) => call(`items/${item.id}`, put(item));
export const loadScene = (id: string) => call<Scene | null>(`canvas/${id}`);
export const saveScene = (id: string, scene: Scene) => call(`canvas/${id}`, put(scene));
export const uploadFile = (blob: Blob) => call<{ key: string }>('files', { method: 'POST', headers: { 'content-type': blob.type }, body: blob }).then(r => r.key);
/** One question and its answer about a mark; the first answer explains the mark and has no question. */
export type Turn = { q: string | null; a: string };
/** Explains the red box in `image`; with the conversation so far and a new `question`, answers that instead. */
export const explain = (image: string, turns?: Turn[], question?: string) =>
	call<{ text: string }>('explain', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ image, turns, question }) }).then(r => r.text);
