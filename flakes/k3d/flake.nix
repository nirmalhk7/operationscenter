{
  description = "A flake to install k3d and create clusters";

  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs?ref=nixos-unstable";
  };

  outputs = { self, nixpkgs }: {
    forAllSystems = f: {
      x86_64-linux = f "x86_64-linux";
      aarch64-darwin = f "aarch64-darwin";
      # Add other architectures as needed
    };

    packages = self.forAllSystems (system: {
      k3d = nixpkgs.legacyPackages.${system}.k3d;
    });

    defaultPackage = self.forAllSystems (system: self.packages.${system}.k3d);

    devShell = self.forAllSystems (system: with nixpkgs.legacyPackages.${system}; mkShell {
      buildInputs = [ k3d ];

      shellHook = ''
        # Create clusters
        k3d cluster create milano-dev --tls-san "trusted.nirmalhk7.com" --tls-san "milano"
        k3d cluster create milano-managed --servers 2 --agents 2 --tls-san "trusted.nirmalhk7.com" --tls-san "milano"
        k3d cluster create milano-live --tls-san "trusted.nirmalhk7.com" --tls-san "milano"

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
      '';
    });
  };
}