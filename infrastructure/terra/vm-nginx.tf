locals {
  nginx = {
    resourceId = 100
  }
}

resource "proxmox_vm_qemu" "nginx" {
  name        = "nginx"
  vmid        = local.nginx.resourceId
  target_node = "milano" 
  pool        = "mx-mgd"           
  onboot      = true           
  tags        = "mgd"
  
  cores       = 1
  sockets     = 2
  memory      = 3000

  # Disk
  disk {
    size     = "32G"
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