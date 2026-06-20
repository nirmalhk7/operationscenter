# Homepage Images

Static assets in this directory are packaged into generated ConfigMaps and
mounted into the Homepage container.

The six wallpaper files are mounted at `/app/public/images/homepage` and served
as `/images/homepage/<name>`:

- `dawn.webp`
- `morning.webp`
- `afternoon.webp`
- `evening.webp`
- `twilight.webp`
- `night.webp`

Local tile icons are mounted separately under `/app/public/icons`.
