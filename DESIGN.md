# DESIGN.md — Terminal Velocity

## Mondo visuale
Terminale a fosforo ambra anni '70 (DEC VT100 / Tektronix): nero caldo, testo ambra con glow fosforo, scanline CRT, vignettatura e leggero flicker. Il mondo presta **tipo, palette, densità e una signature move** (Operate mode): la mosca è il bagliore fosforo + strato CRT su tutta la shell. Navigazione e controlli restano standard macOS-app.

## Palette (Committed: l'ambra possiede la superficie)
- bg `#0b0805` (nero caldo), surface `#141008`, raised `#1c150b`
- border `#332514`, border-hi `#4d3a1a`
- text `#ffd28a` (ambra chiaro), text-2 `#a67c3d`, muted `#6b501f`
- accent `#ffb000`, accent-hi `#ffc233`, glow `rgba(255,176,0,.35)`
- Stati (fanno lavoro, non decorazione): ok `#7dd87d`→ usa `#8fd66e` tiepido, warn `#ffb000`, err `#ff5f45`, info `#e8c36a`

## Tipo
- Display/brand: **VT323** (fontsource) — fosforo pixelato
- UI/testo: **IBM Plex Mono** — è la voce vera di un client SSH, non costume
- Numeri tabulari ovunque, tracking leggero, maiuscolo per label di sezione

## Signature move
Strato `#crt` fixed sopra l'app: scanline `repeating-linear-gradient` + vignetta radiale + flicker quasi impercettibile (~4s). Pointer-events none. Glow via `text-shadow` su brand/titoli/tab attiva. Cursore terminale ambra, caret ambra, selezione ambra scuro, scrollbar ambra spenta.

## Componenti
Sidebar ambra su fondo più scuro; tab a lamella con dot-stato fosforescente; modali con bordo ambra speso e ombra calda (offset + blur, mai aloni zero-offset); findbar/palette stile prompt `>`; lock screen con ASCII logo.

## Accessibilità
Testo `#ffd28a` su `#0b0805` ≈ 11:1, text-2 `#a67c3d` ≈ 4.6:1 ✓. Flicker <0.4% opacity, riducibile con prefers-reduced-motion.
