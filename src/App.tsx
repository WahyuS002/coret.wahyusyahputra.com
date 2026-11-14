import { useEffect, useRef, useState, type DragEvent } from 'react';
import { listItems, saveItem, saveScene, uploadFile, type Item } from './api.ts';
import { Canvas } from './Canvas.tsx';
import { Icon } from './Icon.tsx';
import { pageElements } from './pdf.ts';

const newItem = (name: string, kind: Item['kind'], parentId: string | null, pdf: string | null = null): Item => ({
	id: crypto.randomUUID(),
	parentId,
	name,
	kind,
	pdf,
	updated: new Date().toISOString(),
});

/** Uploads the PDF and makes a canvas of its pages. */
async function importPdf(file: File, parentId: string | null): Promise<Item> {
	const key = await uploadFile(file);
	const elements = await pageElements(key, file); // ponytail: a PDF that won't parse is left in R2 unreferenced; parse before upload if that ever matters
	const item = newItem(file.name.replace(/\.pdf$/i, ''), 'canvas', parentId, key);
	await saveScene(item.id, { elements, images: {} });
	await saveItem(item);
	return item;
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
	dragOver: string | null | undefined;
	drop: (parentId: string | null) => DropHandlers;
};

type DropHandlers = { onDragOver: (event: DragEvent) => void; onDragLeave: (event: DragEvent) => void; onDrop: (event: DragEvent) => void };
const DRAG = 'application/x-coret-item';

const action = 'grid size-6 place-items-center rounded text-ink-faint transition-colors duration-150 hover:bg-black/[0.06] hover:text-ink';

