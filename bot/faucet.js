import { ethers } from 'ethers';
import fs from 'fs';
import axios from 'axios';
import { HttpsProxyAgent } from 'https-proxy-agent';
import log from "../utils/logger.js";
import banner from "../utils/banner.js";
import { solveAntiCaptcha, solve2Captcha } from "../utils/solver.js";
import { readWallets, readProxies } from "../utils/script.js";
import readline from "readline";
import chalk from 'chalk';  

// Store wallet delays with exact timestamps
const walletDelays = new Map();

function askUserOption() {
    return new Promise((resolve) => {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
        });

        rl.question(
            "Choose Captcha Solver:\n1. Anti-Captcha\n2. 2Captcha\nEnter your choice (1/2): ",
            (answer) => {
                rl.close();
                resolve(answer);
            }
        );
    });
}

function askProxyOption() {
    return new Promise((resolve) => {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
        });

        rl.question(
            "Use Proxy?\n1. Yes\n2. No\nEnter your choice (1/2): ",
            (answer) => {
                rl.close();
                resolve(answer === "1");
            }
        );
    });
}

function askApiKey(solverName) {
    return new Promise((resolve) => {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
        });

        rl.question(`Enter your API key for ${solverName}: `, (apiKey) => {
            rl.close();
            resolve(apiKey);
        });
    });
}

