import { ethers } from 'ethers';
import fs from 'fs';
import log from "../utils/logger.js";
import banner from "../utils/banner.js";
import { readWallets } from "../utils/script.js";
import readline from 'readline';

const provider = new ethers.JsonRpcProvider("https://rpc1-testnet.expchain.ai");

// Global statistics
const globalStats = {
    startTime: null,
    rounds: 0,
    transactions: {
        total: 0,
        successful: 0,
        failed: 0
    },
    operations: {
        minted: 0,
        burned: 0,
        staked: 0,
        liquidityAdded: 0,
        airdropped: 0,
        batchTransferred: 0
    },
    errors: {}
};

// Helper functions
function getRandomDelay(min, max, multiplier = 1) {
    const baseDelay = Math.floor(Math.random() * (max - min + 1) + min);
    return Math.floor(baseDelay * multiplier);
}

function updateStats(operation, success = true, errorMsg = null) {
    if (success) {
        globalStats.transactions.successful++;
        if (operation) {
            globalStats.operations[operation]++;
        }
    } else {
        globalStats.transactions.failed++;
        if (errorMsg) {
            globalStats.errors[errorMsg] = (globalStats.errors[errorMsg] || 0) + 1;
        }
    }
    globalStats.transactions.total++;
}

function displayStats() {
    const runtime = globalStats.startTime ? Math.floor((Date.now() - globalStats.startTime) / 1000) : 0;
    const hours = Math.floor(runtime / 3600);
    const minutes = Math.floor((runtime % 3600) / 60);
    const seconds = runtime % 60;

    log.info("\n=== Global Statistics ===");
    log.info(`Runtime: ${hours}h ${minutes}m ${seconds}s`);
    log.info(`Total Rounds: ${globalStats.rounds}`);
    log.info("\nTransactions:");
    log.info(`- Total: ${globalStats.transactions.total}`);
    log.info(`- Successful: ${globalStats.transactions.successful}`);
    log.info(`- Failed: ${globalStats.transactions.failed}`);
    log.info(`- Success Rate: ${((globalStats.transactions.successful/globalStats.transactions.total)*100).toFixed(2)}%`);
    
    log.info("\nOperations:");
    log.info(`- Tokens Minted: ${globalStats.operations.minted}`);
    log.info(`- Tokens Burned: ${globalStats.operations.burned}`);
    log.info(`- Tokens Staked: ${globalStats.operations.staked}`);
    log.info(`- Liquidity Added: ${globalStats.operations.liquidityAdded}`);
    log.info(`- Airdrops Sent: ${globalStats.operations.airdropped}`);
    log.info(`- Batch Transfers: ${globalStats.operations.batchTransferred}`);

    if (Object.keys(globalStats.errors).length > 0) {
        log.info("\nCommon Errors:");
        Object.entries(globalStats.errors)
            .sort(([,a], [,b]) => b - a)
            .slice(0, 5)
            .forEach(([error, count]) => {
                log.info(`- ${error}: ${count} times`);
            });
    }
}

// Load all tokens for all wallets
function loadAllTokens() {
    const tokensDir = 'tokens';
    if (!fs.existsSync(tokensDir)) {
        return [];
    }

    const tokens = [];
    const files = fs.readdirSync(tokensDir);
    for (const file of files) {
        if (file.endsWith('.json')) {
            const tokenData = JSON.parse(fs.readFileSync(`${tokensDir}/${file}`, 'utf8'));
            tokens.push(tokenData);
        }
    }
    return tokens;
}

// Display all deployed tokens grouped by wallet
function displayTokens(tokens) {
    if (tokens.length === 0) {
        log.info("No tokens found");
        return;
    }

    // Group tokens by wallet
    const tokensByWallet = tokens.reduce((acc, token) => {
        if (!acc[token.owner]) {
            acc[token.owner] = [];
        }
        acc[token.owner].push(token);
        return acc;
    }, {});

    log.info("\n=== Deployed Tokens ===");
    let tokenIndex = 1;
    
    for (const [wallet, walletTokens] of Object.entries(tokensByWallet)) {
        log.info(`\nWallet: ${wallet}`);
        walletTokens.forEach(token => {
            log.info(`\n${tokenIndex}. ${token.name} (${token.symbol})`);
            log.info(`   Address: ${token.address}`);
            log.info(`   Deployed: ${new Date(token.deployedAt).toLocaleString()}`);
            tokenIndex++;
        });
    }
}

