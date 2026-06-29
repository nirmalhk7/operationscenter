# Tailscale Access Guide

This guide is for authorized operators who need to reach the Operations Center network through Tailscale.

Tailscale gives you network access. It does not replace app-level authentication such as Authelia or local credentials.

## Quick Start

1. Ask Nirmal to grant access and add your account to the Authelia user list in [clusters/managed/security/authelia/](clusters/managed/security/authelia/).
2. Install Tailscale on your device.
3. Sign in with the approved account.
4. Wait for your device to appear in the Tailscale admin console if approval is required.
5. Open a trusted service URL such as `https://home.trusted.nirmalhk7.com`.

## What This Unlocks

- The Proxmox node accepts Tailscale clients from `100.64.0.0/10`.
- The host's current Tailscale IP is `100.87.0.43`.
- From the tailnet, traffic is forwarded to internal services such as Nginx and the Kubernetes API.
- For repo automation over the VPN, use `PROXMOX_HOST=100.87.0.43` when running Ansible.

## 1. Ask For Access

Before installing anything, ask Nirmal for two things:

- Approval to join the tailnet.
- A matching entry in the Authelia user list in [clusters/managed/security/authelia/](clusters/managed/security/authelia/).

Use the same account for Tailscale and Authelia unless you are told otherwise.

## 2. Install Tailscale

Choose the instructions for your device:

- macOS: [Install Tailscale on macOS](https://tailscale.com/docs/install/mac)
- Windows: [Install Tailscale on Windows](https://tailscale.com/docs/install/windows)
- Android: [Install Tailscale on Android](https://tailscale.com/docs/install/android)

General docs:

- [Install Tailscale](https://tailscale.com/docs/install)
- [Auth keys](https://tailscale.com/docs/features/access-control/auth-keys)
- [Tailscale SSH](https://tailscale.com/docs/features/tailscale-ssh)
- [Subnet routers](https://tailscale.com/docs/features/subnet-routers)

## 3. Sign In And Connect

### macOS

- Open the app and sign in with your approved account.
- Confirm the menu bar icon shows the device is connected.
- If you prefer the CLI, run `tailscale status`.

### Windows

- Open the app and sign in with your approved account.
- Confirm the app shows the device as connected.
- If you prefer the CLI, run `tailscale status`.

### Android

- Open the app and sign in with your approved account.
- Accept the Android VPN permission prompt.
- Keep the VPN enabled while you are using internal services.

## 4. Verify Access

1. Open the Tailscale admin console and confirm your device appears in [Tailscale Machines](https://login.tailscale.com/admin/machines).
2. Open a trusted service URL in your browser.
3. If you are on a desktop, you can also verify the VPN status with `tailscale status`.

Trusted service examples:

- `https://home.trusted.nirmalhk7.com`
- `https://proxmox.trusted.nirmalhk7.com`
- `https://secure.trusted.nirmalhk7.com`
- `https://scrutiny.trusted.nirmalhk7.com`
- `https://robot.trusted.nirmalhk7.com`

## 5. Use The Right Path

### Browser access

Use the normal trusted service URLs once Tailscale is connected.

### Proxmox and automation

- Use `100.87.0.43` when you need to reach Proxmox from the tailnet.
- For Ansible over Tailscale:

```bash
PROXMOX_HOST=100.87.0.43 make ansible-run
```

- The Ansible inventory already uses `PROXMOX_HOST` as the SSH entry point when you are on VPN.

### SSH and cluster admin

- Use SSH from a connected desktop when a workflow requires a shell.
- The host playbook starts Tailscale with SSH support enabled by default unless overridden.
- The Kubernetes API is available on port `6443` through the host's Tailscale IP.

## If Something Fails

1. Confirm the Tailscale app says connected.
2. Confirm your device appears in [Tailscale Machines](https://login.tailscale.com/admin/machines).
3. Confirm you are signed in with the right account.
4. Confirm you are using a trusted `*.trusted.nirmalhk7.com` URL.
5. If you are running repo automation, confirm `PROXMOX_HOST=100.87.0.43` is set.
6. If the device is approved but the service still fails, the problem may be app-level auth, not network access.

## Related Docs

- [Operations Center README](README.md)
- [Proxmox Firewall Rules](infrastructure/terra/proxmox/README.md)
