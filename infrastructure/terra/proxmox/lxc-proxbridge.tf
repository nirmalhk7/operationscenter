resource "proxmox_virtual_environment_container" "lxc-proxbridge" {

  description = "Proxmox bridge for host level activities"
  node_name   = local.nodeName
  vm_id       = local.proxmoxMachines.proxbridge.vm_id
  tags        = ["mgd"]
  pool_id     = proxmox_virtual_environment_pool.pool-mgd.pool_id

  initialization {
    hostname = "proxbridge"

    ip_config {
      ipv4 {
        address = local.proxmoxMachines.proxbridge.cidr
        gateway = local.proxmoxBridgeIp
      }
    }

    user_account {
      keys     = [local.sshKeys.mgd]
      password = "${var.vm_password}${local.proxmoxMachines.proxbridge.vm_id}"
    }
  }

  network_interface {
    bridge   = "wmnet"
    name     = "net0"
    enabled  = true
    firewall = false

  }

  memory {
    dedicated = 500
  }

  cpu {
    architecture = "amd64"
    cores        = 1
  }

  disk {
    datastore_id = "local"
    size         = 8
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

resource "proxmox_virtual_environment_firewall_rules" "lxc-proxbridge-sg" {
  depends_on = [
    proxmox_virtual_environment_container.lxc-proxbridge,
    proxmox_virtual_environment_cluster_firewall_security_group.sg-managed
  ]

  node_name = local.nodeName
  vm_id     = proxmox_virtual_environment_container.lxc-proxbridge.vm_id

  rule {
    security_group = proxmox_virtual_environment_cluster_firewall_security_group.sg-managed.name
    comment        = "Managed Group Rules"
    iface          = "net0"
    enabled        = true
  }
}

resource "proxmox_virtual_environment_firewall_options" "lxc-proxbridge-config" {
  depends_on = [proxmox_virtual_environment_container.lxc-proxbridge]
  node_name  = local.nodeName
  vm_id      = proxmox_virtual_environment_container.lxc-proxbridge.vm_id

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
