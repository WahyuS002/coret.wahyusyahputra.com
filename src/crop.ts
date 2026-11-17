import type { ExcalidrawElement, ExcalidrawImageElement } from '@excalidraw/excalidraw/element/types';
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import { bounds, overlap, type Box } from './geometry.ts';
import { renderPage } from './pdf.ts';

export type PageData = { pdf: string; page: number };
export const pageOf = (element: ExcalidrawElement) => element.customData as PageData | undefined;

/** The PDF page or pasted image a mark sits on; the one it covers most when it straddles two. */
export const pageUnder = (api: ExcalidrawImperativeAPI, box: ExcalidrawElement) =>
	(api.getSceneElements() as readonly ExcalidrawElement[])
		.filter((element): element is ExcalidrawImageElement => element.type === 'image' && element.id !== box.id && !!element.fileId && overlap(element, box) > 0)
		.sort((a, b) => overlap(b, box) - overlap(a, box))[0];

/** What DeepSeek sees for a mark: the page around it, with the mark outlined in red. Several boxes (a phrase across lines) count as one mark. */
export async function cropMark(api: ExcalidrawImperativeAPI, marks: readonly Box[], target: ExcalidrawImageElement): Promise<string> {
	const page = pageOf(target);
	const src = api.getFiles()[target.fileId!]?.dataURL ?? (page ? await renderPage(page.pdf, page.page) : null);
	if (!src) throw new Error('gambarnya belum termuat');
	return crop(src, target, marks);
}

/**
 * The part of `image` around `marks`, cut from its bitmap, with each mark outlined in red.
 * The margin gives the model the surrounding words, so a tight box on one word (or one that clips a letter) still reads right.
 * Small marks are scaled up so the model can read them.
 */
async function crop(src: string, image: Box, marks: readonly Box[]): Promise<string> {
	const box = bounds(marks);
	const bitmap = new Image();
	bitmap.src = src;
	await bitmap.decode();
	const sx = bitmap.naturalWidth / image.width;
	const sy = bitmap.naturalHeight / image.height;
	const pad = Math.min(Math.max(box.width, box.height), 150); // scene units; capped so a whole panel doesn't pull in half the page
	const left = Math.max(box.x - pad, image.x);
	const top = Math.max(box.y - pad, image.y);
	const width = (Math.min(box.x + box.width + pad, image.x + image.width) - left) * sx;
	const height = (Math.min(box.y + box.height + pad, image.y + image.height) - top) * sy;
	const up = Math.max(1, 768 / Math.max(width, height));
	const canvas = document.createElement('canvas');
	canvas.width = Math.round(width * up);
	canvas.height = Math.round(height * up);
	const context = canvas.getContext('2d')!;
	context.drawImage(bitmap, (left - image.x) * sx, (top - image.y) * sy, width, height, 0, 0, canvas.width, canvas.height);
	context.strokeStyle = '#e03131';
	context.lineWidth = Math.max(3, canvas.width / 200);
	for (const mark of marks) context.strokeRect((mark.x - left) * sx * up, (mark.y - top) * sy * up, mark.width * sx * up, mark.height * sy * up);
	return canvas.toDataURL('image/jpeg', 0.9);
}
