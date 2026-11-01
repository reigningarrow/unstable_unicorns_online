# Card artwork

Drop images in this folder and any card whose **name matches the file name** gets that picture
automatically — for every player, with no importing. New files appear within a few seconds (no restart);
the in-game **🖼 Manage Card Artwork → 🔄 Rescan** button picks them up instantly.

## Naming

Name each file after the card. Capitals, punctuation and spaces don't matter, so each of these works for
`Neigh, M'Lord`:

    Neigh, M'Lord.png        neigh_m_lord.jpg        neigh-m-lord.webp

One thing to watch: punctuation turns into a *space*, so the apostrophe in `M'Lord` must be replaced by a
separator — `MLord` (no separator) would **not** match. When in doubt, copy the card's exact name.

Also fine:

| File | Matches |
|---|---|
| `Alluring Narwhal.png` | Alluring Narwhal |
| `Baby Unicorn (Red).webp` | Baby Unicorn (Red) |
| `001 - Baby Unicorn (Pink).png` | Baby Unicorn (Pink) *(a leading index number is ignored)* |
| `Rainbow Aura@2x.png`, `Rainbow Aura front.png` | Rainbow Aura *(trailing `@2x`, `front`, `art`, `card`… are ignored)* |
| `dragons/Dragon's Blessing.png` | Dragon's Blessing *(subfolders are searched, up to 4 deep)* |

Supported types: `.png .jpg .jpeg .webp .gif .avif .svg`. Cards that share a name (all the plain
`Neigh` cards) share one picture. If two files match the same card, the exact-name one wins and the
other is listed as ignored in the Art Manager.

## Where this folder lives

* **Local / `npm start`:** `art/` next to `client/` and `server/`.
* **Docker:** the image copies `art/` in, and `docker-compose`/`docker run -v "$PWD/art:/app/art"`
  lets you add images without rebuilding.
* **Anywhere else:** set the `ART_DIR` environment variable to any folder.

Anything a player uploads in their own browser (Manage Card Artwork) overrides this folder for them only.
