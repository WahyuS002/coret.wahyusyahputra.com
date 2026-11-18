import { CaptureUpdateAction, convertToExcalidrawElements, newElementWith } from '@excalidraw/excalidraw';
import type { ExcalidrawElement, ExcalidrawTextElement } from '@excalidraw/excalidraw/element/types';
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import { useEffect, useReducer, useRef, useState, type RefObject } from 'react';
import { explain, type Turn } from './api.ts';
import { cropMark, pageUnder } from './crop.ts';
import { wrap } from './geometry.ts';
import { Icon } from './Icon.tsx';

type Api = ExcalidrawImperativeAPI;

/** A Jelaskan note: the labelled box next to the page, owned by the mark it explains. */
const isNote = (element: ExcalidrawElement | undefined): element is ExcalidrawElement =>
	!!element && element.type === 'rectangle' && !element.isDeleted && typeof element.customData?.owner === 'string';
const find = (api: Api, id: string | null | undefined) => (id ? api.getSceneElementsIncludingDeleted().find(element => element.id === id) : undefined);
const labelOf = (api: Api, note: ExcalidrawElement) => (api.getSceneElements() as readonly ExcalidrawElement[]).find((element): element is ExcalidrawTextElement => element.type === 'text' && element.containerId === note.id);

/** The note's conversation; notes from before follow-ups existed start from their text. */
function turnsOf(api: Api, note: ExcalidrawElement): Turn[] {
	const turns = note.customData?.turns as Turn[] | undefined;
	return turns?.length
		? turns
		: [
				{
					q: null,
					a: (labelOf(api, note)?.originalText ?? '').replace(/\s*\n\s*/g, ' '),
				},
			];
}

/** Which answer the note shows; the latest unless one was picked with "Pakai ini". */
const shownOf = (note: ExcalidrawElement, turns: Turn[]) => {
	const shown = note.customData?.shown;
	return typeof shown === 'number' && turns[shown] ? shown : turns.length - 1;
};

/** Puts answer `shown` in the note, resized to fit, and keeps the conversation on it. Undoable as one step. */
function updateNote(api: Api, noteId: string, turns: Turn[], shown: number) {
	const note = find(api, noteId);
	if (!isNote(note)) return;
	const [fitted, made] = convertToExcalidrawElements([
		{
			type: 'rectangle',
			x: note.x,
			y: note.y,
			label: { text: wrap(turns[shown].a), fontSize: 20, textAlign: 'left' },
		},
	]);
	const label = {
		...made,
		containerId: note.id,
		customData: { owner: note.id },
	} as ExcalidrawElement;
	const next = newElementWith(note, {
		width: fitted.width,
		height: fitted.height,
		boundElements: [...(note.boundElements ?? []).filter(bound => bound.type !== 'text'), { type: 'text', id: label.id }],
		customData: { ...note.customData, turns, shown },
	});
	// ponytail: the arrow keeps its end point; a much shorter answer can leave it pointing below the note until the note is moved
	api.updateScene({
		elements: [
			...api
				.getSceneElementsIncludingDeleted()
				.map(element => (element.id === note.id ? next : element.type === 'text' && element.containerId === note.id && !element.isDeleted ? newElementWith(element, { isDeleted: true }) : element)),
			label,
		],
		captureUpdate: CaptureUpdateAction.IMMEDIATELY,
	});
}

/** The note under a pointer event on `area`, with `reach` screen pixels of slack around it. */
function noteAt(api: Api, area: HTMLElement, event: PointerEvent, reach = 0, skip?: (noteId: string) => boolean) {
	const { scrollX, scrollY, zoom } = api.getAppState();
	const rect = area.getBoundingClientRect();
	const x = (event.clientX - rect.left) / zoom.value - scrollX;
	const y = (event.clientY - rect.top) / zoom.value - scrollY;
	const r = reach / zoom.value;
	return api.getSceneElements().find(note => isNote(note) && !skip?.(note.id) && x >= note.x - r && x <= note.x + note.width + r && y >= note.y - r && y <= note.y + note.height + r);
}

