import { convertToExcalidrawElements } from '@excalidraw/excalidraw';
import type { FileId } from '@excalidraw/excalidraw/element/types';
import { useEffect, useRef, useState } from 'react';
import { listItems, saveItem, saveScene, uploadFile, type Item } from './api.ts';
import { Canvas } from './Canvas.tsx';
import { PAGE_GAP, PAGE_WIDTH, pageHeights } from './pdf.ts';

const newItem = (name: string, kind: Item['kind'], parentId: string | null, pdf: string | null = null): Item => ({
	id: crypto.randomUUID(),
	parentId,
	name,
	kind,
	pdf,
	updated: new Date().toISOString(),
});

/** Uploads the PDF and makes a canvas with every page stacked top to bottom, locked so drawing never drags a page. */
async function importPdf(file: File, parentId: string | null): Promise<Item> {
	const heights = await pageHeights(file);
	const key = await uploadFile(file);
	let y = 0;
	const elements = convertToExcalidrawElements(
		heights.map((height, index) => {
			const page = { type: 'image' as const, x: 0, y, width: PAGE_WIDTH, height, fileId: `pdf:${key}:${index + 1}` as FileId, status: 'saved' as const, locked: true, customData: { pdf: key, page: index + 1 } };
			y += height + PAGE_GAP;
			return page;
		}),
	);
	const item = newItem(file.name.replace(/\.pdf$/i, ''), 'canvas', parentId, key);
	await saveScene(item.id, { elements, images: {} });
	await saveItem(item);
	return item;
}

function Tree({ items, parentId, openId, folderId, expanded, onOpen, onFolder }: {
	items: Item[];
	parentId: string | null;
	openId: string | null;
	folderId: string | null;
	expanded: Set<string>;
	onOpen: (id: string) => void;
	onFolder: (id: string) => void;
}) {
	const children = items.filter(item => item.parentId === parentId).sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'folder' ? -1 : 1));
	return (
		<ul className={parentId ? 'ml-3 border-l border-neutral-200 pl-1' : ''}>
			{children.map(item => (
				<li key={item.id}>
					{item.kind === 'folder' ? (
						<>
							<button onClick={() => onFolder(item.id)} className={`w-full truncate rounded px-2 py-1 text-left hover:bg-neutral-100 ${folderId === item.id ? 'font-semibold' : ''}`}>
								{expanded.has(item.id) ? '▾' : '▸'} {item.name}
							</button>
							{expanded.has(item.id) && <Tree {...{ items, parentId: item.id, openId, folderId, expanded, onOpen, onFolder }} />}
						</>
					) : (
						<button onClick={() => onOpen(item.id)} className={`w-full truncate rounded px-2 py-1 text-left hover:bg-neutral-100 ${openId === item.id ? 'bg-neutral-200' : ''}`}>
							{item.pdf ? '📄' : '✏️'} {item.name}
						</button>
					)}
				</li>
			))}
		</ul>
	);
}

export function App() {
	const [items, setItems] = useState<Item[]>([]);
	const [openId, setOpenId] = useState(() => new URLSearchParams(location.search).get('c'));
	const [folderId, setFolderId] = useState<string | null>(null); // where new things go
	const [expanded, setExpanded] = useState(new Set<string>());
	const [status, setStatus] = useState('');
	const pdfInput = useRef<HTMLInputElement>(null);

	useEffect(() => {
		listItems().then(setItems, error => setStatus(`Gagal memuat: ${error.message}`));
	}, []);

	function open(id: string) {
		setOpenId(id);
		history.replaceState(null, '', `?c=${id}`);
	}

	function toggleFolder(id: string) {
		setFolderId(id);
		setExpanded(previous => {
			const next = new Set(previous);
			if (!next.delete(id)) next.add(id);
			return next;
		});
	}

	async function run(label: string, task: () => Promise<Item | undefined>) {
		setStatus(label);
		try {
			const item = await task();
			if (item) {
				setItems(previous => [...previous, item]);
				if (item.kind === 'canvas') open(item.id);
				if (item.parentId) setExpanded(previous => new Set(previous).add(item.parentId!));
			}
			setStatus('');
		} catch (error) {
			setStatus(`Gagal: ${(error as Error).message}`);
		}
	}

	function create(kind: Item['kind']) {
		const name = prompt(kind === 'folder' ? 'Nama folder' : 'Nama canvas')?.trim();
		if (!name) return;
		run('Menyimpan…', async () => {
			const item = newItem(name, kind, folderId);
			await saveItem(item);
			return item;
		});
	}

	const current = items.find(item => item.id === openId);
	const folder = items.find(item => item.id === folderId);

	return (
		<div className="flex h-full text-sm">
			<aside className="flex w-64 shrink-0 flex-col border-r border-neutral-200 bg-neutral-50">
				<div className="flex gap-1 border-b border-neutral-200 p-2">
					<button onClick={() => create('folder')} className="rounded px-2 py-1 hover:bg-neutral-200">+ Folder</button>
					<button onClick={() => create('canvas')} className="rounded px-2 py-1 hover:bg-neutral-200">+ Canvas</button>
					<button onClick={() => pdfInput.current?.click()} className="rounded px-2 py-1 hover:bg-neutral-200">+ PDF</button>
					<input
						ref={pdfInput}
						type="file"
						accept="application/pdf"
						hidden
						onChange={event => {
							const file = event.target.files?.[0];
							event.target.value = '';
							if (file) run(`Mengimpor ${file.name}…`, () => importPdf(file, folderId));
						}}
					/>
				</div>
				<button onClick={() => setFolderId(null)} className={`px-3 pt-2 text-left text-xs text-neutral-500 ${folderId ? '' : 'font-semibold'}`}>
					Simpan ke: {folder?.name ?? 'akar'}
				</button>
				<nav className="flex-1 overflow-y-auto p-2">
					<Tree items={items} parentId={null} openId={openId} folderId={folderId} expanded={expanded} onOpen={open} onFolder={toggleFolder} />
				</nav>
				{status && <p className="border-t border-neutral-200 p-2 text-xs text-neutral-600">{status}</p>}
			</aside>
			<main className="relative min-w-0 flex-1">
				{current?.kind === 'canvas' ? (
					<Canvas key={current.id} item={current} />
				) : (
					<div className="grid h-full place-items-center text-neutral-400">Pilih canvas, atau impor PDF.</div>
				)}
			</main>
		</div>
	);
}
