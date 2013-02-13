// ------------------------------------
// Main HTTP load testing interface
// ------------------------------------
//
// This file defines run(), LoadTest, createClient() and extendClient().
//
// This file defines the main API for using nodeload to construct load tests. The main function for
// starting a load test is run(). Nodeload modules, such as monitoring.js and reporting.js, can also be
// used independently.
//
/*jslint laxbreak: true */
var BUILD_AS_SINGLE_FILE;
if (BUILD_AS_SINGLE_FILE === undefined) {
var http = require('http');
var util = require('./util');
var stats = require('./stats');
var reporting = require('./reporting');
var qputs = util.qputs;
var qprint = util.qprint;
var EventEmitter = require('events').EventEmitter;
var MultiLoop = require('./loop').MultiLoop;
var MultiUserLoop = require('./loop/multiuserloop').MultiUserLoop;
var Monitor = require('./monitoring').Monitor;
var Report = reporting.Report;
var LogFile = stats.LogFile;

var NODELOAD_CONFIG = require('./config').NODELOAD_CONFIG;
var START = NODELOAD_CONFIG.START;
var REPORT_MANAGER = reporting.REPORT_MANAGER;
var HTTP_SERVER = require('./http').HTTP_SERVER;


var Program = exports.Program = require('./user/program').Program;
require('./user/http_program').install(Program);
}

/** TEST_OPTIONS defines all of the parameters that can be set in a test specifiction passed to
run(). By default (calling require('nodeload').run({});), will GET localhost:8080/ as fast as possible
with 10 users for 2 minutes. */
var TEST_OPTIONS = {
    name: 'Debug test',                     // A descriptive name for the test

                                            // Specify one of:
    host: 'localhost',                      //   1. (host, port) to connect to via HTTP
    port: 8080,                             //
                                            //
    connectionGenerator: undefined,         //   2. connectionGenerator(), called once for each user.
                                            //      The return value is passed as-is to requestGenerator,
                                            //      requestLoop, or used internally to generate requests
                                            //      when using (method + path + requestData).

                                            // Specify one of:
    requestGenerator: undefined,            //   1. requestGenerator: a function
                                            //         function(http.Client) ->  http.ClientRequest
    requestLoop: undefined,                 //   2. requestLoop: is a function
                                            //         function(finished, http.Client)
    method: 'GET',                          //     If must call:
    path: '/',                              //         finished({
    requestData: undefined,                 //             req: http.ClientRequest,
                                            //             res: http.ClientResponse});
                                            //     after each transaction to finishes to schedule the
                                            //     next iteration of requestLoop.
                                            //   3. (method + path + requestData) specify a single URL to
                                            //     test
                                            //

                                            // Specify one of:
    numUsers: 10,                           //   1. numUsers: number of virtual users concurrently
                                            //      executing therequest loop
    loadProfile: undefined,                 //   2. loadProfile: array with requests/sec over time:
                                            //        [[time (seconds), rps], [time 2, rps], ...]
                                            //      For example, ramp up from 100 to 500 rps and then
                                            //      down to 0 over 20 seconds:
                                            //        [[0, 100], [10, 500], [20, 0]]

                                            // Specify one of:
    targetRps: Infinity,                    //   1. targetRps: times per second to execute request loop
    userProfile: undefined,                 //   2. userProfile: array with number of users over time:
                                            //        [[time (seconds), # users], [time 2, users], ...]
                                            //      For example, ramp up from 0 to 100 users and back
                                            //      down to 0 over 20 seconds:
                                            //        [[0, 0], [10, 100], [20, 0]]

    numRequests: Infinity,                  // Maximum number of iterations of request loop
    timeLimit: 120,                         // Maximum duration of test in seconds
    delay: 0,                               // Seconds before starting test

    stats: ['latency',                      // Specify list of: 'latency', 'result-codes', 'uniques',
            'result-codes'],                // 'concurrency', 'http-errors'. These following statistics
                                            // may also be specified with parameters:
                                            //
                                            //     { name: 'latency', percentiles: [0.9, 0.99] }
                                            //     { name: 'http-errors', successCodes: [200,404], log: 'http-errors.log' }
                                            //
                                            // Extend this list of statistics by adding to the
                                            // monitor.js#Monitor.Monitors object.
                                            //
                                            // Note:
                                            // - for 'uniques', traceableRequest() must be used
                                            //   to create the ClientRequest or only 2 will be detected.
};