// Helper function to check and get safe amount
async function getSafeAmount(contract, wallet, requestedAmount, symbol) {
    try {
        const balance = await contract.balanceOf(wallet.address);
        const currentBalance = parseFloat(ethers.formatUnits(balance, 18));
        // Keep 10% of balance as buffer
        const safeBalance = currentBalance * 0.9;
        
        if (currentBalance < 10) { // If balance is too low
            log.warn(`⚠️ Very low token balance for ${symbol}: ${currentBalance}`);
            return null;
        }

        // Return the smaller of requested amount or safe balance
        return Math.min(requestedAmount, safeBalance);
    } catch (error) {
        log.error("Error checking token balance:", error.message);
        return null;
    }
}

// Helper function to ensure sufficient balance
async function ensureSufficientBalance(contract, wallet, requiredAmount, symbol) {
    try {
        const balance = await contract.balanceOf(wallet.address);
        const currentBalance = parseFloat(ethers.formatUnits(balance, 18));
        
        if (currentBalance < requiredAmount) {
            const mintAmount = Math.ceil(requiredAmount - currentBalance + 100); // Add 100 extra tokens as buffer
            log.info(`Balance insufficient. Minting ${mintAmount} ${symbol} tokens...`);
            const mintTx = await contract.mint(wallet.address, ethers.parseUnits(mintAmount.toString(), 18));
            await mintTx.wait();
            log.info(`Successfully minted ${mintAmount} ${symbol} tokens`);
            return true;
        }
        return true;
    } catch (error) {
        log.error(`Error ensuring balance: ${error.message}`);
        return false;
    }
}

