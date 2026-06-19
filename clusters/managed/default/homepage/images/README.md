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

The on-page logo is mounted separately at `/app/public/icons/logo.svg` and
referenced from `widgets.yaml` as `/icons/logo.svg`. Keep `logo.png` out of the
ConfigMap unless it is heavily compressed; the current SVG is the deployed logo.
