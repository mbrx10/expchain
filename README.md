# Exp Chain Auto Deploy Contract

![banner](image.png)

Introducing EXPchain
The Future of Intelligence • Inventor of zkBridge and Expander • EXPchain: The everything chain for AI
- Website: https://www.polyhedra.network/
- Twitter: [@PolyhedraZK](https://x.com/PolyhedraZK)

## Update
- using Proxy to get Faucet so no need to wait 10 minutes each claim
- put proxy in `proxies.txt` 1 line 1 proxy
  
## Features

- **Auto Getting Faucets**
- **Auto Deploy Contract**
- **Auto Interact with Contract**
- **Auto Generate New Wallets**
- **All Wallets informations saved to wallets.json**


## Requirements

- **Node.js**: Ensure you have Node.js installed.
- **npm**: Ensure you have npm installed.
- **Api key To solve captcha**: you need captcha apikey to get faucet
- **Anti-captcha** https://anti-captcha.com/clients/settings/apisetup
- **2Captcha** https://2captcha.com/enterpage

## Setup

1. Clone this repository:
   ```bash
   git clone https://github.com/mbrx10/expchain.git
   cd expchain
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Setup: to creating new wallets
   ```bash
   npm run setup
   ```
4. Faucet: to getting faucet
   ```bash
   npm run faucet
   ```
5. Deploy: to deploy contract
   ```bash
   npm run deploy
   ```
6. Interact: to interact with contract
   ```bash
   npm run start
   ```

## Project Structure
```
expchain/
├── bot/                    # Bot scripts
│   ├── deploy.js          # Contract deployment script
│   ├── deployToken.js     # Token deployment script
│   ├── faucet.js         # Faucet claiming script
│   ├── setup.js          # Setup and wallet generation
│   └── tokenInteraction.js # Token interaction script
├── utils/                 # Utility functions
├── tokens/                # Generated token files (auto-created)
├── Token.example.json     # Token configuration template
├── wallets.example.json   # Wallet configuration template
└── proxies.example.txt    # Proxy list template
```

## Setup Instructions

1. Clone this repository
```bash
git clone https://github.com/mbrx10/expchain.git
cd expchain
```

2. Install dependencies
```bash
npm install
```

3. Create required files from templates:
```bash
# Windows
copy Token.example.json Token.json
copy wallets.example.json wallets.json
copy proxies.example.txt proxies.txt

# Linux/Mac
cp Token.example.json Token.json
cp wallets.example.json wallets.json
cp proxies.example.txt proxies.txt
```

4. The `tokens/` directory will be created automatically when deploying contracts

## Required Files

### wallets.json
Stores wallet information. Will be automatically generated when running `setup.js`.
```bash
node setup.js
```

### Token.json
Contains token configuration. Copy from `Token.example.json` and modify if needed.

### proxies.txt
List of proxies for faucet claiming. Copy from `proxies.example.txt` and add your proxies.
Format:http://username:password@proxy1.example.com:8080

## ![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)

This project is licensed under the [MIT License](LICENSE).
