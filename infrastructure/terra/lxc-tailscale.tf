resource "proxmox_virtual_environment_container" "lxc-tailscale" {
  description = "Tailscale entry point"
  node_name = local.nodeName
  vm_id     = 102
  tags = ["mgd"]

  initialization {
    hostname = "tailscale"

    ip_config {
      ipv4 {
        address = "${local.machineSubnet}102/24"
        gateway = "${local.machineSubnet}1"
      }
    }

    user_account {
        password = "${var.vm_password}102"
    }
  }

  network_interface {
    bridge = "wmnet"
    name = "net0"
    enabled = true
    firewall = true
    
  }

  memory {
    dedicated = 1024
  }
  
  cpu {
    architecture = "amd64"
    cores        = 2
    units        = 1024
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

resource "proxmox_virtual_environment_firewall_rules" "lxc-tailscale-sg" {
  node_name = local.nodeName
  vm_id     = 102
  
  rule {
    security_group = proxmox_virtual_environment_cluster_firewall_security_group.sg-managed.name
    comment        = "Dev TEst"
    iface          = "net0"
  }
}

resource "proxmox_virtual_environment_firewall_options" "lxc-tailscale-config" {
  depends_on = [proxmox_virtual_environment_container.lxc-tailscale]

  node_name = proxmox_virtual_environment_container.lxc-tailscale.node_name
  vm_id     = proxmox_virtual_environment_container.lxc-tailscale.vm_id

  enabled       = true
}