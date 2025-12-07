import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "@nomicfoundation/hardhat-chai-matchers";

// If not set, it uses ours Alchemy's default API key.
const providerApiKey = process.env.ALCHEMY_API_KEY || "oKxs-03sij-U_N0iOlrSsZFr29-IqbuF";
// If not set, it uses the hardhat account 0 private key.
const deployerPrivateKey = process.env.ACCOUNT_PRIVATE_KEY ?? "0x0000000000000000000000000000000000000000000000000000000000000000";
// If not set, it uses our block explorers default API keys.
const etherscanApiKey = process.env.ETHERSCAN_V2_API_KEY || "DNXJA8RX2Q3VZ4URQIWP7Z68CJXQZSC6AW";

const config: HardhatUserConfig = {
  solidity: {
    compilers: [
      {
        version: "0.8.20",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
    ],
  },
  // Primary deployment target: Base Sepolia (testnet) and Base (mainnet)
  defaultNetwork: "baseSepolia", // Use "base" for mainnet deployment
  networks: {
    hardhat: {
      accounts: {
        count: 20,
      },
    },
    mainnet: {
      url: "https://mainnet.rpc.buidlguidl.com",
      accounts: deployerPrivateKey !== "0x0000000000000000000000000000000000000000000000000000000000000000" ? [deployerPrivateKey] : [],
    },
    sepolia: {
      url: `https://eth-sepolia.g.alchemy.com/v2/${providerApiKey}`,
      accounts: deployerPrivateKey !== "0x0000000000000000000000000000000000000000000000000000000000000000" ? [deployerPrivateKey] : [],
    },
    arbitrum: {
      url: `https://arb-mainnet.g.alchemy.com/v2/${providerApiKey}`,
      accounts: deployerPrivateKey !== "0x0000000000000000000000000000000000000000000000000000000000000000" ? [deployerPrivateKey] : [],
    },
    arbitrumSepolia: {
      url: `https://arb-sepolia.g.alchemy.com/v2/${providerApiKey}`,
      accounts: deployerPrivateKey !== "0x0000000000000000000000000000000000000000000000000000000000000000" ? [deployerPrivateKey] : [],
    },
    optimism: {
      url: `https://opt-mainnet.g.alchemy.com/v2/${providerApiKey}`,
      accounts: deployerPrivateKey !== "0x0000000000000000000000000000000000000000000000000000000000000000" ? [deployerPrivateKey] : [],
    },
    optimismSepolia: {
      url: `https://opt-sepolia.g.alchemy.com/v2/${providerApiKey}`,
      accounts: deployerPrivateKey !== "0x0000000000000000000000000000000000000000000000000000000000000000" ? [deployerPrivateKey] : [],
    },
    polygon: {
      url: `https://polygon-mainnet.g.alchemy.com/v2/${providerApiKey}`,
      accounts: deployerPrivateKey !== "0x0000000000000000000000000000000000000000000000000000000000000000" ? [deployerPrivateKey] : [],
    },
    polygonAmoy: {
      url: `https://polygon-amoy.g.alchemy.com/v2/${providerApiKey}`,
      accounts: deployerPrivateKey !== "0x0000000000000000000000000000000000000000000000000000000000000000" ? [deployerPrivateKey] : [],
    },
    polygonZkEvm: {
      url: `https://polygonzkevm-mainnet.g.alchemy.com/v2/${providerApiKey}`,
      accounts: deployerPrivateKey !== "0x0000000000000000000000000000000000000000000000000000000000000000" ? [deployerPrivateKey] : [],
    },
    polygonZkEvmCardona: {
      url: `https://polygonzkevm-cardona.g.alchemy.com/v2/${providerApiKey}`,
      accounts: deployerPrivateKey !== "0x0000000000000000000000000000000000000000000000000000000000000000" ? [deployerPrivateKey] : [],
    },
    gnosis: {
      url: "https://rpc.gnosischain.com",
      accounts: deployerPrivateKey !== "0x0000000000000000000000000000000000000000000000000000000000000000" ? [deployerPrivateKey] : [],
    },
    chiado: {
      url: "https://rpc.chiadochain.net",
      accounts: deployerPrivateKey !== "0x0000000000000000000000000000000000000000000000000000000000000000" ? [deployerPrivateKey] : [],
    },
    base: {
      url: "https://mainnet.base.org",
      accounts: deployerPrivateKey !== "0x0000000000000000000000000000000000000000000000000000000000000000" ? [deployerPrivateKey] : [],
    },
    baseSepolia: {
      url: "https://sepolia.base.org",
      accounts: deployerPrivateKey !== "0x0000000000000000000000000000000000000000000000000000000000000000" ? [deployerPrivateKey] : [],
    },
    scrollSepolia: {
      url: "https://sepolia-rpc.scroll.io",
      accounts: deployerPrivateKey !== "0x0000000000000000000000000000000000000000000000000000000000000000" ? [deployerPrivateKey] : [],
    },
    scroll: {
      url: "https://rpc.scroll.io",
      accounts: deployerPrivateKey !== "0x0000000000000000000000000000000000000000000000000000000000000000" ? [deployerPrivateKey] : [],
    },
    celo: {
      url: "https://forno.celo.org",
      accounts: deployerPrivateKey !== "0x0000000000000000000000000000000000000000000000000000000000000000" ? [deployerPrivateKey] : [],
    },
    celoAlfajores: {
      url: "https://alfajores-forno.celo-testnet.org",
      accounts: deployerPrivateKey !== "0x0000000000000000000000000000000000000000000000000000000000000000" ? [deployerPrivateKey] : [],
    },
  },
  // Configuration for hardhat-verify plugin
  etherscan: {
    apiKey: etherscanApiKey,
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
