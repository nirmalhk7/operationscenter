# Public Appwrite on `dev.nirmalhk7.com`

## Summary

Expose Appwrite Console and API publicly at `https://dev.nirmalhk7.com`, with Cloudflare Tunnel landing on bare-metal `cloudflared` inside the existing `live-nginx` LXC. `live-nginx` forwards only this hostname to a dedicated Traefik public entrypoint, and Appwrite manifests move from `mgd-devbench` into `clusters/live/devbench`, running in namespace `live-devbench` while continuing to use the existing external MariaDB database at `172.16.0.106:3306/appwrite`.

```text
Internet
-> Cloudflare DNS/WAF/Bot controls
-> Cloudflare Tunnel
-> live-nginx LXC: bare-metal cloudflared
-> live-nginx LXC: bare-metal Nginx
-> k8mgd Traefik livepublic entrypoint
-> Appwrite in live-devbench
-> existing MariaDB at 172.16.0.106:3306
```

## Implementation Notes

- `cloudflared` is installed directly on the Nginx LXC by Ansible and managed by systemd when `CLOUDFLARED_TUNNEL_TOKEN` is provided.
- Cloudflare should route `dev.nirmalhk7.com` to the tunnel origin `http://127.0.0.1:18080`.
- Nginx accepts only `dev.nirmalhk7.com` on the local tunnel listener and proxies to Traefik at `https://172.16.0.105:8443`.
- Traefik exposes a dedicated `livepublic` entrypoint; only Appwrite binds to it.
- Appwrite manifests live in `clusters/live/devbench`, run in namespace `live-devbench`, use the same MariaDB database and credentials, and keep `_APP_OPENSSL_KEY_V1` unchanged.
- Appwrite Console and API are both public; protection is layered through Cloudflare, Nginx, Traefik middleware, and Appwrite abuse controls.

## Rollout Checks

- Render Kubernetes:
  - `kubectl kustomize clusters/live/devbench`
  - `kubectl kustomize clusters/managed/kube-system`
  - `kubectl kustomize clusters/managed`
- Validate infra and proxy config:
  - `terraform fmt`
  - `terraform plan`
  - Nginx config test on `live-nginx`
- Before cutover, migrate or intentionally discard any Appwrite PVC data from `mgd-devbench`; the database alone does not preserve local uploads/certificates.