// Token interactions
async function interactWithToken(contract, wallet, symbol) {
    try {
        const waitForTx = async (tx, message, operation = null) => {
            try {
                const gasPrice = await provider.getFeeData();
                const overrides = {
                    gasLimit: 500000,
                    maxFeePerGas: gasPrice.maxFeePerGas * 2n, // 2x dari rekomendasi
                    maxPriorityFeePerGas: gasPrice.maxPriorityFeePerGas * 2n
                };

                const receipt = await tx.wait();
                log.info(message);
                updateStats(operation, true);
                await new Promise(resolve => setTimeout(resolve, 3000));
                return receipt;
            } catch (error) {
                updateStats(operation, false, error.message);
                throw error;
            }
        };

        // Random interactions
        const interactions = [
            async () => {
                const mintAmount = Math.floor(Math.random() * 901) + 100;
                const mintTx = await contract.mint(wallet.address, ethers.parseUnits(mintAmount.toString(), 18));
                await waitForTx(mintTx, `Minted ${mintAmount} ${symbol} to ${wallet.address}`, 'minted');
            },
            async () => {
                const amount = Math.floor(Math.random() * 151) + 50;
                if (await ensureSufficientBalance(contract, wallet, amount, symbol)) {
                    const poolTx = await contract.transfer(await contract.getAddress(), ethers.parseUnits(amount.toString(), 18));
                    await waitForTx(poolTx, `Created liquidity pool with ${amount} ${symbol}`, 'liquidityAdded');
                }
            },
            async () => {
                const numRecipients = Math.floor(Math.random() * 6) + 3;
                const amountPerRecipient = Math.floor(Math.random() * 50) + 1;
                const totalAmount = amountPerRecipient * numRecipients;
                
                if (await ensureSufficientBalance(contract, wallet, totalAmount, symbol)) {
                    const recipients = Array.from({ length: numRecipients }, () => ethers.Wallet.createRandom().address);
                    for (const addr of recipients) {
                        const tx = await contract.transfer(addr, ethers.parseUnits(amountPerRecipient.toString(), 18));
                        await waitForTx(tx, `Airdropped ${amountPerRecipient} ${symbol} to ${addr}`, 'airdropped');
                    }
                }
            },
            async () => {
                const stakeAmount = Math.floor(Math.random() * 126) + 25;
                if (await ensureSufficientBalance(contract, wallet, stakeAmount, symbol)) {
                    log.info(`\nSimulating staking of ${stakeAmount} ${symbol}...`);
                    const stakeTx = await contract.transfer(await contract.getAddress(), ethers.parseUnits(stakeAmount.toString(), 18));
                    await waitForTx(stakeTx, `Locked ${stakeAmount} ${symbol} for staking`, 'staked');
                    
                    await new Promise(resolve => setTimeout(resolve, 5000));
                    
                    const rewardRate = (Math.random() * 0.15) + 0.05;
                    const rewardAmount = Math.floor(stakeAmount * rewardRate);
                    const rewardTx = await contract.mint(wallet.address, ethers.parseUnits(rewardAmount.toString(), 18));
                    await waitForTx(rewardTx, `Received ${rewardAmount} ${symbol} as staking reward (${(rewardRate * 100).toFixed(1)}% APR)`, 'minted');
                }
            },
            async () => {
                const burnAmount = Math.floor(Math.random() * 91) + 10;
                if (await ensureSufficientBalance(contract, wallet, burnAmount, symbol)) {
                    const burnTx = await contract.burn(wallet.address, ethers.parseUnits(burnAmount.toString(), 18));
                    await waitForTx(burnTx, `Burned ${burnAmount} ${symbol}`, 'burned');
                }
            },
            async () => {
                const numRecipients = Math.floor(Math.random() * 4) + 2;
                const amountPerRecipient = Math.floor(Math.random() * 21) + 10;
                const totalAmount = amountPerRecipient * numRecipients;

                if (await ensureSufficientBalance(contract, wallet, totalAmount, symbol)) {
                    const recipients = Array.from({ length: numRecipients }, () => ethers.Wallet.createRandom().address);
                    for (const addr of recipients) {
                        const tx = await contract.transfer(addr, ethers.parseUnits(amountPerRecipient.toString(), 18));
                        await waitForTx(tx, `Batch transferred ${amountPerRecipient} ${symbol} to ${addr}`, 'batchTransferred');
                    }
                }
            },
            async () => {
                const amount = Math.floor(Math.random() * 10) + 1;
                const gasPrice = await provider.getFeeData();
                const overrides = {
                    gasLimit: 500000,
                    maxFeePerGas: gasPrice.maxFeePerGas * 2n,
                    maxPriorityFeePerGas: gasPrice.maxPriorityFeePerGas * 2n
                };

                if (!await ensureSufficientBalance(contract, wallet, amount * 2, symbol)) {
                    throw new Error("Failed to ensure sufficient balance");
                }

                const operations = ['mint', 'burn', 'stake'];
                const operation = operations[Math.floor(Math.random() * operations.length)];

                switch (operation) {
                    case 'mint':
                        await waitForTx(
                            await contract.mint(wallet.address, ethers.parseUnits(amount.toString(), 18), overrides),
                            `Minted ${amount} ${symbol} tokens`,
                            'minted'
                        );
                        break;

                    case 'burn':
                        const safeAmount = await getSafeAmount(contract, wallet, amount, symbol);
                        if (safeAmount) {
                            await waitForTx(
                                await contract.burn(ethers.parseUnits(safeAmount.toString(), 18), overrides),
                                `Burned ${safeAmount} ${symbol} tokens`,
                                'burned'
                            );
                        }
                        break;

                    case 'stake':
                        const stakeAmount = await getSafeAmount(contract, wallet, amount, symbol);
                        if (stakeAmount) {
                            await waitForTx(
                                await contract.stake(ethers.parseUnits(stakeAmount.toString(), 18), overrides),
                                `Staked ${stakeAmount} ${symbol} tokens`,
                                'staked'
                            );
                        }
                        break;
                }
            }
        ];

        // Shuffle interactions array
        for (let i = interactions.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [interactions[i], interactions[j]] = [interactions[j], interactions[i]];
        }

        // Execute interactions
        const numInteractions = Math.floor(Math.random() * 3) + 2;
        let successfulInteractions = 0;

        // Try each interaction until we get enough successful ones
        for (let i = 0; successfulInteractions < numInteractions && i < interactions.length; i++) {
            try {
                await interactions[i]();
                successfulInteractions++;
            } catch (error) {
                if (error.message.includes("insufficient funds")) {
                    log.warn(`Skipping interaction due to insufficient balance`);
                    continue;
                }
                throw error;
            }
        }

    } catch (error) {
        const errorMsg = error.message.includes("insufficient funds") ? "Insufficient funds" :
                        error.message.includes("nonce") ? "Nonce error" :
                        "Unknown error";
        log.error(`Error in token interaction for ${symbol}: ${errorMsg}`);
        updateStats(null, false, errorMsg);
    }
}

