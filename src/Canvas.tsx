import { CaptureUpdateAction, Excalidraw, convertToExcalidrawElements, getSceneVersion, newElementWith, restoreElements } from '@excalidraw/excalidraw';
import type { ExcalidrawElement, ExcalidrawImageElement, FileId } from '@excalidraw/excalidraw/element/types';
import type { BinaryFileData, BinaryFiles, ExcalidrawImperativeAPI, NormalizedZoomValue } from '@excalidraw/excalidraw/types';
import { useEffect, useRef, useState } from 'react';
import { explain, loadScene, saveScene, uploadFile, type Item, type Scene } from './api.ts';
import { followOwners, type Part } from './explanations.ts';
import { bounds, overlap, wrap } from './geometry.ts';
import { cropMark, pageOf, pageUnder, type PageData } from './crop.ts';
import { ExplainSheet, NoteButton, NoteCovers } from './ExplainSheet.tsx';
import { Icon } from './Icon.tsx';
import { pageElements, renderPage } from './pdf.ts';

// Where each canvas was last viewed, kept per browser so a refresh lands back on the same spot.
type View = { scrollX: number; scrollY: number; zoom: number };
const viewKey = (id: string) => `coret:view:${id}`;
const hideKey = (id: string) => `coret:hide:${id}`;
function lastView(id: string): View | null {
	try {
		const view = JSON.parse(localStorage.getItem(viewKey(id)) ?? 'null') as View | null;
		return view && [view.scrollX, view.scrollY, view.zoom].every(Number.isFinite) && view.zoom > 0 ? view : null;
	} catch {
		return null;
	}
}

// The first pages of every PDF opened, so switching back to one shows it at once.
// ponytail: two rendered pages (~0.5 MB) per PDF stay in memory for the tab's life; bound it if people open hundreds
const firstPages = new Map<string, Promise<BinaryFileData>>();
const firstPage = ({ fileId, customData }: ExcalidrawImageElement) => {
	const id = fileId as FileId;
	if (!firstPages.has(id)) {
		const { pdf, page } = customData as PageData;
		const rendered = renderPage(pdf, page).then(dataURL => ({ id, dataURL: dataURL as BinaryFileData['dataURL'], mimeType: 'image/jpeg' as const, created: Date.now() }));
		rendered.catch(() => firstPages.delete(id));
		firstPages.set(id, rendered);
	}
	return firstPages.get(id)!;
};

