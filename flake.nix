{
  description = "We go big or go home. Operations Center Mainflake";

  # Define the inputs for the flake
  inputs = {
    # Use the unstable branch of nixpkgs
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";

    # Include the k3d flake from a local path
    k3d = {
      url = "./flakes/k3d";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  # Define the outputs of the flake
  outputs = { self, nixpkgs, k3d }: {
    # Include k3d in the packages section
    packages = {
      x86_64-linux = k3d.defaultPackage.x86_64-linux;
      aarch64-darwin = k3d.defaultPackage.aarch64-darwin;
    };

    # Define the default package for each system
    defaultPackage = {
      x86_64-linux = self.packages.x86_64-linux;
      aarch64-darwin = self.packages.aarch64-darwin;
    };

    # Define development shells
    devShells = let
      pkgs = import nixpkgs { inherit (self) system; };
    in {
      default = pkgs.mkShell {
        buildInputs = [
          k3d.defaultPackage.${builtins.currentSystem}
        ];
      };
    };
  };
}