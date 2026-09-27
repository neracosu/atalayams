'use strict';
// Atalaya Hosting: punto de entrada para "Setup Node.js App" de cPanel (Passenger) u otro hosting con Node.
// Corre sin root dentro de la cuenta: guarda sus datos en ~/.atalaya-data y recibe los envios del agente.
process.env.ATALAYA_EDITION = process.env.ATALAYA_EDITION || 'hosting';
require('./server/index.js');
