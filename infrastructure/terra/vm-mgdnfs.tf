resource "proxmox_virtual_environment_vm" "vm-mgdnfs1" {
  name        = "mgdnfs1"
  description = "Managed by Terraform"
  tags        = ["debian"]

  node_name = local.nodeName
  vm_id     = 108
  boot_order = [
    "scsi0",
    "net0",
    "scsi1"
  ]
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
    dedicated = 1024*3
  }

  disk {
    datastore_id = "local"
    import_from  = proxmox_virtual_environment_download_file.debian-13-generic-amd64-qcow2.id
    interface    = "scsi0"
    size = 3
  }

  disk {
      backup            = true
      cache             = "none"
      datastore_id      = "hdd"
      discard           = "ignore"
      file_format       = "qcow2"
      interface         = "scsi1"
      iothread          = false
      replicate         = true
      size              = 32
      ssd               = false
  }

  
  initialization {
    datastore_id = "local"
    ip_config {
      ipv4 {
        address = "${local.machineSubnet}108/24"
        gateway = "${local.machineSubnet}1"
      }
    }

    user_account {
      password = "${var.vm_password}108"
      keys = [local.sshKeys.mgd]
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

resource "proxmox_virtual_environment_firewall_rules" "lxc-vm-mgdnfs1-sg" {
  depends_on = [ 
    proxmox_virtual_environment_vm.vm-mgdnfs1,
    proxmox_virtual_environment_cluster_firewall_security_group.sg-managed
  ]

  node_name = local.nodeName
  vm_id     = proxmox_virtual_environment_vm.vm-mgdnfs1.vm_id
  
  rule {
    security_group = proxmox_virtual_environment_cluster_firewall_security_group.sg-managed.name
    comment        = "Dev Test"
    iface          = "net0"
    enabled        = true
  }
}