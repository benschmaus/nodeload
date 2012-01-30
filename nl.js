#!/usr/bin/env node
/*
 Copyright (c) 2010 Benjamin Schmaus
 Copyright (c) 2010 Jonathan Lee 

 Permission is hereby granted, free of charge, to any person
 obtaining a copy of this software and associated documentation
 files (the "Software"), to deal in the Software without
 restriction, including without limitation the rights to use,
 copy, modify, merge, publish, distribute, sublicense, and/or sell
 copies of the Software, and to permit persons to whom the
 Software is furnished to do so, subject to the following
 conditions:

 The above copyright notice and this permission notice shall be
 included in all copies or substantial portions of the Software.

 THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
 EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES
 OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
 NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
 HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
 WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
 FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR
 OTHER DEALINGS IN THE SOFTWARE.
*/

/*jslint sub:true */

var options = require('./lib/nl/options');
options.process();

if (!options.get('url')) {
    options.help();
}

var nl = require('./nodeload')
            .quiet()
            .setMonitorIntervalMs(options.get('reportInterval') * 1000);

function puts(text) { if (!options.get('quiet')) { console.log(text); } }
function pad(str, width) { return str + (new Array(width-str.length)).join(' '); }
function printItem(name, val, padLength) {
    if (padLength === undefined) { padLength = 40; }
    puts(pad(name + ':', padLength) + ' ' + val);
}

var testStart;
var host = options.get('host');
var test = nl.run({
    name: host,
    host: options.get('host'),
    port: options.get('port'),
    requestGenerator: options.get('requestGenerator'),
    method: options.get('method'),
    path: options.get('path'),
    requestData: options.get('requestData'),
    numUsers: options.get('numClients'),
    numRequests: options.get('numRequests'),
    timeLimit: options.get('timeLimit'),
    targetRps: options.get('targetRps'),
    stats: ['latency', 'result-codes', 'request-bytes', 'response-bytes']
});

test.on('start', function(tests) { testStart = new Date(); });
test.on('update', function(interval, stats) {
    puts(pad('Completed ' +stats[host]['result-codes'].length+ ' requests', 40));
});
test.on('end', function() {

    var stats = test.stats[host];
    var elapsedSeconds = ((new Date()) - testStart)/1000;

    puts('');
    printItem('Server', options.get('host') + ':' + options.get('port'));

    if (options.get('requestGeneratorModule') === undefined) {
        printItem('HTTP Method', options.get('method'));
        printItem('Document Path', options.get('path'));
    } else {
        printItem('Request Generator', options.get('requestGeneratorModule'));
    }

    printItem('Concurrency Level', options.get('numClients'));
    printItem('Number of requests', stats['result-codes'].length);
    printItem('Body bytes transferred', stats['request-bytes'].total + stats['response-bytes'].total);
    printItem('Elapsed time (s)', elapsedSeconds.toFixed(2));
    printItem('Requests per second', (stats['result-codes'].length/elapsedSeconds).toFixed(2));
    printItem('Mean time per request (ms)', stats['latency'].mean().toFixed(2));
    printItem('Time per request standard deviation', stats['latency'].stddev().toFixed(2));
    
    puts('\nPercentages of requests served within a certain time (ms)');
    printItem('  Min', stats['latency'].min, 6);
    printItem('  Avg', stats['latency'].mean().toFixed(1), 6);
    printItem('  50%', stats['latency'].percentile(0.5), 6);
    printItem('  95%', stats['latency'].percentile(0.95), 6);
    printItem('  99%', stats['latency'].percentile(0.99), 6);
    printItem('  Max', stats['latency'].max, 6);

    process.exit(0);
});
test.start();