const toDataURL = (blob: Blob) =>
	new Promise<string>((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(reader.result as string);
		reader.onerror = () => reject(reader.error);
		reader.readAsDataURL(blob);
	});

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
	// What to save. Excalidraw empties its scene on unmount, before the save on unmount runs, so the API can't be asked then.
	const initialFiles = useRef<BinaryFileData[]>([]);
	const latest = useRef<{ elements: readonly ExcalidrawElement[]; files: BinaryFiles }>({ elements: [], files: {} });
	const timer = useRef<number | undefined>(undefined);
	const queue = useRef(Promise.resolve());
	const container = useRef<HTMLDivElement>(null);
	const area = useRef<HTMLDivElement>(null);
	const [sheet, setSheet] = useState<string | null>(null); // the note whose conversation is open
	// With notes hidden, rereading means recalling each answer first. Remembered per canvas; notes revealed (or made) this visit stay shown until the canvas is left.
	const [hidden, setHidden] = useState(() => {
		try {
			return localStorage.getItem(hideKey(item.id)) === '1';
		} catch {
			return false;
		}
	});
	const [revealed, setRevealed] = useState(() => new Set<string>());
	const reveal = (id: string) => setRevealed(shown => new Set(shown).add(id));
	function toggleHidden() {
		const next = !hidden;
		setHidden(next);
		if (next) setSheet(null);
		try {
			localStorage.setItem(hideKey(item.id), next ? '1' : '0');
		} catch {}
	}

	useEffect(() => {
		loadScene(item.id)
			.then(async loaded => {
				let elements = loaded?.elements ?? [];
				// Pages lost to an old save bug (canvas switched within a second of opening) come back from the PDF.
				if (item.pdf && !elements.some(element => pageOf(element as ExcalidrawElement))) elements = [...(await pageElements(item.pdf)), ...elements];
				// Pages in the first screen are drawn before the canvas shows, so it doesn't appear empty and fill in a moment later.
				const all = (elements as ExcalidrawElement[]).filter((element): element is ExcalidrawImageElement => element.type === 'image' && !!pageOf(element));
				const view = lastView(item.id);
				const screen = view && { x: -view.scrollX, y: -view.scrollY, width: (container.current?.clientWidth ?? 0) / view.zoom, height: (container.current?.clientHeight ?? 0) / view.zoom };
				const visible = screen ? all.filter(page => overlap(page, screen) > 0) : [];
				const pages = (visible.length ? visible : all).slice(0, 2);
				initialFiles.current = await Promise.all(pages.map(firstPage)).catch(() => []);
				for (const file of initialFiles.current) requested.current.add(file.id);
				if (elements === loaded?.elements) savedVersion.current = getSceneVersion(elements as ExcalidrawElement[]); // opening isn't a change to save
				images.current = { ...loaded?.images };
				setScene({ elements, images: images.current });
				setWidth(container.current?.clientWidth ?? 0);
			})
			.catch(error => setStatus(`Gagal membuka: ${error.message}`));
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
		const { elements, files } = latest.current;
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

	function onChange(elements: readonly ExcalidrawElement[], _: unknown, files: BinaryFiles) {
		// A Jelaskan note goes with its mark and comes back with it on undo; kept out of history so one undo restores all.
		const follow = followOwners(elements as readonly Part[]);
		if (follow.size)
			return apiRef.current?.updateScene({
				elements: elements.map(element => (follow.has(element.id) ? newElementWith(element, { isDeleted: follow.get(element.id)!, customData: { ...element.customData, cascaded: follow.get(element.id) } }) : element)),
				captureUpdate: CaptureUpdateAction.NEVER,
			}); // that update calls onChange again, which saves
		latest.current = { elements, files };
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
		if (!selected.length) return setStatus('Pilih kotaknya dulu');
		// Several boxes (Shift+klik) mark one phrase that wraps across lines; the first one owns the note and anchors the arrow.
		const [box] = selected;
		const target = pageUnder(api, box);
		if (!target) return setStatus('Kotaknya harus di atas halaman atau gambar');

		setBusy(true);
		setStatus('Bertanya ke DeepSeek…');
		try {
			const answer = await explain(await cropMark(api, selected, target));
			const text = wrap(answer);

			// Next to the page, level with the mark, moved down past any note already there.
			const x = target.x + target.width + 80;
			const height = text.split('\n').length * 25 + 30;
			const all = bounds(selected);
			let y = all.y + all.height / 2 - height / 2;
			for (;;) {
				const hit = api.getSceneElements().filter(element => overlap(element, { x, y, width: 320, height }) > 0);
				if (!hit.length) break;
				y = Math.max(...hit.map(element => element.y + element.height)) + 20;
			}

			const id = crypto.randomUUID();
			reveal(id); // just asked: shown even with notes hidden
			const start = { x: box.x + box.width, y: box.y + box.height / 2 };
			// restoreElements moves the arrow's first point to 0,0 as Excalidraw expects; left as converted, dragging the note flings the arrow off-canvas
			const arrowId = crypto.randomUUID();
			const bindable = ['rectangle', 'ellipse', 'diamond'].includes(box.type);
			const added = restoreElements(
				convertToExcalidrawElements([
					{ type: 'rectangle', id, x, y, roundness: { type: 3 }, label: { text, fontSize: 20, textAlign: 'left' }, customData: { owner: box.id, marks: selected.map(element => element.id), turns: [{ q: null, a: answer }] } },
					{ type: 'arrow', id: arrowId, ...start, width: x - start.x, height: y + height / 2 - start.y, strokeColor: '#4a8fd6', opacity: 40, end: { id }, customData: { owner: id } },
				], { regenerateIds: false }), // keep our ids: customData.owner and the start binding point at them
				null,
			).map(element =>
				element.type === 'text' ? { ...element, customData: { owner: id } } // the note's label goes with the note
				: element.id === arrowId && bindable ? { ...element, startBinding: { elementId: box.id, focus: 0, gap: 1 } } // arrow follows the mark when it moves
				: element,
			);
			// Group the boxes so they move and delete together, unless they already share a group.
			const group = crypto.randomUUID();
			const grouped = new Map<string, ExcalidrawElement>(
				selected.length > 1 && !box.groupIds.some(id => selected.every(element => element.groupIds.includes(id))) ? selected.map(element => [element.id, newElementWith(element, { groupIds: [...element.groupIds, group] })]) : [],
			);
			const first = grouped.get(box.id) ?? box;
			const mark = bindable ? newElementWith(first, { boundElements: [...(first.boundElements ?? []), { type: 'arrow', id: arrowId }] }) : first;
			api.updateScene({ elements: [...api.getSceneElementsIncludingDeleted().map(element => (element.id === box.id ? mark : (grouped.get(element.id) ?? element))), ...added], captureUpdate: CaptureUpdateAction.IMMEDIATELY });
			setStatus('');
		} catch (error) {
			setStatus(`Gagal: ${(error as Error).message}`);
		} finally {
			setBusy(false);
		}
	}

	if (!scene)
		return (
			// Same grey as the canvas, so switching shows one change instead of a flash; the text only appears if loading is slow.
			<div ref={container} className="h-full bg-canvas p-6 text-sm text-ink-muted">
				{status || <span className="appear-late">Memuat…</span>}
			</div>
		);
	// A canvas reopens where it was last viewed; a PDF seen for the first time opens at the top of its first page, centred.
	const first = (scene.elements as ExcalidrawElement[]).find(pageOf);
	const view = lastView(item.id);
	const start = view ? { scrollX: view.scrollX, scrollY: view.scrollY, zoom: { value: view.zoom as NormalizedZoomValue } } : first ? { scrollX: width / 2 - (first.x + first.width / 2), scrollY: 80 - first.y } : {};
	return (
		// The sheet sits beside the canvas, not over it, so the notes on the right stay visible.
		<div className="flex h-full">
			<div ref={area} className="relative min-w-0 flex-1 overflow-hidden">
				<Excalidraw
					excalidrawAPI={instance => {
						apiRef.current = instance;
						setApi(instance);
						if (import.meta.env.DEV) Object.assign(window, { excalidraw: instance });
					}}
					// Same grey as the empty canvas area; white PDF pages stand out on it.
					initialData={{ elements: scene.elements as ExcalidrawElement[], files: Object.fromEntries(initialFiles.current.map(file => [file.id, file])), appState: { viewBackgroundColor: '#eeeded', ...start }, scrollToContent: !first && !view }}
					onChange={onChange}
					onScrollChange={(scrollX, scrollY, zoom) => {
						try {
							localStorage.setItem(viewKey(item.id), JSON.stringify({ scrollX, scrollY, zoom: zoom.value }));
						} catch {} // private mode / storage full: just reopen at the top
					}}
					renderTopRightUI={() => (
						<div className="flex items-center gap-2">
							{status && <span className="max-w-64 truncate text-xs text-ink-muted">{status}</span>}
							<button onClick={toggleHidden} className="grid size-9 place-items-center rounded-lg bg-paper text-ink-muted ring-1 ring-line-strong transition-colors duration-150 hover:bg-active hover:text-ink" title={hidden ? 'Tampilkan penjelasan' : 'Sembunyikan penjelasan'} aria-label={hidden ? 'Tampilkan penjelasan' : 'Sembunyikan penjelasan'} aria-pressed={hidden}>
								<Icon name={hidden ? 'eyeOff' : 'eye'} />
							</button>
							<button onClick={explainSelection} disabled={busy} className="rounded-lg bg-ink px-3.5 py-2 text-sm font-medium text-paper transition-colors duration-150 hover:bg-ink/85 disabled:opacity-50" title="Kotakin bagian halaman, pilih kotaknya (Shift+klik untuk beberapa baris), lalu klik">
								{busy ? '…' : 'Jelaskan'}
							</button>
						</div>
					)}
				/>
				{api && hidden && <NoteCovers api={api} area={area} shown={revealed} onReveal={reveal} />}
				{api && <NoteButton api={api} area={area} onOpen={setSheet} covered={id => hidden && !revealed.has(id)} />}
			</div>
			{api && sheet && <ExplainSheet key={sheet} api={api} noteId={sheet} onClose={() => setSheet(null)} />}
		</div>
	);
}
