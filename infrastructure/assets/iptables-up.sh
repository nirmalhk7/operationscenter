#!/bin/bash

# ==========================================
# OPERATIONS CENTER: Network Up Script
# ==========================================

# --- CONFIGURATION VARIABLES ---
HOST_IP="${HOST_IP:?}"
INT_SUBNET="${INT_SUBNET:?}"

NGINX_IP="${NGINX_IP:?}"
K8S_IP="${K8S_IP:?}"
VPN_IP="${VPN_IP:?}"

WAN_IFACE="${WAN_IFACE:?}"
LAN_IFACE="${LAN_IFACE:?}"
VPN_IFACE="${VPN_IFACE:?}"
# -------------------------------

# 1. Enable IP Forwarding
echo 1 > /proc/sys/net/ipv4/ip_forward

# 2. FLUSH EXISTING RULES
iptables -F
iptables -t nat -F
iptables -t mangle -F
iptables -X

# ==========================================
# 3. CORE ROUTING & NAT
# ==========================================

# A. ENABLE OUTGOING TAILSCALE TRAFFIC (Masquerade)
iptables -t nat -A POSTROUTING -o "$VPN_IFACE" -s "$INT_SUBNET" -j MASQUERADE

# B. ENABLE OUTGOING INTERNET TRAFFIC (SNAT to WiFi)
iptables -t nat -A POSTROUTING -o "$WAN_IFACE" -s "$INT_SUBNET" -j SNAT --to-source "$HOST_IP"

# C. ENABLE FORWARDING
iptables -A FORWARD -i "$LAN_IFACE" -o "$WAN_IFACE" -j ACCEPT
iptables -A FORWARD -i "$WAN_IFACE" -o "$LAN_IFACE" -m state --state RELATED,ESTABLISHED -j ACCEPT
iptables -A FORWARD -i "$LAN_IFACE" -o "$VPN_IFACE" -j ACCEPT
iptables -A FORWARD -i "$VPN_IFACE" -o "$LAN_IFACE" -j ACCEPT

# D. Allow ICMP
iptables -A INPUT -i "$LAN_IFACE" -p icmp -j ACCEPT
iptables -A OUTPUT -o "$LAN_IFACE" -p icmp -j ACCEPT

# ==========================================
# 4. LAN PORT FORWARDING (Incoming from host)
# ==========================================

# Port 80/443 -> Nginx
iptables -t nat -A PREROUTING -d "$HOST_IP" -p tcp --dport 80 -j DNAT --to-destination "$NGINX_IP":80
iptables -t nat -A PREROUTING -d "$HOST_IP" -p tcp --dport 443 -j DNAT --to-destination "$NGINX_IP":443
# Port 6443 -> K8s
iptables -t nat -A PREROUTING -d "$HOST_IP" -p tcp --dport 6443 -j DNAT --to-destination "$K8S_IP":6443

# Port 2049 -> NFS
iptables -t nat -A PREROUTING -p tcp --dport 2049 -j DNAT --to-destination "$NFS_IP":2049

# Redirect RPC Bind (Port 111) - Required for clients to "find" the share
iptables -t nat -A PREROUTING -p tcp --dport 111 -j DNAT --to-destination "$NFS_IP":111
iptables -t nat -A PREROUTING -p udp --dport 111 -j DNAT --to-destination "$NFS_IP":111

# Standard Forwarding Allows
iptables -A FORWARD -p tcp -d "$NGINX_IP" --dport 80 -m state --state NEW,ESTABLISHED,RELATED -j ACCEPT
iptables -A FORWARD -p tcp -d "$NGINX_IP" --dport 443 -m state --state NEW,ESTABLISHED,RELATED -j ACCEPT
iptables -A FORWARD -p tcp -d "$K8S_IP" --dport 6443 -m state --state NEW,ESTABLISHED,RELATED -j ACCEPT
iptables -A FORWARD -p tcp -s "$NGINX_IP" -m state --state ESTABLISHED,RELATED -j ACCEPT
iptables -A FORWARD -p tcp -s "$K8S_IP" -m state --state ESTABLISHED,RELATED -j ACCEPT

# ==========================================
# 5. TAILSCALE INGRESS (Incoming from VPN)
# ==========================================

iptables -t nat -A PREROUTING -i "$VPN_IFACE" -p tcp --dport 80 -j DNAT --to-destination "$NGINX_IP":80
iptables -t nat -A PREROUTING -i "$VPN_IFACE" -p tcp --dport 443 -j DNAT --to-destination "$NGINX_IP":443
iptables -t nat -A PREROUTING -i "$VPN_IFACE" -p tcp --dport 6443 -j DNAT --to-destination "$K8S_IP":6443

# ==========================================
# 6. LOCALHOST LOOPBACK (Access from Host itself)
# ==========================================
# Allows 'curl' from the host to work by intercepting local OUTPUT traffic

iptables -t nat -A OUTPUT -d "$VPN_IP" -p tcp --dport 80 -j DNAT --to-destination "$NGINX_IP":80
iptables -t nat -A OUTPUT -d "$VPN_IP" -p tcp --dport 443 -j DNAT --to-destination "$NGINX_IP":443
iptables -t nat -A OUTPUT -d "$VPN_IP" -p tcp --dport 6443 -j DNAT --to-destination "$K8S_IP":6443
