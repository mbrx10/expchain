import fs from 'fs';
import readline from 'readline';
import log from './logger.js';

export async function askQuestion(question) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    return new Promise((resolve) => {
        rl.question(question, (answer) => {
            rl.close();
            resolve(answer);
        });
    });
}


export function readWallets() {
    if (fs.existsSync("wallets.json")) {
        const data = fs.readFileSync("wallets.json");
        return JSON.parse(data);
    } else {
        log.info("No wallets found in wallets.json");
        return [];
    }
}


export function readProxies() {
    if (fs.existsSync("proxies.txt")) {
        const data = fs.readFileSync("proxies.txt", 'utf-8');
        const proxies = data.split('\n').filter(Boolean); 
        return proxies;
    } else {
        log.error("No proxies found in proxies.txt");
        return [];
    }
}
