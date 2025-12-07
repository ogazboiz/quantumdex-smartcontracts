
import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";

const config: HardhatUserConfig = {
  solidity: {
    compilers: [
      {
        version: "0.8.20",
        settings: {
          optimizer: {
            enabled: true,
            // https://docs.soliditylang.org/en/latest/using-the-compiler.html#optimizer-options
            runs: 200,
          },
        },
      },
    ],
  },
  // Primary deployment target: Base Sepolia (testnet) and Base (mainnet)
  defaultNetwork: "baseSepolia", // Use "base" for mainnet deployment
  paths: {
    tests: "./test",
  },
  networks: {
    // View the networks that are pre-configured.
    // If the network you are looking for is not here you can add new network settings
    mainnet: {
      type: "http",
      url: configVariable("MAINNET_RPC_URL"),
      accounts: [configVariable("MAINNET_PRIVATE_KEY")],
    },
    sepolia: {
      type: "http",
      url: configVariable(
        "ALCHEMY_API_KEY",
        "https://eth-sepolia.g.alchemy.com/v2/{variable}",
      ),
      accounts: [configVariable("SEPOLIA_PRIVATE_KEY")],
    },
    arbitrum: {
      type: "http",
      url: configVariable(
        "ALCHEMY_API_KEY",
        "https://arb-mainnet.g.alchemy.com/v2/{variable}",
      ),
      accounts: [configVariable("ARBITRUM_PRIVATE_KEY")],
    },
    arbitrumSepolia: {
      type: "http",
      url: configVariable(
        "ALCHEMY_API_KEY",
        "https://arb-sepolia.g.alchemy.com/v2/{variable}",
      ),
      accounts: [configVariable("ARBITRUM_SEPOLIA_PRIVATE_KEY")],
    },
    optimism: {
      type: "http",
      url: configVariable(
        "ALCHEMY_API_KEY",
        "https://opt-mainnet.g.alchemy.com/v2/{variable}",
      ),
      accounts: [configVariable("OPTIMISM_PRIVATE_KEY")],
    },
    optimismSepolia: {
      type: "http",
      url: configVariable(
        "ALCHEMY_API_KEY",
        "https://opt-sepolia.g.alchemy.com/v2/{variable}",
      ),
      accounts: [configVariable("OPTIMISM_SEPOLIA_PRIVATE_KEY")],
    },
    polygon: {
      type: "http",
      url: configVariable(
        "ALCHEMY_API_KEY",
        "https://polygon-mainnet.g.alchemy.com/v2/{variable}",
      ),
      accounts: [configVariable("POLYGON_PRIVATE_KEY")],
    },
    polygonAmoy: {
      type: "http",
      url: configVariable(
        "ALCHEMY_API_KEY",
        "https://polygon-amoy.g.alchemy.com/v2/{variable}",
      ),
      accounts: [configVariable("POLYGON_AMOY_PRIVATE_KEY")],
    },
    polygonZkEvm: {
      type: "http",
      url: configVariable(
        "ALCHEMY_API_KEY",
        "https://polygonzkevm-mainnet.g.alchemy.com/v2/{variable}",
      ),
      accounts: [configVariable("POLYGON_ZKEVM_PRIVATE_KEY")],
    },
    polygonZkEvmCardona: {
      type: "http",
      url: configVariable(
        "ALCHEMY_API_KEY",
        "https://polygonzkevm-cardona.g.alchemy.com/v2/{variable}",
      ),
      accounts: [configVariable("POLYGON_ZKEVM_CARDONA_PRIVATE_KEY")],
    },
    gnosis: {
      type: "http",
      url: "https://rpc.gnosischain.com",
      accounts: [configVariable("GNOSIS_PRIVATE_KEY")],
    },
    chiado: {
      type: "http",
      url: "https://rpc.chiadochain.net",
      accounts: [configVariable("CHIADO_PRIVATE_KEY")],
    },
    base: {
      type: "http",
      url: configVariable("BASE_RPC_URL"),
      accounts: [configVariable("BASE_PRIVATE_KEY")],
    },
    baseSepolia: {
      type: "http",
      url: configVariable("BASE_SEPOLIA_RPC_URL"),
      accounts: [configVariable("BASE_SEPOLIA_PRIVATE_KEY")],
    },
    scrollSepolia: {
      type: "http",
      url: configVariable("SCROLL_SEPOLIA_RPC_URL"),
      accounts: [configVariable("SCROLL_SEPOLIA_PRIVATE_KEY")],
    },
    scroll: {
      type: "http",
      url: configVariable("SCROLL_RPC_URL"),
      accounts: [configVariable("SCROLL_PRIVATE_KEY")],
    },
    celo: {
      type: "http",
      url: configVariable("CELO_RPC_URL"),
      accounts: [configVariable("CELO_PRIVATE_KEY")],
    },
    celoAlfajores: {
      type: "http",
      url: configVariable("CELO_ALFAJORES_RPC_URL"),
      accounts: [configVariable("CELO_ALFAJORES_PRIVATE_KEY")],
    },
  },
  // Configuration for hardhat-verify plugin
  etherscan: {
    apiKey: {
      mainnet: configVariable("ETHERSCAN_API_KEY"),
      sepolia: configVariable("ETHERSCAN_API_KEY"),
      base: configVariable("BASESCAN_API_KEY"),
      baseSepolia: configVariable("BASESCAN_API_KEY"),
      celo: configVariable("CELOSCAN_API_KEY"), // Celo uses Celoscan
      celoAlfajores: configVariable("CELOSCAN_API_KEY"),
    },
    customChains: [
      {
        network: "celo",
        chainId: 42220,
        urls: {
          apiURL: "https://api.celoscan.io/api",
          browserURL: "https://celoscan.io",
        },
      },
      {
        network: "celoAlfajores",
        chainId: 44787,
        urls: {
          apiURL: "https://api-alfajores.celoscan.io/api",
          browserURL: "https://alfajores.celoscan.io",
        },
      },
    ],
  },
  sourcify: {
    enabled: false,
  },
  mocha: {
    timeout: 40000,
  },
};

export default config;