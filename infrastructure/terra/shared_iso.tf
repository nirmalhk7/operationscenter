resource "proxmox_virtual_environment_download_file" "debian-13-generic-amd64-qcow2" {
  content_type = "import"
  datastore_id = "local"
  node_name    = "milano"
  url = "https://cloud.debian.org/images/cloud/trixie/latest/debian-13-generic-amd64.qcow2"
  file_name = "debian-13-generic-amd64.qcow2"
}

resource "proxmox_virtual_environment_download_file" "ubuntu-noble-server-cloudimg-amd64-img" {
  content_type = "import"
  datastore_id = "local"
  node_name    = "milano"
  url = "https://cloud-images.ubuntu.com/noble/current/noble-server-cloudimg-amd64.img"
  file_name = "ubuntu-noble-server-cloudimg-amd64.qcow2"
}

resource "proxmox_virtual_environment_download_file" "alpine" {
  content_type = "import"
  datastore_id = "local"
  node_name    = "milano"
  url = "https://dl-cdn.alpinelinux.org/alpine/v3.22/releases/cloud/generic_alpine-3.22.1-x86_64-bios-cloudinit-r0.qcow2"
  file_name = "generic_alpine-3.22.1-x86_64-bios-cloudinit-r0.qcow2"
}