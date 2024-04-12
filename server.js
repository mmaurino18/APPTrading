// Importar módulos necesarios
const WebSocket = require('ws');
const fetch = require('node-fetch').default;
require('dotenv').config(); // Cargar las variables de entorno desde .env

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
                model: "gpt-3.5-turbo",
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

            // Obtener datos de la respuesta JSON
            const dataGPT = await responseGPT.json();
            //console.log(dataGPT);
            //console.log(dataGPT.choices[0].message);

            // Extraer el impacto estimado de la respuesta de ChatGPT
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
            if ((companyImpactGPT >= 75 && companyImpactGemini >= 70) || (companyImpactGPT >= 70 && companyImpactGemini >= 75)) {
                // Comprar acciones
                const order = await alpaca.createOrder({
                    symbol: tickerSymbol,
                    qty: 1,
                    side: 'buy',
                    type: 'market',
                    time_in_force: 'day' // Orden válida solo durante el día
                });
                console.log("Order placed:", order);
            } else if (companyImpactGPT <= 30) {
                // Vender todas las acciones de la empresa
                const closedPosition = await alpaca.closePosition(tickerSymbol);
                console.log("Position closed for", tickerSymbol);
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
        return NaN; // Devuelve NaN si no se puede encontrar un número entero válido en el texto
    }
}