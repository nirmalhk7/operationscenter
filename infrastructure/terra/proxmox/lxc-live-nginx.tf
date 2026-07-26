resource "proxmox_virtual_environment_container" "lxc-live-nginx" {

  description = "Dedicated public Appwrite ingress NginX"
  node_name   = local.nodeName
  vm_id       = local.proxmoxMachines.live_nginx.vm_id
  tags        = ["mgd"]
  pool_id     = proxmox_virtual_environment_pool.pool-mgd.pool_id

  initialization {
    hostname = "live-nginx"

    ip_config {
      ipv4 {
        address = local.proxmoxMachines.live_nginx.cidr
        gateway = local.proxmoxBridgeIp
      }
    }

    dns {
      servers = ["1.1.1.1", "1.0.0.1"]
    }

    user_account {
      keys     = [local.sshKeys.mgd]
      password = "${var.vm_password}${local.proxmoxMachines.live_nginx.vm_id}"
    }
  }

  network_interface {
    bridge   = "wmnet"
    name     = "net0"
    enabled  = true
    firewall = true
  }

  # Same shape as CT 101, reduced while the public ingress is small.
  memory {
    dedicated = 512
  }

  cpu {
    architecture = "amd64"
    cores        = 1
  }

  disk {
    datastore_id = "local"
    size         = 6
  }

  console {
    enabled   = true
    tty_count = 2
    type      = "tty"
  }

  operating_system {
    template_file_id = local.osTemplates.debian12
    type             = "debian"
  }
}

resource "proxmox_virtual_environment_firewall_rules" "lxc-live-nginx-sg" {
  depends_on = [proxmox_virtual_environment_container.lxc-live-nginx]

  node_name = local.nodeName
  vm_id     = proxmox_virtual_environment_container.lxc-live-nginx.vm_id

  # ALLOWED FROM ANY TO live Nginx
  rule {
    action  = "ACCEPT"
    type    = "in"
    proto   = "tcp"
    dport   = "22"
    comment = "Allow SSH management"
    iface   = "net0"
    enabled = true
  }

  # Prometheus runs on k8mgd and scrapes the local Nginx exporter.
  # ALLOWED FROM k8mgd TO live Nginx
  rule {
    action  = "ACCEPT"
    type    = "in"
    proto   = "tcp"
    dport   = "9113"
    source  = local.proxmoxMachines.k8mgd.ip
    comment = "Allow k8mgd to scrape live Nginx metrics"
    iface   = "net0"
    enabled = true
  }

  # The only private workload destination permitted from this LXC.
  # ALLOWED FROM live Nginx TO k8mgd
  rule {
    action  = "ACCEPT"
    type    = "out"
    proto   = "tcp"
    dest    = local.proxmoxMachines.k8mgd.ip
    dport   = "8443"
    comment = "Allow live Nginx to reach Traefik livepublic"
    iface   = "net0"
    enabled = true
  }

  # Deny private, link-local, and Tailscale destinations before broad Internet
  # port allows below. The k8mgd exception above remains permitted.
  # BLOCKED FROM live Nginx TO RFC1918 10/8
  rule {
    action  = "DROP"
    type    = "out"
    dest    = "8.8.8.8"
    comment = "Block all outbound traffic, including ICMP, to 8.8.8.8"
    iface   = "net0"
    log     = "info"
    enabled = true
  }

  rule {
    action  = "DROP"
    type    = "out"
    proto   = "icmp"
    dest    = "8.8.8.8"
    comment = "Explicitly block outbound ICMP to 8.8.8.8"
    iface   = "net0"
    log     = "info"
    enabled = true
  }

  # BLOCKED FROM live Nginx TO RFC1918 10/8
  rule {
    action  = "DROP"
    type    = "out"
    dest    = "10.0.0.0/8"
    comment = "Block outbound to RFC1918 10/8"
    iface   = "net0"
    log     = "info"
    enabled = true
  }

  # BLOCKED FROM live Nginx TO RFC1918 172.16/12
  rule {
    action  = "DROP"
    type    = "out"
    dest    = "172.16.0.0/12"
    comment = "Block outbound to RFC1918 172.16/12"
    iface   = "net0"
    log     = "info"
    enabled = true
  }

  # BLOCKED FROM live Nginx TO RFC1918 192.168/16
  rule {
    action  = "DROP"
    type    = "out"
    dest    = "192.168.0.0/16"
    comment = "Block outbound to RFC1918 192.168/16"
    iface   = "net0"
    log     = "info"
    enabled = true
  }

  # BLOCKED FROM live Nginx TO link-local destinations
  rule {
    action  = "DROP"
    type    = "out"
    dest    = "169.254.0.0/16"
    comment = "Block outbound to link-local destinations"
    iface   = "net0"
    log     = "info"
    enabled = true
  }

  # BLOCKED FROM live Nginx TO CGNAT and Tailscale range
  rule {
    action  = "DROP"
    type    = "out"
    dest    = "100.64.0.0/10"
    comment = "Block outbound to CGNAT and Tailscale range"
    iface   = "net0"
    log     = "info"
    enabled = true
  }

  # ALLOWED FROM live Nginx TO public Internet
  rule {
    action  = "ACCEPT"
    type    = "out"
    proto   = "tcp"
    dport   = "80"
    comment = "Allow outbound HTTP to public Internet"
    iface   = "net0"
    enabled = true
  }

  # ALLOWED FROM live Nginx TO public Internet
  rule {
    action  = "ACCEPT"
    type    = "out"
    proto   = "tcp"
    dport   = "443"
    comment = "Allow outbound HTTPS to public Internet"
    iface   = "net0"
    enabled = true
  }

  # ALLOWED FROM live Nginx TO Cloudflare Tunnel
  rule {
    action  = "ACCEPT"
    type    = "out"
    proto   = "tcp"
    dport   = "7844"
    comment = "Allow Cloudflare Tunnel over HTTP/2"
    iface   = "net0"
    enabled = true
  }

  # ALLOWED FROM live Nginx TO Cloudflare Tunnel
  rule {
    action  = "ACCEPT"
    type    = "out"
    proto   = "udp"
    dport   = "7844"
    comment = "Allow Cloudflare Tunnel over QUIC"
    iface   = "net0"
    enabled = true
  }

  # ALLOWED FROM live Nginx TO public Internet
  rule {
    action  = "ACCEPT"
    type    = "out"
    proto   = "tcp"
    dport   = "53"
    comment = "Allow outbound TCP DNS to public Internet"
    iface   = "net0"
    enabled = true
  }

  # ALLOWED FROM live Nginx TO public Internet
  rule {
    action  = "ACCEPT"
    type    = "out"
    proto   = "udp"
    dport   = "53"
    comment = "Allow outbound UDP DNS to public Internet"
    iface   = "net0"
    enabled = true
  }

}

resource "proxmox_virtual_environment_firewall_options" "lxc-live-nginx-config" {
  depends_on = [proxmox_virtual_environment_container.lxc-live-nginx]
  node_name  = local.nodeName
  vm_id      = proxmox_virtual_environment_container.lxc-live-nginx.vm_id

  enabled       = true
  input_policy  = "DROP"
  output_policy = "DROP"
  ipfilter      = false
  macfilter     = true
  ndp           = false
  radv          = false
  log_level_in  = "info"
  log_level_out = "info"
}