var LoadTest, generateConnection, requestGeneratorLoop;

/** run(spec, ...) is the primary method for creating and executing load tests with nodeload. See
TEST_OPTIONS for a list of the configuration values in each specification.

@return A LoadTest object with start() / stop() methods, emits 'start' / 'end', and holds statistics
        in .interval and .stats. See LoadTest below.
*/
var run = exports.run = function(specs) {
    specs = (specs instanceof Array) ? specs : util.argarray(arguments);
    var tests = specs.map(function(spec) {
        spec = util.defaults(spec, TEST_OPTIONS);
        var generateRequest = function(client) {
                if (spec.requestGenerator) { return spec.requestGenerator(client); }
                var request = client.request(spec.method, spec.path, { 'host': spec.host });
                if (spec.requestData) {
                    request.write(spec.requestData);
                }
                return request;
            },
            monitor = new Monitor(spec.stats),
            report = new Report(spec.name).updateFromMonitor(monitor),
            loop = null;

        if (spec.userProgram) {
            loop = new MultiUserLoop({
                userProgram: spec.userProgram,
                programArguments: spec.programArguments,
                concurrencyProfile: spec.userProfile || [[0, spec.numUsers]],
                duration: spec.timeLimit,
                numberOfTimes: spec.numRequests,
            });
        }
        else {
            loop = new MultiLoop({
                fun: spec.requestLoop || requestGeneratorLoop(generateRequest),
                argGenerator: spec.connectionGenerator || generateConnection(spec.host, spec.port, !spec.requestLoop),
                concurrencyProfile: spec.userProfile || [[0, spec.numUsers]],
                rpsProfile: spec.loadProfile || [[0, spec.targetRps]],
                duration: spec.timeLimit,
                numberOfTimes: spec.numRequests,
                delay: spec.delay
            })
        }

        loop.on('add', function(loops) {
            monitor.monitorObjects(loops, 'startiteration', 'enditeration');
        });
        REPORT_MANAGER.addReport(report);
        monitor.name = spec.name;
        monitor.setLoggingEnabled(NODELOAD_CONFIG.LOGS_ENABLED);

        return {
            spec: spec,
            loop: loop,
            monitor: monitor,
            report: report,
        };
    });

    var loadtest = new LoadTest(tests).start();
    return loadtest;
};

/** LoadTest can be started & stopped. Starting it will fire up the global HTTP_SERVER if it is not
started. Stopping LoadTest will shut HTTP_SERVER down. The expectation is that only one LoadTest instance
is normally running at a time, and when the test finishes, you usually want to let the process end, which
requires stopping HTTP_SERVER. Set loadtest.keepAlive=true to not shut down HTTP_SERVER when done.

LoadTest contains the members:

    - tests: a list of the test objects created by run() from each spec, which contains:
        spec: original specification used by run to create this test object
        loop: a MultiLoop instance that represents all the "vusers" for this job
        monitor: a Monitor instance tracking stats from the MultiLoop instance, loop
        report: a Report which is tracked by REPORT_MANAGER holding a chart for every stat in monitor
    - interval: statistics gathered since the last 'update' event
    - stats: cumulative statistics
    - updateInterval: milliseconds between 'update' events, which includes statistics from the previous
      interval as well as overall statistics. Defaults to 2 seconds.

LoadTest emits these events:

- 'update', interval, stats: interval has stats since last update. stats contains overall stats.
- 'end': all tests finished

*/
var LoadTest = exports.LoadTest = function LoadTest(tests) {
    EventEmitter.call(this);
    util.PeriodicUpdater.call(this);

    var self = this;
    self.tests = tests;
    self.updateInterval = NODELOAD_CONFIG.MONITOR_INTERVAL_MS;
    self.interval = {};
    self.stats = {};
    self.tests.forEach(function(test) {
        self.interval[test.spec.name] = test.monitor.interval;
        self.stats[test.spec.name] = test.monitor.stats;
    });
    self.finishChecker_ = this.checkFinished_.bind(this);
};

util.inherits(LoadTest, EventEmitter);

