import { GlobalWorkerOptions, getDocument, type PDFDocumentProxy } from 'pdfjs-dist';
import worker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

GlobalWorkerOptions.workerSrc = worker;

export const PAGE_WIDTH = 800; // scene units; every page is scaled to this width
export const PAGE_GAP = 60;

const opened = new Map<string, Promise<PDFDocumentProxy>>();
const open = (key: string) => {
	if (!opened.has(key)) opened.set(key, getDocument({ url: `/api/files/${key}` }).promise);
	return opened.get(key)!;
};

/** Height of every page once scaled to PAGE_WIDTH, read from a local file before it is uploaded. */
export async function pageHeights(file: File): Promise<number[]> {
	const task = getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
	const pdf = await task.promise;
	const heights: number[] = [];
	for (let n = 1; n <= pdf.numPages; n++) {
		const { width, height } = (await pdf.getPage(n)).getViewport({ scale: 1 });
		heights.push((height / width) * PAGE_WIDTH);
	}
	await task.destroy();
	return heights;
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
