resource "proxmox_virtual_environment_vm" "vm-dbpgvectomgd" {
  name        = "db-pgvecto-mgd"
  description = "Managed by Terraform"
  tags        = ["managed"]

  node_name = local.nodeName
  vm_id     = 106
  
  agent {
    # read 'Qemu guest agent' section, change to true only when ready
    enabled = true
  }
  
  # if agent is not enabled, the VM may not be able to shutdown properly, and may need to be forced off
  stop_on_destroy = true

  on_boot = true

  pool_id = proxmox_virtual_environment_pool.pool-mgd.id

  cpu {
    cores        = 3
    type         = "x86-64-v2-AES"  # recommended for modern CPUs
  }

  memory {
    dedicated = 1024*5
  }

  disk {
    datastore_id = "local"
    import_from  = proxmox_virtual_environment_download_file.debian-13-generic-amd64-qcow2.id
    interface    = "scsi0"
    size = 100
  }

  
  initialization {
    datastore_id = "local"
    ip_config {
      ipv4 {
        address = "${local.machineSubnet}106/24"
        gateway = "${local.machineSubnet}1"
      }
    }

    user_account {
      password = "${var.vm_password}106"
      username = "root"
    }
  }

  network_device {
    bridge = "wmnet"
    firewall = false
  }

  operating_system {
    type = "l26"
  }

  efi_disk {
    datastore_id = "local"
  }

  tpm_state {
    datastore_id = "local"
  }

  serial_device {}
}

resource "proxmox_virtual_environment_firewall_rules" "lxc-vm-dbpgvectomgd-sg" {
  depends_on = [ 
    proxmox_virtual_environment_vm.vm-dbpgvectomgd,
    proxmox_virtual_environment_cluster_firewall_security_group.sg-managed
  ]

  node_name = local.nodeName
  vm_id     = proxmox_virtual_environment_vm.vm-dbpgvectomgd.vm_id
  
  rule {
    security_group = proxmox_virtual_environment_cluster_firewall_security_group.sg-managed.name
    comment        = "Dev Test"
    iface          = "net0"
    enabled        = true
  }
}