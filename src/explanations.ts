/** An element that may belong to another: a Jelaskan note belongs to its mark, its text and arrow to the note. */
export type Part = { id: string; isDeleted: boolean; customData?: { owner?: string; cascaded?: boolean } };

/**
 * Which parts to delete because their owner is gone, or bring back because their owner returned (undo).
 * Only parts deleted this way (`cascaded`) come back, so an arrow or note removed by hand stays removed.
 * Returns id -> new isDeleted; the caller stores that value as `cascaded` too.
 */
export function followOwners(elements: readonly Part[]): Map<string, boolean> {
	const deleted = new Map(elements.map(element => [element.id, element.isDeleted]));
	const changes = new Map<string, boolean>();
	for (let changed = true; changed; ) {
		changed = false; // repeat so a mark's removal reaches the note, then its text and arrow
		for (const element of elements) {
			const owner = element.customData?.owner;
			if (!owner) continue;
			const ownerGone = deleted.get(owner) ?? true;
			const isDeleted = deleted.get(element.id)!;
			const cascaded = changes.get(element.id) ?? element.customData?.cascaded;
			if (isDeleted === ownerGone || (isDeleted && !cascaded)) continue;
			deleted.set(element.id, ownerGone);
			changes.set(element.id, ownerGone);
			changed = true;
		}
	}
	return changes;
}
