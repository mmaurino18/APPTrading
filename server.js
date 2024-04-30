// Importar módulos necesarios
//const http = require('http');
const WebSocket = require('ws');
const fetch = require('node-fetch').default;
require('dotenv').config(); // Cargar las variables de entorno desde .env

const express = require('express');
const app = express();
const port = process.env.PORT || 3000; // Usar el puerto definido en la variable de entorno PORT o el puerto 3000 por defecto
app.listen(port, () => {
  console.log(`Servidor escuchando en el puerto ${port}`);
});

//const server = http.createServer();
// Configurar instancia de Alpaca con las claves de API
const Alpaca = require("@alpacahq/alpaca-trade-api");
const alpaca = new Alpaca({
    keyId: process.env.ALPACA_API_KEY_ID,
    secretKey: process.env.ALPACA_API_SECRET_KEY,
    paper: true, // Usar el entorno de pruebas (paper trading)
});

const { GoogleGenerativeAI } = require("@google/generative-ai");

// Access your API key as an environment variable (see "Set up your API key" above)
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const generativeModel = genAI.getGenerativeModel({ model: "gemini-pro"});
// Crear conexión websocket con el servicio de noticias de Alpaca
const wss = new WebSocket("wss://stream.data.alpaca.markets/v1beta1/news");

// Manejar eventos de apertura y mensajes de la conexión websocket
wss.on('open', function() {
    console.log("Websocket connected!");
    const chat_id= "1856656765"
    sendMessageToTelegram('Me conecte correctamente',chat_id);
    // Autenticarse con el servicio de noticias de Alpaca
    const authMsg = {
        action: 'auth',
        key: process.env.ALPACA_API_KEY_ID,
        secret: process.env.ALPACA_API_SECRET_KEY
    };
    wss.send(JSON.stringify(authMsg)); // Enviar datos de autenticación al websocket

    // Suscribirse a todos los feeds de noticias
    const subscribeMsg = {
        action: 'subscribe',
        news: ['*'] // Suscribirse a todas las noticias
    };
    wss.send(JSON.stringify(subscribeMsg)); // Conectar a la fuente de datos en vivo de noticias
});

