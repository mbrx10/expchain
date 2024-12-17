import { ethers } from "ethers";
import solc from "solc";
import fs from "fs";
import banner from "../utils/banner.js";
import log from "../utils/logger.js";
import { readWallets } from "../utils/script.js";

const provider = new ethers.JsonRpcProvider("https://rpc1-testnet.expchain.ai");

// Function to generate random token name and symbol
function generateTokenDetails() {
    const adjectives = [
        'Super', 'Mega', 'Ultra', 'Hyper', 'Quantum', 'Cosmic', 'Digital', 'Crypto',
        'Stellar', 'Atomic', 'Neural', 'Phoenix', 'Cyber', 'Vector', 'Matrix', 'Solar',
        'Lunar', 'Nexus', 'Fusion', 'Omega', 'Alpha', 'Delta', 'Prime', 'Nova',
        'Dynamic', 'Crystal', 'Eternal', 'Infinite', 'Virtual', 'Quantum', 'Plasma'
    ];
    const nouns = [
        'Chain', 'Token', 'Coin', 'Net', 'Link', 'Block', 'Node', 'Grid',
        'Sphere', 'Wave', 'Pulse', 'Core', 'Vault', 'Forge', 'Bridge', 'Gate',
        'Port', 'Hub', 'Shard', 'Ring', 'Web', 'Cloud', 'Matrix', 'Prism',
        'Nexus', 'Edge', 'Path', 'Stack', 'Flow', 'Stream', 'Mesh'
    ];
    
    const randomAdjective = adjectives[Math.floor(Math.random() * adjectives.length)];
    const randomNoun = nouns[Math.floor(Math.random() * nouns.length)];
    
    const name = `${randomAdjective} ${randomNoun}`;
    const symbol = (randomAdjective.substring(0, 1) + randomNoun.substring(0, 2)).toUpperCase();
    
    return { name, symbol };
}

// contract
const contractSource = `
pragma solidity ^0.8.0;

contract Token {
    string public name;
    string public symbol;
    uint8 public decimals = 18;
    uint256 public totalSupply;

    mapping(address => uint256) public balanceOf;
    address public owner;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Mint(address indexed to, uint256 value);
    event Burn(address indexed from, uint256 value);

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner can call this function");
        _;
    }

    constructor(
        string memory _name,
        string memory _symbol,
        uint256 _initialSupply
    ) {
        name = _name;
        symbol = _symbol;
        owner = msg.sender;
        balanceOf[msg.sender] = _initialSupply;
        totalSupply = _initialSupply;
        emit Transfer(address(0), msg.sender, _initialSupply);
    }

    function transfer(address to, uint256 value) public returns (bool) {
        require(balanceOf[msg.sender] >= value, "Insufficient balance");
        require(to != address(0), "Invalid recipient");

        balanceOf[msg.sender] -= value;
        balanceOf[to] += value;
        emit Transfer(msg.sender, to, value);
        return true;
    }

    function mint(address to, uint256 value) public onlyOwner returns (bool) {
        require(to != address(0), "Invalid recipient");
        
        balanceOf[to] += value;
        totalSupply += value;
        emit Mint(to, value);
        emit Transfer(address(0), to, value);
        return true;
    }

    function burn(address from, uint256 value) public onlyOwner returns (bool) {
        require(balanceOf[from] >= value, "Insufficient balance");
        
        balanceOf[from] -= value;
        totalSupply -= value;
        emit Burn(from, value);
        emit Transfer(from, address(0), value);
        return true;
    }
}`;

async function deployContract(PRIVATE_KEY, walletAddress) {
    try {
        log.info("Compiling and deploying the contract...");
        const input = {
            language: "Solidity",
            sources: {
                "Token.sol": {
                    content: contractSource,
                },
            },
            settings: {
                outputSelection: {
                    "*": {
                        "*": ["*"],
                    },
                },
            },
        };

        const compiled = JSON.parse(solc.compile(JSON.stringify(input)));
        const contractABI = compiled.contracts["Token.sol"].Token.abi;
        const contractBytecode = compiled.contracts["Token.sol"].Token.evm.bytecode.object;

        const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
        const factory = new ethers.ContractFactory(contractABI, contractBytecode, wallet);

        const { name, symbol } = generateTokenDetails();
        const initialSupply = ethers.parseUnits("1000", 18);
        const contract = await factory.deploy(name, symbol, initialSupply);

        await contract.waitForDeployment();

        const contractAddress = await contract.getAddress();
        log.info(`Contract deployed successfully at: ${contractAddress}`);
        log.info(`Block Explorer: https://blockscout-testnet.expchain.ai/address/${contractAddress}`);
        
        // Save token info to history
        const tokenInfo = {
            address: contractAddress,
            abi: contractABI,
            name,
            symbol,
            owner: walletAddress,
            deployedAt: new Date().toISOString()
        };

        // Save to tokens directory
        if (!fs.existsSync('tokens')) {
            fs.mkdirSync('tokens');
        }
        fs.writeFileSync(
            `tokens/${walletAddress}_${contractAddress}.json`,
            JSON.stringify(tokenInfo, null, 2)
        );

        return tokenInfo;
    } catch (error) {
        log.error("Error deploying contract:", error);
        return null;
    }
}

async function deployContracts() {
    try {
        log.warn(banner);
        const wallets = readWallets();
        if (!wallets) {
            log.error("Please create new wallets first...");
            process.exit(1);
        }
        log.info(`Found ${wallets.length} existing wallets...`);

        // Create deployment promises with logging wrapper
        const deploymentPromises = wallets.map(async (wallet, index) => {
            try {
                // Log start of this specific deployment
                log.info(`\n=== Starting Token Deployment for wallet ${wallet.address} (${index + 1}/${wallets.length}) ===`);
                
                const tokenInfo = await deployContract(wallet.privateKey, wallet.address);
                
                if (tokenInfo) {
                    log.info(`Token deployed successfully: ${tokenInfo.name} (${tokenInfo.symbol})`);
                    log.info(`Owner: ${tokenInfo.owner}`);
                    log.info(`Contract: ${tokenInfo.address}`);
                    return { success: true, tokenInfo };
                }
                return { success: false, error: "Deployment failed" };
            } catch (error) {
                log.error(`Error deploying token for wallet ${wallet.address}:`, error);
                return { success: false, error: error.message };
            }
        });

        // Execute all deployments in parallel
        const results = await Promise.all(deploymentPromises);

        // Log final summary
        log.info("\n=== Deployment Summary ===");
        results.forEach((result, index) => {
            const wallet = wallets[index];
            if (result.success) {
                log.info(`✅ Wallet ${wallet.address}: Success - ${result.tokenInfo.name} (${result.tokenInfo.symbol})`);
            } else {
                log.info(`❌ Wallet ${wallet.address}: Failed - ${result.error}`);
            }
        });

        log.info("\n=== All deployments complete ===");
        log.info("To interact with these tokens, run:");
        log.info("node tokenInteraction.js");

    } catch (error) {
        log.error("Error in deployment process:", error);
    }
}

deployContracts();
