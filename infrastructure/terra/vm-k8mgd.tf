locals {
  k8mgd = {
    resourceId = 101
  }
}

resource "proxmox_vm_qemu" "k8mgd" {
  name        = "k8mgd"
  vmid        = local.k8mgd.resourceId
  target_node = "milano" 
  pool        = "mx-mgd"           
  onboot      = true           
  tags        = "mgd"
  
  cores       = 2
  sockets     = 2
  memory      = 12000

  # Disk
  disk {
    size     = 50
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