/** Start running the load test. Starts HTTP_SERVER if it is stopped (unless disabled globally). */
LoadTest.prototype.start = function(keepAlive) {
    var self = this;
    self.keepAlive = keepAlive;

    // clients can catch 'start' event even after calling start().
    process.nextTick(self.emit.bind(self, 'start'));
    self.tests.forEach(function(test) {
        test.loop.start();
        test.loop.on('end', self.finishChecker_);
    });

    if (!HTTP_SERVER.running && NODELOAD_CONFIG.HTTP_ENABLED) {
        HTTP_SERVER.start(NODELOAD_CONFIG.HTTP_PORT);
    }

    return self;
};

/** Force the load test to stop. */
LoadTest.prototype.stop = function() {
    this.tests.forEach(function(t) { t.loop.stop(); });
    return this;
};

LoadTest.prototype.update = function() {
    this.emit('update', this.interval, this.stats);
    this.tests.forEach(function(t) { t.monitor.update(); });
    qprint('.');
};

LoadTest.prototype.checkFinished_ = function() {
    if (this.tests.some(function(t) { return t.loop.running; })) { return; }
    this.updateInterval = 0;
    this.update();
    qputs('Done.');

    if (!this.keepAlive) {
        HTTP_SERVER.stop();
    }

    this.emit('end');
};

/** extendClient extends an existing instance of http.Client by noting the request method and path.
Writing to new requests also emits the 'write' event. This client must be used when using nodeload to
when tracking 'uniques' and 'request-bytes'. */
var extendClient = exports.extendClient = function(client) {
    var wrappedRequest = client.request;
    client.request = function(method, url) {
        var request = wrappedRequest.apply(client, arguments),
            wrappedWrite = request.write,
            wrappedEnd = request.end,
            track = function(data) {
                if (data) {
                    request.emit('write', data);
                    request.body += data.toString();
                }
            };
        request.method = method;
        request.path = url;
        request.body = '';
        request.write = function(data, encoding) {
            track(data);
            return wrappedWrite.apply(request, arguments);
        };
        request.end = function(data, encoding) {
            track(data);
            return wrappedEnd.apply(request, arguments);
        };
        return request;
    };
    return client;
};

/** Same arguments as http.createClient. Returns an extended version of the object (see extendClient) */
var createClient = exports.createClient = function() {
    return extendClient(util.createReconnectingClient.apply(this, arguments));
};

/** Creates a new HTTP connection. This is used as an argGenerator for LoadTest's MultiLoop, so each
"user" gets its own connection. If the load test is using requestGeneratorLoop to generate its requests,
then we also need to terminate pending requests when client errors occur. We emit a fake 'response'
event, so that requestGeneratorLoop can finish its iteration. */
function generateConnection(host, port, detectClientErrors) {
    return function() {
        var client = createClient(port, host);
        if (detectClientErrors) {
            // we need to detect client errors if we're managing the request generation
            client.on('error', function(err) {
                qputs('WARN: Error during HTTP request: ' + (err ? err.toString() : 'unknown'));
            });
            client.on('reconnect', function(oldclient) {
                // For each pending outgoing request, simulate an empty response
                if (oldclient._outgoing) {
                    oldclient._outgoing.forEach(function(req) {
                        if (req instanceof http.ClientRequest) {
                            req.emit('response', new EventEmitter());
                        }
                    });
                }
            });
        }
        return client;
    };
}

/** Wrapper for request generator function, generator

@param generator A function:

                     function(http.Client) -> http.ClientRequest

                 The http.Client is provided by nodeload. The http.ClientRequest may contain an extra
                 .timeout field specifying the maximum milliseconds to wait for a response.

@return A Loop compatible function, function(loopFun, http.Client). Each iteration makes an HTTP
        request by calling generator. loopFun({req: http.ClientRequest, res: http.ClientResponse}) is
        called when the HTTP response is received or the request times out. */
function requestGeneratorLoop(generator) {
    return function(finished, client) {
        var running = true, timeoutId, request = generator(client);
        var callFinished = function(response) {
            if (running) {
                running = false;
                clearTimeout(timeoutId);
                response.statusCode = response.statusCode || 0;
                finished({req: request, res: response});
            }
        };
        if (request) {
            if (request.timeout > 0) {
                timeoutId = setTimeout(function() {
                                callFinished(new EventEmitter());
                            }, request.timeout);
            }
            request.on('response', function(response) {
                callFinished(response);
            });
            request.end();
        } else {
            finished(null);
        }
    };
}
