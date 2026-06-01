resource "proxmox_virtual_environment_container" "lxc-nginx" {

  description = "NginX"
  node_name   = local.nodeName
  vm_id       = local.proxmoxMachines.nginx.vm_id
  tags        = ["mgd"]
  pool_id     = proxmox_virtual_environment_pool.pool-mgd.pool_id

  initialization {
    hostname = "nginx"

    ip_config {
      ipv4 {
        address = local.proxmoxMachines.nginx.cidr
        gateway = local.proxmoxBridgeIp
      }
    }

    user_account {
      keys     = [local.sshKeys.mgd]
      password = "${var.vm_password}${local.proxmoxMachines.nginx.vm_id}"
    }
  }

  network_interface {
    bridge   = "wmnet"
    name     = "net0"
    enabled  = true
    firewall = true
  }

  memory {
    dedicated = 1024
  }

  cpu {
    architecture = "amd64"
    cores        = 1
  }

  disk {
    datastore_id = "local"
    size         = 9
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

resource "proxmox_virtual_environment_firewall_rules" "lxc-nginx-sg" {
  depends_on = [
    proxmox_virtual_environment_container.lxc-nginx,
    proxmox_virtual_environment_cluster_firewall_security_group.sg-managed
  ]

  node_name = local.nodeName
  vm_id     = proxmox_virtual_environment_container.lxc-nginx.vm_id

  rule {
    security_group = proxmox_virtual_environment_cluster_firewall_security_group.sg-managed.name
    comment        = "Managed Group Rules"
    iface          = "net0"
    enabled        = true
  }

  rule {
    action  = "ACCEPT"
    type    = "in"
    proto   = "tcp"
    dport   = "80"
    comment = "Allow HTTP ingress"
    iface   = "net0"
    enabled = true
  }

  rule {
    action  = "ACCEPT"
    type    = "in"
    proto   = "tcp"
    dport   = "443"
    comment = "Allow HTTPS ingress"
    iface   = "net0"
    enabled = true
  }

  rule {
    action  = "ACCEPT"
    type    = "in"
    proto   = "tcp"
    dport   = "6901"
    comment = "Allow robot stream proxy ingress"
    iface   = "net0"
    enabled = true
  }
}

resource "proxmox_virtual_environment_firewall_options" "lxc-nginx-config" {
  depends_on = [proxmox_virtual_environment_container.lxc-nginx]
  node_name  = local.nodeName
  vm_id      = proxmox_virtual_environment_container.lxc-nginx.vm_id

  enabled       = true
  input_policy  = "DROP"
  output_policy = "ACCEPT"
  ipfilter      = false
  macfilter     = true
  ndp           = false
  radv          = false
  log_level_in  = "info"
  log_level_out = "info"
}
