locals {
  k8live = {
    resourceId = 101
  }
}

resource "proxmox_vm_qemu" "k8live" {
  name        = "k8live"
  vmid        = local.k8live.resourceId
  target_node = "milano" 
  pool        = "mx-mgd"           
  onboot      = true           
  tags        = "mgd"
  
  cores       = 2
  sockets     = 2
  memory      = 12000

  # Disk
  disk {
    size     = "100G"
    type     = "scsi"
    storage  = "local"
  }

  # Network
  network {
    model  = "virtio"
    bridge = "wmnet"
    firewall = false
  }

  iso = local.os_isos.alpine
}