/** Hides the text of every note not in `shown` behind a "?"; pressing one reveals it. The box and its arrow stay visible. */
export function NoteCovers({ api, area, shown, onReveal }: { api: Api; area: RefObject<HTMLDivElement | null>; shown: Set<string>; onReveal: (noteId: string) => void }) {
	const [, redraw] = useReducer((n: number) => n + 1, 0);

	useEffect(() => {
		const element = area.current;
		if (!element) return;
		// The covers let the wheel and drags through to the canvas; only a press on a covered note is caught, before Excalidraw sees it.
		const down = (event: PointerEvent) => {
			const note = noteAt(api, element, event, 0, id => shown.has(id));
			if (!note) return;
			event.stopPropagation();
			event.preventDefault();
			onReveal(note.id);
		};
		element.addEventListener('pointerdown', down, true);
		const offChange = api.onChange(redraw);
		const offScroll = api.onScrollChange(redraw);
		return () => {
			element.removeEventListener('pointerdown', down, true);
			offChange();
			offScroll();
		};
	}, [api, area, shown, onReveal]);

	const { scrollX, scrollY, zoom } = api.getAppState();
	const inset = 4; // scene units, so the note's own border shows around the cover
	// ponytail: one div per note in the whole canvas; skip off-screen ones if a book collects hundreds
	return api
		.getSceneElements()
		.filter(note => isNote(note) && !shown.has(note.id))
		.map(note => (
			<div
				key={note.id}
				style={{
					left: (note.x + inset + scrollX) * zoom.value,
					top: (note.y + inset + scrollY) * zoom.value,
					width: Math.max(0, note.width - 2 * inset) * zoom.value,
					height: Math.max(0, note.height - 2 * inset) * zoom.value,
					borderRadius: 12 * zoom.value,
					fontSize: Math.min(note.height * 0.5, 28) * zoom.value,
				}}
				// The canvas stays light in dark mode, so the cover keeps the canvas grey too.
				className="pointer-events-none absolute z-[2] grid place-items-center bg-canvas font-heading font-semibold text-[#9b9990]"
				aria-hidden
			>
				?
			</div>
		));
}

/**
 * A sparkle on the top-right corner of the note under the pointer, or of the selected one (touch has no hover). Not on a covered note: its conversation holds the answer.
 * With `onCover` (notes hidden), a crossed eye beside it covers the note again.
 */
export function NoteButton({ api, area, onOpen, covered, onCover }: { api: Api; area: RefObject<HTMLDivElement | null>; onOpen: (noteId: string) => void; covered: (noteId: string) => boolean; onCover?: (noteId: string) => void }) {
	const [hovered, setHovered] = useState<string | null>(null);
	const [, redraw] = useReducer((n: number) => n + 1, 0);

	useEffect(() => {
		const element = area.current;
		if (!element) return;
		const move = (event: PointerEvent) => {
			const note = noteAt(api, element, event, 20); // reach: moving onto the button, which overhangs the corner, keeps it
			setHovered(note?.id ?? null);
		};
		const leave = () => setHovered(null);
		element.addEventListener('pointermove', move);
		element.addEventListener('pointerleave', leave);
		// Only this button redraws on every scroll and change, not the whole canvas.
		const offChange = api.onChange(redraw);
		const offScroll = api.onScrollChange(redraw);
		return () => {
			element.removeEventListener('pointermove', move);
			element.removeEventListener('pointerleave', leave);
			offChange();
			offScroll();
		};
	}, [api, area]);

	const { scrollX, scrollY, zoom, selectedElementIds, selectedElementsAreBeingDragged, editingTextElement } = api.getAppState();
	if (selectedElementsAreBeingDragged || editingTextElement) return null;
	const ids = Object.keys(selectedElementIds);
	const selected = ids.length === 1 ? find(api, ids[0]) : undefined;
	const note = [find(api, hovered), selected, selected?.type === 'text' ? find(api, selected.containerId) : undefined].find(isNote);
	if (!note || covered(note.id)) return null;
	const corner = { left: (note.x + note.width + scrollX) * zoom.value, top: (note.y + scrollY) * zoom.value };
	const round = 'absolute z-[3] grid size-7 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-paper shadow-[0_1px_2px_rgb(0_0_0/0.12),0_4px_12px_-4px_rgb(0_0_0/0.2)] ring-1 ring-line-strong transition-colors duration-150';
	return (
		<>
			{onCover && (
				<button onClick={() => onCover(note.id)} style={{ ...corner, left: corner.left - 34 }} className={`${round} text-ink-muted hover:bg-active hover:text-ink`} title="Tutup lagi" aria-label="Tutup lagi catatan ini">
					<Icon name="eyeOff" className="size-4" />
				</button>
			)}
			<button onClick={() => onOpen(note.id)} style={corner} className={`${round} text-accent hover:bg-accent-soft`} title="Tanya lagi" aria-label="Tanya lagi tentang catatan ini">
				<Icon name="sparkles" className="size-4" />
			</button>
		</>
	);
}

