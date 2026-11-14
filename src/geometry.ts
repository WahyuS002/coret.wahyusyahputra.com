export type Box = { x: number; y: number; width: number; height: number };

/** Area two boxes share; 0 when they don't touch. */
export const overlap = (a: Box, b: Box) =>
	Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));

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
