# operationscenter

This repository contains configurations for my home server, which I call "Operations Center" because I want to model this exactly like in a professional setting.


        # Create clusters
        echo "dev cluster: playground"
        k3d cluster create milano-dev --k3s-arg "--tls-san 'kube.trusted.nirmalhk7.com' --tls-san 'milano'"
        echo "managed cluster: critical applications"
        k3d cluster create milano-managed --servers 2 --agents 2  --k3s-arg "--tls-san 'trusted.nirmalhk7.com' --tls-san 'milano'"
        echo "live cluster: internet exposed"
        k3d cluster create milano-live  --k3s-arg "--tls-san 'trusted.nirmalhk7.com' --tls-san 'milano'"

        # Print client-certificate-data, client-key-data, and certificate-authority-data
        for cluster in milano-dev milano-managed milano-live; do
          echo "Cluster: $cluster"
          kubectl config view --raw -o jsonpath="{.clusters[?(@.name==\"$cluster\")].cluster.certificate-authority-data}"
          echo
          kubectl config view --raw -o jsonpath="{.users[?(@.name==\"$cluster\")].user.client-certificate-data}"
          echo
          kubectl config view --raw -o jsonpath="{.users[?(@.name==\"$cluster\")].user.client-key-data}"
          echo
        done