const QUICK = ['Lebih detail', 'Terjemahan harfiah', 'Kasih contoh'];

/** The conversation behind one note: what DeepSeek saw, every answer, and a box to ask again. */
export function ExplainSheet({ api, noteId, onClose }: { api: Api; noteId: string; onClose: () => void }) {
	// Read from the note on every render, so undo/redo on the canvas shows up here too.
	const [, redraw] = useReducer((n: number) => n + 1, 0);
	const note = find(api, noteId);
	const turns = isNote(note) ? turnsOf(api, note) : [];
	const shown = isNote(note) ? shownOf(note, turns) : -1;
	const [image, setImage] = useState<string | null>(null);
	const [draft, setDraft] = useState('');
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');
	const end = useRef<HTMLDivElement>(null);

	// The same crop the first answer was given, cut again from the mark, so follow-ups see the page too.
	useEffect(() => {
		const note = find(api, noteId);
		const mark = find(api, note?.customData?.owner as string | undefined);
		const target = mark && !mark.isDeleted ? pageUnder(api, mark) : undefined;
		if (!mark || !target) return setError('Kotak tandanya tidak ada di atas halaman, jadi tidak bisa ditanya lagi.');
		// Notes made from several boxes list them all; older notes have just the owner.
		const marks = ((note?.customData?.marks as string[] | undefined) ?? [mark.id]).flatMap(id => find(api, id) ?? []).filter(element => !element.isDeleted);
		let live = true;
		cropMark(api, marks, target).then(
			crop => live && setImage(crop),
			failure => live && setError(`Gagal memuat potongan halaman: ${failure.message}`),
		);
		return () => {
			live = false;
		};
	}, [api, noteId]);

	// The note going away (deleted, or its mark deleted) closes the sheet; any other change may be an undo of its text.
	useEffect(() => api.onChange(() => (isNote(find(api, noteId)) ? redraw() : onClose())), [api, noteId, onClose]);
	// Braces matter: newer Chrome returns a Promise from scrollIntoView, and React would call it as the cleanup.
	useEffect(() => {
		end.current?.scrollIntoView({ block: 'end' });
	}, [turns.length, busy]);

	async function ask(question: string) {
		question = question.trim();
		if (!question || !image || busy) return;
		setBusy(true);
		setError('');
		try {
			const next = [...turns, { q: question, a: await explain(image, turns, question) }];
			setDraft('');
			updateNote(api, noteId, next, next.length - 1);
		} catch (failure) {
			setError(`Gagal: ${(failure as Error).message}`);
		} finally {
			setBusy(false);
		}
	}

	return (
		<aside className="flex w-[360px] shrink-0 flex-col border-l border-line bg-paper" aria-label="Tanya lagi">
			<header className="flex h-12 shrink-0 items-center gap-2 border-b border-line pr-2 pl-4">
				<Icon name="sparkles" className="size-4 text-accent" />
				<h2 className="font-heading text-sm font-semibold">Tanya lagi</h2>
				<button onClick={onClose} className="ml-auto grid size-7 place-items-center rounded-md text-ink-faint transition-colors duration-150 hover:bg-tint/[0.06] hover:text-ink" aria-label="Tutup">
					<Icon name="x" />
				</button>
			</header>
			<div className="thin-scroll flex-1 space-y-4 overflow-y-auto px-4 py-4">
				{image ? (
					<img src={image} alt="Potongan halaman yang dilihat DeepSeek, bagian yang ditanyakan diberi kotak merah" className="w-full rounded-md ring-1 ring-line" />
				) : (
					!error && <div className="aspect-[4/3] animate-pulse rounded-md bg-shell" />
				)}
				{turns.map((turn, index) => (
					<div key={index} className="space-y-2">
						{turn.q && <p className="ml-10 rounded-lg bg-accent-soft px-3 py-2 text-sm text-ink">{turn.q}</p>}
						<p className="text-sm leading-relaxed text-ink">{turn.a}</p>
						{turns.length > 1 &&
							(index === shown ? (
								<p className="text-xs text-accent">Dipakai di catatan</p>
							) : (
								<button onClick={() => updateNote(api, noteId, turns, index)} className="rounded text-xs text-ink-muted underline decoration-line-strong underline-offset-4 transition-colors duration-150 hover:text-ink hover:decoration-ink">
									Pakai ini
								</button>
							))}
					</div>
				))}
				{busy && (
					<p className="flex items-center gap-2 text-sm text-ink-faint">
						<Icon name="spin" className="size-3.5 animate-spin" />
						Bertanya ke DeepSeek…
					</p>
				)}
				{error && (
					<p role="alert" className="flex items-start gap-2 text-sm text-danger">
						<Icon name="alert" className="mt-0.5 size-3.5" />
						{error}
					</p>
				)}
				<div ref={end} />
			</div>
			<footer className="shrink-0 space-y-2 border-t border-line p-3">
				<div className="flex flex-wrap gap-1.5">
					{QUICK.map(question => (
						<button
							key={question}
							onClick={() => ask(question)}
							disabled={!image || busy}
							className="rounded-full px-2.5 py-1 text-xs text-ink-muted ring-1 ring-line-strong transition-colors duration-150 hover:bg-shell hover:text-ink disabled:opacity-50"
						>
							{question}
						</button>
					))}
				</div>
				<form
					onSubmit={event => {
						event.preventDefault();
						ask(draft);
					}}
					className="flex items-end gap-2 rounded-lg bg-shell p-1.5 ring-1 ring-line focus-within:ring-accent"
				>
					<textarea
						value={draft}
						onChange={event => setDraft(event.target.value)}
						onKeyDown={event => {
							if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
								event.preventDefault();
								ask(draft);
							}
						}}
						rows={2}
						maxLength={1000}
						placeholder="Tanya soal bagian ini…"
						aria-label="Pertanyaan"
						className="min-h-0 flex-1 resize-none bg-transparent px-1.5 py-1 text-sm outline-none placeholder:text-ink-faint focus-visible:outline-none"
					/>
					<button
						type="submit"
						disabled={!draft.trim() || !image || busy}
						className="grid size-8 shrink-0 place-items-center rounded-md bg-ink text-paper transition-colors duration-150 hover:bg-ink/85 disabled:opacity-40"
						aria-label="Kirim"
					>
						<Icon name="arrowUp" />
					</button>
				</form>
			</footer>
		</aside>
	);
}
