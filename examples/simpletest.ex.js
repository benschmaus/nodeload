#!/usr/bin/env node

// Self contained node.js HTTP server and a load test against it. Just run:
//
//     $ examples/simpletest.ex.js
//
var http = require('http');
var nl = require('../nodeload');
console.log("Test server on localhost:9000.");
http.createServer(function (req, res) {
    res.writeHead((Math.random() < 0.8) ? 200 : 404, {'Content-Type': 'text/plain'});
    res.end('foo\n');
}).listen(9000);

nl.run({
    name: "Read",
    host: 'localhost',
    port: 9000,
    numUsers: 10,
    timeLimit: 600,
    targetRps: 500,
    stats: [
        'result-codes', 
        { name: 'latency', percentiles: [0.9, 0.99] },
        'concurrency',
        'rps',
        'uniques',
        { name: 'http-errors', successCodes: [200,404], log: 'http-errors.log' }
    ],
    requestGenerator: function(client) {
        return client.request('GET', "/" + Math.floor(Math.random()*8000), { 'host': 'localhost' });
    }
});