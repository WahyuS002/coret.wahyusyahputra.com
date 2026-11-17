import assert from 'node:assert/strict';
import { bounds, overlap, wrap } from './geometry.ts';

assert.equal(overlap({ x: 0, y: 0, width: 10, height: 10 }, { x: 5, y: 5, width: 10, height: 10 }), 25);
assert.equal(overlap({ x: 0, y: 0, width: 10, height: 10 }, { x: 20, y: 0, width: 5, height: 5 }), 0);
assert.deepEqual(bounds([{ x: 300, y: 10, width: 100, height: 20 }, { x: 50, y: 40, width: 80, height: 20 }]), { x: 50, y: 10, width: 350, height: 50 });
assert.equal(wrap('LAD artinya anak laki-laki (dialek Skotlandia), panggilan akrab untuk bocah.'), 'LAD artinya anak laki-laki\n(dialek Skotlandia), panggilan\nakrab untuk bocah.');
assert.equal(wrap('  satu  '), 'satu');
assert.equal(wrap('sebuahkatayangsangatpanjangsekalimelebihibatas pendek'), 'sebuahkatayangsangatpanjangsekalimelebihibatas\npendek');
console.log('geometry ok');
