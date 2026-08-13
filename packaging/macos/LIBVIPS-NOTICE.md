# sharp-libvips redistribution notice

The macOS bundle includes `@img/sharp-libvips-darwin-arm64` version 1.3.2 as
a separate dynamically loaded runtime package for Sharp. Its package metadata
declares `LGPL-3.0-or-later`.

- Exact build recipes and corresponding source references:
  <https://github.com/lovell/sharp-libvips/tree/v1.3.2>
- Upstream libvips source:
  <https://github.com/libvips/libvips>
- Installed package path:
  `node_modules/@img/sharp-libvips-darwin-arm64`

The packaged library remains separate from the MyNAS application bundle and
can be replaced in that package path with a compatible user-modified build.
The included package README lists the other linked libraries, their licenses,
and their source/license URLs.

The bundle also includes `heic-decode` (ISC) and its separate
`libheif-js` runtime package (LGPL-3.0) for HEIC decoding. The unmodified
runtime can be replaced under `node_modules/libheif-js`; source is available
at <https://github.com/catdad-experiments/libheif-js>.

The full GNU LGPL version 3 and incorporated GNU GPL version 3 terms accompany
the runtime as `LGPL-3.0.txt` and `GPL-3.0.txt`. Those files govern libvips;
they do not change MyNAS's Apache-2.0 license.
