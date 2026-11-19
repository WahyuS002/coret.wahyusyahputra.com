import assert from 'node:assert/strict';
import { bounds, landOn, overlap, wrap } from './geometry.ts';

// Zoomed out: back to 100%, page top 80px down, centred across.
assert.deepEqual(landOn({ x: 0, y: 2000, width: 800, height: 1130 }, { width: 1200, height: 900 }, 0.3), { scrollX: 200, scrollY: -1920, zoom: 1 });
// Zoomed in: zoom kept.
assert.equal(landOn({ x: 0, y: 0, width: 800, height: 1130 }, { width: 1200, height: 900 }, 2).zoom, 2);
// A landscape slide that fits: its middle at the screen's middle.
assert.equal(landOn({ x: 0, y: 1000, width: 800, height: 450 }, { width: 1200, height: 1200 }, 1).scrollY, 600 - 1225);

assert.equal(overlap({ x: 0, y: 0, width: 10, height: 10 }, { x: 5, y: 5, width: 10, height: 10 }), 25);
assert.equal(overlap({ x: 0, y: 0, width: 10, height: 10 }, { x: 20, y: 0, width: 5, height: 5 }), 0);
assert.deepEqual(bounds([{ x: 300, y: 10, width: 100, height: 20 }, { x: 50, y: 40, width: 80, height: 20 }]), { x: 50, y: 10, width: 350, height: 50 });
assert.equal(wrap('LAD artinya anak laki-laki (dialek Skotlandia), panggilan akrab untuk bocah.'), 'LAD artinya anak laki-laki\n(dialek Skotlandia), panggilan\nakrab untuk bocah.');
assert.equal(wrap('  satu  '), 'satu');
assert.equal(wrap('sebuahkatayangsangatpanjangsekalimelebihibatas pendek'), 'sebuahkatayangsangatpanjangsekalimelebihibatas\npendek');
console.log('geometry ok');
