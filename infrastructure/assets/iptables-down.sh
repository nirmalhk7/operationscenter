#!/bin/bash

# ==========================================
# OPERATIONS CENTER: Network Down Script
# ==========================================

# --- CONFIGURATION VARIABLES ---
HOST_IP="${HOST_IP:?}"
INT_SUBNET="${INT_SUBNET:?}"

NGINX_IP="${NGINX_IP:?}"
K8S_IP="${K8S_IP:?}"
VPN_IP="${VPN_IP:?}"
NFS_IP="${NFS_IP:?}"

WAN_IFACE="${WAN_IFACE:?}"
LAN_IFACE="${LAN_IFACE:?}"
VPN_IFACE="${VPN_IFACE:?}"
# -------------------------------

# 1. Remove Core Routing
iptables -t nat -D POSTROUTING -o "$VPN_IFACE" -s "$INT_SUBNET" -j MASQUERADE
iptables -t nat -D POSTROUTING -o "$WAN_IFACE" -s "$INT_SUBNET" -j SNAT --to-source "$HOST_IP"

# 2. Remove Forwarding
iptables -D FORWARD -i "$LAN_IFACE" -o "$WAN_IFACE" -j ACCEPT
iptables -D FORWARD -i "$WAN_IFACE" -o "$LAN_IFACE" -m state --state RELATED,ESTABLISHED -j ACCEPT
iptables -D FORWARD -i "$LAN_IFACE" -o "$VPN_IFACE" -j ACCEPT
iptables -D FORWARD -i "$VPN_IFACE" -o "$LAN_IFACE" -j ACCEPT

# 3. Remove ICMP
iptables -D INPUT -i "$LAN_IFACE" -p icmp -j ACCEPT
iptables -D OUTPUT -o "$LAN_IFACE" -p icmp -j ACCEPT

# 4. Remove LAN Port Forwards
iptables -t nat -D PREROUTING -d "$HOST_IP" -p tcp --dport 80 -j DNAT --to-destination "$NGINX_IP":80
iptables -t nat -D PREROUTING -d "$HOST_IP" -p tcp --dport 443 -j DNAT --to-destination "$NGINX_IP":443
iptables -t nat -D PREROUTING -d "$HOST_IP" -p tcp --dport 6443 -j DNAT --to-destination "$K8S_IP":6443

# Remove NFS and RPC Bind DNAT rules
iptables -t nat -D PREROUTING -p tcp --dport 2049 -j DNAT --to-destination "$NFS_IP":2049 2>/dev/null
iptables -t nat -D PREROUTING -p tcp --dport 111 -j DNAT --to-destination "$NFS_IP":111 2>/dev/null
iptables -t nat -D PREROUTING -p udp --dport 111 -j DNAT --to-destination "$NFS_IP":111 2>/dev/null

iptables -D FORWARD -p tcp -d "$NGINX_IP" --dport 80 -m state --state NEW,ESTABLISHED,RELATED -j ACCEPT
iptables -D FORWARD -p tcp -d "$NGINX_IP" --dport 443 -m state --state NEW,ESTABLISHED,RELATED -j ACCEPT
iptables -D FORWARD -p tcp -d "$K8S_IP" --dport 6443 -m state --state NEW,ESTABLISHED,RELATED -j ACCEPT
iptables -D FORWARD -p tcp -s "$NGINX_IP" -m state --state ESTABLISHED,RELATED -j ACCEPT
iptables -D FORWARD -p tcp -s "$K8S_IP" -m state --state ESTABLISHED,RELATED -j ACCEPT

# 5. Remove Tailscale Ingress
iptables -t nat -D PREROUTING -i "$VPN_IFACE" -p tcp --dport 80 -j DNAT --to-destination "$NGINX_IP":80 2>/dev/null
iptables -t nat -D PREROUTING -i "$VPN_IFACE" -p tcp --dport 443 -j DNAT --to-destination "$NGINX_IP":443 2>/dev/null
iptables -t nat -D PREROUTING -i "$VPN_IFACE" -p tcp --dport 6443 -j DNAT --to-destination "$K8S_IP":6443 2>/dev/null

# 6. Remove Localhost Loopback
iptables -t nat -D OUTPUT -d "$VPN_IP" -p tcp --dport 80 -j DNAT --to-destination "$NGINX_IP":80 2>/dev/null
iptables -t nat -D OUTPUT -d "$VPN_IP" -p tcp --dport 443 -j DNAT --to-destination "$NGINX_IP":443 2>/dev/null
iptables -t nat -D OUTPUT -d "$VPN_IP" -p tcp --dport 6443 -j DNAT --to-destination "$K8S_IP":6443 2>/dev/null