function Tree(props: TreeProps) {
	const { items, parentId, openId, folderId, expanded, onOpen, onFolder, onRename, onDelete, dragOver, drop } = props;
	const children = items.filter(item => item.parentId === parentId).sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'folder' ? -1 : 1));
	if (!children.length) return null;
	return (
		<ul className={parentId ? 'ml-[15px] border-l border-line pl-1.5' : ''}>
			{children.map(item => (
				<li key={item.id}>
					{/* dropping on a canvas row puts the item next to it, i.e. in the same folder */}
					<div className="group relative" draggable onDragStart={event => event.dataTransfer.setData(DRAG, item.id)} {...drop(item.kind === 'folder' ? item.id : item.parentId)}>
						{item.kind === 'folder' ? (
							<button
								onClick={() => onFolder(item.id)}
								aria-expanded={expanded.has(item.id)}
								title={folderId === item.id ? 'Item baru masuk ke folder ini' : undefined}
								className={`${row} group-hover:pr-16 group-focus-within:pr-16 ${dragOver === item.id ? 'bg-accent-soft text-ink ring-1 ring-accent' : 'text-ink-muted hover:bg-black/[0.04] hover:text-ink'}`}
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

/** A dashed sheet in the shape of the PDF page that will open here; drop a PDF on the area or click the sheet. */
function EmptyState({ onPdf, onFiles, onCanvas }: { onPdf: () => void; onFiles: (files: File[]) => void; onCanvas: () => void }) {
	const [over, setOver] = useState(false);
	return (
		<div
			className="dot-grid flex h-full flex-col items-center justify-center gap-4 p-8"
			onDragOver={event => {
				event.preventDefault();
				setOver(true);
			}}
			onDragLeave={event => {
				if (!event.currentTarget.contains(event.relatedTarget as Node)) setOver(false);
			}}
			onDrop={event => {
				event.preventDefault();
				setOver(false);
				onFiles([...event.dataTransfer.files]);
			}}
		>
			<button
				onClick={onPdf}
				className={`group flex aspect-[1/1.414] w-60 flex-col items-center justify-center gap-4 rounded-md border-2 border-dashed px-6 text-center transition-colors duration-150 ${over ? 'border-accent bg-accent-soft' : 'border-line-strong bg-paper/70 hover:border-accent/60 hover:bg-paper'}`}
			>
				<Icon name="pdfUp" className={`size-7 transition-colors duration-150 ${over ? 'text-accent' : 'text-ink-faint group-hover:text-accent'}`} />
				<span className="text-[15px] leading-snug text-ink-muted">{over ? 'Lepas untuk mengimpor' : 'Tarik PDF ke sini untuk mulai mencoret'}</span>
				<span className="flex h-8 items-center rounded-md bg-ink px-3 font-medium text-paper transition-colors duration-150 group-hover:bg-ink/85">Pilih PDF</span>
			</button>
			<button onClick={onCanvas} className="rounded text-ink-muted underline decoration-line-strong underline-offset-4 transition-colors duration-150 hover:text-ink hover:decoration-ink">
				atau buka canvas kosong
			</button>
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
		listItems().then(
			items => {
				setItems(items);
				// After a refresh, open the folders down to the canvas in the URL so it shows in the tree.
				const open = new Set<string>();
				for (let at = items.find(item => item.id === openId)?.parentId; at && !open.has(at); at = items.find(item => item.id === at)?.parentId) open.add(at);
				setExpanded(open);
			},
			error => setStatus(`Gagal memuat: ${error.message}`),
		);
	}, []);

	function open(id: string) {
		setOpenId(id);
		history.replaceState(null, '', `?c=${id}`);
	}

	/** Opening a folder makes it the target for new items; closing it hands the target back to its parent. */
	function toggleFolder(id: string) {
		const closing = expanded.has(id);
		setFolderId(closing ? (items.find(item => item.id === id)?.parentId ?? null) : id);
		setExpanded(previous => {
			const next = new Set(previous);
			if (closing) next.delete(id);
			else next.add(id);
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
			return true;
		} catch (error) {
			setStatus(`Gagal: ${(error as Error).message}`);
			return false;
		}
	}

	/** One at a time so the status shows which file is going; stops at the first failure so its error stays visible. */
	async function importFiles(files: File[], parentId: string | null) {
		const pdfs = files.filter(file => file.type === 'application/pdf');
		for (const [index, file] of pdfs.entries()) if (!(await run(`Mengimpor ${pdfs.length > 1 ? `${index + 1}/${pdfs.length} ` : ''}${file.name}…`, () => importPdf(file, parentId)))) return;
	}

	function move(id: string, parentId: string | null) {
		const item = items.find(other => other.id === id);
		if (!item || item.parentId === parentId) return;
		for (let at = parentId; at; at = items.find(other => other.id === at)?.parentId ?? null) if (at === id) return; // a folder can't go inside itself
		if (parentId) setExpanded(previous => new Set(previous).add(parentId));
		apply('Memindahkan…', [{ ...item, parentId, updated: new Date().toISOString() }]);
	}

	const [dragOver, setDragOver] = useState<string | null>(); // folder under the cursor while dragging; null = root
	const drop = (parentId: string | null): DropHandlers => ({
		onDragOver: event => {
			event.preventDefault();
			event.stopPropagation();
			setDragOver(parentId);
		},
		onDragLeave: event => {
			if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragOver(undefined);
		},
		onDrop: event => {
			event.preventDefault();
			event.stopPropagation();
			setDragOver(undefined);
			const id = event.dataTransfer.getData(DRAG);
			if (id) move(id, parentId);
			else importFiles([...event.dataTransfer.files], parentId);
		},
	});

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
							multiple
							hidden
							onChange={event => {
								const files = [...(event.target.files ?? [])];
								event.target.value = '';
								importFiles(files, folderId);
							}}
						/>
					</div>
				</header>
				<nav className={`thin-scroll flex-1 overflow-y-auto px-2 pb-3 transition-colors duration-150 ${dragOver === null ? 'bg-accent-soft/50' : ''}`} {...drop(null)}>
					{items.length ? (
						<Tree items={items} parentId={null} openId={openId} folderId={folderId} expanded={expanded} onOpen={open} onFolder={toggleFolder} onRename={rename} onDelete={remove} dragOver={dragOver} drop={drop} />
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
					<EmptyState onPdf={() => pdfInput.current?.click()} onFiles={files => importFiles(files, folderId)} onCanvas={() => create('canvas')} />
				)}
			</main>
		</div>
	);
}
