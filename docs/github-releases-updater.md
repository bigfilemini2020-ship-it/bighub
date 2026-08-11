# BigHub GitHub Releases Updater

BigHub desktop updates use Tauri updater with GitHub Releases. Media files are not distributed through this path.

## What Goes To GitHub Releases

- Windows installer: `BigHub_*_x64-setup.exe`
- Installer signature: `BigHub_*_x64-setup.exe.sig`
- Updater manifest: `latest.json`

Do not upload videos, images, PDFs, or post attachments as release assets.

## One-Time Migration

Current installed apps that still point to the old Vercel updater endpoint need one manual install. After users install the first GitHub-updater build, later updates can be delivered through GitHub Releases.

## Release Steps

1. Finish all app fixes.
2. Bump both versions once:
   - `src-tauri/tauri.conf.json`
   - `src-tauri/Cargo.toml`
3. Build installer:

```powershell
npm run desktop:build
```

4. Create updater manifest:

```powershell
node work/create-updater-manifest.mjs `
  --version 0.1.8 `
  --tag v0.1.8 `
  --asset "src-tauri/target/release/bundle/nsis/BigHub_0.1.8_x64-setup.exe" `
  --out latest.json `
  --notes "BigHub desktop update"
```

5. Create GitHub Release tag `v0.1.8`.
6. Upload installer, `.sig`, and `latest.json` to that release.
7. Test from the previously installed GitHub-updater build using Settings -> 업데이트 확인.

## Manifest Shape

Tauri static updater JSON uses platform keys like `windows-x86_64`. `signature` must be the content of the generated `.sig` file, not a file path or URL.
