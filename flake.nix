{
  description = "Mainflake";

  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs?ref=nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
    # k3d-flake.url = path:./flakes/k3d;
  };

  outputs = { self, nixpkgs, flake-utils,  ... }@inputs:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs { inherit system; };
      in {
      packages = {
        hello = pkgs.hello;
        # k3d = k3d-flake.packages.${system}.defaultPackage;
      };
      }
    );
}