async function getFaucet(payload, proxy = null) {
    const url = "https://faucetv2-api.expchain.ai/api/faucet";
    
    try {
        const config = {
            headers: {
                "Content-Type": "application/json",
            }
        };

        if (proxy) {
            const agent = new HttpsProxyAgent(proxy);
            config.httpsAgent = agent;
            log.info(chalk.cyan(`Using proxy: ${proxy}`));
        } else {
            log.info(chalk.cyan("Not using proxy"));
        }

        log.info("Getting Faucet...");
        const response = await axios.post(url, payload, config);
        return response.data;
    } catch (error) {
        if (error.response?.data) {
            return error.response.data;
        }
        log.error("Error Getting Faucet:", error);
        return { error: error.message };
    }
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function parseWaitTime(message) {
    if (!message) return null;
    const match = message.match(/wait (\d+) minutes?/);
    if (match) {
        const minutes = parseInt(match[1]);
        return minutes * 60 * 1000; // Convert minutes to milliseconds
    }
    return null;
}

function getRemainingDelay(walletAddress) {
    const delay = walletDelays.get(walletAddress);
    if (!delay) return 0;

    const now = Date.now();
    const remaining = delay.endTime - now;
    return remaining > 0 ? remaining : 0;
}

function updateWalletDelay(walletAddress, waitTimeMs, message) {
    if (waitTimeMs > 0) {
        const endTime = Date.now() + waitTimeMs;
        walletDelays.set(walletAddress, { endTime, message });
        const minutes = Math.ceil(waitTimeMs / 60000);
        log.info(chalk.yellow(`${message} (${minutes} minutes) for wallet ${walletAddress}`));
    }
}

async function getNextWalletToProcess(wallets) {
    let shortestWait = Infinity;
    let nextWallet = null;

    for (const wallet of wallets) {
        const remainingDelay = getRemainingDelay(wallet.address);
        if (remainingDelay === 0) {
            return wallet; // This wallet can be processed immediately
        }
        if (remainingDelay < shortestWait) {
            shortestWait = remainingDelay;
            nextWallet = wallet;
        }
    }

    return { wallet: nextWallet, waitTime: shortestWait };
}

// Parallel processing configuration
const CONCURRENT_TASKS = 10; // Number of parallel processes

async function processWalletParallel(wallet, solveCaptcha, apiKey, proxy) {
    log.info(`=== Starting Getting Faucet for wallet ${wallet.address} ===`);
    
    try {
        const payloadFaucet = {
            chain_id: 18880,
            to: wallet.address,
            cf_turnstile_response: await solveCaptcha(apiKey),
        };

        const faucet = await getFaucet(payloadFaucet, proxy);

        if (faucet.message === 'Success') {
            log.info(chalk.green(`Faucet Success https://blockscout-testnet.expchain.ai/address/${wallet.address}`));
            updateWalletDelay(wallet.address, 10 * 60 * 1000, "Server cooldown period");
            return true;
        } else {
            const waitTime = parseWaitTime(faucet.data);
            if (waitTime) {
                updateWalletDelay(wallet.address, waitTime, faucet.data);
            } else {
                log.error(chalk.red(`${faucet.data || 'Unknown error'} Claim Faucet Failed...`));
            }
            return false;
        }
    } catch (error) {
        log.error(chalk.red(`Error processing wallet ${wallet.address}: ${error.message}`));
        return false;
    }
}

async function getFaucetAllParallel() {
    log.warn(banner);
    
    const wallets = readWallets();
    if (!wallets) {
        log.error("Please Create new wallets first...");
        process.exit(1);
    }
    log.info(`Found ${wallets.length} existing wallets...`);

    const userChoice = await askUserOption();
    let solveCaptcha;
    let apiKey;

    if (userChoice === "1") {
        log.info("Using Anti-Captcha Solver...");
        solveCaptcha = solveAntiCaptcha;
        apiKey = await askApiKey("Anti-Captcha");
    } else if (userChoice === "2") {
        log.info("Using 2Captcha Solver...");
        solveCaptcha = solve2Captcha;
        apiKey = await askApiKey("2Captcha");
    } else {
        log.error("Invalid choice! Exiting...");
        process.exit(1);
    }

    const useProxy = await askProxyOption();
    let proxies = [];
    let proxyIndex = 0;

    if (useProxy) {
        proxies = readProxies();
        if (proxies.length === 0) {
            log.error("No proxies found! Exiting...");
            process.exit(1);
        }
    }

    // Track processed wallets to avoid duplicates
    const processedWallets = new Set();
    
    while (true) {
        const availableWallets = [];
        const processingPromises = [];

        // Find unique available wallets
        for (const wallet of wallets) {
            if (processedWallets.has(wallet.address)) continue;
            
            const remainingDelay = getRemainingDelay(wallet.address);
            if (remainingDelay === 0) {
                availableWallets.push(wallet);
                if (availableWallets.length >= CONCURRENT_TASKS) break;
            }
        }

        if (availableWallets.length === 0) {
            // Find the shortest wait time among all wallets
            let shortestWait = Infinity;
            for (const wallet of wallets) {
                const waitTime = getRemainingDelay(wallet.address);
                if (waitTime > 0 && waitTime < shortestWait) {
                    shortestWait = waitTime;
                }
            }

            if (shortestWait !== Infinity) {
                const minutesToWait = Math.ceil(shortestWait / 60000);
                log.info(chalk.yellow(`All wallets are in waiting period. Sleeping for ${minutesToWait} minutes...`));
                await sleep(shortestWait);
            } else {
                log.info("All wallets processed. Exiting...");
                process.exit(0);
            }
            continue;
        }

        // Process available wallets in parallel
        for (const wallet of availableWallets) {
            const proxy = useProxy ? proxies[proxyIndex++ % proxies.length] : null;
            processingPromises.push(
                processWalletParallel(wallet, solveCaptcha, apiKey, proxy)
                    .then(success => {
                        if (success) {
                            processedWallets.add(wallet.address);
                        }
                    })
            );
        }

        // Wait for all parallel processes to complete
        await Promise.all(processingPromises);
        await sleep(5000); // Small delay between batch processing
    }
}

async function getFaucetAll() {
    log.warn(banner);
    
    const wallets = readWallets();
    if (!wallets) {
        log.error("Please Create new wallets first...");
        process.exit(1);
    }
    log.info(`Found ${wallets.length} existing wallets...`);

    const userChoice = await askUserOption();
    let solveCaptcha;
    let apiKey;

    if (userChoice === "1") {
        log.info("Using Anti-Captcha Solver...");
        solveCaptcha = solveAntiCaptcha;
        apiKey = await askApiKey("Anti-Captcha");
    } else if (userChoice === "2") {
        log.info("Using 2Captcha Solver...");
        solveCaptcha = solve2Captcha;
        apiKey = await askApiKey("2Captcha");
    } else {
        log.error("Invalid choice! Exiting...");
        process.exit(1);
    }

    const useProxy = await askProxyOption();
    let proxies = [];
    let proxyIndex = 0;

    if (useProxy) {
        proxies = readProxies();
        if (proxies.length === 0) {
            log.error("No proxies found! Exiting...");
            process.exit(1);
        }
    }

    while (true) {
        const next = await getNextWalletToProcess(wallets);

        // If we got a wallet object directly, process it
        if (next.address) {
            const wallet = next;
            log.info(`=== Starting Getting Faucet for wallet ${wallet.address} ===`);

            const proxy = useProxy ? proxies[proxyIndex] : null;
            
            try {
                const payloadFaucet = {
                    chain_id: 18880,
                    to: wallet.address,
                    cf_turnstile_response: await solveCaptcha(apiKey),
                };

                const faucet = await getFaucet(payloadFaucet, proxy);

                if (faucet.message === 'Success') {
                    log.info(chalk.green(`Faucet Success https://blockscout-testnet.expchain.ai/address/${wallet.address}`));
                    updateWalletDelay(wallet.address, 10 * 60 * 1000, "Server cooldown period");
                } else {
                    const waitTime = parseWaitTime(faucet.data);
                    if (waitTime) {
                        updateWalletDelay(wallet.address, waitTime, faucet.data);
                    } else {
                        log.error(chalk.red(`${faucet.data || 'Unknown error'} Claim Faucet Failed...`));
                    }
                }
            } catch (error) {
                log.error(chalk.red(`Error processing wallet ${wallet.address}: ${error.message}`));
            }

            if (useProxy) {
                proxyIndex = (proxyIndex + 1) % proxies.length;
            }

            log.info(`== Moving to next wallet ==`);
            await sleep(5000); // Small delay between attempts
        }
        // If we got a wait time, sleep until next available wallet
        else if (next.waitTime !== Infinity) {
            const minutesToWait = Math.ceil(next.waitTime / 60000);
            log.info(chalk.yellow(`All wallets are in waiting period. Sleeping for ${minutesToWait} minutes...`));
            await sleep(next.waitTime);
        }
        // If something went wrong, use a safe default delay
        else {
            await sleep(30000);
        }
    }
}

// Add option to choose between parallel and sequential execution
async function main() {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    const answer = await new Promise((resolve) => {
        rl.question(
            "Choose execution mode:\n1. Sequential (Original)\n2. Parallel\nEnter your choice (1/2): ",
            (answer) => {
                rl.close();
                resolve(answer);
            }
        );
    });

    if (answer === "1") {
        await getFaucetAll();
    } else if (answer === "2") {
        await getFaucetAllParallel();
    } else {
        log.error("Invalid choice! Exiting...");
        process.exit(1);
    }
}

main();
