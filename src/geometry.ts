export type Box = { x: number; y: number; width: number; height: number };

/** Area two boxes share; 0 when they don't touch. */
export const overlap = (a: Box, b: Box) =>
	Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));

/** The smallest box around all of `boxes`. */
export function bounds(boxes: readonly Box[]): Box {
	const x = Math.min(...boxes.map(box => box.x));
	const y = Math.min(...boxes.map(box => box.y));
	return { x, y, width: Math.max(...boxes.map(box => box.x + box.width)) - x, height: Math.max(...boxes.map(box => box.y + box.height)) - y };
}

/**
 * Where to scroll so `page` is read from its top: centred across, zoomed to at least 100%, its top 80px below the screen's.
 * A page that fits whole on screen (a landscape slide) is centred down too, so the screen's middle stays on it.
 */
export function landOn(page: Box, screen: { width: number; height: number }, zoom: number) {
	const z = Math.max(zoom, 1);
	const scrollX = screen.width / (2 * z) - (page.x + page.width / 2);
	const scrollY = page.height * z <= screen.height ? screen.height / (2 * z) - (page.y + page.height / 2) : 80 / z - page.y;
	return { scrollX, scrollY, zoom: z };
}

/** Breaks a gloss into lines, since a labelled box grows to fit its text instead of wrapping it. */
export function wrap(text: string, width = 30): string {
	const lines: string[] = [];
	for (const word of text.split(/\s+/).filter(Boolean)) {
		const last = lines.at(-1);
		if (last !== undefined && (last + ' ' + word).length <= width) lines[lines.length - 1] = last + ' ' + word;
		else lines.push(word);
	}
	return lines.join('\n');
}
