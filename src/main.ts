import cron from 'node-cron';
import dotenv from 'dotenv';
import path from 'path';
import { Client, GatewayIntentBits, TextChannel } from 'discord.js';
import { fileURLToPath } from 'url';
import { runMarketAnalysisPipeline } from './lib/analyze.js';
import { saveSignalsAndReportsToFirestore } from './lib/firestore.js';
import { PriceManager } from './lib/websocket.js';
import { TradingBotManager } from './lib/trade.js';
import SYMBOLS from './data/symbols.json' with { type: 'json' };
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });
const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages]
});

const BOT_TOKEN = process.env.BOT_TOKEN as string;
const TARGET_CHANNEL_ID = '1559964513824940184';

// websocket止損止盈計算
const priceManager = new PriceManager(SYMBOLS);
priceManager.connect();
priceManager.startMonitoringServices();

// 分析組合包
async function sendAnalysisReport() {
    try {
        // const channel = await client.channels.fetch(TARGET_CHANNEL_ID) as TextChannel;
        // if (!channel) return;
        const { marketDataReports, messageChunks, signals } = await runMarketAnalysisPipeline();
        // await channel.send(`# ${headerTitle}`);
        // for (const chunk of messageChunks) {
        //     await channel.send(chunk);
        // }
        await saveSignalsAndReportsToFirestore(signals, marketDataReports);
    } catch (error) {
        console.error('❌ 定時發送分析報告失敗：', error);
    }
}


// discord傳送
client.once('ready', async () => {
    console.log(`機器人已成功登入：${client.user?.tag}`);
    const bot = new TradingBotManager();
    const channel = await client.channels.fetch(TARGET_CHANNEL_ID) as TextChannel;
    bot.startOpenOrdersTimeoutMonitor((symbol, entryPrice, side) => {
        channel.send(`收到逾時通知 -> 幣種: ${symbol}, 掛單價: ${entryPrice}, 方向: ${side}`);
    });
    // await sendAnalysisReport('【趨勢分析】');
    cron.schedule('0 */2 * * *', async () => {
        await sendAnalysisReport();
    });
});


client.login(BOT_TOKEN);