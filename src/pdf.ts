import { convertToExcalidrawElements } from '@excalidraw/excalidraw';
import type { FileId } from '@excalidraw/excalidraw/element/types';
import { GlobalWorkerOptions, getDocument, type PDFDocumentProxy } from 'pdfjs-dist';
import worker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

GlobalWorkerOptions.workerSrc = worker;

// pdf.js fetches decoders (JBIG2/JPEG 2000 in scanned books) and non-embedded fonts by file name; without them those pages render blank.
const data = import.meta.glob<string>(['../node_modules/pdfjs-dist/wasm/*.wasm', '../node_modules/pdfjs-dist/standard_fonts/*'], { query: '?url', import: 'default', eager: true });
const urls = new Map(Object.entries(data).map(([path, url]) => [path.split('/').pop()!, url]));
class BinaryDataFactory {
	async fetch({ filename }: { filename: string }) {
		const url = urls.get(filename);
		if (!url) throw new Error(`pdf.js data not bundled: ${filename}`);
		return new Uint8Array(await (await fetch(url)).arrayBuffer());
	}
}
const load = (source: { url: string } | { data: Uint8Array }) => getDocument({ ...source, BinaryDataFactory });

export const PAGE_WIDTH = 800; // scene units; every page is scaled to this width
export const PAGE_GAP = 60;

const opened = new Map<string, Promise<PDFDocumentProxy>>();
const open = (key: string) => {
	if (!opened.has(key)) opened.set(key, load({ url: `/api/files/${key}` }).promise);
	return opened.get(key)!;
};

/**
 * Every page of the PDF in R2 at `key`, stacked top to bottom at PAGE_WIDTH and locked so drawing never drags a page.
 * Pass the local `file` right after uploading it so it isn't downloaded back.
 */
export async function pageElements(key: string, file?: File) {
	if (file) opened.set(key, load({ data: new Uint8Array(await file.arrayBuffer()) }).promise);
	const pdf = await open(key);
	let y = 0;
	const pages = [];
	for (let n = 1; n <= pdf.numPages; n++) {
		const { width, height } = (await pdf.getPage(n)).getViewport({ scale: 1 });
		const scaled = (height / width) * PAGE_WIDTH;
		pages.push({ type: 'image' as const, x: 0, y, width: PAGE_WIDTH, height: scaled, fileId: `pdf:${key}:${n}` as FileId, status: 'saved' as const, locked: true, customData: { pdf: key, page: n } });
		y += scaled + PAGE_GAP;
	}
	return convertToExcalidrawElements(pages);
}

/** One page as a JPEG data URL, at twice PAGE_WIDTH so it stays sharp when zoomed in. */
export async function renderPage(key: string, page: number): Promise<string> {
	const pdfPage = await (await open(key)).getPage(page);
	const viewport = pdfPage.getViewport({ scale: (PAGE_WIDTH * 2) / pdfPage.getViewport({ scale: 1 }).width });
	const canvas = document.createElement('canvas');
	canvas.width = Math.ceil(viewport.width);
	canvas.height = Math.ceil(viewport.height);
	await pdfPage.render({ canvas, viewport }).promise;
	return canvas.toDataURL('image/jpeg', 0.85);
}
