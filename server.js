const WebSocket = require('ws');
const fetch = require('node-fetch').default;
require('dotenv').config();
const cron = require('node-cron');
const express = require('express');
const app = express();
const chat_id = "1856656765";
const port = process.env.PORT || 3000;

const Alpaca = require("@alpacahq/alpaca-trade-api");
const alpaca = new Alpaca({
    keyId: process.env.ALPACA_API_KEY_ID,
    secretKey: process.env.ALPACA_API_SECRET_KEY,
    paper: true,
});

const { GoogleGenerativeAI } = require("@google/generative-ai");

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const generativeModel = genAI.getGenerativeModel({ model: "gemini-pro" });

let wss;

function startWebSocket() {
    wss = new WebSocket("wss://stream.data.alpaca.markets/v1beta1/news");

    wss.on('open', function() {
        console.log("Websocket connected!");
        sendMessageToTelegram('Me conecté correctamente', chat_id);

        const authMsg = {
            action: 'auth',
            key: process.env.ALPACA_API_KEY_ID,
            secret: process.env.ALPACA_API_SECRET_KEY
        };
        wss.send(JSON.stringify(authMsg));

        const subscribeMsg = {
            action: 'subscribe',
            news: ['*']
        };
        wss.send(JSON.stringify(subscribeMsg));
    });

    wss.on('message', async function(message) {
        try {
            console.log("Message is " + message);

            const currentEvent = JSON.parse(message)[0];

            if (currentEvent.T === "n") {
                const question = "Given the headline '" + currentEvent.headline + "', show me a number from 1-100 detailing the impact of this headline.";
                const apiRequestBodyGPT = {
                    model: "gpt-3.5-turbo-0125",
                    messages: [
                        { role: "system", content: "Only respond with a number from 1-100 detailing the impact of the headline." },
                        { role: "user", content: question }
                    ]
                };

                const responseGPT = await fetch("https://api.openai.com/v1/chat/completions", {
                    method: "POST",
                    headers: {
                        "Authorization": "Bearer " + process.env.OPENAI_API_KEY,
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify(apiRequestBodyGPT)
                });

                if (!responseGPT.ok) {
                    throw new Error('Failed to fetch ChatGPT completion');
                }

                const dataGPT = await responseGPT.json();
                const companyImpactGPT = parseInt(dataGPT.choices[0].message.content);

                const requestGemini = {
                    contents: [{ role: 'user', parts: [{ text: question }] }],
                };
                const result = await generativeModel.generateContent(requestGemini);
                const responseGemini = await result.response;
                const geminiContent = responseGemini.text();
                const companyImpactGemini = extractCompanyImpact(geminiContent);
                const tickerSymbol = currentEvent.symbols[0];

                console.log(companyImpactGemini);
                console.log(companyImpactGPT);

                const grupo_chat_id = "-1002057046707";
                let multiplicador = "BUENA";
                if ((companyImpactGPT >= 85 && companyImpactGemini >= 80) || (companyImpactGPT >= 80 && companyImpactGemini >= 85) || (companyImpactGPT >= 90) || (companyImpactGemini >= 90)) {
                    multiplicador = "MUY BUENA";
                }
                if ((companyImpactGPT >= 93 && companyImpactGemini >= 90) || (companyImpactGPT >= 90 && companyImpactGemini >= 93) || (companyImpactGPT >= 95) || (companyImpactGemini >= 95)) {
                    multiplicador = "EXCELENTE";
                }
                if ((companyImpactGPT >= 75 && companyImpactGemini >= 70) || (companyImpactGPT >= 70 && companyImpactGemini >= 75) || (companyImpactGPT >= 80) || (companyImpactGemini >= 80)) {
                    const messageTelegram = "Comprar acciones de " + tickerSymbol + ", la oportunidad es " + multiplicador + "\n " +
                        "Los valores de las IA son:\n" +
                        companyImpactGPT + " de chat GPT\n" +
                        companyImpactGemini + " de Gemini";
                    sendMessageToTelegram(messageTelegram, grupo_chat_id);
                } else if ((companyImpactGemini > 1 && companyImpactGemini <= 30 && companyImpactGPT <= 30)) {
                    const messageTelegram = "Vender acciones de " + tickerSymbol + "\n" +
                        "Los valores son:\n" +
                        companyImpactGPT + " de chat GPT\n" +
                        companyImpactGemini + " de Gemini";
                    sendMessageToTelegram(messageTelegram, grupo_chat_id);
                }
            }
        } catch (error) {
            console.error('Error processing WebSocket message:', error);
        }
    });

    wss.on('close', function() {
        console.log("Websocket disconnected!");
        sendMessageToTelegram('¡El websocket se ha desconectado!', chat_id);
        // Reconnect
        setTimeout(startWebSocket, 10000); // Attempt reconnection after 10 seconds
    });

    wss.on('error', function(error) {
        console.error('WebSocket error:', error);
        wss.close(); // Close the connection on error and trigger reconnection
    });
}

function extractCompanyImpact(generatedText) {
    const numberPattern = /\b\d+\b/;
    const match = generatedText.match(numberPattern);

    if (match && match.length > 0) {
        const companyImpact = parseInt(match[0]);
        return companyImpact;
    } else {
        return 0;
    }
}

async function sendMessageToTelegram(message, chat_id) {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const apiUrl = `https://api.telegram.org/bot${botToken}/sendMessage`;
    const requestBody = {
        chat_id: chat_id,
        text: message
    };

    try {
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody)
        });

        const responseData = await response.json();
        console.log('Message sent successfully:', responseData);
    } catch (error) {
        console.error('Failed to send message:', error);
    }
}

function restartWebSocket() {
    console.log('Reiniciando WebSocket...');
    if (wss) {
        wss.close();
    } else {
        startWebSocket();
    }
}

app.listen(port, () => {
    console.log(`Servidor escuchando en el puerto ${port}`);
    startWebSocket();
});

cron.schedule('0 * * * *', () => {
    restartWebSocket();
});

cron.schedule('*/30 * * * *', () => {
    sendMessageToTelegram('Sigo funcionando', chat_id);
    console.log('Sending message every 30 minutes...');
});