async function interactWithAllTokens(tokens, wallets) {
    if (!globalStats.startTime) {
        globalStats.startTime = Date.now();
    }

    try {
        while (true) {
            globalStats.rounds++;
            log.info("\n=== Starting New Round of Interactions ===");
            const startTime = new Date().toLocaleString();
            log.info(`Start Time: ${startTime}`);

            const interactionPromises = tokens.map(async (token) => {
                try {
                    const wallet = wallets.find(w => w.address.toLowerCase() === token.owner.toLowerCase());
                    if (!wallet) {
                        log.error(`Wallet not found for token owner: ${token.owner}`);
                        return;
                    }

                    const contract = new ethers.Contract(
                        token.address,
                        token.abi,
                        new ethers.Wallet(wallet.privateKey, provider)
                    );

                    log.info(`\n--- Starting interactions with ${token.name} (${token.symbol}) ---`);
                    const initialSupply = await contract.totalSupply();
                    const initialBalance = await contract.balanceOf(wallet.address);
                    log.info(`Initial Total Supply: ${ethers.formatUnits(initialSupply, 18)}`);
                    log.info(`Initial Balance: ${ethers.formatUnits(initialBalance, 18)} ${token.symbol}`);

                    await interactWithToken(contract, wallet, token.symbol);

                    const finalSupply = await contract.totalSupply();
                    const finalBalance = await contract.balanceOf(wallet.address);
                    log.info(`\nFinal Total Supply: ${ethers.formatUnits(finalSupply, 18)} ${token.symbol}`);
                    log.info(`Final Balance: ${ethers.formatUnits(finalBalance, 18)} ${token.symbol}`);
                } catch (error) {
                    log.error(`Error in token ${token.symbol}:`, error.message);
                    updateStats(null, false, "Token interaction failed");
                }
            });

            await Promise.all(interactionPromises);

            const endTime = new Date().toLocaleString();
            log.info("\n=== Round Completed ===");
            log.info(`Start Time: ${startTime}`);
            log.info(`End Time: ${endTime}`);

            // Display statistics every round
            displayStats();

            // Random delay between 2-5 minutes (120000-300000 ms)
            const minDelay = 120000; // 2 minutes
            const maxDelay = 300000; // 5 minutes
            const delay = Math.floor(Math.random() * (maxDelay - minDelay + 1) + minDelay);
            const minutes = Math.floor(delay / 60000);
            const seconds = Math.floor((delay % 60000) / 1000);
            
            log.info(`\nWaiting ${minutes} minutes ${seconds} seconds before starting next round...\n`);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    } catch (error) {
        log.error("Error in main process:", error.message);
        updateStats(null, false, "Main process error");
        await new Promise(resolve => setTimeout(resolve, 10000));
        return interactWithAllTokens(tokens, wallets);
    }
}

async function main() {
    try {
        // Load tokens and wallets
        const tokens = loadAllTokens();
        if (tokens.length === 0) {
            log.error("No tokens found");
            return;
        }

        const wallets = readWallets();
        if (!wallets || wallets.length === 0) {
            log.error("No wallets found. Please create wallets first.");
            return;
        }

        // Display available tokens
        displayTokens(tokens);

        log.info("\nStarting continuous token interactions (Press Ctrl+C to stop)...");
        await interactWithAllTokens(tokens, wallets);

    } catch (error) {
        log.error("Error:", error.message);
        // If there's an error, wait 10 seconds and restart
        await new Promise(resolve => setTimeout(resolve, 10000));
        main(); // Restart the process
    }
}

main();