// Manejar mensajes recibidos a través del websocket
wss.on('message', async function(message) {
    try {
        console.log("Message is " + message);

        // Parsear el mensaje JSON recibido
        const currentEvent = JSON.parse(message)[0];

        // Verificar si el evento es una noticia ('n' representa una noticia)
        if (currentEvent.T === "n") {

            // Preparar solicitud para ChatGPT con la noticia actual
            const question = "Given the headline '" + currentEvent.headline + "', show me a number from 1-100 detailing the impact of this headline.";
            const apiRequestBodyGPT = {
                model: "gpt-3.5-turbo-0125",
                messages: [
                    { role: "system", content: "Only respond with a number from 1-100 detailing the impact of the headline." },
                    { role: "user", content: question }
                ]
            };
            // Enviar solicitud a la API de OpenAI (ChatGPT)
            const responseGPT = await fetch("https://api.openai.com/v1/chat/completions", {
                method: "POST",
                headers: {
                    "Authorization": "Bearer " + process.env.OPENAI_API_KEY,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(apiRequestBodyGPT)
            });

            // Verificar la respuesta de la API de OpenAI
            if (!responseGPT.ok) {
                throw new Error('Failed to fetch ChatGPT completion');
            }
            /*.catch((error) => {
                console.log(error)
              });*/

            // Obtener datos de la respuesta JSON
            const dataGPT = await responseGPT.json();
            const companyImpactGPT = parseInt(dataGPT.choices[0].message.content);
            
            //GEMINI
            const requestGemini = {
                contents: [{role: 'user', parts: [{text: question}]}],
              };
            const result = await generativeModel.generateContent(requestGemini);
            const responseGemini = await result.response;
            const geminiContent = responseGemini.text();
            //console.log(geminiContent);
            const companyImpactGemini = extractCompanyImpact(geminiContent);
            const tickerSymbol = currentEvent.symbols[0];

            console.log(companyImpactGemini);
            console.log(companyImpactGPT);

            //const tickerSymbol2 = 'AAPL';
            //const latestQuote = await alpaca.getLatestQuote(tickerSymbol);

            //const currentPrice = latestQuote.c;
            //console.log(`Current price of ${tickerSymbol}: ${currentPrice}`);
            //const barset = await alpaca.getBarsV2("minute", tickerSymbol, { limit: 1 });
            //const bars = barset[tickerSymbol2];
            /*alpaca.getLatestTrade(tickerSymbol).then((trade) => {
                console.log(`El precio actual de ${symbol} es ${trade.price}`);
              }).catch((error) => {
                console.log('Hubo un error al obtener el precio:', error);
              });*/
            //const currentPrice2 = bars.slice(-1)[0].c;
            //console.log(currentPrice2);
            /*.lastQuote('AAPL').then((response) => {
                console.log(response);
              });*/
            //const currentPrice = bars[bars.length - 1].c
            //const roundedNotional = parseFloat(notionalAmount.toFixed(2));
            const grupo_chat_id = "-1002057046707";
            let multiplicador = "BUENA";
            if((companyImpactGPT >= 85 && companyImpactGemini >= 80)||(companyImpactGPT >= 80 && companyImpactGemini >= 85)||(companyImpactGPT >= 90)||(companyImpactGemini >= 90)){
                multiplicador= "MUY BUENA";
            }
            if((companyImpactGPT >= 93 && companyImpactGemini >= 90)||(companyImpactGPT >= 90 && companyImpactGemini >= 93)||(companyImpactGPT >= 95)||(companyImpactGemini >= 95)){
                multiplicador= "EXCELENTE";
            }
            if((companyImpactGPT >= 75 && companyImpactGemini >= 70)||(companyImpactGPT >= 70 && companyImpactGemini >= 75)||(companyImpactGPT >= 80)||(companyImpactGemini >= 80)) {
                /*const order = await alpaca.createOrder({
                    symbol: tickerSymbol,  // Símbolo del activo que deseas comprar (por ejemplo, 'AAPL' para Apple)
                    notional: 1000 * multiplicador,
                    //qty:1  // El monto total a invertir, como un porcentaje del poder de compra disponible
                    side: 'buy',  // Indica que esta es una orden de compra
                    type: 'market',  // Tipo de orden: 'market' para comprar al precio de mercado actual
                    time_in_force: 'day',  // Duración de la orden: 'day' para que la orden expire al final del día
                    //limit_price: account.buying_power * 0.9,  // Precio límite de la orden (no se usa en una orden de mercado)
                     // Clase de orden: 'bracket' para una orden con órdenes de take-profit y stop-loss adjuntas
                    /*take_profit: {
                        limit_price: currentPrice  * 1.15,  // Precio límite para la orden de take-profit (15% por encima del precio de compra)
                    },
                    stop_loss: {
                        stop_price: currentPrice  * 0.65,  // Precio límite para la orden de take-profit (15% por encima del precio de compra)
                    },
                });
                console.log("Order placed:", order);*/
                const messageTelegram = "Comprar acciones de " + tickerSymbol + ", la oportunidad es " + multiplicador + "\n "   
                                        + "Los valores de las IA son:\n" 
                                        + companyImpactGPT + " de chat GPT\n"
                                        + companyImpactGemini + " de Gemini";

                sendMessageToTelegram(messageTelegram, grupo_chat_id);
            } else if ((companyImpactGPT <= 30) && (companyImpactGemini >1 && companyImpactGemini<= 30) ) {
                // Vender todas las acciones de la empresa
                /*const closedPosition = await alpaca.closePosition(tickerSymbol);
                console.log("Position closed for", tickerSymbol);*/
                const messageTelegram = "Vender acciones de " + tickerSymbol + "\n"   
                + "Los valores son:\n" 
                + companyImpactGPT + " de chat GPT\n"
                + companyImpactGemini + " de Gemini";
                sendMessageToTelegram(messageTelegram, grupo_chat_id);
            }
        }
    } catch (error) {
        console.error('Error processing WebSocket message:', error);
    }
});

function extractCompanyImpact(generatedText) {
    const numberPattern = /\b\d+\b/; // Expresión regular para encontrar números enteros en el texto
    const match = generatedText.match(numberPattern);

    if (match && match.length > 0) {
        const companyImpact = parseInt(match[0]);
        return companyImpact;
    } else {
        return 0; // Devuelve NaN si no se puede encontrar un número entero válido en el texto
    }
}

async function sendMessageToTelegram(message,chat_id) {
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
wss.on('close', function() {
    console.log("Websocket disconnected!");
    const chat_id = "1856656765"; // El ID del chat al que deseas enviar la notificación
    sendMessageToTelegram('¡El websocket se ha desconectado!', chat_id);
});