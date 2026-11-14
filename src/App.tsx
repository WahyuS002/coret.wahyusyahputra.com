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

const ICONS = {
	chevron: ['m9 18 6-6-6-6'],
	folder: ['M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z'],
	folderPlus: ['M12 10v6', 'M9 13h6', 'M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z'],
	pdf: ['M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z', 'M14 2v4a2 2 0 0 0 2 2h4', 'M16 13H8', 'M16 17H8', 'M10 9H8'],
	pdfUp: ['M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z', 'M14 2v4a2 2 0 0 0 2 2h4', 'M12 12v6', 'm15 15-3-3-3 3'],
	pen: ['M12 20h9', 'M16.376 3.622a1 1 0 0 1 3.002 3.002L7.368 18.635a2 2 0 0 1-.855.506l-2.872.838a.5.5 0 0 1-.62-.62l.838-2.872a2 2 0 0 1 .506-.854z'],
	penPlus: ['M12 20h4', 'M19 16v6', 'M16 19h6', 'M16.376 3.622a1 1 0 0 1 3.002 3.002L7.368 18.635a2 2 0 0 1-.855.506l-2.872.838a.5.5 0 0 1-.62-.62l.838-2.872a2 2 0 0 1 .506-.854z'],
	x: ['M18 6 6 18', 'm6 6 12 12'],
	rename: ['M13 21h8', 'm15 5 4 4', 'M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z'],
	trash: ['M3 6h18', 'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6', 'M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2', 'M10 11v6', 'M14 11v6'],
	spin: ['M21 12a9 9 0 1 1-6.219-8.56'],
	alert: ['M12 8v4', 'M12 16h.01', 'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z'],
};

function Icon({ name, className = 'size-4' }: { name: keyof typeof ICONS; className?: string }) {
	return (
		<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden className={`shrink-0 ${className}`}>
			{ICONS[name].map(d => <path key={d} d={d} />)}
		</svg>
	);
}

const row = 'flex h-8 w-full items-center gap-2 rounded-lg px-2 text-left transition-colors duration-150';

type TreeProps = {
	items: Item[];
	parentId: string | null;
	openId: string | null;
	folderId: string | null;
	expanded: Set<string>;
	onOpen: (id: string) => void;
	onFolder: (id: string) => void;
	onRename: (item: Item) => void;
	onDelete: (item: Item) => void;
};

const action = 'grid size-6 place-items-center rounded text-ink-faint transition-colors duration-150 hover:bg-black/[0.06] hover:text-ink';

function Tree(props: TreeProps) {
	const { items, parentId, openId, folderId, expanded, onOpen, onFolder, onRename, onDelete } = props;
	const children = items.filter(item => item.parentId === parentId).sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'folder' ? -1 : 1));
	return (
		<ul className={parentId ? 'ml-[15px] border-l border-line pl-1.5' : ''}>
			{children.map(item => (
				<li key={item.id}>
					<div className="group relative">
						{item.kind === 'folder' ? (
							<button
								onClick={() => onFolder(item.id)}
								aria-expanded={expanded.has(item.id)}
								title={folderId === item.id ? 'Item baru masuk ke folder ini' : undefined}
								className={`${row} group-hover:pr-16 group-focus-within:pr-16 ${folderId === item.id ? 'bg-active text-ink' : 'text-ink-muted hover:bg-black/[0.04] hover:text-ink'}`}
							>
								<Icon name="chevron" className={`size-3.5 text-ink-faint transition-transform duration-150 ${expanded.has(item.id) ? 'rotate-90' : ''}`} />
								<Icon name="folder" className={`size-4 ${folderId === item.id ? 'text-accent' : 'text-ink-faint'}`} />
								<span className="truncate">{item.name}</span>
							</button>
						) : (
							<button
								onClick={() => onOpen(item.id)}
								aria-current={openId === item.id ? 'page' : undefined}
								className={`${row} pl-[30px] group-hover:pr-16 group-focus-within:pr-16 ${openId === item.id ? 'bg-active text-ink' : 'text-ink-muted hover:bg-black/[0.04] hover:text-ink'}`}
							>
								<Icon name={item.pdf ? 'pdf' : 'pen'} className={`size-4 ${openId === item.id ? 'text-ink' : 'text-ink-faint'}`} />
								<span className="truncate">{item.name}</span>
							</button>
						)}
						<div className="absolute inset-y-0 right-1 flex items-center opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100">
							<button onClick={() => onRename(item)} className={action} title="Ganti nama" aria-label={`Ganti nama ${item.name}`}><Icon name="rename" className="size-3.5" /></button>
							<button onClick={() => onDelete(item)} className={`${action} hover:text-danger`} title="Hapus" aria-label={`Hapus ${item.name}`}><Icon name="trash" className="size-3.5" /></button>
						</div>
					</div>
					{item.kind === 'folder' && expanded.has(item.id) && <Tree {...props} parentId={item.id} />}
				</li>
			))}
		</ul>
	);
}

