{
  description = "A very basic flake";

  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs?ref=nixos-unstable";
    k3d-flake = path: ./flakes/k3d;
  };

  outputs = { self, nixpkgs, k3d-flake }: {

    packages = {
      x86_64-linux = {
        default = nixpkgs.legacyPackages.x86_64-linux.k3d;
        k3d = nixpkgs.legacyPackages.x86_64-linux.k3d;
      };

      aarch64-darwin = {
        default = nixpkgs.legacyPackages.aarch64-darwin.k3d;
        k3d = nixpkgs.legacyPackages.aarch64-darwin.k3d;
      };
    };

    devShell = {
      x86_64-linux = nixpkgs.mkShell {
        buildInputs = [
          nixpkgs.legacyPackages.x86_64-linux.k3d
        ];
      };

      aarch64-darwin = nixpkgs.mkShell {
        buildInputs = [
          nixpkgs.legacyPackages.aarch64-darwin.k3d
        ];
      };
    };

    overlay = final: prev: {
      k3d = k3d-flake.packages.${final.system}.defaultPackage;
    };
  };
}