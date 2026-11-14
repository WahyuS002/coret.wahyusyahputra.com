import { CaptureUpdateAction, Excalidraw, convertToExcalidrawElements, getSceneVersion } from '@excalidraw/excalidraw';
import type { ExcalidrawElement, ExcalidrawImageElement, FileId } from '@excalidraw/excalidraw/element/types';
import type { BinaryFileData, ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import { useEffect, useRef, useState } from 'react';
import { explain, loadScene, saveScene, uploadFile, type Item, type Scene } from './api.ts';
import { overlap, wrap, type Box } from './geometry.ts';
import { renderPage } from './pdf.ts';

type PageData = { pdf: string; page: number };

const pageOf = (element: ExcalidrawElement) => element.customData as PageData | undefined;
const toDataURL = (blob: Blob) =>
	new Promise<string>((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(reader.result as string);
		reader.onerror = () => reject(reader.error);
		reader.readAsDataURL(blob);
	});

/** The part of `image` under `box`, cut from its bitmap. Small marks (one word) are scaled up so the model can read them. */
async function crop(src: string, image: Box, box: Box): Promise<string> {
	const bitmap = new Image();
	bitmap.src = src;
	await bitmap.decode();
	const sx = bitmap.naturalWidth / image.width;
	const sy = bitmap.naturalHeight / image.height;
	const left = Math.max(box.x, image.x);
	const top = Math.max(box.y, image.y);
	const width = (Math.min(box.x + box.width, image.x + image.width) - left) * sx;
	const height = (Math.min(box.y + box.height, image.y + image.height) - top) * sy;
	const up = Math.max(1, 512 / Math.max(width, height));
	const canvas = document.createElement('canvas');
	canvas.width = Math.round(width * up);
	canvas.height = Math.round(height * up);
	canvas.getContext('2d')!.drawImage(bitmap, (left - image.x) * sx, (top - image.y) * sy, width, height, 0, 0, canvas.width, canvas.height);
	return canvas.toDataURL('image/jpeg', 0.9);
}

export function Canvas({ item }: { item: Item }) {
	const [scene, setScene] = useState<Scene | null>(null);
	const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
	const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
	const [status, setStatus] = useState('');
	const [busy, setBusy] = useState(false);
	const [width, setWidth] = useState(0);
	const images = useRef<Record<string, string>>({});
	const requested = useRef(new Set<string>());
	const savedVersion = useRef(-1);
	const timer = useRef<number | undefined>(undefined);
	const queue = useRef(Promise.resolve());
	const container = useRef<HTMLDivElement>(null);

	useEffect(() => {
		loadScene(item.id).then(
			loaded => {
				images.current = { ...loaded?.images };
				setScene(loaded ?? { elements: [], images: {} });
				setWidth(container.current?.clientWidth ?? 0);
			},
			error => setStatus(`Gagal membuka: ${error.message}`),
		);
	}, [item.id]);

	// Uploaded images come back from R2.
	useEffect(() => {
		if (!api || !scene) return;
		for (const [id, key] of Object.entries(scene.images))
			fetch(`/api/files/${key}`)
				.then(response => response.blob())
				.then(async blob => api.addFiles([{ id: id as FileId, dataURL: (await toDataURL(blob)) as BinaryFileData['dataURL'], mimeType: blob.type as BinaryFileData['mimeType'], created: Date.now() }]))
				.catch(() => setStatus('Ada gambar yang gagal dimuat'));

		return api.onScrollChange(showPages);
	}, [api, scene]);

	// PDF pages are rendered once they come near the screen. Runs on every change and scroll; pages already asked for are skipped.
	function showPages() {
		const api = apiRef.current;
		if (!api) return;
		const { scrollX, scrollY, zoom, width, height } = api.getAppState();
		const view = { x: -scrollX, y: -scrollY - height / zoom.value, width: width / zoom.value, height: (3 * height) / zoom.value }; // a screen above and below too
		// ponytail: rendered pages stay in memory for as long as the canvas is open; evict far pages if long PDFs get heavy
		for (const element of api.getSceneElements()) {
			const page = pageOf(element);
			if (element.type !== 'image' || !page || !element.fileId || requested.current.has(element.fileId) || !overlap(element, view)) continue;
			const fileId = element.fileId;
			requested.current.add(fileId);
			renderPage(page.pdf, page.page).then(
				dataURL => api.addFiles([{ id: fileId, dataURL: dataURL as BinaryFileData['dataURL'], mimeType: 'image/jpeg', created: Date.now() }]),
				() => requested.current.delete(fileId),
			);
		}
	}

	// save() and flush() read refs only, so the unmount handler below (registered once) never sees stale state.
	async function save() {
		const api = apiRef.current;
		if (!api) return;
		const files = api.getFiles();
		const elements = api.getSceneElements();
		for (const element of elements) {
			if (element.type !== 'image' || !element.fileId || pageOf(element) || images.current[element.fileId] || !files[element.fileId]) continue;
			try {
				images.current[element.fileId] = await uploadFile(await (await fetch(files[element.fileId].dataURL)).blob());
			} catch (error) {
				setStatus(`Gambar gagal diunggah: ${(error as Error).message}`);
			}
		}
		await saveScene(item.id, { elements, images: images.current });
	}

	function flush() {
		if (timer.current === undefined) return;
		clearTimeout(timer.current);
		timer.current = undefined;
		queue.current = queue.current.then(save).then(
			() => setStatus(status => (status === 'Menyimpan…' ? '' : status)),
			error => setStatus(`Gagal menyimpan: ${error.message}`),
		);
	}

	function onChange(elements: readonly ExcalidrawElement[]) {
		showPages();
		const version = getSceneVersion(elements);
		if (version === savedVersion.current) return;
		savedVersion.current = version;
		setStatus('Menyimpan…');
		clearTimeout(timer.current);
		timer.current = window.setTimeout(flush, 1000);
	}

	// Don't lose the last second of drawing when switching canvas or closing the tab.
	useEffect(() => {
		const warn = (event: BeforeUnloadEvent) => {
			if (timer.current !== undefined) event.preventDefault();
		};
		addEventListener('beforeunload', warn);
		return () => {
			removeEventListener('beforeunload', warn);
			flush();
		};
	}, []);

	async function explainSelection() {
		if (!api) return;
		const elements: readonly ExcalidrawElement[] = api.getSceneElements();
		const { selectedElementIds } = api.getAppState();
		const selected = elements.filter(element => selectedElementIds[element.id]);
		if (selected.length !== 1) return setStatus('Pilih satu kotak dulu');
		const [box] = selected;
		const target = elements
			.filter((element): element is ExcalidrawImageElement => element.type === 'image' && element.id !== box.id && !!element.fileId && overlap(element, box) > 0)
			.sort((a, b) => overlap(b, box) - overlap(a, box))[0];
		if (!target?.fileId) return setStatus('Kotaknya harus di atas halaman atau gambar');

		setBusy(true);
		setStatus('Bertanya ke DeepSeek…');
		try {
			const page = pageOf(target);
			const src = api.getFiles()[target.fileId]?.dataURL ?? (page ? await renderPage(page.pdf, page.page) : null);
			if (!src) throw new Error('gambarnya belum termuat');
			const text = wrap(await explain(await crop(src, target, box)));

			// Next to the page, level with the mark, moved down past any note already there.
			const x = target.x + target.width + 80;
			const height = text.split('\n').length * 25 + 30;
			let y = box.y + box.height / 2 - height / 2;
			for (;;) {
				const hit = api.getSceneElements().filter(element => overlap(element, { x, y, width: 320, height }) > 0);
				if (!hit.length) break;
				y = Math.max(...hit.map(element => element.y + element.height)) + 20;
			}

			const id = crypto.randomUUID();
			const start = { x: box.x + box.width, y: box.y + box.height / 2 };
			const added = convertToExcalidrawElements([
				{ type: 'rectangle', id, x, y, roundness: { type: 3 }, label: { text, fontSize: 20, textAlign: 'left' } },
				{ type: 'arrow', ...start, width: x - start.x, height: y + height / 2 - start.y, strokeColor: '#4a8fd6', end: { id } },
			]);
			api.updateScene({ elements: [...api.getSceneElementsIncludingDeleted(), ...added], captureUpdate: CaptureUpdateAction.IMMEDIATELY });
			setStatus('');
		} catch (error) {
			setStatus(`Gagal: ${(error as Error).message}`);
		} finally {
			setBusy(false);
		}
	}

	if (!scene)
		return (
			<div ref={container} className="h-full p-6 text-sm text-neutral-500">
				{status || 'Memuat…'}
			</div>
		);
	// A PDF opens at the top of its first page, centred, rather than at the middle of the whole stack.
	const first = (scene.elements as ExcalidrawElement[]).find(pageOf);
	const start = first ? { scrollX: width / 2 - (first.x + first.width / 2), scrollY: 80 - first.y } : {};
	return (
		<Excalidraw
			excalidrawAPI={instance => {
				apiRef.current = instance;
				setApi(instance);
				if (import.meta.env.DEV) Object.assign(window, { excalidraw: instance });
			}}
			// Grey around a PDF so its white pages stand out.
			initialData={{ elements: scene.elements as ExcalidrawElement[], appState: { viewBackgroundColor: item.pdf ? '#ececec' : '#ffffff', ...start }, scrollToContent: !first }}
			onChange={onChange}
			langCode="id-ID"
			renderTopRightUI={() => (
				<div className="flex items-center gap-2">
					{status && <span className="max-w-64 truncate text-xs text-neutral-500">{status}</span>}
					<button onClick={explainSelection} disabled={busy} className="rounded-lg bg-violet-600 px-3 py-2 text-sm text-white disabled:opacity-50" title="Kotakin bagian halaman, pilih kotaknya, lalu klik">
						{busy ? '…' : 'Jelaskan'}
					</button>
				</div>
			)}
		/>
	);
}