function EmptyState({ onPdf, onCanvas }: { onPdf: () => void; onCanvas: () => void }) {
	return (
		<div className="dot-grid grid h-full place-items-center p-8">
			<div className="flex gap-2">
				<button onClick={onPdf} className="flex h-10 items-center gap-2 rounded-lg bg-ink px-4 font-medium text-paper shadow-[0_1px_2px_rgb(0_0_0/0.12),0_4px_12px_-4px_rgb(0_0_0/0.2)] transition-colors duration-150 hover:bg-ink/85">
					<Icon name="pdfUp" />
					Impor PDF
				</button>
				<button onClick={onCanvas} className="flex h-10 items-center gap-2 rounded-lg bg-paper px-4 font-medium text-ink ring-1 ring-line-strong transition-colors duration-150 hover:bg-shell">
					<Icon name="pen" />
					Canvas kosong
				</button>
			</div>
		</div>
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

	/** Saves changed items (renamed, or deleted as tombstones) and drops the deleted ones from the tree. */
	async function apply(label: string, changed: Item[]) {
		setStatus(label);
		try {
			await Promise.all(changed.map(saveItem));
			setItems(previous => previous.map(item => changed.find(next => next.id === item.id) ?? item).filter(item => !item.deleted));
			setStatus('');
		} catch (error) {
			setStatus(`Gagal: ${(error as Error).message}`);
		}
	}

	function rename(item: Item) {
		const name = prompt('Nama baru', item.name)?.trim();
		if (name && name !== item.name) apply('Menyimpan…', [{ ...item, name, updated: new Date().toISOString() }]);
	}

	function remove(item: Item) {
		const gone = new Set([item.id]);
		for (let grew = true; grew; ) {
			grew = false;
			for (const other of items)
				if (other.parentId && gone.has(other.parentId) && !gone.has(other.id)) {
					gone.add(other.id);
					grew = true;
				}
		}
		const question = item.kind === 'folder' && gone.size > 1 ? `Hapus folder "${item.name}" beserta ${gone.size - 1} isinya?` : `Hapus "${item.name}"?`;
		if (!confirm(`${question} Tidak bisa dibatalkan.`)) return;
		if (openId && gone.has(openId)) {
			setOpenId(null);
			history.replaceState(null, '', location.pathname);
		}
		if (folderId && gone.has(folderId)) setFolderId(null);
		const updated = new Date().toISOString();
		apply('Menghapus…', items.filter(other => gone.has(other.id)).map(other => ({ ...other, deleted: true, updated })));
	}

	const current = items.find(item => item.id === openId);
	const folder = items.find(item => item.id === folderId);

	const failed = status.startsWith('Gagal');
	const iconButton = 'grid size-8 place-items-center rounded-md text-ink-muted transition-colors duration-150 hover:bg-black/[0.05] hover:text-ink';

	return (
		<div className="flex h-full text-sm">
			<aside className="flex w-64 shrink-0 flex-col border-r border-line bg-shell">
				<header className="flex items-center justify-between py-3 pr-2 pl-4">
					<span className="font-heading text-lg font-semibold tracking-[-0.02em]">coret</span>
					<div className="flex">
						<button onClick={() => create('folder')} className={iconButton} title="Folder baru" aria-label="Folder baru"><Icon name="folderPlus" /></button>
						<button onClick={() => create('canvas')} className={iconButton} title="Canvas baru" aria-label="Canvas baru"><Icon name="penPlus" /></button>
						<button onClick={() => pdfInput.current?.click()} className={iconButton} title="Impor PDF" aria-label="Impor PDF"><Icon name="pdfUp" /></button>
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
				</header>
				{folder && (
					<div className="mx-3 mb-1 flex items-center gap-1.5 py-1 pl-1 text-xs text-ink-muted" title="Item baru masuk ke folder ini">
						<Icon name="folder" className="size-3.5 text-accent" />
						<span className="min-w-0 truncate font-medium text-ink">{folder.name}</span>
						<button onClick={() => setFolderId(null)} className="ml-auto grid size-5 shrink-0 place-items-center rounded text-ink-faint hover:bg-black/[0.05] hover:text-ink" title="Simpan ke akar" aria-label="Simpan ke akar"><Icon name="x" className="size-3.5" /></button>
					</div>
				)}
				<nav className="thin-scroll flex-1 overflow-y-auto px-2 pb-3">
					{items.length ? (
						<Tree items={items} parentId={null} openId={openId} folderId={folderId} expanded={expanded} onOpen={open} onFolder={toggleFolder} onRename={rename} onDelete={remove} />
					) : (
						!status && <p className="px-2 py-1 text-xs text-ink-faint">Belum ada apa-apa di sini.</p>
					)}
				</nav>
				{status && (
					<p role="status" className={`flex items-start gap-2 border-t border-line px-4 py-2.5 text-xs ${failed ? 'text-danger' : 'text-ink-muted'}`}>
						<Icon name={failed ? 'alert' : 'spin'} className={`mt-px size-3.5 ${failed ? '' : 'animate-spin'}`} />
						<span className="min-w-0 break-words">{status}</span>
					</p>
				)}
			</aside>
			<main className="relative min-w-0 flex-1">
				{current?.kind === 'canvas' ? (
					<Canvas key={current.id} item={current} />
				) : (
					<EmptyState onPdf={() => pdfInput.current?.click()} onCanvas={() => create('canvas')} />
				)}
			</main>
		</div>
	);
}
