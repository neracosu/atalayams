'use strict';
// Un puerto libre de verdad para las pruebas que levantan un servidor. Elegirlo al azar chocaba de vez en cuando
// con algo que ya estuviera escuchando (un simulador abierto) y la prueba fallaba sin que nada estuviera roto.
const { execFileSync } = require('child_process');
module.exports = () => Number(execFileSync(process.execPath, ['-e',
  "const s = require('net').createServer().listen(0, '127.0.0.1', () => { process.stdout.write(String(s.address().port)); s.close(); })"], { encoding: 'utf8' }));
