• Proposed Plan


  # Firewall Review And Remediation Plan

  1. Summary
      1. The current Terraform firewall policy has several gaps where declared rules may not be enforced, especially where guest NICs have firewall
         = false.

      2. The dev security group is defined but unattached, and its current rule order would still allow dev-to-managed DNS/HTTP/HTTPS before the
         drop.

      3. The remediation should make enforcement explicit, tighten broad allows, align host iptables with Terraform intent, and update stale
         documentation.

  2. Findings
      1. High: Guest firewall rules are likely unenforced on several guests because per-NIC firewalling is disabled, including Nginx, k8mgd, and
         NFS.

      2. High: sg-dev is not attached to any guest, so dev-to-managed isolation is not active.
      3. High: sg-dev has a broad inbound allow that effectively permits all inbound traffic to dev IPs if attached.
      4. Medium: OpenClaw allows robot ingress only from Nginx, but Paperclip is configured to call OpenClaw directly from Kubernetes.
      7. Low: The Proxmox firewall README is stale; it says Nginx has firewall = true, but Terraform currently has false.

  3. Key Changes
      1. Set firewall = true for guests whose Terraform firewall rules are intended to be active, starting with Nginx and any VM whose inbound
         surface is documented as restricted.

      2. Rework sg-dev so dev-to-managed DROP rules run before generic outbound allows.
      3. Remove the broad dev inbound allow and attach sg-dev only to actual dev-tier guests when they exist.
      4. Restrict SSH allows to trusted management source ranges using a datacenter IP set or equivalent source rules.
      5. Either allow k8mgd-to-OpenClaw robot ingress for Paperclip or route Paperclip through Nginx and keep OpenClaw restricted to Nginx.
      6. Constrain host iptables DNAT/forwarding rules so they match expected destinations and interfaces instead of globally widening exposure.
      7. Update infrastructure/terra/proxmox/README.md after Terraform behavior is corrected.

  4. Test Plan
      1. Run terraform -chdir=infrastructure/terra/proxmox fmt -check -diff.
      2. Refresh or repair the local cached bpg/proxmox provider, then run terraform -chdir=infrastructure/terra/proxmox validate.
      3. Run terraform plan only after the Proxmox credentials/environment are intentionally provided.
      4. After apply, live-test Nginx 80/443/6901, k8mgd 6443, NFS 111/2049, OpenClaw 18789, SSH from trusted management ranges, and dev-to-managed
         deny behavior.

  5. Assumptions
      1. The intended model is the README’s model: managed inbound is explicit, Nginx/OpenClaw are firewall-enforced, and dev cannot reach managed.
      2. Dev-tier guests are not currently present in infrastructure/terra/proxmox; fix the reusable security group now and attach it when dev
         guests are added.

      3. No live terraform apply, Ansible run, or Nginx deployment is part of the code change unless explicitly requested.