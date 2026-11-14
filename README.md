# coret

Canvas ala Excalidraw untuk membaca dan mencoret-coret PDF, dengan DeepSeek bawaan. Pengganti Obsidian + plugin Excalidraw untuk pemakaian pribadi. Vite + React + TypeScript, satu Cloudflare Worker untuk SPA dan `/api`.

## Pengembangan lokal

```sh
pnpm install
pnpm exec wrangler d1 migrations apply coret --local   # sekali
pnpm dev
```

Isi `DEEPSEEK_API_KEY` di `.dev.vars`. `AUTH_DISABLED=1` di file itu melewati pemeriksaan Cloudflare Access, dan hanya berlaku lokal.

`pnpm test` menjalankan tes kecil untuk `src/geometry.ts`.

## Fitur versi awal

- Tree folder dan canvas (D1). Item baru masuk ke folder yang terakhir diklik ("Simpan ke").
- **+ PDF**: PDF diunggah ke R2, lalu dibuat satu canvas berisi semua halaman yang disusun ke bawah dan dikunci. Halaman di-render pdf.js hanya saat mendekati layar. Canvas cuma menyimpan referensi "PDF X halaman N", bukan gambarnya.
- Isi canvas (JSON Excalidraw) disimpan di R2 sebagai `canvas/<id>.json`, otomatis 1 detik setelah berhenti menggambar. Gambar yang di-paste diunggah ke R2 saat disimpan.
- **Jelaskan**: kotakin bagian halaman, pilih kotaknya, klik *Jelaskan*. Potongan gambar dikirim lewat Worker ke `deepseek-flash` (vision, thinking dimatikan). Jawabannya muncul sebagai kotak di kanan halaman, dengan panah dari bagian yang ditandai.
- Ganti nama dan hapus lewat ikon yang muncul saat kursor di atas item. Menghapus folder ikut menghapus isinya. Canvas yang dihapus ikut dibersihkan dari R2 (gambar coretan, PDF, gambar yang di-paste); di D1 tersisa tanda hapus supaya perangkat lain tidak menghidupkannya lagi.
- API hanya menerima JWT Cloudflare Access yang valid.

Belum ada (sengaja): pindah item, cache offline IndexedDB, panel chat, versi HP, pencarian.

## Deploy pertama

```sh
pnpm exec wrangler d1 create coret            # salin database_id ke wrangler.jsonc
pnpm exec wrangler r2 bucket create coret-files
pnpm exec wrangler secret put DEEPSEEK_API_KEY
```

Buat aplikasi Cloudflare Access untuk `coret.wahyusyahputra.com`, lalu salin AUD-nya ke `ACCESS_AUD` di `wrangler.jsonc`. Selama `ACCESS_AUD` kosong, semua `/api` menolak dengan 401. Setelah itu:

```sh
pnpm run deploy
```
