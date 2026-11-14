import assert from 'node:assert/strict';
import { followOwners, type Part } from './explanations.ts';

const scene = (mark: boolean, note: Part['customData'] & { isDeleted?: boolean } = {}, arrow: Part['customData'] & { isDeleted?: boolean } = {}): Part[] => [
	{ id: 'mark', isDeleted: !mark },
	{ id: 'note', isDeleted: note.isDeleted ?? false, customData: { owner: 'mark', cascaded: note.cascaded } },
	{ id: 'text', isDeleted: note.isDeleted ?? false, customData: { owner: 'note', cascaded: note.cascaded } },
	{ id: 'arrow', isDeleted: arrow.isDeleted ?? false, customData: { owner: 'note', cascaded: arrow.cascaded } },
];
const result = (parts: Part[]) => Object.fromEntries(followOwners(parts));

// mark deleted -> note, its text and the arrow go
assert.deepEqual(result(scene(false)), { note: true, text: true, arrow: true });
// undo brings the mark back -> everything removed with it returns
assert.deepEqual(result(scene(true, { isDeleted: true, cascaded: true }, { isDeleted: true, cascaded: true })), { note: false, text: false, arrow: false });
// note deleted by hand (Excalidraw takes its text) -> only the arrow goes, the mark stays
assert.deepEqual(result(scene(true, { isDeleted: true })), { arrow: true });
// arrow deleted by hand -> nothing else changes, and it isn't brought back
assert.deepEqual(result(scene(true, {}, { isDeleted: true })), {});
// all in place -> no changes
assert.deepEqual(result(scene(true)), {});
// mark gone for good (not in the scene) counts as deleted
assert.deepEqual(result(scene(true).slice(1)), { note: true, text: true, arrow: true });
console.log('explanations ok');
